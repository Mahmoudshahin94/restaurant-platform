import { zodResolver } from '@hookform/resolvers/zod';
import { barcodeIssue, detectSymbology, formatBpsAsPercent } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import { Feature } from '@pos/shared-types';
import type { Category, KitchenStation, ModifierGroup, Product, Tax } from '@pos/validation';
import {
  Alert,
  Button,
  Checkbox,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  NativeSelect,
} from '@pos/ui';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { LocalizedFields } from '../../components/localized-fields';
import { api } from '../../lib/api';
import { applyServerValidation, tKey, useErrorText, useFeature } from '@pos/app-kit';
import { useCurrentLocale } from '@pos/app-kit';
import { moneyField, optionalMoneyField, useMoney } from '../../lib/money';
import { useCatalogMutation, useTenantId } from '../../lib/queries';
import { catalogRequest, draftOf } from './variant-matrix';
import { ProductImagesEditor } from './product-images';
import { BarcodeList, type CatalogErrors, VariantsEditor } from './variants-editor';

const required = 'common:validation.required';
const selectionCount = z
  .string()
  .trim()
  .regex(/^\d{0,2}$/, 'common:validation.invalid');

/** A group's own rule, the default when the product does not override it. */
interface GroupRule {
  id: string;
  minSelect: number;
  maxSelect: number | null;
  options: number;
}

/**
 * The product's overrides must still make a valid choice: min ≤ max (each falling back to the
 * group's value) and min no more than the group's options. The API checks the same.
 */
export function validOverride(rule: GroupRule, min: string, max: string): boolean {
  const minValue = min === '' ? rule.minSelect : Number(min);
  const maxValue = max === '' ? rule.maxSelect : Number(max);
  if (max !== '' && Number(max) < 1) return false;
  if (minValue > rule.options) return false;
  return maxValue === null || minValue <= maxValue;
}

const text = z.string();
const named = { nameEn: text, nameAr: text };

/** The issue of a typed barcode, as a translation key, or undefined when it is valid. */
function barcodeMessage(code: string): string | undefined {
  const issue = barcodeIssue(code.trim(), detectSymbology(code.trim()));
  return issue ? `menu:barcodes.issues.${issue}` : undefined;
}

/**
 * Options and variants as edited (ADR 0021). Money stays as typed and is checked here only for
 * the variants sold; names are required for options, their values, and hand-named variants.
 */
function catalogForm(currency: string) {
  const price = moneyField(currency);
  const cost = optionalMoneyField(currency);
  return z
    .object({
      options: z.array(
        z.object({
          id: z.string().optional(),
          key: z.string(),
          ...named,
          values: z.array(z.object({ id: z.string().optional(), key: z.string(), ...named })),
        }),
      ),
      variants: z.array(
        z.object({
          id: z.string().optional(),
          valueKeys: z.array(z.string()),
          enabled: z.boolean(),
          ...named,
          sku: text,
          price: text,
          cost: text,
          trackInventory: z.boolean(),
          barcodes: z.array(z.string()),
        }),
      ),
    })
    .superRefine(({ options, variants }, ctx) => {
      const issue = (path: (string | number)[], message: string) => {
        ctx.addIssue({ code: 'custom', path, message });
      };
      options.forEach((option, i) => {
        if (!option.nameEn.trim()) issue(['options', i, 'nameEn'], required);
        if (!option.nameAr.trim()) issue(['options', i, 'nameAr'], required);
        if (option.values.length === 0) issue(['options', i, 'values'], 'menu:options.needValue');
        option.values.forEach((v, j) => {
          if (!v.nameEn.trim()) issue(['options', i, 'values', j, 'nameEn'], required);
          if (!v.nameAr.trim()) issue(['options', i, 'values', j, 'nameAr'], required);
        });
      });
      if (options.length > 0 && !variants.some((v) => v.enabled)) {
        issue(['variants'], 'menu:options.noneSold');
      }
      variants.forEach((v, i) => {
        if (!v.enabled) return;
        if (options.length === 0) {
          if (!v.nameEn.trim()) issue(['variants', i, 'nameEn'], required);
          if (!v.nameAr.trim()) issue(['variants', i, 'nameAr'], required);
        }
        if (v.sku.trim().length > 40) issue(['variants', i, 'sku'], 'common:validation.tooLong');
        const priced = price.safeParse(v.price);
        if (!priced.success)
          issue(['variants', i, 'price'], priced.error.issues[0]?.message ?? required);
        const costed = cost.safeParse(v.cost);
        if (!costed.success)
          issue(['variants', i, 'cost'], costed.error.issues[0]?.message ?? required);
        const code = v.barcodes[0]?.trim() ?? '';
        const message = code === '' ? undefined : barcodeMessage(code);
        if (message) issue(['variants', i, 'barcodes'], message);
      });
    });
}

