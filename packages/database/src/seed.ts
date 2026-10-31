/**
 * Development seed. Reads seed/demo.json, the extra demo tenants in seed/tenants/ (one per
 * business type, ADR 0017) and SEED_* environment variables; idempotent (re-running updates
 * instead of duplicating). Never run against production.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { combinationName, detectSymbology } from '@pos/domain';
import type { Feature } from '@pos/shared-types';
import { type Prisma, PrismaClient, type Locale } from '@prisma/client';
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
  /**
   * Payment provider accounts (ADR 0024), tenant-wide, added when the tenant has no account of
   * the method; each is linked to the tender of its type named `tender`. Development adapters
   * only, without secrets (the seed cannot seal them).
   */
  paymentProviders?: {
    method: 'ONLINE' | 'TERMINAL';
    providerKey: string;
    mode: 'TEST';
    publicConfig?: Record<string, string>;
    tender: string;
  }[];
  /** Location code → cash drawers. */
  cashRegisters?: Record<string, { nameEn: string; nameAr: string }[]>;
  /** Modules the tenant switches on or off (tenant-wide overrides, ADR 0018); added when missing. */
  features?: Partial<Record<Feature, boolean>>;
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
      /** Codes of a product without variants; the first is primary (ADR 0021). */
      barcodes?: string[];
      /** Option axes; variants then name one value index of each (`optionValues`). */
      options?: SeedOption[];
      variants?: SeedVariant[];
    }[];
  }[];
}

interface SeedOption {
  nameEn: string;
  nameAr: string;
  values: { nameEn: string; nameAr: string }[];
}

interface SeedVariant {
  /** Required without options; a combination is named after its values. */
  nameEn?: string;
  nameAr?: string;
  price: number;
  sku?: string;
  cost?: number;
  trackInventory?: boolean;
  optionValues?: number[];
  barcodes?: string[];
}

type SeedProduct = SeedMenu['categories'][number]['products'][number];

/** A value a seed file refers to by position; a wrong index is a broken seed file. */
function seedRef<T>(value: T | undefined): T {
  if (value === undefined)
    throw new Error('Seed variant names an option value that does not exist');
  return value;
}

const barcodeRows = (codes: readonly string[]) =>
  codes.map((code, i) => ({ code, symbology: detectSymbology(code), isPrimary: i === 0 }));

/**
 * The retail catalog of one seeded product (ADR 0021): its options, variants (with SKUs, costs and
 * their barcodes) and its own barcodes. Writes nothing for a product that has options already;
 * a product seeded before it had options gets them, its old variants archived.
 */
async function seedProductCatalog(
  prisma: PrismaClient,
  tenantId: string,
  productId: string,
  spec: Pick<SeedProduct, 'barcodes' | 'options' | 'variants'>,
): Promise<void> {
  const options = spec.options ?? [];
  if (options.length > 0) {
    if ((await prisma.productOption.count({ where: { productId } })) > 0) return;
    await prisma.productVariant.updateMany({
      where: { productId, archivedAt: null },
      data: { archivedAt: new Date() },
    });
  }
  const valueIds: string[][] = [];
  for (const [i, { values, ...option }] of options.entries()) {
    const row = await prisma.productOption.create({
      data: {
        ...option,
        productId,
        sortOrder: i,
        values: { create: values.map((v, j) => ({ ...v, sortOrder: j })) },
      },
      include: { values: { orderBy: { sortOrder: 'asc' } } },
    });
    valueIds.push(row.values.map((v) => v.id));
  }
  const existing = await prisma.productVariant.findMany({
    where: { productId, archivedAt: null },
    orderBy: { sortOrder: 'asc' },
  });
  for (const [k, { optionValues = [], barcodes = [], ...variant }] of (
    spec.variants ?? []
  ).entries()) {
    const named =
      options.length > 0
        ? combinationName(
            optionValues.map((value, option) => seedRef(options[option]?.values[value])),
          )
        : { nameEn: variant.nameEn ?? '', nameAr: variant.nameAr ?? '' };
    const data: Prisma.ProductVariantUncheckedCreateInput = {
      ...variant,
      ...named,
      productId,
      sortOrder: k,
      optionValues: {
        create: optionValues.map((value, option) => ({
          optionValueId: seedRef(valueIds[option]?.[value]),
        })),
      },
    };
    // Variants seeded before M5 (matched by position) get their SKU and barcodes.
    const before = options.length === 0 ? existing[k] : undefined;
    const row = before
      ? await prisma.productVariant.update({
          where: { id: before.id },
          data: { sku: variant.sku ?? before.sku, cost: variant.cost ?? before.cost },
        })
      : await prisma.productVariant.create({ data });
    await addBarcodes(prisma, tenantId, productId, row.id, barcodes);
  }
  await addBarcodes(prisma, tenantId, productId, null, spec.barcodes ?? []);
}

