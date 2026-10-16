/**
 * Development seed. Reads seed/demo.json and SEED_* environment variables; idempotent
 * (re-running updates instead of duplicating). Never run against production.
 */
import { readFileSync } from 'node:fs';
import { PERMISSIONS, type Permission, isPermission } from '@pos/shared-types';
import { PrismaClient, type Locale } from '@prisma/client';
import { hashSecret } from './credentials';
import { syncPermissionCatalog } from './permissions';

interface SeedFile {
  restaurant: {
    slug: string;
    nameEn: string;
    nameAr: string;
    currencyCode: string;
    defaultLocale: Locale;
    timezone: string;
  };
  locations: {
    code: string;
    nameEn: string;
    nameAr: string;
    timezone: string;
    taxInclusive: boolean;
    addressLine: string | null;
    phone: string | null;
  }[];
  roles: { name: string; description: string; isSystem: boolean; permissions: '*' | string[] }[];
  menu?: SeedMenu;
  users: {
    envPrefix: string;
    displayName: string;
    preferredLocale: Locale;
    role: string;
    location: string | null;
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

/** Creates the demo menu once; skipped when the restaurant already has categories. */
async function seedMenu(prisma: PrismaClient, restaurantId: string, menu: SeedMenu): Promise<void> {
  if ((await prisma.category.count({ where: { restaurantId } })) > 0) return;

  const stationIds = new Map<string, string>();
  for (const [i, station] of menu.kitchenStations.entries()) {
    const row = await prisma.kitchenStation.create({
      data: { ...station, restaurantId, sortOrder: i },
    });
    stationIds.set(station.code, row.id);
  }
  const groupIds = new Map<string, string>();
  for (const [i, { key, modifiers, ...group }] of menu.modifierGroups.entries()) {
    const row = await prisma.modifierGroup.create({
      data: {
        ...group,
        restaurantId,
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
    const cat = await prisma.category.create({ data: { ...category, restaurantId, sortOrder: i } });
    for (const [j, { stations, groups, variants = [], ...product }] of products.entries()) {
      await prisma.product.create({
        data: {
          ...product,
          restaurantId,
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing environment variable ${name} (see infrastructure/.env.example)`);
  return value;
}

function resolveRolePermissions(spec: '*' | string[]): Permission[] {
  if (spec === '*') return [...PERMISSIONS];
  const unknown = spec.filter((p) => !isPermission(p));
  if (unknown.length > 0) throw new Error(`Unknown permissions in seed: ${unknown.join(', ')}`);
  return spec as Permission[];
}

export async function seed(prisma: PrismaClient, file: SeedFile): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');

  await syncPermissionCatalog(prisma);

  const restaurant = await prisma.restaurant.upsert({
    where: { slug: file.restaurant.slug },
    update: {},
    create: file.restaurant,
  });

  const locationIds = new Map<string, string>();
  for (const loc of file.locations) {
    const location = await prisma.location.upsert({
      where: { restaurantId_code: { restaurantId: restaurant.id, code: loc.code } },
      update: {},
      create: { ...loc, restaurantId: restaurant.id },
    });
    locationIds.set(loc.code, location.id);
  }

  const roleIds = new Map<string, string>();
  for (const roleSpec of file.roles) {
    const permissions = resolveRolePermissions(roleSpec.permissions);
    const role = await prisma.role.upsert({
      where: { restaurantId_name: { restaurantId: restaurant.id, name: roleSpec.name } },
      update: { description: roleSpec.description, isSystem: roleSpec.isSystem },
      create: {
        restaurantId: restaurant.id,
        name: roleSpec.name,
        description: roleSpec.description,
        isSystem: roleSpec.isSystem,
      },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })),
    });
    roleIds.set(roleSpec.name, role.id);
  }

  if (file.menu) await seedMenu(prisma, restaurant.id, file.menu);

  for (const userSpec of file.users) {
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
        restaurantId: restaurant.id,
        passwordHash: await hashSecret(password),
        displayName: userSpec.displayName,
        preferredLocale: userSpec.preferredLocale,
      },
    });
    const existing = await prisma.userRole.findFirst({
      where: { userId: user.id, roleId, locationId },
    });
    if (!existing) await prisma.userRole.create({ data: { userId: user.id, roleId, locationId } });
  }
}

async function main(): Promise<void> {
  const file = JSON.parse(
    readFileSync(new URL('../seed/demo.json', import.meta.url), 'utf8'),
  ) as SeedFile;
  const prisma = new PrismaClient();
  try {
    await seed(prisma, file);
    console.info(`Seeded restaurant "${file.restaurant.slug}"`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