function productForm(currency: string, groups: readonly GroupRule[]) {
  return z.object({
    categoryId: z.string().min(1, required),
    sku: z.string().trim().max(40, 'common:validation.tooLong'),
    nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
    nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
    descriptionEn: z.string().trim().max(1000, 'common:validation.tooLong'),
    descriptionAr: z.string().trim().max(1000, 'common:validation.tooLong'),
    price: moneyField(currency),
    sortOrder: z.coerce
      .number<string>()
      .int('common:validation.invalid')
      .min(0, 'common:validation.invalid'),
    catalog: catalogForm(currency),
    barcodes: z.array(z.string()),
    modifierGroups: z
      .array(z.object({ id: z.string(), min: selectionCount, max: selectionCount }))
      .superRefine((links, ctx) => {
        links.forEach((link, index) => {
          const rule = groups.find((g) => g.id === link.id);
          if (rule && !validOverride(rule, link.min, link.max)) {
            ctx.addIssue({
              code: 'custom',
              message: 'menu:products.overrideInvalid',
              path: [index, 'max'],
            });
          }
        });
      }),
    stationIds: z.array(z.string()),
    taxIds: z.array(z.string()),
  });
}
type ProductFormInput = z.input<ReturnType<typeof productForm>>;
type ProductFormOutput = z.output<ReturnType<typeof productForm>>;
type GroupLinkInput = ProductFormInput['modifierGroups'][number];

interface ProductDialogProps {
  product: Product | null;
  currency: string;
  categories: Category[];
  modifierGroups: ModifierGroup[];
  stations: KitchenStation[];
  taxes: Tax[];
  onClose: () => void;
}

/** Adds or removes a group link, keeping display order and any override already typed. */
function toggleGroup(
  list: readonly GroupLinkInput[],
  id: string,
  on: boolean,
  universe: readonly { id: string }[],
): GroupLinkInput[] {
  const byId = new Map(list.map((l) => [l.id, l]));
  if (on && !byId.has(id)) byId.set(id, { id, min: '', max: '' });
  if (!on) byId.delete(id);
  return universe.flatMap((u) => {
    const link = byId.get(u.id);
    return link ? [link] : [];
  });
}

/** Toggles an id in a list while keeping the order of `universe` (display order). */
function toggle(
  list: readonly string[],
  id: string,
  on: boolean,
  universe: readonly { id: string }[],
): string[] {
  const set = new Set(list);
  if (on) set.add(id);
  else set.delete(id);
  return universe.map((u) => u.id).filter((x) => set.has(x));
}

