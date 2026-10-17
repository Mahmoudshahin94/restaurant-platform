import type { PrismaClient } from '@pos/database';
import { newId } from '@pos/domain';
import type { TenantFixture } from './helpers';

/**
 * A small priced menu for order tests: VAT 15% on everything; a Burger (25.00) with a required
 * single-choice "Doneness" group and optional "Extras"; a Cola with Small/Large sizes; a 10%
 * discount; one table section at location A with tables T1 and T2.
 */
export async function createMenuFixture(prisma: PrismaClient, tenant: TenantFixture) {
  const restaurantId = tenant.restaurantId;
  const vat = await prisma.tax.create({
    data: { restaurantId, nameEn: 'VAT', nameAr: 'ضريبة', rateBps: 1500 },
  });
  const grill = await prisma.kitchenStation.create({
    data: { restaurantId, code: 'GRILL', nameEn: 'Grill', nameAr: 'شواية' },
  });
  const category = await prisma.category.create({
    data: { restaurantId, nameEn: 'Mains', nameAr: 'رئيسية' },
  });
  const doneness = await prisma.modifierGroup.create({
    data: {
      restaurantId,
      nameEn: 'Doneness',
      nameAr: 'الاستواء',
      minSelect: 1,
      maxSelect: 1,
      modifiers: {
        create: [
          { nameEn: 'Medium', nameAr: 'متوسط' },
          { nameEn: 'Well done', nameAr: 'مستوي' },
        ],
      },
    },
    include: { modifiers: true },
  });
  const extras = await prisma.modifierGroup.create({
    data: {
      restaurantId,
      nameEn: 'Extras',
      nameAr: 'إضافات',
      maxSelect: 2,
      modifiers: { create: [{ nameEn: 'Cheese', nameAr: 'جبن', priceDelta: 300 }] },
    },
    include: { modifiers: true },
  });
  const burger = await prisma.product.create({
    data: {
      restaurantId,
      categoryId: category.id,
      nameEn: 'Burger',
      nameAr: 'برجر',
      price: 2500,
      modifierGroups: {
        create: [
          { modifierGroupId: doneness.id, sortOrder: 1 },
          { modifierGroupId: extras.id, sortOrder: 2 },
        ],
      },
      stations: { create: [{ kitchenStationId: grill.id }] },
      taxes: { create: [{ taxId: vat.id }] },
    },
  });
  const cola = await prisma.product.create({
    data: {
      restaurantId,
      categoryId: category.id,
      nameEn: 'Cola',
      nameAr: 'كولا',
      price: 600,
      variants: {
        create: [
          { nameEn: 'Small', nameAr: 'صغير', price: 600 },
          { nameEn: 'Large', nameAr: 'كبير', price: 800, sortOrder: 1 },
        ],
      },
      taxes: { create: [{ taxId: vat.id }] },
    },
    include: { variants: true },
  });
  const tenPercent = await prisma.discount.create({
    data: { restaurantId, nameEn: '10% off', nameAr: 'خصم 10%', type: 'PERCENTAGE', value: 1000 },
  });
  const section = await prisma.tableSection.create({
    data: {
      locationId: tenant.locationA,
      nameEn: 'Indoor',
      nameAr: 'داخلي',
      tables: {
        create: [
          { locationId: tenant.locationA, label: 'T1' },
          { locationId: tenant.locationA, label: 'T2' },
        ],
      },
    },
    include: { tables: true },
  });
  const medium = doneness.modifiers.find((m) => m.nameEn === 'Medium')!;
  const cheese = extras.modifiers[0]!;
  const small = cola.variants.find((v) => v.nameEn === 'Small')!;
  const large = cola.variants.find((v) => v.nameEn === 'Large')!;
  return {
    vat,
    grill,
    burger,
    cola,
    medium,
    wellDone: doneness.modifiers.find((m) => m.nameEn === 'Well done')!,
    cheese,
    small,
    large,
    tenPercent,
    tables: section.tables,
    /** A valid burger line (medium + cheese). */
    burgerLine: (quantity = 1) => ({
      id: newId(),
      productId: burger.id,
      modifierIds: [medium.id, cheese.id],
      quantity,
    }),
    colaLine: (quantity = 1, size: 'small' | 'large' = 'large') => ({
      id: newId(),
      productId: cola.id,
      variantId: size === 'small' ? small.id : large.id,
      quantity,
    }),
  };
}
