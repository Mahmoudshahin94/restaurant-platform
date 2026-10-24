import { DomainError, combinationName, variantOptionsIssue } from '@pos/domain';
import { Feature, TenantFileKind } from '@pos/shared-types';
import type { updateProductSchema } from '@pos/validation';
import type { z } from 'zod';
import type { PrismaTx } from '../../prisma/prisma.service';
import type { FeatureService } from '../features/feature.service';
import type { TenantFilesService } from '../files/tenant-files.service';
import { type ProductWithRelations, sortedOptions } from './menu.mappers';

type UpdateInput = z.output<typeof updateProductSchema>;
type OptionsInput = NonNullable<UpdateInput['options']>;
type VariantsInput = NonNullable<UpdateInput['variants']>;
type BarcodesInput = NonNullable<UpdateInput['barcodes']>;

/** The options, variants, barcodes and pictures a request writes (ADR 0021). */
export interface CatalogWrite {
  sku?: string | null;
  options?: OptionsInput;
  variants?: VariantsInput;
  barcodes?: BarcodesInput;
  imageFileIds?: string[];
}

export interface CatalogServices {
  features: FeatureService;
  files: TenantFilesService;
}

/** A price that changed, for the `product.price_changed` audit entries. */
export type PriceChange = Record<string, unknown>;

interface Target {
  variantId: string | null;
  barcodes: BarcodesInput;
}

const sameText = (a: { nameEn: string; nameAr: string }, b: typeof a) =>
  a.nameEn === b.nameEn && a.nameAr === b.nameAr;

/** Whether `options` describes exactly the stored options (same ids, names and values, in order). */
function sameOptions(stored: ProductWithRelations['options'], options: OptionsInput): boolean {
  const current = sortedOptions(stored);
  return (
    current.length === options.length &&
    current.every((o, i) => {
      const next = options[i];
      return (
        next !== undefined &&
        next.id === o.id &&
        sameText(o, next) &&
        o.values.length === next.values.length &&
        o.values.every((v, j) => {
          const value = next.values[j];
          return value !== undefined && value.id === v.id && sameText(v, value);
        })
      );
    })
  );
}

/**
 * Writes a product's options, variants, barcodes and pictures (ADR 0021), inside the caller's
 * transaction, after the product row itself. `current` is the product as stored before the
 * request (for a new product: as just created, with nothing of these). Returns the variant price
 * changes for the audit log.
 *
 * - **Options** (`options`, sent with `variants`): matched by id, renamed, added or removed;
 *   removing an option or value removes it from the variants that named it.
 * - **Variants** (`variants`): the complete list, as before M5; missing ones are archived (orders
 *   name them) and their barcodes freed. A product with options takes one value of each per
 *   variant and names the variant after them; one without, names given by hand.
 * - **Barcodes**: each target's list replaces what it had; absent keeps it. Codes are unique in
 *   the tenant (`BARCODE_TAKEN`) and a product with variants has them on its variants.
 * - **SKUs** are unique in the tenant across products and variants (`SKU_TAKEN`).
 * - **Modules**: new option axes need PRODUCT_VARIANTS and new barcodes need BARCODE; what is
 *   already stored can be sent back unchanged with the module off.
 */
