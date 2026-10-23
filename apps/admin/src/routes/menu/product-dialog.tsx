import { zodResolver } from '@hookform/resolvers/zod';
import { formatBpsAsPercent } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
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
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { LocalizedFields } from '../../components/localized-fields';
import { api } from '../../lib/api';
import { applyServerValidation, tKey, useErrorText } from '@pos/app-kit';
import { useCurrentLocale } from '@pos/app-kit';
import { moneyField, useMoney } from '../../lib/money';
import { useCatalogMutation, useTenantId } from '../../lib/queries';

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
    variants: z.array(
      z.object({
        id: z.string().optional(),
        nameEn: z.string().trim().min(1, required),
        nameAr: z.string().trim().min(1, required),
        price: moneyField(currency),
      }),
    ),
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
      variants:
        product?.variants.map((v) => ({
          id: v.id,
          nameEn: v.nameEn,
          nameAr: v.nameAr,
          price: toInput(v.price),
        })) ?? [],
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
  const variants = useFieldArray({ control: form.control, name: 'variants' });
  const errors = form.formState.errors;
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
      variants: values.variants.map((v, i) => ({ ...v, sortOrder: i })),
      // Per-product overrides of the group's min/max; empty = the group's own rule.
      modifierGroups: values.modifierGroups.map((link, i) => ({
        modifierGroupId: link.id,
        sortOrder: i,
        minSelect: count(link.min),
        maxSelect: count(link.max),
      })),
      stationIds: values.stationIds,
      taxIds: values.taxIds,
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
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-3xl">
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

        <fieldset className="grid gap-3">
          <legend className="text-sm font-medium">{t('menu:products.variants')}</legend>
          <p className="text-xs text-muted-foreground">{t('menu:products.variantsHint')}</p>
          {variants.fields.map((field, index) => {
            const rowErrors = errors.variants?.[index];
            return (
              <div
                key={field.id}
                className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_9rem_auto] sm:items-end"
              >
                <Field label={t('menu:fields.nameEn')} error={msg(rowErrors?.nameEn?.message)}>
                  <Input lang="en" dir="ltr" {...form.register(`variants.${index}.nameEn`)} />
                </Field>
                <Field label={t('menu:fields.nameAr')} error={msg(rowErrors?.nameAr?.message)}>
                  <Input lang="ar" dir="rtl" {...form.register(`variants.${index}.nameAr`)} />
                </Field>
                <Field label={t('menu:products.price')} error={msg(rowErrors?.price?.message)}>
                  <Input
                    inputMode="decimal"
                    dir="ltr"
                    {...form.register(`variants.${index}.price`)}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common:actions.remove')}
                  onClick={() => {
                    variants.remove(index);
                  }}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            );
          })}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                variants.append({ nameEn: '', nameAr: '', price: '' });
              }}
            >
              <Plus aria-hidden />
              {t('menu:products.addVariant')}
            </Button>
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <fieldset className="grid content-start gap-2">
            <legend className="text-sm font-medium">{t('menu:products.modifierGroups')}</legend>
            <p className="text-xs text-muted-foreground">{t('menu:products.modifierGroupsHint')}</p>
            {modifierGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('menu:products.noModifierGroups')}</p>
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