export function ProductDialog({
  product,
  currency,
  categories,
  modifierGroups,
  stations,
  taxes,
  onClose,
}: ProductDialogProps) {
  const { t } = useTranslation(['menu', 'common', 'pricing']);
  const locale = useCurrentLocale();
  const tid = useTenantId();
  const errorText = useErrorText();
  const { toInput } = useMoney();
  const [formError, setFormError] = useState<string | null>(null);
  // Pictures (ADR 0027): uploaded at once, attached in this order when the product is saved.
  const [imageFileIds, setImageFileIds] = useState<string[]>(product?.imageFileIds ?? []);
  // Retail capabilities (ADR 0021): what the editor offers follows the tenant's modules.
  const optionsOn = useFeature(Feature.PRODUCT_VARIANTS);
  const barcodesOn = useFeature(Feature.BARCODE);
  const inventoryOn = useFeature(Feature.INVENTORY);
  const modifiersOn = useFeature(Feature.MODIFIERS);
  const kitchenOn = useFeature(Feature.KDS);

  const rules: GroupRule[] = modifierGroups.map((g) => ({
    id: g.id,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    options: g.modifiers.filter((m) => m.archivedAt === null).length,
  }));
  const form = useForm<ProductFormInput, unknown, ProductFormOutput>({
    resolver: zodResolver(productForm(currency, rules)),
    defaultValues: {
      categoryId: product?.categoryId ?? categories[0]?.id ?? '',
      sku: product?.sku ?? '',
      nameEn: product?.nameEn ?? '',
      nameAr: product?.nameAr ?? '',
      descriptionEn: product?.descriptionEn ?? '',
      descriptionAr: product?.descriptionAr ?? '',
      price: product ? toInput(product.price) : '',
      sortOrder: String(product?.sortOrder ?? 0),
      catalog: draftOf(product, toInput),
      barcodes: product?.barcodes.map((b) => b.code) ?? [],
      modifierGroups:
        product?.modifierGroups.map((l) => ({
          id: l.modifierGroupId,
          min: l.minSelect === null ? '' : String(l.minSelect),
          max: l.maxSelect === null ? '' : String(l.maxSelect),
        })) ?? [],
      stationIds: product?.stationIds ?? [],
      // New products start with the tenant's default taxes; nothing is applied implicitly.
      taxIds: product?.taxIds ?? taxes.filter((t) => t.isDefault).map((t) => t.id),
    },
  });
  const errors = form.formState.errors;
  const typedPrice = useWatch({ control: form.control, name: 'price' });
  const catalog = useWatch({ control: form.control, name: 'catalog' });
  // A product with variants is scanned by its variants' codes.
  const hasVariants = catalog.options.length > 0 || catalog.variants.length > 0;
  const msg = (m?: string) => (m ? tKey(t, m) : undefined);

  const save = useCatalogMutation((values: ProductFormOutput) => {
    const count = (v: string) => (v === '' ? null : Number(v));
    const body = {
      categoryId: values.categoryId,
      sku: values.sku || null,
      nameEn: values.nameEn,
      nameAr: values.nameAr,
      descriptionEn: values.descriptionEn || null,
      descriptionAr: values.descriptionAr || null,
      price: values.price,
      sortOrder: values.sortOrder,
      ...catalogRequest(values.catalog.options, values.catalog.variants, (input) =>
        moneyField(currency).parse(input),
      ),
      barcodes: hasVariants ? [] : values.barcodes.map((code, i) => ({ code, isPrimary: i === 0 })),
      // Per-product overrides of the group's min/max; empty = the group's own rule.
      modifierGroups: values.modifierGroups.map((link, i) => ({
        modifierGroupId: link.id,
        sortOrder: i,
        minSelect: count(link.min),
        maxSelect: count(link.max),
      })),
      stationIds: values.stationIds,
      taxIds: values.taxIds,
      imageFileIds,
    };
    if (product) return api.menu.products.update(tid, product.id, body);
    return api.menu.products.create(tid, {
      ...body,
      variants: body.variants.map(({ id: _id, ...v }) => v),
    });
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      if (
        !applyServerValidation(error, form.setError, [
          'sku',
          'nameEn',
          'nameAr',
          'price',
          'categoryId',
        ])
      ) {
        setFormError(errorText(error));
      }
    }
  });

  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-5xl">
      <DialogHeader>
        <DialogTitle>{product ? t('menu:products.edit') : t('menu:products.new')}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-5" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('menu:products.category')} error={msg(errors.categoryId?.message)}>
            <NativeSelect {...form.register('categoryId')}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {pickLocalized(c, 'name', locale)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label={t('menu:products.sku')}
            hint={t('menu:products.skuHint')}
            error={msg(errors.sku?.message)}
          >
            <Input dir="ltr" autoComplete="off" {...form.register('sku')} />
          </Field>
        </div>
        <LocalizedFields register={form.register} errors={errors} withDescription />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={`${t('menu:products.price')} (${currency})`}
            hint={t('menu:products.priceHint')}
            error={msg(errors.price?.message)}
          >
            <Input
              inputMode="decimal"
              dir="ltr"
              placeholder={toInput(0)}
              {...form.register('price')}
            />
          </Field>
          <Field label={t('menu:fields.sortOrder')} hint={t('menu:fields.sortOrderHint')}>
            <Input
              type="number"
              inputMode="numeric"
              dir="ltr"
              className="w-32"
              {...form.register('sortOrder')}
            />
          </Field>
        </div>

        <Controller
          control={form.control}
          name="catalog"
          render={({ field }) => (
            <VariantsEditor
              value={field.value}
              onChange={field.onChange}
              errors={errors.catalog as CatalogErrors | undefined}
              price={typedPrice}
              currency={currency}
              optionsOn={optionsOn}
              barcodesOn={barcodesOn}
              inventoryOn={inventoryOn}
            />
          )}
        />

        <ProductImagesEditor value={imageFileIds} onChange={setImageFileIds} />

        {barcodesOn && !hasVariants ? (
          <Controller
            control={form.control}
            name="barcodes"
            render={({ field }) => <BarcodeList codes={field.value} onChange={field.onChange} />}
          />
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          {/* Modules a business does not use stay out of its way (ADR 0018). */}
          {modifiersOn ? (
            <fieldset className="grid content-start gap-2">
              <legend className="text-sm font-medium">{t('menu:products.modifierGroups')}</legend>
              <p className="text-xs text-muted-foreground">
                {t('menu:products.modifierGroupsHint')}
              </p>
              {modifierGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('menu:products.noModifierGroups')}
                </p>
              ) : (
                <Controller
                  control={form.control}
                  name="modifierGroups"
                  render={({ field }) => (
                    <div className="grid gap-3">
                      {modifierGroups.map((g) => {
                        const index = field.value.findIndex((l) => l.id === g.id);
                        const link = index >= 0 ? field.value[index] : undefined;
                        const linkError =
                          index >= 0 ? errors.modifierGroups?.[index]?.max?.message : undefined;
                        const setLink = (patch: Partial<GroupLinkInput>) => {
                          field.onChange(
                            field.value.map((l) => (l.id === g.id ? { ...l, ...patch } : l)),
                          );
                        };
                        return (
                          <div key={g.id} className="grid gap-2">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`group-${g.id}`}
                                checked={link !== undefined}
                                onCheckedChange={(v) => {
                                  field.onChange(
                                    toggleGroup(field.value, g.id, v === true, modifierGroups),
                                  );
                                }}
                              />
                              <Label htmlFor={`group-${g.id}`}>
                                {pickLocalized(g, 'name', locale)}
                              </Label>
                            </div>
                            {link ? (
                              <div className="grid gap-1 ps-6">
                                <div className="flex flex-wrap items-end gap-2">
                                  <Field label={t('menu:products.overrideMin')} className="w-24">
                                    <Input
                                      inputMode="numeric"
                                      dir="ltr"
                                      placeholder={String(g.minSelect)}
                                      value={link.min}
                                      onChange={(e) => {
                                        setLink({ min: e.target.value });
                                      }}
                                    />
                                  </Field>
                                  <Field label={t('menu:products.overrideMax')} className="w-24">
                                    <Input
                                      inputMode="numeric"
                                      dir="ltr"
                                      placeholder={g.maxSelect === null ? '—' : String(g.maxSelect)}
                                      value={link.max}
                                      onChange={(e) => {
                                        setLink({ max: e.target.value });
                                      }}
                                    />
                                  </Field>
                                </div>
                                <p
                                  className={
                                    linkError
                                      ? 'text-xs text-destructive'
                                      : 'text-xs text-muted-foreground'
                                  }
                                >
                                  {linkError
                                    ? tKey(t, linkError)
                                    : t('menu:products.overrideHint', {
                                        min: g.minSelect,
                                        max: g.maxSelect ?? t('menu:products.unlimited'),
                                      })}
                                </p>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                />
              )}
            </fieldset>
          ) : null}
          {kitchenOn ? (
            <fieldset className="grid content-start gap-2">
              <legend className="text-sm font-medium">{t('menu:products.stations')}</legend>
              <p className="text-xs text-muted-foreground">{t('menu:products.stationsHint')}</p>
              {stations.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('menu:products.noStations')}</p>
              ) : (
                <Controller
                  control={form.control}
                  name="stationIds"
                  render={({ field }) => (
                    <div className="grid gap-2">
                      {stations.map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`station-${s.id}`}
                            checked={field.value.includes(s.id)}
                            onCheckedChange={(v) => {
                              field.onChange(toggle(field.value, s.id, v === true, stations));
                            }}
                          />
                          <Label htmlFor={`station-${s.id}`}>
                            {pickLocalized(s, 'name', locale)}
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}
                />
              )}
            </fieldset>
          ) : null}
        </div>

        <fieldset className="grid content-start gap-2">
          <legend className="text-sm font-medium">{t('pricing:products.taxes')}</legend>
          <p className="text-xs text-muted-foreground">{t('pricing:products.taxesHint')}</p>
          {taxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pricing:products.noTaxes')}</p>
          ) : (
            <Controller
              control={form.control}
              name="taxIds"
              render={({ field }) => (
                <div className="flex flex-wrap gap-4">
                  {taxes.map((tax) => (
                    <div key={tax.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`tax-${tax.id}`}
                        checked={field.value.includes(tax.id)}
                        onCheckedChange={(v) => {
                          field.onChange(toggle(field.value, tax.id, v === true, taxes));
                        }}
                      />
                      <Label htmlFor={`tax-${tax.id}`}>
                        {pickLocalized(tax, 'name', locale)}{' '}
                        <span className="ltr-nums">({formatBpsAsPercent(tax.rateBps)}%)</span>
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            />
          )}
        </fieldset>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('common:states.saving') : t('common:actions.save')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
