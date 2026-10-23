import { zodResolver } from '@hookform/resolvers/zod';
import { pickLocalized } from '@pos/i18n';
import type { Category } from '@pos/validation';
import {
  Alert,
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
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArchiveAction } from '../../components/archive-action';
import { LocalizedFields } from '../../components/localized-fields';
import { QueryState } from '@pos/app-kit';
import { ArchivedBadge } from '../../components/status-badge';
import { api } from '../../lib/api';
import { applyServerValidation, tKey, useErrorText } from '@pos/app-kit';
import { useCurrentLocale } from '@pos/app-kit';
import { usePermissions } from '../../lib/permissions';
import { useCatalogMutation, useCategories, useTenantId } from '../../lib/queries';

const required = 'common:validation.required';
const categoryForm = z.object({
  nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  descriptionEn: z.string().trim().max(1000, 'common:validation.tooLong'),
  descriptionAr: z.string().trim().max(1000, 'common:validation.tooLong'),
  sortOrder: z.coerce
    .number<string>()
    .int('common:validation.invalid')
    .min(0, 'common:validation.invalid'),
});
type CategoryFormInput = z.input<typeof categoryForm>;
type CategoryFormOutput = z.output<typeof categoryForm>;

function CategoryDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const { t } = useTranslation(['menu', 'common']);
  const tid = useTenantId();
  const errorText = useErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<CategoryFormInput, unknown, CategoryFormOutput>({
    resolver: zodResolver(categoryForm),
    defaultValues: {
      nameEn: category?.nameEn ?? '',
      nameAr: category?.nameAr ?? '',
      descriptionEn: category?.descriptionEn ?? '',
      descriptionAr: category?.descriptionAr ?? '',
      sortOrder: String(category?.sortOrder ?? 0),
    },
  });
  const save = useCatalogMutation((values: CategoryFormOutput) => {
    const body = {
      ...values,
      descriptionEn: values.descriptionEn || null,
      descriptionAr: values.descriptionAr || null,
    };
    return category
      ? api.menu.categories.update(tid, category.id, body)
      : api.menu.categories.create(tid, body);
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      if (!applyServerValidation(error, form.setError, ['nameEn', 'nameAr', 'sortOrder']))
        setFormError(errorText(error));
    }
  });

  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{category ? t('menu:categories.edit') : t('menu:categories.new')}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <LocalizedFields register={form.register} errors={form.formState.errors} withDescription />
        <Field
          label={t('menu:fields.sortOrder')}
          hint={t('menu:fields.sortOrderHint')}
          error={
            form.formState.errors.sortOrder?.message
              ? tKey(t, form.formState.errors.sortOrder.message)
              : undefined
          }
        >
          <Input
            type="number"
            inputMode="numeric"
            dir="ltr"
            className="w-32"
            {...form.register('sortOrder')}
          />
        </Field>
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

export function CategoriesPage() {
  const { t } = useTranslation(['menu', 'common']);
  const locale = useCurrentLocale();
  const tid = useTenantId();
  const { can } = usePermissions();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const query = useCategories(showArchived);
  const archive = useCatalogMutation((id: string) => api.menu.categories.archive(tid, id));
  const restore = useCatalogMutation((id: string) => api.menu.categories.restore(tid, id));
  const canCreate = can('products.create');

  return (
    <>
      <PageHeader
        title={t('menu:categories.title')}
        description={t('menu:categories.description')}
        actions={
          canCreate ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('menu:categories.new')}
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
        empty={{ title: t('menu:categories.empty'), description: t('menu:categories.emptyHint') }}
      >
        {(rows) => (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('menu:fields.name')}</TableHead>
                  <TableHead className="w-28">{t('menu:fields.sortOrder')}</TableHead>
                  <TableHead className="w-28">{t('menu:fields.status')}</TableHead>
                  <TableHead className="w-56 text-end">{t('menu:fields.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{pickLocalized(row, 'name', locale)}</div>
                      {row.descriptionEn || row.descriptionAr ? (
                        <div className="text-xs text-muted-foreground">
                          {pickLocalized(row, 'description', locale)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="ltr-nums">{row.sortOrder}</TableCell>
                    <TableCell>
                      <ArchivedBadge archivedAt={row.archivedAt} />
                    </TableCell>
                    <TableCell className="text-end">
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
        {editing !== null ? (
          <CategoryDialog
            key={editing === 'new' ? 'new' : editing.id}
            category={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
