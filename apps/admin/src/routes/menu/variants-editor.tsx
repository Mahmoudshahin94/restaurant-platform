import { tKey, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import { barcodeIssue, detectSymbology } from '@pos/domain';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@pos/ui';
import { Plus, Trash2, X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type OptionDraft,
  type VariantDraft,
  blankVariant,
  matrixRows,
  newOption,
  newValue,
  rowName,
} from './variant-matrix';

export interface CatalogDraft {
  options: OptionDraft[];
  variants: VariantDraft[];
}

/** Errors of the draft, as react-hook-form reports them (messages are translation keys). */
type Message = { message?: string } | undefined;
export interface CatalogErrors {
  options?: (
    | {
        nameEn?: Message;
        nameAr?: Message;
        values?: Message & ({ nameEn?: Message; nameAr?: Message } | undefined)[];
      }
    | undefined
  )[];
  variants?: Message & ({ [field: string]: Message } | undefined)[];
}

interface VariantsEditorProps {
  value: CatalogDraft;
  onChange: (value: CatalogDraft) => void;
  errors: CatalogErrors | undefined;
  /** The product's price as typed: new rows start from it. */
  price: string;
  currency: string;
  /** PRODUCT_VARIANTS: option axes and the generated matrix. */
  optionsOn: boolean;
  /** BARCODE: a barcode per variant. */
  barcodesOn: boolean;
  /** INVENTORY: whether each variant's stock is counted. */
  inventoryOn: boolean;
}

/** Moves to the next row's barcode field: a scanner types a code and Enter, label after label. */
function nextBarcodeOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const fields = [...document.querySelectorAll<HTMLInputElement>('[data-variant-barcode]')];
  fields[fields.indexOf(event.currentTarget) + 1]?.focus();
}

/**
 * Options and variants of a product (ADR 0021). With options (Size, Colour...), the variants are
 * the matrix of their values: every combination is a row the business sells or not, with its own
 * SKU, price, cost, barcode and stock flag. Without, variants are sizes named by hand, as before.
 */
