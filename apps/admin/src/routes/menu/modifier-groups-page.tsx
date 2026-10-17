import { zodResolver } from '@hookform/resolvers/zod';
import { pickLocalized } from '@pos/i18n';
import type { ModifierGroup } from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArchiveAction } from '../../components/archive-action';
import { LocalizedFields } from '../../components/localized-fields';
import { QueryState } from '@pos/app-kit';
import { ArchivedBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { tKey, useErrorText } from '@pos/app-kit';
import { useCurrentLocale } from '@pos/app-kit';
import { moneyField, useMoney } from '../../lib/money';
import { usePermissions } from '../../lib/permissions';
import { useCatalogMutation, useModifierGroups, useRestaurantId } from '../../lib/queries';

const required = 'common:validation.required';
const count = z.coerce
  .number<string>()
  .int('common:validation.invalid')
  .min(0, 'common:validation.invalid')
  .max(50, 'common:validation.invalid');

function groupForm(currency: string) {
  return z
    .object({
      nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
      nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
      minSelect: count,
      maxSelect: z
        .string()
        .trim()
        .transform((v, ctx) => {
          if (v === '') return null;
          const n = Number(v);
          if (!Number.isInteger(n) || n < 1 || n > 50) {
            ctx.addIssue({ code: 'custom', message: 'common:validation.invalid' });
            return z.NEVER;
          }
          return n;
        }),
      modifiers: z
        .array(
          z.object({
            id: z.string().optional(),
            nameEn: z.string().trim().min(1, required),
            nameAr: z.string().trim().min(1, required),
            priceDelta: moneyField(currency),
            isDefault: z.boolean(),
          }),
        )
        .min(1, required),
    })
    .refine((g) => g.maxSelect === null || g.maxSelect >= g.minSelect, {
      message: 'common:validation.minMax',
      path: ['maxSelect'],
    })
    .refine((g) => g.minSelect <= g.modifiers.length, {
      message: 'common:validation.minMax',
      path: ['minSelect'],
    });
}
type GroupFormInput = z.input<ReturnType<typeof groupForm>>;
type GroupFormOutput = z.output<ReturnType<typeof groupForm>>;

function GroupDialog({
  group,
  currency,
  onClose,
}: {
  group: ModifierGroup | null;
  currency: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['menu', 'common']);
  const rid = useRestaurantId();
  const errorText = useErrorText();
  const { toInput } = useMoney();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<GroupFormInput, unknown, GroupFormOutput>({
    resolver: zodResolver(groupForm(currency)),
    defaultValues: {
      nameEn: group?.nameEn ?? '',
      nameAr: group?.nameAr ?? '',
      minSelect: String(group?.minSelect ?? 0),
      maxSelect: group?.maxSelect === null || group === null ? '' : String(group.maxSelect),
      modifiers: group?.modifiers.map((m) => ({
        id: m.id,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        priceDelta: toInput(m.priceDelta),
        isDefault: m.isDefault,
      })) ?? [{ nameEn: '', nameAr: '', priceDelta: '0', isDefault: false }],
    },
  });
  const modifiers = useFieldArray({ control: form.control, name: 'modifiers' });
  const errors = form.formState.errors;
  const msg = (m?: string) => (m ? tKey(t, m) : undefined);

  const save = useCatalogMutation((values: GroupFormOutput) => {
    const list = values.modifiers.map((m, i) => ({ ...m, sortOrder: i }));
    return group
      ? api.menu.modifierGroups.update(rid, group.id, { ...values, modifiers: list })
      : api.menu.modifierGroups.create(rid, {
          ...values,
          modifiers: list.map(({ id: _id, ...m }) => m),
        });
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      setFormError(errorText(error));
    }
  });

  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          {group ? t('menu:modifierGroups.edit') : t('menu:modifierGroups.new')}
        </DialogTitle>
      </DialogHeader>
      <form className="grid gap-5" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <LocalizedFields register={form.register} errors={errors} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('menu:modifierGroups.minSelect')} error={msg(errors.minSelect?.message)}>
            <Input
              type="number"
              inputMode="numeric"
              dir="ltr"
              min={0}
              {...form.register('minSelect')}
            />
          </Field>
          <Field
            label={t('menu:modifierGroups.maxSelect')}
            hint={t('menu:modifierGroups.maxSelectHint')}
            error={msg(errors.maxSelect?.message)}
          >
            <Input
              type="number"
              inputMode="numeric"
              dir="ltr"
              min={1}
              {...form.register('maxSelect')}
            />
          </Field>
        </div>
        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-medium">{t('menu:modifierGroups.modifiers')}</legend>
          {modifiers.fields.map((field, index) => {
            const rowErrors = errors.modifiers?.[index];
            return (
              <div
                key={field.id}
                className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_8rem_auto_auto] sm:items-end"
              >
                <Field label={t('menu:fields.nameEn')} error={msg(rowErrors?.nameEn?.message)}>
                  <Input lang="en" dir="ltr" {...form.register(`modifiers.${index}.nameEn`)} />
                </Field>
                <Field label={t('menu:fields.nameAr')} error={msg(rowErrors?.nameAr?.message)}>
                  <Input lang="ar" dir="rtl" {...form.register(`modifiers.${index}.nameAr`)} />
                </Field>
                <Field
                  label={t('menu:modifierGroups.priceDelta')}
                  error={msg(rowErrors?.priceDelta?.message)}
                >
                  <Input
                    inputMode="decimal"
                    dir="ltr"
                    {...form.register(`modifiers.${index}.priceDelta`)}
                  />
                </Field>
                <Controller
                  control={form.control}
                  name={`modifiers.${index}.isDefault`}
                  render={({ field: f }) => (
                    <div className="flex h-10 items-center gap-2">
                      <Checkbox
                        id={`default-${field.id}`}
                        checked={f.value}
                        onCheckedChange={(v) => {
                          f.onChange(v === true);
                        }}
                      />
                      <Label htmlFor={`default-${field.id}`}>
                        {t('menu:modifierGroups.isDefault')}
                      </Label>
                    </div>
                  )}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common:actions.remove')}
                  disabled={modifiers.fields.length === 1}
                  onClick={() => {
                    modifiers.remove(index);
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
                modifiers.append({ nameEn: '', nameAr: '', priceDelta: '0', isDefault: false });
              }}
            >
              <Plus aria-hidden />
              {t('menu:modifierGroups.addModifier')}
            </Button>
          </div>
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

export function ModifierGroupsPage() {
  const { t } = useTranslation(['menu', 'common']);
  const locale = useCurrentLocale();
  const rid = useRestaurantId();
  const { can } = usePermissions();
  const { currency, format } = useMoney();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ModifierGroup | 'new' | null>(null);
  const query = useModifierGroups(showArchived);
  const archive = useCatalogMutation((id: string) => api.menu.modifierGroups.archive(rid, id));
  const restore = useCatalogMutation((id: string) => api.menu.modifierGroups.restore(rid, id));

  return (
    <>
      <PageHeader
        title={t('menu:modifierGroups.title')}
        description={t('menu:modifierGroups.description')}
        actions={
          can('products.create') && currency ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('menu:modifierGroups.new')}
            </Button>
          ) : null
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Checkbox
          id="show-archived"
          checked={showArchived}
          onCheckedChange={(v) => {
            setShowArchived(v === true);
          }}
        />
        <Label htmlFor="show-archived">{t('menu:showArchived')}</Label>
      </div>
      <QueryState
        query={query}
        isEmpty={(rows) => rows.length === 0}
        empty={{
          title: t('menu:modifierGroups.empty'),
          description: t('menu:modifierGroups.emptyHint'),
        }}
      >
        {(rows) => (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('menu:fields.name')}</TableHead>
                  <TableHead>{t('menu:modifierGroups.modifiers')}</TableHead>
                  <TableHead className="w-40">{t('menu:modifierGroups.minSelect')}</TableHead>
                  <TableHead className="w-28">{t('menu:fields.status')}</TableHead>
                  <TableHead className="w-56 text-end">{t('menu:fields.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {pickLocalized(row, 'name', locale)}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs text-muted-foreground">
                        {t('menu:modifierGroups.count', { count: row.modifiers.length })}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.modifiers.map((m) => (
                          <Badge key={m.id} variant="outline">
                            {pickLocalized(m, 'name', locale)}
                            {m.priceDelta > 0 ? (
                              <bdi className="whitespace-nowrap">
                                {format(m.priceDelta, { sign: 'exceptZero' })}
                              </bdi>
                            ) : null}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.minSelect > 0 ? 'default' : 'secondary'}>
                        {row.minSelect > 0
                          ? t('menu:modifierGroups.required')
                          : t('menu:modifierGroups.optional')}
                      </Badge>{' '}
                      <span className="ltr-nums text-xs text-muted-foreground">
                        {t('menu:modifierGroups.range', {
                          min: row.minSelect,
                          max: row.maxSelect ?? t('menu:modifierGroups.unlimited'),
                        })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <ArchivedBadge archivedAt={row.archivedAt} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {can('products.update') && !row.archivedAt ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditing(row);
                            }}
                          >
                            <Pencil aria-hidden />
                            {t('common:actions.edit')}
                          </Button>
                        ) : null}
                        <ArchiveAction
                          name={pickLocalized(row, 'name', locale)}
                          archived={row.archivedAt !== null}
                          canArchive={can('products.delete')}
                          canRestore={can('products.update')}
                          pending={archive.isPending || restore.isPending}
                          onArchive={() => archive.mutateAsync(row.id)}
                          onRestore={() => restore.mutateAsync(row.id)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </QueryState>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null && currency ? (
          <GroupDialog
            key={editing === 'new' ? 'new' : editing.id}
            group={editing === 'new' ? null : editing}
            currency={currency}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
