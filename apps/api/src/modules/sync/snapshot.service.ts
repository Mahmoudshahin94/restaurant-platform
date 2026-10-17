import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@pos/server';
import type { LocationSnapshot, SnapshotTable } from '@pos/validation';
import type { AuthenticatedDevice } from '../devices/device.guard';

/**
 * Builds the configuration snapshot a location hub needs to run offline. Only rows of the hub's
 * own restaurant and location are included, and only rows whose references the hub can satisfy
 * (e.g. role grants at other locations are left out). Staff credential hashes are included so
 * staff can sign in at the hub without the cloud: the hub is a trusted device of the restaurant.
 */
@Injectable()
export class SnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async build(device: AuthenticatedDevice): Promise<LocationSnapshot> {
    const { restaurantId, locationId } = device;
    const db = this.prisma;
    const atLocation = { OR: [{ locationId: null }, { locationId }] };
    const byId = { id: 'asc' } as const;

    const users = await db.user.findMany({
      where: { restaurantId, roles: { some: atLocation } },
      orderBy: byId,
    });
    const userIds = users.map((u) => u.id);
    const productWhere = { product: { restaurantId } };

    const tables: Record<SnapshotTable, unknown[]> = {
      restaurants: await db.restaurant.findMany({ where: { id: restaurantId } }),
      locations: await db.location.findMany({ where: { id: locationId } }),
      roles: await db.role.findMany({ where: { restaurantId }, orderBy: byId }),
      rolePermissions: await db.rolePermission.findMany({
        where: { role: { restaurantId } },
        orderBy: [{ roleId: 'asc' }, { permissionKey: 'asc' }],
      }),
      users,
      userRoles: await db.userRole.findMany({
        where: { userId: { in: userIds }, ...atLocation },
        orderBy: byId,
      }),
      employees: await db.employee.findMany({
        where: {
          restaurantId,
          OR: [{ homeLocationId: null }, { homeLocationId: locationId }],
          AND: [{ OR: [{ userId: null }, { userId: { in: userIds } }] }],
        },
        orderBy: byId,
      }),
      taxes: await db.tax.findMany({ where: { restaurantId }, orderBy: byId }),
      categories: await db.category.findMany({ where: { restaurantId }, orderBy: byId }),
      kitchenStations: await db.kitchenStation.findMany({ where: { restaurantId }, orderBy: byId }),
      modifierGroups: await db.modifierGroup.findMany({ where: { restaurantId }, orderBy: byId }),
      modifiers: await db.modifier.findMany({
        where: { group: { restaurantId } },
        orderBy: byId,
      }),
      products: await db.product.findMany({ where: { restaurantId }, orderBy: byId }),
      productVariants: await db.productVariant.findMany({ where: productWhere, orderBy: byId }),
      productModifierGroups: await db.productModifierGroup.findMany({
        where: productWhere,
        orderBy: [{ productId: 'asc' }, { modifierGroupId: 'asc' }],
      }),
      productStations: await db.productStation.findMany({
        where: productWhere,
        orderBy: [{ productId: 'asc' }, { kitchenStationId: 'asc' }],
      }),
      productTaxes: await db.productTax.findMany({
        where: productWhere,
        orderBy: [{ productId: 'asc' }, { taxId: 'asc' }],
      }),
      locationProducts: await db.locationProduct.findMany({
        where: { locationId },
        orderBy: { productId: 'asc' },
      }),
      discounts: await db.discount.findMany({ where: { restaurantId }, orderBy: byId }),
      tableSections: await db.tableSection.findMany({ where: { locationId }, orderBy: byId }),
      diningTables: await db.diningTable.findMany({ where: { locationId }, orderBy: byId }),
      paymentMethods: await db.paymentMethod.findMany({ where: { restaurantId }, orderBy: byId }),
      cashRegisters: await db.cashRegister.findMany({ where: { locationId }, orderBy: byId }),
      // Orders taken through the cloud before the hub was paired keep their numbers (ADR 0012).
      orderCounters: await db.orderCounter.findMany({
        where: { locationId, businessDate: { gte: new Date(Date.now() - 2 * 24 * 60 * 60_000) } },
        orderBy: { businessDate: 'asc' },
      }),
    };

    // JSON round trip: dates become ISO strings, exactly as the hub receives them.
    const json = JSON.parse(JSON.stringify(tables)) as LocationSnapshot['tables'];
    const version = createHash('sha256').update(JSON.stringify(json)).digest('hex').slice(0, 32);
    return {
      format: 1,
      restaurantId,
      locationId,
      generatedAt: new Date().toISOString(),
      version,
      tables: json,
    };
  }
}
