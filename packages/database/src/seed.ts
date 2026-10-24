/**
 * Development seed. Reads seed/demo.json, the extra demo tenants in seed/tenants/ (one per
 * business type, ADR 0017) and SEED_* environment variables; idempotent (re-running updates
 * instead of duplicating). Never run against production.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { PrismaClient, type Locale } from '@prisma/client';
import { hashSecret } from './credentials';
import { syncPermissionCatalog } from './permissions';
import { type LocationSpec, type RoleSpec, type TenantSpec, provisionTenant } from './provisioning';

interface SeedFile {
  tenant: TenantSpec;
  locations: LocationSpec[];
  roles: RoleSpec[];
  menu?: SeedMenu;
  taxes?: { nameEn: string; nameAr: string; rateBps: number; isDefault: boolean }[];
  discounts?: { nameEn: string; nameAr: string; type: 'PERCENTAGE' | 'FIXED'; value: number }[];
  /** Location code → sections with tables. */
  floorPlans?: Record<
    string,
    { nameEn: string; nameAr: string; tables: { label: string; seats: number }[] }[]
  >;
  paymentMethods?: { type: 'CASH' | 'CARD' | 'ONLINE'; nameEn: string; nameAr: string }[];
  /** Location code → cash drawers. */
  cashRegisters?: Record<string, { nameEn: string; nameAr: string }[]>;
  users: {
    envPrefix: string;
    displayName: string;
    preferredLocale: Locale;
    role: string;
    location: string | null;
    /** POS sign-in at the location hub: employee code + PIN from `<envPrefix>_PIN`. */
    employeeCode?: string;
    /** Skipped (with a note) when its SEED_* variables are not set: extra demo tenants only. */
    optional?: boolean;
  }[];
}

interface SeedMenu {
  kitchenStations: { code: string; nameEn: string; nameAr: string }[];
  modifierGroups: {
    key: string;
    nameEn: string;
    nameAr: string;
    minSelect: number;
    maxSelect: number | null;
    modifiers: { nameEn: string; nameAr: string; priceDelta: number; isDefault?: boolean }[];
  }[];
  categories: {
    nameEn: string;
    nameAr: string;
    products: {
      sku: string;
      nameEn: string;
      nameAr: string;
      descriptionEn?: string;
      descriptionAr?: string;
      price: number;
      stations: string[];
      groups: string[];
      variants?: { nameEn: string; nameAr: string; price: number }[];
    }[];
  }[];
}

/** Creates the demo menu once; skipped when the tenant already has categories. */
async function seedMenu(prisma: PrismaClient, tenantId: string, menu: SeedMenu): Promise<void> {
  if ((await prisma.category.count({ where: { tenantId } })) > 0) return;

  const stationIds = new Map<string, string>();
  for (const [i, station] of menu.kitchenStations.entries()) {
    const row = await prisma.kitchenStation.create({
      data: { ...station, tenantId, sortOrder: i },
    });
    stationIds.set(station.code, row.id);
  }
  const groupIds = new Map<string, string>();
  for (const [i, { key, modifiers, ...group }] of menu.modifierGroups.entries()) {
    const row = await prisma.modifierGroup.create({
      data: {
        ...group,
        tenantId,
        sortOrder: i,
        modifiers: { create: modifiers.map((m, j) => ({ ...m, sortOrder: j })) },
      },
    });
    groupIds.set(key, row.id);
  }
  const lookup = (map: Map<string, string>, key: string): string => {
    const id = map.get(key);
    if (!id) throw new Error(`Unknown seed reference ${key}`);
    return id;
  };
  for (const [i, { products, ...category }] of menu.categories.entries()) {
    const cat = await prisma.category.create({ data: { ...category, tenantId, sortOrder: i } });
    for (const [j, { stations, groups, variants = [], ...product }] of products.entries()) {
      await prisma.product.create({
        data: {
          ...product,
          tenantId,
          categoryId: cat.id,
          sortOrder: j,
          variants: { create: variants.map((v, k) => ({ ...v, sortOrder: k })) },
          modifierGroups: {
            create: groups.map((g, k) => ({ modifierGroupId: lookup(groupIds, g), sortOrder: k })),
          },
          stations: {
            create: stations.map((code) => ({ kitchenStationId: lookup(stationIds, code) })),
          },
        },
      });
    }
  }
}

/** Taxes (assigned to every product), discounts and floor plans; each skipped if present. */
async function seedConfiguration(
  prisma: PrismaClient,
  tenantId: string,
  locationIds: Map<string, string>,
  file: SeedFile,
): Promise<void> {
  if (file.taxes && (await prisma.tax.count({ where: { tenantId } })) === 0) {
    const products = await prisma.product.findMany({
      where: { tenantId },
      select: { id: true },
    });
    for (const tax of file.taxes) {
      await prisma.tax.create({
        data: {
          ...tax,
          tenantId,
          products: tax.isDefault
            ? { create: products.map((p) => ({ productId: p.id })) }
            : undefined,
        },
      });
    }
  }
  if (file.discounts && (await prisma.discount.count({ where: { tenantId } })) === 0) {
    await prisma.discount.createMany({ data: file.discounts.map((d) => ({ ...d, tenantId })) });
  }
  // Methods are added when missing (by type and name), so a new one reaches existing databases.
  for (const [i, method] of (file.paymentMethods ?? []).entries()) {
    const found = await prisma.paymentMethod.count({
      where: { tenantId, type: method.type, nameEn: method.nameEn },
    });
    if (found === 0) {
      await prisma.paymentMethod.create({ data: { ...method, tenantId, sortOrder: i } });
    }
  }
  for (const [code, registers] of Object.entries(file.cashRegisters ?? {})) {
    const locationId = locationIds.get(code);
    if (!locationId) throw new Error(`Unknown location ${code} in cashRegisters`);
    if ((await prisma.cashRegister.count({ where: { locationId } })) > 0) continue;
    await prisma.cashRegister.createMany({ data: registers.map((r) => ({ ...r, locationId })) });
  }
  for (const [code, sections] of Object.entries(file.floorPlans ?? {})) {
    const locationId = locationIds.get(code);
    if (!locationId) throw new Error(`Unknown location ${code} in floorPlans`);
    if ((await prisma.tableSection.count({ where: { locationId } })) > 0) continue;
    for (const [i, { tables, ...section }] of sections.entries()) {
      await prisma.tableSection.create({
        data: {
          ...section,
          locationId,
          sortOrder: i,
          tables: { create: tables.map((t, j) => ({ ...t, locationId, sortOrder: j })) },
        },
      });
    }
  }
}

