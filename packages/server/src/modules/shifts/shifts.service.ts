import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pos/database';
import { DomainError, shiftCashSummary } from '@pos/domain';
import type {
  CashRegister,
  MethodTotals,
  Shift,
  cashMovementSchema,
  closeShiftSchema,
  openShiftSchema,
} from '@pos/validation';
import type { z } from 'zod';
import type { Principal } from '../../common/auth/principal';
import { ChangeRecorder } from '../../prisma/change-recorder';
import { isUniqueViolation } from '../../prisma/errors';
import { PrismaService, type PrismaTx } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const shiftInclude = {
  cashRegister: true,
  cash: { orderBy: { createdAt: 'asc' } },
  payments: { where: { status: 'CAPTURED' } },
} satisfies Prisma.ShiftInclude;
type ShiftRow = Prisma.ShiftGetPayload<{ include: typeof shiftInclude }>;

/** Totals per payment method: charges, refunds and net, from captured payment rows. */
export function totalsByMethod(
  payments: readonly {
    paymentMethodId: string;
    methodType: MethodTotals['type'];
    methodNameEn: string;
    methodNameAr: string;
    type: 'CHARGE' | 'REFUND';
    amount: number;
  }[],
): MethodTotals[] {
  const map = new Map<string, MethodTotals>();
  for (const p of payments) {
    const entry = map.get(p.paymentMethodId) ?? {
      paymentMethodId: p.paymentMethodId,
      type: p.methodType,
      nameEn: p.methodNameEn,
      nameAr: p.methodNameAr,
      count: 0,
      charges: 0,
      refunds: 0,
      net: 0,
    };
    if (p.type === 'CHARGE') {
      entry.count += 1;
      entry.charges += p.amount;
    } else {
      entry.refunds += p.amount;
    }
    entry.net = entry.charges - entry.refunds;
    map.set(p.paymentMethodId, entry);
  }
  return [...map.values()].sort((a, b) => a.nameEn.localeCompare(b.nameEn));
}