export function VariantsEditor({
  value,
  onChange,
  errors,
  price,
  currency,
  optionsOn,
  barcodesOn,
  inventoryOn,
}: VariantsEditorProps) {
  const { t } = useTranslation(['menu', 'common']);
  const locale = useCurrentLocale();
  const { options, variants } = value;
  const withOptions = options.length > 0;
  const msg = (m: Message) => (m?.message ? tKey(t, m.message) : undefined);

  /** A change to the options: the matrix follows it. */
  const setOptions = (next: OptionDraft[]) => {
    onChange({ options: next, variants: matrixRows(next, variants, price) });
  };
  const setOption = (index: number, patch: Partial<OptionDraft>) => {
    setOptions(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  };
  const setVariant = (index: number, patch: Partial<VariantDraft>) => {
    onChange({ options, variants: variants.map((v, i) => (i === index ? { ...v, ...patch } : v)) });
  };

  return (
    <div className="grid gap-5">
      {optionsOn || withOptions ? (
        <fieldset className="grid gap-3" disabled={!optionsOn}>
          <legend className="text-sm font-medium">{t('menu:options.title')}</legend>
          <p className="text-xs text-muted-foreground">{t('menu:options.hint')}</p>
          {options.map((option, index) => {
            const optionErrors = errors?.options?.[index];
            return (
              <div key={option.key} className="grid gap-3 rounded-md border p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <Field
                    label={t('menu:options.nameEn', { index: index + 1 })}
                    error={msg(optionErrors?.nameEn)}
                  >
                    <Input
                      lang="en"
                      dir="ltr"
                      placeholder={t('menu:options.namePlaceholderEn')}
                      value={option.nameEn}
                      onChange={(e) => {
                        setOption(index, { nameEn: e.target.value });
                      }}
                    />
                  </Field>
                  <Field
                    label={t('menu:options.nameAr', { index: index + 1 })}
                    error={msg(optionErrors?.nameAr)}
                  >
                    <Input
                      lang="ar"
                      dir="rtl"
                      placeholder={t('menu:options.namePlaceholderAr')}
                      value={option.nameAr}
                      onChange={(e) => {
                        setOption(index, { nameAr: e.target.value });
                      }}
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    size="icon-md"
                    aria-label={t('menu:options.remove', { name: option.nameEn || index + 1 })}
                    onClick={() => {
                      setOptions(options.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <div className="grid gap-2 ps-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('menu:options.values')}
                  </span>
                  {option.values.map((v, valueIndex) => {
                    const valueErrors = optionErrors?.values?.[valueIndex];
                    const setValue = (patch: Partial<typeof v>) => {
                      setOption(index, {
                        values: option.values.map((x, i) =>
                          i === valueIndex ? { ...x, ...patch } : x,
                        ),
                      });
                    };
                    return (
                      <div key={v.key} className="flex items-start gap-2">
                        <Input
                          lang="en"
                          dir="ltr"
                          className="flex-1"
                          aria-label={t('menu:options.valueEn', {
                            option: option.nameEn,
                            index: valueIndex + 1,
                          })}
                          aria-invalid={valueErrors?.nameEn ? true : undefined}
                          placeholder={t('menu:options.valuePlaceholderEn')}
                          value={v.nameEn}
                          onChange={(e) => {
                            setValue({ nameEn: e.target.value });
                          }}
                        />
                        <Input
                          lang="ar"
                          dir="rtl"
                          className="flex-1"
                          aria-label={t('menu:options.valueAr', {
                            option: option.nameEn,
                            index: valueIndex + 1,
                          })}
                          aria-invalid={valueErrors?.nameAr ? true : undefined}
                          placeholder={t('menu:options.valuePlaceholderAr')}
                          value={v.nameAr}
                          onChange={(e) => {
                            setValue({ nameAr: e.target.value });
                          }}
                        />
                        <Button
                          variant="ghost"
                          size="icon-md"
                          aria-label={t('menu:options.removeValue', {
                            name: v.nameEn || valueIndex + 1,
                          })}
                          disabled={option.values.length === 1}
                          onClick={() => {
                            setOption(index, {
                              values: option.values.filter((_, i) => i !== valueIndex),
                            });
                          }}
                        >
                          <X aria-hidden />
                        </Button>
                      </div>
                    );
                  })}
                  {msg(optionErrors?.values) ? (
                    <p className="text-xs text-destructive">{msg(optionErrors?.values)}</p>
                  ) : null}
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={option.values.length >= 30}
                      onClick={() => {
                        setOption(index, { values: [...option.values, newValue()] });
                      }}
                    >
                      <Plus aria-hidden />
                      {t('menu:options.addValue')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={options.length >= 3}
              onClick={() => {
                setOptions([...options, newOption()]);
              }}
            >
              <Plus aria-hidden />
              {t('menu:options.add')}
            </Button>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="grid gap-3">
        <legend className="text-sm font-medium">
          {withOptions ? t('menu:options.variants') : t('menu:products.variants')}
        </legend>
        <p className="text-xs text-muted-foreground">
          {withOptions ? t('menu:options.variantsHint') : t('menu:products.variantsHint')}
        </p>
        {msg(errors?.variants) ? (
          <p className="text-xs text-destructive">{msg(errors?.variants)}</p>
        ) : null}
        {variants.length > 0 ? (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  {withOptions ? (
                    <TableHead className="w-14">{t('menu:options.sold')}</TableHead>
                  ) : null}
                  <TableHead className="min-w-40">{t('menu:options.variant')}</TableHead>
                  <TableHead className="min-w-32">{t('menu:products.sku')}</TableHead>
                  <TableHead className="min-w-28">{`${t('menu:products.price')} (${currency})`}</TableHead>
                  <TableHead className="min-w-28">{`${t('menu:options.cost')} (${currency})`}</TableHead>
                  {barcodesOn ? (
                    <TableHead className="min-w-44">{t('menu:barcodes.barcode')}</TableHead>
                  ) : null}
                  {inventoryOn ? (
                    <TableHead className="w-20">{t('menu:options.trackInventory')}</TableHead>
                  ) : null}
                  {withOptions ? null : <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((row, index) => {
                  const rowErrors = errors?.variants?.[index];
                  const name = withOptions ? rowName(options, row) : null;
                  const label =
                    (name ? pickLocalized(name, 'name', locale) : '') ||
                    pickLocalized(row, 'name', locale) ||
                    t('menu:products.variantName', { index: index + 1 });
                  const off = withOptions && !row.enabled;
                  return (
                    <TableRow
                      key={row.id ?? `${row.valueKeys.join('|')}-${String(index)}`}
                      className={cn(off && 'opacity-60')}
                    >
                      {withOptions ? (
                        <TableCell>
                          <Checkbox
                            aria-label={t('menu:options.sell', { name: label })}
                            checked={row.enabled}
                            onCheckedChange={(v) => {
                              setVariant(index, { enabled: v === true });
                            }}
                          />
                        </TableCell>
                      ) : null}
                      <TableCell>
                        {name ? (
                          <div>
                            <div className="font-medium">{pickLocalized(name, 'name', locale)}</div>
                            <div className="text-xs text-muted-foreground">
                              {pickLocalized(name, 'name', locale === 'ar' ? 'en' : 'ar')}
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-1">
                            <Input
                              lang="en"
                              dir="ltr"
                              aria-label={t('menu:fields.nameEn')}
                              aria-invalid={rowErrors?.nameEn ? true : undefined}
                              placeholder={t('menu:fields.nameEn')}
                              value={row.nameEn}
                              onChange={(e) => {
                                setVariant(index, { nameEn: e.target.value });
                              }}
                            />
                            <Input
                              lang="ar"
                              dir="rtl"
                              aria-label={t('menu:fields.nameAr')}
                              aria-invalid={rowErrors?.nameAr ? true : undefined}
                              placeholder={t('menu:fields.nameAr')}
                              value={row.nameAr}
                              onChange={(e) => {
                                setVariant(index, { nameAr: e.target.value });
                              }}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Cell error={msg(rowErrors?.sku)}>
                          <Input
                            dir="ltr"
                            autoComplete="off"
                            aria-label={t('menu:options.skuOf', { name: label })}
                            disabled={off}
                            value={row.sku}
                            onChange={(e) => {
                              setVariant(index, { sku: e.target.value });
                            }}
                          />
                        </Cell>
                      </TableCell>
                      <TableCell>
                        <Cell error={msg(rowErrors?.price)}>
                          <Input
                            inputMode="decimal"
                            dir="ltr"
                            aria-label={t('menu:options.priceOf', { name: label })}
                            disabled={off}
                            value={row.price}
                            onChange={(e) => {
                              setVariant(index, { price: e.target.value });
                            }}
                          />
                        </Cell>
                      </TableCell>
                      <TableCell>
                        <Cell error={msg(rowErrors?.cost)}>
                          <Input
                            inputMode="decimal"
                            dir="ltr"
                            aria-label={t('menu:options.costOf', { name: label })}
                            disabled={off}
                            value={row.cost}
                            onChange={(e) => {
                              setVariant(index, { cost: e.target.value });
                            }}
                          />
                        </Cell>
                      </TableCell>
                      {barcodesOn ? (
                        <TableCell>
                          <Cell error={msg(rowErrors?.barcodes)}>
                            <div className="flex items-center gap-1">
                              <Input
                                dir="ltr"
                                autoComplete="off"
                                data-variant-barcode=""
                                aria-label={t('menu:barcodes.of', { name: label })}
                                disabled={off}
                                value={row.barcodes[0] ?? ''}
                                onKeyDown={nextBarcodeOnEnter}
                                onChange={(e) => {
                                  setVariant(index, {
                                    barcodes: [e.target.value, ...row.barcodes.slice(1)],
                                  });
                                }}
                              />
                              {row.barcodes.length > 1 ? (
                                <Badge variant="outline" title={row.barcodes.slice(1).join(', ')}>
                                  {t('menu:barcodes.more', { count: row.barcodes.length - 1 })}
                                </Badge>
                              ) : null}
                            </div>
                          </Cell>
                        </TableCell>
                      ) : null}
                      {inventoryOn ? (
                        <TableCell>
                          <Checkbox
                            aria-label={t('menu:options.trackInventoryOf', { name: label })}
                            disabled={off}
                            checked={row.trackInventory}
                            onCheckedChange={(v) => {
                              setVariant(index, { trackInventory: v === true });
                            }}
                          />
                        </TableCell>
                      ) : null}
                      {withOptions ? null : (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon-md"
                            aria-label={t('common:actions.remove')}
                            onClick={() => {
                              onChange({
                                options,
                                variants: variants.filter((_, i) => i !== index),
                              });
                            }}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
        {withOptions ? null : (
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onChange({ options, variants: [...variants, blankVariant('')] });
              }}
            >
              <Plus aria-hidden />
              {t('menu:products.addVariant')}
            </Button>
          </div>
        )}
      </fieldset>
    </div>
  );
}

function Cell({ error, children }: { error: string | undefined; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

interface BarcodeListProps {
  codes: string[];
  onChange: (codes: string[]) => void;
  error?: string | undefined;
}

/**
 * Barcode entry for a product without variants: scan or type a code and press Enter (a scanner
 * does both). Codes are checked as they are added: an EAN or UPC with a wrong check digit is
 * refused. The first code is primary, printed on labels.
 */
export function BarcodeList({ codes, onChange, error }: BarcodeListProps) {
  const { t } = useTranslation(['menu', 'common']);
  const [draft, setDraft] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  const add = () => {
    const code = draft.trim();
    if (code === '') return;
    const problem = barcodeIssue(code, detectSymbology(code));
    if (problem) {
      setIssue(t(`menu:barcodes.issues.${problem}`));
      return;
    }
    if (codes.includes(code)) {
      setIssue(t('menu:barcodes.duplicate'));
      return;
    }
    onChange([...codes, code]);
    setDraft('');
    setIssue(null);
  };
  const message = issue ?? error;
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{t('menu:barcodes.title')}</legend>
      <p className="text-xs text-muted-foreground">{t('menu:barcodes.hint')}</p>
      {codes.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label={t('menu:barcodes.title')}>
          {codes.map((code, i) => (
            <li
              key={code}
              className="flex items-center gap-2 rounded-full border bg-muted px-3 py-1 text-sm"
            >
              <span dir="ltr" className="ltr-nums font-mono">
                {code}
              </span>
              <span className="text-xs text-muted-foreground">
                {t(`menu:barcodes.symbology.${detectSymbology(code)}`)}
              </span>
              {i === 0 ? <Badge variant="secondary">{t('menu:barcodes.primary')}</Badge> : null}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-background"
                aria-label={t('menu:barcodes.remove', { code })}
                onClick={() => {
                  onChange(codes.filter((c) => c !== code));
                }}
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-2">
        <div className="grid flex-1 gap-1.5">
          <Label htmlFor="product-barcode">{t('menu:barcodes.add')}</Label>
          <Input
            id="product-barcode"
            dir="ltr"
            autoComplete="off"
            aria-invalid={message ? true : undefined}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setIssue(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <Button variant="outline" onClick={add} disabled={draft.trim() === ''}>
          <Plus aria-hidden />
          {t('common:actions.add')}
        </Button>
      </div>
      {message ? <p className="text-xs text-destructive">{message}</p> : null}
    </fieldset>
  );
}
