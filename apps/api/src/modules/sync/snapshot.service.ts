import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import {
  BrandingService,
  PrismaService,
  TENANT_FILE_STORAGE,
  type TenantFileStorage,
  toTenantFileDto,
} from '@pos/server';
import type { LocationSnapshot, SnapshotTable, TenantFileDto } from '@pos/validation';
import type { AuthenticatedDevice } from '../devices/device.guard';

/**
 * Builds the configuration snapshot a location hub needs to run offline. Only rows of the hub's
 * own tenant and location are included, and only rows whose references the hub can satisfy
 * (e.g. role grants at other locations are left out). Staff credential hashes (their accounts') are included so
 * staff can sign in at the hub without the cloud: the hub is a trusted device of the tenant.
 */
@Injectable()
export class SnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
    @Inject(TENANT_FILE_STORAGE) private readonly storage: TenantFileStorage,
  ) {}

  /**
   * A product picture of the hub's tenant, for the hub to keep (ADR 0027). Only files a product
   * or variant shows: nothing else the tenant uploaded leaves the cloud this way.
   */
  async productPicture(
    device: AuthenticatedDevice,
    fileId: string,
  ): Promise<{ file: TenantFileDto; bytes: Buffer }> {
    const { tenantId } = device;
    const shown = await this.prisma.productImage.count({ where: { tenantId, fileId } });
    const file = shown
      ? await this.prisma.tenantFile.findFirst({ where: { id: fileId, tenantId } })
      : null;
    const bytes = file ? await this.storage.get(tenantId, file.storageKey) : null;
    if (!file || !bytes) throw new DomainError('FILE_NOT_FOUND', 'File not found', { fileId });
    return { file: toTenantFileDto(file), bytes };
  }

  async build(device: AuthenticatedDevice): Promise<LocationSnapshot> {
    const { tenantId, locationId } = device;
    const db = this.prisma;
    const atLocation = { OR: [{ locationId: null }, { locationId }] };
    const byId = { id: 'asc' } as const;

    // The organization's role assignments travel only while it is active (ADR 0029, R16): a
    // suspended organization's members keep only the roles their brand gave them, and one with
    // nothing else is left out, so the hub refuses them as the cloud does (R6).
    const { organization } = await db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { organization: { select: { status: true } } },
    });
    const roleWhere =
      organization === null || organization.status === 'ACTIVE'
        ? atLocation
        : { ...atLocation, grantedByOrganization: false };
    const users = await db.user.findMany({
      where: { tenantId, roles: { some: roleWhere } },
      orderBy: byId,
    });
    const userIds = users.map((u) => u.id);
    const accountIds = [...new Set(users.map((u) => u.accountId))];
    const productWhere = { product: { tenantId } };

    // Branding (ADR 0019): only the files it shows travel, with their bytes.
    const fileIds = await this.branding.fileIds(tenantId);
    // Product pictures (ADR 0027): the cover of each product and variant, what the POS and the
    // kiosk show. Their rows travel here; the hub fetches their bytes itself (GET /sync/files),
    // so a menu edit does not resend every picture.
    const productImages = coversOf(
      await db.productImage.findMany({
        where: { tenantId },
        orderBy: [{ productId: 'asc' }, { variantId: 'asc' }, { sortOrder: 'asc' }, byId],
      }),
    );
    const allFileIds = [...new Set([...fileIds, ...productImages.map((i) => i.fileId)])];
    const tenantFiles = allFileIds.length
      ? await db.tenantFile.findMany({
          where: { tenantId, id: { in: allFileIds } },
          orderBy: byId,
        })
      : [];
    const files: LocationSnapshot['files'] = [];
    for (const file of tenantFiles) {
      if (!fileIds.includes(file.id)) continue;
      const bytes = await this.storage.get(tenantId, file.storageKey);
      if (bytes) files.push({ id: file.id, content: bytes.toString('base64') });
    }

    const tables: Record<SnapshotTable, unknown[]> = {
      tenants: await db.tenant.findMany({ where: { id: tenantId } }),
      locations: await db.location.findMany({ where: { id: locationId } }),
      // Identity only: credentials and the last-seen time stay in the cloud. A terminal waiting
      // to pair brings its pairing code's hash and expiry, so the hub pairs it offline (ADR 0022).
      devices: await db.device.findMany({
        where: { locationId },
        select: {
          id: true,
          tenantId: true,
          locationId: true,
          name: true,
          type: true,
          status: true,
          pairingCodeHash: true,
          pairingExpiresAt: true,
          createdAt: true,
        },
        orderBy: byId,
      }),
      roles: await db.role.findMany({ where: { tenantId }, orderBy: byId }),
      rolePermissions: await db.rolePermission.findMany({
        where: { role: { tenantId } },
        orderBy: [{ roleId: 'asc' }, { permissionKey: 'asc' }],
      }),
      // The logins of those users (E1), for offline sign-in: the hash travels, the last brand
      // signed into stays in the cloud.
      accounts: (
        await db.account.findMany({ where: { id: { in: accountIds } }, orderBy: byId })
      ).map((a) => ({ ...a, lastTenantId: null })),
      users,
      userRoles: await db.userRole.findMany({
        where: { userId: { in: userIds }, ...roleWhere },
        orderBy: byId,
      }),
      employees: await db.employee.findMany({
        where: {
          tenantId,
          OR: [{ homeLocationId: null }, { homeLocationId: locationId }],
          AND: [{ OR: [{ userId: null }, { userId: { in: userIds } }] }],
        },
        orderBy: byId,
      }),
      taxes: await db.tax.findMany({ where: { tenantId }, orderBy: byId }),
      categories: await db.category.findMany({ where: { tenantId }, orderBy: byId }),
      kitchenStations: await db.kitchenStation.findMany({ where: { tenantId }, orderBy: byId }),
      modifierGroups: await db.modifierGroup.findMany({ where: { tenantId }, orderBy: byId }),
      modifiers: await db.modifier.findMany({
        where: { group: { tenantId } },
        orderBy: byId,
      }),
      products: await db.product.findMany({ where: { tenantId }, orderBy: byId }),
      productVariants: await db.productVariant.findMany({ where: productWhere, orderBy: byId }),
      // Retail catalog (ADR 0021): published with the menu, so the POS can scan offline.
      productOptions: await db.productOption.findMany({ where: productWhere, orderBy: byId }),
      productOptionValues: await db.productOptionValue.findMany({
        where: { option: productWhere },
        orderBy: byId,
      }),
      productVariantOptionValues: await db.productVariantOptionValue.findMany({
        where: { variant: productWhere },
        orderBy: [{ variantId: 'asc' }, { optionValueId: 'asc' }],
      }),
      productBarcodes: await db.productBarcode.findMany({ where: { tenantId }, orderBy: byId }),
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
      discounts: await db.discount.findMany({ where: { tenantId }, orderBy: byId }),
      tableSections: await db.tableSection.findMany({ where: { locationId }, orderBy: byId }),
      diningTables: await db.diningTable.findMany({ where: { locationId }, orderBy: byId }),
      // Payment providers (ADR 0024): the tenant's accounts and this location's, without their
      // secrets (a separate, cloud-only table that is never read here).
      paymentProviderAccounts: await db.paymentProviderAccount.findMany({
        where: { tenantId, OR: [{ locationId: null }, { locationId }] },
        select: {
          id: true,
          tenantId: true,
          locationId: true,
          method: true,
          providerKey: true,
          mode: true,
          status: true,
          publicConfig: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: byId,
      }),
      paymentMethods: await db.paymentMethod.findMany({ where: { tenantId }, orderBy: byId }),
      cashRegisters: await db.cashRegister.findMany({ where: { locationId }, orderBy: byId }),
      // Modules (ADR 0018), so the hub enforces them offline: overrides of the tenant, this
      // location and its devices (a device's override names its location too).
      tenantEntitlements: await db.tenantEntitlement.findMany({
        where: { tenantId },
        orderBy: { feature: 'asc' },
      }),
      featureOverrides: await db.featureOverride.findMany({
        where: { tenantId, OR: [{ locationId: null }, { locationId }] },
        orderBy: byId,
      }),
      // Every file branding refers to (its foreign keys hold); bytes missing in the cloud's
      // storage are simply not served by the hub either.
      tenantFiles,
      tenantBranding: await db.tenantBranding.findMany({ where: { tenantId } }),
      productImages,
      // Orders taken through the cloud before the hub was paired keep their numbers (ADR 0012).
      orderCounters: await db.orderCounter.findMany({
        where: { locationId, businessDate: { gte: new Date(Date.now() - 2 * 24 * 60 * 60_000) } },
        orderBy: { businessDate: 'asc' },
      }),
    };

    // JSON round trip: dates become ISO strings, exactly as the hub receives them.
    const json = JSON.parse(JSON.stringify(tables)) as LocationSnapshot['tables'];
    const version = createHash('sha256')
      .update(JSON.stringify(json))
      .update(JSON.stringify(files.map((f) => f.id)))
      .digest('hex')
      .slice(0, 32);
    return {
      format: 9,
      tenantId,
      locationId,
      generatedAt: new Date().toISOString(),
      version,
      tables: json,
      files,
    };
  }
}

/** The first picture of each product and of each variant (rows ordered by product, variant, sort). */
function coversOf<T extends { productId: string; variantId: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.productId}:${row.variantId ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
