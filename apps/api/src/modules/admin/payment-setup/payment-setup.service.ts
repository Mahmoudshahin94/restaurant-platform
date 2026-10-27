import { Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import { AuditService, PrismaService, type PrismaTx } from '@pos/server';
import { type PaymentProviderMethod, TENDER_TYPE_OF } from '@pos/shared-types';
import type {
  CashRegisterAdmin,
  PaymentMethodAdmin,
  UpdateCashRegisterRequest,
  createCashRegisterSchema,
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
} from '@pos/validation';
import type { z } from 'zod';

interface MethodRow {
  id: string;
  type: PaymentMethodAdmin['type'];
  nameEn: string;
  nameAr: string;
  sortOrder: number;
  providerAccountId: string | null;
  archivedAt: Date | null;
}

const toMethod = (row: MethodRow): PaymentMethodAdmin => ({
  id: row.id,
  type: row.type,
  nameEn: row.nameEn,
  nameAr: row.nameAr,
  sortOrder: row.sortOrder,
  providerAccountId: row.providerAccountId,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

interface RegisterRow {
  id: string;
  locationId: string;
  nameEn: string;
  nameAr: string;
  archivedAt: Date | null;
  shifts: { id: string }[];
}

const toRegister = (row: RegisterRow): CashRegisterAdmin => ({
  id: row.id,
  locationId: row.locationId,
  nameEn: row.nameEn,
  nameAr: row.nameAr,
  openShiftId: row.shifts[0]?.id ?? null,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

const openShift = { shifts: { where: { status: 'OPEN' as const }, select: { id: true } } };

/**
 * Tenders and cash drawers (configuration, `settings.manage`). Rows are archived, never deleted:
 * recorded payments and shifts reference them. Hubs receive changes through the change feed.
 */
@Injectable()
export class PaymentSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listMethods(tenantId: string): Promise<PaymentMethodAdmin[]> {
    const rows = await this.prisma.paymentMethod.findMany({
      where: { tenantId },
      orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { sortOrder: 'asc' }],
    });
    return rows.map(toMethod);
  }

  async createMethod(
    tenantId: string,
    input: z.output<typeof createPaymentMethodSchema>,
  ): Promise<PaymentMethodAdmin> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertAccount(tx, tenantId, input.type, input.providerAccountId);
      const row = await tx.paymentMethod.create({ data: { ...input, tenantId } });
      await this.audit.record(
        {
          action: 'payment_method.created',
          entityType: 'PaymentMethod',
          entityId: row.id,
          locationId: null,
          metadata: { method: input },
        },
        tx,
      );
      return toMethod(row);
    });
  }

  async updateMethod(
    tenantId: string,
    methodId: string,
    input: z.output<typeof updatePaymentMethodSchema>,
  ): Promise<PaymentMethodAdmin> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.paymentMethod.findFirst({ where: { id: methodId, tenantId } });
      if (!before) throw new DomainError('PAYMENT_METHOD_NOT_FOUND', 'Payment method not found');
      if (input.providerAccountId !== undefined) {
        await this.assertAccount(tx, tenantId, before.type, input.providerAccountId);
      }
      const row = await tx.paymentMethod.update({ where: { id: methodId }, data: input });
      await this.audit.record(
        {
          action: 'payment_method.updated',
          entityType: 'PaymentMethod',
          entityId: methodId,
          locationId: null,
          metadata: {
            changes: input,
            before: {
              nameEn: before.nameEn,
              nameAr: before.nameAr,
              sortOrder: before.sortOrder,
              providerAccountId: before.providerAccountId,
            },
          },
        },
        tx,
      );
      return toMethod(row);
    });
  }

  async archiveMethod(
    tenantId: string,
    methodId: string,
    archived: boolean,
  ): Promise<PaymentMethodAdmin> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.paymentMethod.findFirst({ where: { id: methodId, tenantId } });
      if (!before) throw new DomainError('PAYMENT_METHOD_NOT_FOUND', 'Payment method not found');
      if (archived && before.type === 'CASH' && before.archivedAt === null) {
        const otherCash = await tx.paymentMethod.count({
          where: { tenantId, type: 'CASH', archivedAt: null, id: { not: methodId } },
        });
        if (otherCash === 0) {
          // Shifts count cash; a tenant without a cash tender could not close a drawer.
          throw new DomainError('CONFLICT', 'Keep at least one cash method', {
            reason: 'LAST_CASH_METHOD',
          });
        }
      }
      const row = await tx.paymentMethod.update({
        where: { id: methodId },
        data: { archivedAt: archived ? (before.archivedAt ?? new Date()) : null },
      });
      await this.audit.record(
        {
          action: archived ? 'payment_method.archived' : 'payment_method.restored',
          entityType: 'PaymentMethod',
          entityId: methodId,
          locationId: null,
          metadata: { nameEn: row.nameEn, type: row.type },
        },
        tx,
      );
      return toMethod(row);
    });
  }

  /**
   * A tender may be linked to one of the tenant's provider accounts whose payments are recorded
   * under its type (ADR 0024): an online tender to an ONLINE account, a card tender to a CARD or
   * kiosk TERMINAL account.
   */
  private async assertAccount(
    tx: PrismaTx,
    tenantId: string,
    type: PaymentMethodAdmin['type'],
    accountId: string | null,
  ): Promise<void> {
    if (!accountId) return;
    const account = await tx.paymentProviderAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { method: true },
    });
    if (!account) throw new DomainError('PAYMENT_PROVIDER_NOT_FOUND', 'Payment provider not found');
    if (TENDER_TYPE_OF[account.method as PaymentProviderMethod] !== type) {
      throw new DomainError(
        'PAYMENT_PROVIDER_INVALID',
        'This provider takes another kind of payment',
        {
          reason: 'WRONG_METHOD',
          method: account.method,
        },
      );
    }
  }

  async listRegisters(locationId: string): Promise<CashRegisterAdmin[]> {
    const rows = await this.prisma.cashRegister.findMany({
      where: { locationId },
      include: openShift,
      orderBy: [{ archivedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'asc' }],
    });
    return rows.map(toRegister);
  }

  async createRegister(
    locationId: string,
    input: z.output<typeof createCashRegisterSchema>,
  ): Promise<CashRegisterAdmin> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.cashRegister.create({
        data: { ...input, locationId },
        include: openShift,
      });
      await this.audit.record(
        {
          action: 'cash_register.created',
          entityType: 'CashRegister',
          entityId: row.id,
          locationId,
          metadata: { register: input },
        },
        tx,
      );
      return toRegister(row);
    });
  }

  async updateRegister(
    locationId: string,
    registerId: string,
    input: UpdateCashRegisterRequest,
  ): Promise<CashRegisterAdmin> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.cashRegister.findFirst({ where: { id: registerId, locationId } });
      if (!before) throw new DomainError('CASH_REGISTER_NOT_FOUND', 'Cash drawer not found');
      const row = await tx.cashRegister.update({
        where: { id: registerId },
        data: input,
        include: openShift,
      });
      await this.audit.record(
        {
          action: 'cash_register.updated',
          entityType: 'CashRegister',
          entityId: registerId,
          locationId,
          metadata: { changes: input, before: { nameEn: before.nameEn, nameAr: before.nameAr } },
        },
        tx,
      );
      return toRegister(row);
    });
  }

  /** A drawer with an open shift cannot be archived: close the shift at the POS first. */
  async archiveRegister(
    locationId: string,
    registerId: string,
    archived: boolean,
  ): Promise<CashRegisterAdmin> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.cashRegister.findFirst({
        where: { id: registerId, locationId },
        include: openShift,
      });
      if (!before) throw new DomainError('CASH_REGISTER_NOT_FOUND', 'Cash drawer not found');
      if (archived && before.shifts.length > 0) {
        throw new DomainError('CONFLICT', 'Close the drawer’s shift first', {
          reason: 'SHIFT_OPEN',
        });
      }
      const row = await tx.cashRegister.update({
        where: { id: registerId },
        data: { archivedAt: archived ? (before.archivedAt ?? new Date()) : null },
        include: openShift,
      });
      await this.audit.record(
        {
          action: archived ? 'cash_register.archived' : 'cash_register.restored',
          entityType: 'CashRegister',
          entityId: registerId,
          locationId,
          metadata: { nameEn: row.nameEn },
        },
        tx,
      );
      return toRegister(row);
    });
  }
}