/** Adds the codes this tenant does not have yet. */
async function addBarcodes(
  prisma: PrismaClient,
  tenantId: string,
  productId: string,
  variantId: string | null,
  codes: readonly string[],
): Promise<void> {
  const taken = new Set(
    (await prisma.productBarcode.findMany({ where: { tenantId, code: { in: [...codes] } } })).map(
      (b) => b.code,
    ),
  );
  const hasPrimary =
    (await prisma.productBarcode.count({ where: { productId, variantId, isPrimary: true } })) > 0;
  const rows = barcodeRows(codes)
    .map((b) => ({ ...b, isPrimary: b.isPrimary && !hasPrimary }))
    .filter((b) => !taken.has(b.code));
  if (rows.length > 0) {
    await prisma.productBarcode.createMany({
      data: rows.map((b) => ({ ...b, tenantId, productId, variantId })),
    });
  }
}

/**
 * Brings the retail catalog of an existing demo tenant up to its seed file: products are found by
 * SKU, and get the options, variant SKUs and barcodes they were seeded without.
 */
async function alignCatalog(prisma: PrismaClient, tenantId: string, menu: SeedMenu): Promise<void> {
  for (const product of menu.categories.flatMap((c) => c.products)) {
    if (
      !product.barcodes &&
      !product.options &&
      !product.variants?.some((v) => v.barcodes || v.sku)
    ) {
      continue;
    }
    const row = await prisma.product.findFirst({ where: { tenantId, sku: product.sku } });
    if (row) await seedProductCatalog(prisma, tenantId, row.id, product);
  }
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
    for (const [j, spec] of products.entries()) {
      const {
        stations,
        groups,
        variants: _variants,
        barcodes: _barcodes,
        options: _options,
        ...product
      } = spec;
      const row = await prisma.product.create({
        data: {
          ...product,
          tenantId,
          categoryId: cat.id,
          sortOrder: j,
          modifierGroups: {
            create: groups.map((g, k) => ({ modifierGroupId: lookup(groupIds, g), sortOrder: k })),
          },
          stations: {
            create: stations.map((code) => ({ kitchenStationId: lookup(stationIds, code) })),
          },
        },
      });
      await seedProductCatalog(prisma, tenantId, row.id, spec);
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
  for (const provider of file.paymentProviders ?? []) {
    if (
      (await prisma.paymentProviderAccount.count({
        where: { tenantId, method: provider.method },
      })) > 0
    ) {
      continue;
    }
    const account = await prisma.paymentProviderAccount.create({
      data: {
        tenantId,
        method: provider.method,
        providerKey: provider.providerKey,
        mode: provider.mode,
        publicConfig: provider.publicConfig ?? {},
      },
    });
    await prisma.paymentMethod.updateMany({
      where: { tenantId, nameEn: provider.tender, archivedAt: null },
      data: { providerAccountId: account.id },
    });
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

  // Development websites answer on `<slug>.localhost` (ADR 0023).
  const webDomain = process.env.PLATFORM_WEB_DOMAIN ?? 'localhost';
  const provisioned = await provisionTenant(prisma, { ...file, webDomain });
  const tenant = { id: provisioned.tenantId };
  const { locationIds, roleIds } = provisioned;

  if (process.env.SEED_ALIGN_TENANTS === '1') {
    await alignTenant(prisma, tenant.id, locationIds, file);
  }
  if (file.menu) {
    if (process.env.SEED_ALIGN_TENANTS === '1') await alignCatalog(prisma, tenant.id, file.menu);
    await seedMenu(prisma, tenant.id, file.menu);
  }
  for (const [feature, enabled] of Object.entries(file.features ?? {})) {
    await prisma.featureOverride.upsert({
      where: { tenantId_scope_feature: { tenantId: tenant.id, scope: 'tenant', feature } },
      create: { tenantId: tenant.id, scope: 'tenant', feature, enabled },
      update: {},
    });
  }
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

    const passwordHash = await hashSecret(password);
    const account = await prisma.account.upsert({
      where: { email },
      update: { passwordHash },
      create: { email, passwordHash, lastTenantId: tenant.id },
    });
    const user = await prisma.user.upsert({
      where: { tenantId_accountId: { tenantId: tenant.id, accountId: account.id } },
      update: { email, displayName: userSpec.displayName },
      create: {
        email,
        tenantId: tenant.id,
        accountId: account.id,
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
