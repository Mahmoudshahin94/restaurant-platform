import { Injectable } from '@nestjs/common';
import { hashSecret } from '@pos/database';
import { DomainError, assertCanGrant } from '@pos/domain';
import {
  AuditService,
  type Principal,
  PrismaService,
  type PrismaTx,
  isUniqueViolation,
} from '@pos/server';
import { isPermission } from '@pos/shared-types';
import type { Employee, UpdateEmployeeRequest, createEmployeeSchema } from '@pos/validation';
import type { z } from 'zod';

const employeeInclude = { user: { select: { email: true } } } as const;

interface EmployeeRow {
  id: string;
  employeeCode: string;
  displayName: string;
  homeLocationId: string | null;
  userId: string | null;
  pinHash: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  user: { email: string } | null;
}

const toDto = (row: EmployeeRow): Employee => ({
  id: row.id,
  employeeCode: row.employeeCode,
  displayName: row.displayName,
  homeLocationId: row.homeLocationId,
  userId: row.userId,
  userEmail: row.user?.email ?? null,
  hasPin: row.pinHash !== null,
  isActive: row.isActive,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * Staff who sign in at the POS with employee code and PIN (on the location hub). An employee
 * signs in with the roles of the user it is linked to; without a linked user there is no PIN
 * sign-in. PINs are stored as argon2id hashes only, and setting one is audited without the
 * value. Employees reach the hubs through the configuration change feed.
 *
 * Whoever knows an employee's PIN acts with the linked user's roles at the POS, so linking a user
 * or setting the PIN of a linked employee requires holding that user's permissions (no
 * escalation through the POS).
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(restaurantId: string): Promise<Employee[]> {
    const rows = await this.prisma.employee.findMany({
      where: { restaurantId },
      include: employeeInclude,
      orderBy: [{ isActive: 'desc' }, { employeeCode: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(
    principal: Principal,
    input: z.output<typeof createEmployeeSchema>,
  ): Promise<Employee> {
    const pinHash = input.pin ? await hashSecret(input.pin) : null;
    return this.unique(() =>
      this.prisma.$transaction(async (tx) => {
        await this.checkRefs(tx, principal.restaurantId, input.homeLocationId, input.userId, null);
        if (input.userId) await this.assertCanActAs(tx, principal, input.userId);
        const row = await tx.employee.create({
          data: {
            restaurantId: principal.restaurantId,
            employeeCode: input.employeeCode,
            displayName: input.displayName,
            homeLocationId: input.homeLocationId,
            userId: input.userId,
            pinHash,
          },
          include: employeeInclude,
        });
        await this.audit.record(
          {
            action: 'employee.created',
            entityType: 'Employee',
            entityId: row.id,
            locationId: input.homeLocationId,
            metadata: {
              employeeCode: row.employeeCode,
              displayName: row.displayName,
              userId: row.userId,
              pinSet: pinHash !== null,
            },
          },
          tx,
        );
        return toDto(row);
      }),
    );
  }

  async update(
    principal: Principal,
    employeeId: string,
    input: UpdateEmployeeRequest,
  ): Promise<Employee> {
    return this.unique(() =>
      this.prisma.$transaction(async (tx) => {
        const before = await this.load(tx, principal.restaurantId, employeeId);
        await this.checkRefs(
          tx,
          principal.restaurantId,
          input.homeLocationId ?? null,
          input.userId ?? null,
          employeeId,
        );
        if (input.userId !== undefined && input.userId !== before.userId) {
          for (const userId of [before.userId, input.userId]) {
            if (userId) await this.assertCanActAs(tx, principal, userId);
          }
        }
        const row = await tx.employee.update({
          where: { id: employeeId },
          data: input,
          include: employeeInclude,
        });
        const changes = Object.fromEntries(
          Object.entries(input).filter(([k, v]) => before[k as keyof EmployeeRow] !== v),
        );
        if (Object.keys(changes).length > 0) {
          // Linking another user changes the roles this employee signs in with.
          const action =
            input.isActive === false && before.isActive
              ? 'employee.deactivated'
              : input.userId !== undefined && input.userId !== before.userId
                ? 'employee.user_linked'
                : 'employee.updated';
          await this.audit.record(
            {
              action,
              entityType: 'Employee',
              entityId: employeeId,
              locationId: row.homeLocationId,
              metadata: {
                employeeCode: row.employeeCode,
                changes,
                before: Object.fromEntries(
                  Object.keys(changes).map((k) => [k, before[k as keyof EmployeeRow]]),
                ),
              },
            },
            tx,
          );
        }
        return toDto(row);
      }),
    );
  }

  /** Sets or resets the POS PIN. The hub's lockout counter is per code, not per PIN. */
  async setPin(principal: Principal, employeeId: string, pin: string): Promise<Employee> {
    const pinHash = await hashSecret(pin);
    return this.prisma.$transaction(async (tx) => {
      const before = await this.load(tx, principal.restaurantId, employeeId);
      if (before.userId) await this.assertCanActAs(tx, principal, before.userId);
      const row = await tx.employee.update({
        where: { id: employeeId },
        data: { pinHash },
        include: employeeInclude,
      });
      await this.audit.record(
        {
          action: before.pinHash ? 'employee.pin_reset' : 'employee.pin_set',
          entityType: 'Employee',
          entityId: employeeId,
          locationId: row.homeLocationId,
          metadata: { employeeCode: row.employeeCode },
        },
        tx,
      );
      return toDto(row);
    });
  }

  private async load(tx: PrismaTx, restaurantId: string, employeeId: string) {
    const row = await tx.employee.findFirst({
      where: { id: employeeId, restaurantId },
      include: employeeInclude,
    });
    if (!row) throw new DomainError('EMPLOYEE_NOT_FOUND', 'Employee not found', { employeeId });
    return row;
  }

  private async checkRefs(
    tx: PrismaTx,
    restaurantId: string,
    homeLocationId: string | null,
    userId: string | null,
    employeeId: string | null,
  ): Promise<void> {
    if (homeLocationId) {
      const location = await tx.location.findFirst({
        where: { id: homeLocationId, restaurantId },
        select: { id: true },
      });
      if (!location) throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    }
    if (userId) {
      const user = await tx.user.findFirst({
        where: { id: userId, restaurantId },
        select: { employee: { select: { id: true } } },
      });
      if (!user) throw new DomainError('USER_NOT_FOUND', 'User not found', { userId });
      if (user.employee && user.employee.id !== employeeId) {
        throw new DomainError('CONFLICT', 'This user is linked to another employee', {
          reason: 'USER_LINKED',
        });
      }
    }
  }

  /** The caller must hold every permission the user has, where the user has it. */
  private async assertCanActAs(tx: PrismaTx, principal: Principal, userId: string): Promise<void> {
    const assignments = await tx.userRole.findMany({
      where: { userId },
      include: { role: { include: { permissions: { select: { permissionKey: true } } } } },
    });
    for (const a of assignments) {
      assertCanGrant(
        principal.assignments,
        a.locationId,
        a.role.permissions.map((p) => p.permissionKey).filter(isPermission),
      );
    }
  }

  private async unique<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError('CONFLICT', 'This employee code is in use', {
          reason: 'CODE_TAKEN',
        });
      }
      throw error;
    }
  }
}