export async function writeProductCatalog(
  tx: PrismaTx,
  services: CatalogServices,
  tenantId: string,
  current: ProductWithRelations,
  input: CatalogWrite,
): Promise<PriceChange[]> {
  const productId = current.id;
  const priceChanges: PriceChange[] = [];
  const scope = { tenantId };

  if (input.options !== undefined && input.options.length > 0) {
    if (!sameOptions(current.options, input.options)) {
      await services.features.assertEnabled([Feature.PRODUCT_VARIANTS], scope, { db: tx });
    }
  }
  const storedCodes = new Set(current.barcodes.map((b) => `${b.variantId ?? ''}:${b.code}`));
  const sentCodes = [
    ...(input.barcodes ?? []).map((b) => `:${b.code}`),
    ...(input.variants ?? []).flatMap((v) =>
      (v.barcodes ?? []).map((b) => `${v.id ?? 'new'}:${b.code}`),
    ),
  ];
  if (sentCodes.some((key) => !storedCodes.has(key))) {
    await services.features.assertEnabled([Feature.BARCODE], scope, { db: tx });
  }

  // --- Options --------------------------------------------------------------------------------
  let valueIds = sortedOptions(current.options).map((o) => o.values.map((v) => v.id));
  let valueNames: { nameEn: string; nameAr: string }[][] = sortedOptions(current.options).map(
    (o) => o.values,
  );
  if (input.options !== undefined) {
    ({ valueIds, valueNames } = await writeOptions(tx, current, input.options));
  }

  // --- Variants -------------------------------------------------------------------------------
  const liveVariantIds = new Set(
    current.variants.filter((v) => v.archivedAt === null).map((v) => v.id),
  );
  const targets: Target[] = [];
  let finalVariantIds = [...liveVariantIds];
  if (input.variants !== undefined) {
    const combinations = input.variants.map((v) => v.optionValues);
    const withOptions = valueIds.length > 0;
    const issue = variantOptionsIssue(
      valueIds.map((values) => values.length),
      combinations,
    );
    if (issue || (withOptions && input.variants.length === 0)) {
      throw new DomainError('INVALID_VARIANT_OPTIONS', 'Variants do not match the options', {
        reason: issue?.reason ?? 'NO_VARIANTS',
        index: issue?.index ?? 0,
      });
    }
    const existing = new Map(current.variants.map((v) => [v.id, v]));
    const keep: string[] = [];
    for (const [
      index,
      { id, optionValues, barcodes, imageFileIds, ...fields },
    ] of input.variants.entries()) {
      const values = optionValues.map((value, option) => valueNames[option]?.[value]);
      const named = withOptions
        ? combinationName(values.map((v) => v ?? { nameEn: '', nameAr: '' }))
        : { nameEn: fields.nameEn, nameAr: fields.nameAr };
      if (!named.nameEn || !named.nameAr) {
        throw new DomainError('INVALID_VARIANT_OPTIONS', 'A variant needs a name', {
          reason: 'NAME_REQUIRED',
          index,
        });
      }
      const data = {
        nameEn: named.nameEn,
        nameAr: named.nameAr,
        sku: fields.sku,
        price: fields.price,
        cost: fields.cost,
        trackInventory: fields.trackInventory,
        sortOrder: fields.sortOrder,
      };
      let variantId: string;
      if (id) {
        const before = existing.get(id);
        if (!before) {
          throw new DomainError('VARIANT_NOT_FOUND', 'Variant not in product', { variantId: id });
        }
        await tx.productVariant.update({ where: { id }, data: { ...data, archivedAt: null } });
        if (before.price !== data.price) {
          priceChanges.push({ productId, variantId: id, from: before.price, to: data.price });
        }
        variantId = id;
      } else {
        variantId = (await tx.productVariant.create({ data: { ...data, productId } })).id;
      }
      keep.push(variantId);
      const ids = optionValues.map((value, option) => valueIds[option]?.[value] ?? '');
      const linked = existing.get(variantId)?.optionValues.map((l) => l.optionValueId) ?? [];
      if (!id || [...linked].sort().join() !== [...ids].sort().join()) {
        await tx.productVariantOptionValue.deleteMany({ where: { variantId } });
        if (withOptions) {
          await tx.productVariantOptionValue.createMany({
            data: ids.map((optionValueId) => ({ variantId, optionValueId })),
          });
        }
      }
      if (barcodes !== undefined || !id) targets.push({ variantId, barcodes: barcodes ?? [] });
      if (imageFileIds !== undefined) {
        await writeImages(tx, services, tenantId, productId, variantId, imageFileIds);
      }
    }
    const toArchive = [...liveVariantIds].filter((v) => !keep.includes(v));
    if (toArchive.length > 0) {
      await tx.productVariant.updateMany({
        where: { id: { in: toArchive } },
        data: { archivedAt: new Date() },
      });
      // An archived variant is no longer sold: its codes and pictures are free for others.
      await tx.productBarcode.deleteMany({ where: { variantId: { in: toArchive } } });
      await tx.productImage.deleteMany({ where: { variantId: { in: toArchive } } });
    }
    finalVariantIds = keep;
  }

  // --- Product-level barcodes and pictures ------------------------------------------------------
  if (input.barcodes !== undefined) targets.push({ variantId: null, barcodes: input.barcodes });
  if (input.imageFileIds !== undefined) {
    await writeImages(tx, services, tenantId, productId, null, input.imageFileIds);
  }
  await writeBarcodes(tx, tenantId, productId, targets);

  if (finalVariantIds.length > 0) {
    const productLevel = await tx.productBarcode.count({ where: { productId, variantId: null } });
    if (productLevel > 0) {
      throw new DomainError(
        'BARCODE_INVALID',
        'A product with variants is scanned by its variants',
        {
          reason: 'VARIANT_REQUIRED',
        },
      );
    }
  }
  await assertSkusFree(tx, tenantId, productId);
  return priceChanges;
}