/**
 * Shifts and the cash drawer. One open shift per drawer is guaranteed by a unique column that
 * holds the drawer id only while the shift is open. Closing snapshots the expected cash, the
 * counted cash and the difference.
 */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly changes: ChangeRecorder,
  ) {}

  async registers(locationId: string): Promise<CashRegister[]> {
    const rows = await this.prisma.cashRegister.findMany({
      where: { locationId, archivedAt: null },
      include: { shifts: { where: { status: 'OPEN' }, select: { id: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      locationId: r.locationId,
      nameEn: r.nameEn,
      nameAr: r.nameAr,
      openShiftId: r.shifts[0]?.id ?? null,
    }));
  }

  async list(
    locationId: string,
    status: 'OPEN' | 'CLOSED' | undefined,
    limit: number,
  ): Promise<Shift[]> {
    const rows = await this.prisma.shift.findMany({
      where: { locationId, ...(status ? { status } : {}) },
      include: shiftInclude,
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async get(locationId: string, shiftId: string): Promise<Shift> {
    return this.toDto(await this.load(this.prisma, locationId, shiftId));
  }

  async open(
    principal: Principal,
    locationId: string,
    input: z.output<typeof openShiftSchema>,
  ): Promise<Shift> {
    const existing = await this.prisma.shift.findUnique({ where: { id: input.id } });
    if (existing) {
      if (existing.locationId !== locationId)
        throw new DomainError('CONFLICT', 'Shift id already used', { reason: 'ID_IN_USE' });
      return this.get(locationId, input.id);
    }
    const register = await this.prisma.cashRegister.findFirst({
      where: { id: input.cashRegisterId, locationId, archivedAt: null },
    });
    if (!register) throw new DomainError('CASH_REGISTER_NOT_FOUND', 'Cash drawer not found');
    const location = await this.prisma.location.findUniqueOrThrow({ where: { id: locationId } });

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.shift.create({
          data: {
            id: input.id,
            restaurantId: location.restaurantId,
            locationId,
            cashRegisterId: register.id,
            status: 'OPEN',
            openRegisterId: register.id,
            openingFloat: input.openingFloat,
            openedById: principal.userId,
          },
        });
        await this.audit.record(
          {
            action: 'shift.opened',
            entityType: 'Shift',
            entityId: input.id,
            locationId,
            metadata: { cashRegisterId: register.id, openingFloat: input.openingFloat },
          },
          tx,
        );
        await this.changes.record(tx, { shiftIds: [input.id] });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const again = await this.prisma.shift.findUnique({ where: { id: input.id } });
        if (again) return this.get(locationId, input.id);
        throw new DomainError('SHIFT_ALREADY_OPEN', 'This cash drawer already has an open shift', {
          cashRegisterId: register.id,
        });
      }
      throw error;
    }
    return this.get(locationId, input.id);
  }

  async recordCashMovement(
    principal: Principal,
    locationId: string,
    shiftId: string,
    input: z.output<typeof cashMovementSchema>,
  ): Promise<Shift> {
    const existing = await this.prisma.cashTransaction.findUnique({ where: { id: input.id } });
    if (existing) return this.get(locationId, shiftId);
    await this.prisma.$transaction(async (tx) => {
      const shift = await this.load(tx, locationId, shiftId);
      if (shift.status !== 'OPEN')
        throw new DomainError('SHIFT_NOT_OPEN', 'Shift is closed', { shiftId });
      await tx.cashTransaction.create({
        data: {
          id: input.id,
          shiftId,
          type: input.type,
          amount: input.amount,
          reason: input.reason,
          createdById: principal.userId,
        },
      });
      await this.audit.record(
        {
          action: input.type === 'PAY_IN' ? 'cash.pay_in' : 'cash.pay_out',
          entityType: 'Shift',
          entityId: shiftId,
          locationId,
          metadata: { amount: input.amount, reason: input.reason },
        },
        tx,
      );
      await this.changes.record(tx, { shiftIds: [shiftId] });
    });
    return this.get(locationId, shiftId);
  }

  async close(
    principal: Principal,
    locationId: string,
    shiftId: string,
    input: z.output<typeof closeShiftSchema>,
  ): Promise<Shift> {
    await this.prisma.$transaction(async (tx) => {
      const shift = await this.load(tx, locationId, shiftId);
      if (shift.status !== 'OPEN')
        throw new DomainError('SHIFT_NOT_OPEN', 'Shift is already closed', { shiftId });
      const { expectedCash } = shiftCashSummary(shift.openingFloat, shift.cash);
      const closed = await tx.shift.updateMany({
        where: { id: shiftId, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          openRegisterId: null,
          closedById: principal.userId,
          closedAt: new Date(),
          expectedCash,
          countedCash: input.countedCash,
          cashDifference: input.countedCash - expectedCash,
          closingNotes: input.notes,
        },
      });
      if (closed.count !== 1)
        throw new DomainError('SHIFT_NOT_OPEN', 'Shift is already closed', { shiftId });
      await this.audit.record(
        {
          action: 'shift.closed',
          entityType: 'Shift',
          entityId: shiftId,
          locationId,
          metadata: {
            expectedCash,
            countedCash: input.countedCash,
            difference: input.countedCash - expectedCash,
            notes: input.notes,
          },
        },
        tx,
      );
      await this.changes.record(tx, { shiftIds: [shiftId] });
    });
    return this.get(locationId, shiftId);
  }

  private async load(tx: PrismaTx, locationId: string, shiftId: string): Promise<ShiftRow> {
    const row = await tx.shift.findFirst({
      where: { id: shiftId, locationId },
      include: shiftInclude,
    });
    if (!row) throw new DomainError('SHIFT_NOT_FOUND', 'Shift not found', { shiftId });
    return row;
  }

  private async toDto(row: ShiftRow): Promise<Shift> {
    const openedBy = await this.prisma.user.findUnique({
      where: { id: row.openedById },
      select: { displayName: true },
    });
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      id: row.id,
      locationId: row.locationId,
      cashRegisterId: row.cashRegisterId,
      cashRegisterNameEn: row.cashRegister.nameEn,
      cashRegisterNameAr: row.cashRegister.nameAr,
      status: row.status,
      openingFloat: row.openingFloat,
      openedById: row.openedById,
      openedByName: openedBy?.displayName ?? '',
      openedAt: row.openedAt.toISOString(),
      closedById: row.closedById,
      closedAt: iso(row.closedAt),
      expectedCash: row.expectedCash,
      countedCash: row.countedCash,
      cashDifference: row.cashDifference,
      closingNotes: row.closingNotes,
      summary: {
        cash: shiftCashSummary(row.openingFloat, row.cash),
        byMethod: totalsByMethod(row.payments),
        orderCount: new Set(row.payments.filter((p) => p.type === 'CHARGE').map((p) => p.orderId))
          .size,
      },
      cashTransactions: row.cash.map((c) => ({
        id: c.id,
        type: c.type,
        amount: c.amount,
        paymentId: c.paymentId,
        reason: c.reason,
        createdById: c.createdById,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }
}