/**
 * Brings an existing demo tenant's currency, time zone and languages, and its locations' time
 * zones, back to the seed file (`SEED_ALIGN_TENANTS=1`; the E2E databases set it). Provisioning
 * never overwrites a tenant's own settings, so a database seeded before a seed file changed would
 * otherwise keep the old values. The currency is only changed while the tenant has no orders
 * (ADR 0002: stored amounts are in its minor units).
 */
async function alignTenant(
  prisma: PrismaClient,
  tenantId: string,
  locationIds: Map<string, string>,
  file: SeedFile,
): Promise<void> {
  const { currencyCode, timezone, defaultLocale, supportedLocales } = file.tenant;
  const current = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const orders = await prisma.order.count({ where: { tenantId } });
  const changeCurrency = currencyCode !== undefined && currencyCode !== current.currencyCode;
  if (changeCurrency && orders > 0) {
    console.info(
      `Kept ${file.tenant.slug} in ${current.currencyCode}: it has ${String(orders)} orders (reset the database to switch to ${currencyCode})`,
    );
  }
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      timezone,
      defaultLocale,
      ...(supportedLocales ? { supportedLocales } : {}),
      ...(changeCurrency && orders === 0 ? { currencyCode } : {}),
    },
  });
  for (const loc of file.locations) {
    const id = locationIds.get(loc.code);
    if (id) await prisma.location.update({ where: { id }, data: { timezone: loc.timezone } });
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing environment variable ${name} (see infrastructure/.env.example)`);
  return value;
}

export async function seed(prisma: PrismaClient, file: SeedFile): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');

  await syncPermissionCatalog(prisma);

  const provisioned = await provisionTenant(prisma, file);
  const tenant = { id: provisioned.tenantId };
  const { locationIds, roleIds } = provisioned;

  if (process.env.SEED_ALIGN_TENANTS === '1') {
    await alignTenant(prisma, tenant.id, locationIds, file);
  }
  if (file.menu) await seedMenu(prisma, tenant.id, file.menu);
  await seedConfiguration(prisma, tenant.id, locationIds, file);

  for (const userSpec of file.users) {
    if (userSpec.optional && !process.env[`${userSpec.envPrefix}_EMAIL`]) {
      console.info(`Skipped ${userSpec.envPrefix} (set ${userSpec.envPrefix}_EMAIL/_PASSWORD)`);
      continue;
    }
    const email = requireEnv(`${userSpec.envPrefix}_EMAIL`).toLowerCase();
    const password = requireEnv(`${userSpec.envPrefix}_PASSWORD`);
    const roleId = roleIds.get(userSpec.role);
    if (!roleId) throw new Error(`Unknown role ${userSpec.role}`);
    const locationId = userSpec.location === null ? null : locationIds.get(userSpec.location);
    if (locationId === undefined) throw new Error(`Unknown location ${String(userSpec.location)}`);

    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash: await hashSecret(password), displayName: userSpec.displayName },
      create: {
        email,
        tenantId: tenant.id,
        passwordHash: await hashSecret(password),
        displayName: userSpec.displayName,
        preferredLocale: userSpec.preferredLocale,
      },
    });
    const existing = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId, locationId },
    });
    if (!existing) await prisma.userRole.create({ data: { userId: user.id, roleId, locationId } });

    if (userSpec.employeeCode) {
      const pin = requireEnv(`${userSpec.envPrefix}_PIN`);
      if (!/^\d{4,8}$/.test(pin)) throw new Error(`${userSpec.envPrefix}_PIN must be 4–8 digits`);
      const employee = {
        displayName: userSpec.displayName,
        pinHash: await hashSecret(pin),
        homeLocationId: locationId,
        userId: user.id,
        isActive: true,
      };
      await prisma.employee.upsert({
        where: {
          tenantId_employeeCode: {
            tenantId: tenant.id,
            employeeCode: userSpec.employeeCode,
          },
        },
        update: employee,
        create: { ...employee, tenantId: tenant.id, employeeCode: userSpec.employeeCode },
      });
    }
  }
}

async function main(): Promise<void> {
  const read = (url: URL) => JSON.parse(readFileSync(url, 'utf8')) as SeedFile;
  const extras = new URL('../seed/tenants/', import.meta.url);
  const files = [
    read(new URL('../seed/demo.json', import.meta.url)),
    ...readdirSync(extras)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => read(new URL(name, extras))),
  ];
  const prisma = new PrismaClient();
  try {
    for (const file of files) {
      await seed(prisma, file);
      console.info(
        `Seeded tenant "${file.tenant.slug}" (${file.tenant.businessType ?? 'RESTAURANT'})`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