/** Saves the options as sent; returns each option's value ids and names, in order. */
async function writeOptions(
  tx: PrismaTx,
  current: ProductWithRelations,
  options: OptionsInput,
): Promise<{ valueIds: string[][]; valueNames: { nameEn: string; nameAr: string }[][] }> {
  const productId = current.id;
  const stored = new Map(current.options.map((o) => [o.id, o]));
  const keptOptions: string[] = [];
  const valueIds: string[][] = [];
  for (const [index, { id, values, ...names }] of options.entries()) {
    const before = id ? stored.get(id) : undefined;
    if (id && !before) {
      throw new DomainError('INVALID_VARIANT_OPTIONS', 'Option not in product', {
        reason: 'UNKNOWN_OPTION',
        optionId: id,
      });
    }
    const optionId = before
      ? (
          await tx.productOption.update({
            where: { id: before.id },
            data: { ...names, sortOrder: index },
          })
        ).id
      : (await tx.productOption.create({ data: { ...names, productId, sortOrder: index } })).id;
    keptOptions.push(optionId);

    const storedValues = new Map((before?.values ?? []).map((v) => [v.id, v]));
    const ids: string[] = [];
    for (const [position, { id: valueId, ...valueNames }] of values.entries()) {
      if (valueId && !storedValues.has(valueId)) {
        throw new DomainError('INVALID_VARIANT_OPTIONS', 'Value not in option', {
          reason: 'UNKNOWN_VALUE',
          optionValueId: valueId,
        });
      }
      const row = valueId
        ? await tx.productOptionValue.update({
            where: { id: valueId },
            data: { ...valueNames, sortOrder: position },
          })
        : await tx.productOptionValue.create({
            data: { ...valueNames, optionId, sortOrder: position },
          });
      ids.push(row.id);
    }
    const removed = [...storedValues.keys()].filter((v) => !ids.includes(v));
    if (removed.length > 0)
      await tx.productOptionValue.deleteMany({ where: { id: { in: removed } } });
    valueIds.push(ids);
  }
  const removedOptions = current.options
    .filter((o) => !keptOptions.includes(o.id))
    .map((o) => o.id);
  if (removedOptions.length > 0) {
    await tx.productOption.deleteMany({ where: { id: { in: removedOptions } } });
  }
  return {
    valueIds,
    valueNames: options.map((o) => o.values.map(({ nameEn, nameAr }) => ({ nameEn, nameAr }))),
  };
}

/**
 * Replaces the barcodes of each target (the product itself, or one variant). The first code of a
 * list is primary unless another is. Codes another product or variant of the tenant has are
 * refused; moving a code between this product's own variants is fine.
 */
async function writeBarcodes(
  tx: PrismaTx,
  tenantId: string,
  productId: string,
  targets: Target[],
): Promise<void> {
  if (targets.length === 0) return;
  const codes = targets.flatMap((t) => t.barcodes.map((b) => b.code));
  if (codes.length > 0) {
    const taken = await tx.productBarcode.findFirst({
      where: { tenantId, code: { in: codes }, NOT: { productId } },
      select: { code: true },
    });
    if (taken) {
      throw new DomainError('BARCODE_TAKEN', 'Another item has this barcode', { code: taken.code });
    }
    // Codes kept by a target of this product that is not being rewritten are taken too.
    const rewritten = targets.map((t) => t.variantId);
    const own = await tx.productBarcode.findFirst({
      where: {
        productId,
        code: { in: codes },
        NOT: { OR: rewritten.map((variantId) => ({ variantId })) },
      },
      select: { code: true },
    });
    if (own)
      throw new DomainError('BARCODE_TAKEN', 'Another variant has this barcode', {
        code: own.code,
      });
  }
  await tx.productBarcode.deleteMany({
    where: { productId, OR: targets.map((t) => ({ variantId: t.variantId })) },
  });
  const rows = targets.flatMap(({ variantId, barcodes }) => {
    const primary = Math.max(
      0,
      barcodes.findIndex((b) => b.isPrimary),
    );
    return barcodes.map((b, i) => ({
      tenantId,
      productId,
      variantId,
      code: b.code,
      symbology: b.symbology,
      isPrimary: i === primary,
    }));
  });
  if (rows.length > 0) await tx.productBarcode.createMany({ data: rows });
}

/** Replaces the pictures of the product (`variantId` null) or of one variant. */
async function writeImages(
  tx: PrismaTx,
  services: CatalogServices,
  tenantId: string,
  productId: string,
  variantId: string | null,
  fileIds: readonly string[],
): Promise<void> {
  await services.files.assertOwned(
    tx,
    tenantId,
    fileIds.map((id) => ({ id, kind: TenantFileKind.PRODUCT_IMAGE })),
  );
  await tx.productImage.deleteMany({ where: { productId, variantId } });
  if (fileIds.length > 0) {
    await tx.productImage.createMany({
      data: fileIds.map((fileId, sortOrder) => ({
        tenantId,
        productId,
        variantId,
        fileId,
        sortOrder,
      })),
    });
  }
}

/**
 * Every SKU names one thing the tenant sells: no other product or live variant of the tenant
 * has the SKU of this product or of one of its live variants. Product SKUs are also unique in the
 * database; variant SKUs only here, since variants carry no tenant column.
 */
async function assertSkusFree(tx: PrismaTx, tenantId: string, productId: string): Promise<void> {
  const product = await tx.product.findFirst({
    where: { id: productId, tenantId },
    select: { sku: true, variants: { where: { archivedAt: null }, select: { sku: true } } },
  });
  if (!product) return;
  const own = product.variants.flatMap((v) => (v.sku === null ? [] : [v.sku]));
  const skus = [...(product.sku === null ? [] : [product.sku]), ...own];
  if (skus.length === 0) return;
  const duplicate = skus.find((sku, i) => skus.indexOf(sku) !== i);
  if (duplicate !== undefined) {
    throw new DomainError('SKU_TAKEN', 'Two items of this product share a SKU', { sku: duplicate });
  }
  const product2 = await tx.product.findFirst({
    where: { tenantId, sku: { in: skus }, NOT: { id: productId } },
    select: { sku: true },
  });
  const variant = await tx.productVariant.findFirst({
    where: {
      sku: { in: skus },
      archivedAt: null,
      product: { tenantId, NOT: { id: productId } },
    },
    select: { sku: true },
  });
  const taken = product2?.sku ?? variant?.sku;
  if (taken) throw new DomainError('SKU_TAKEN', 'Another item has this SKU', { sku: taken });
}
