import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, useCurrentLocale } from '@pos/app-kit';
import { pickLocalized } from '@pos/i18n';
import type { CashRegisterAdmin } from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ArchiveAction } from '../../components/archive-action';
import { LocalizedFields } from '../../components/localized-fields';
import { LocationRequired } from '../../components/location-required';
import { ArchivedBadge } from '../../components/status-badge';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { usePermissions } from '../../lib/permissions';
import { keys, useAdminMutation } from '../../lib/queries';

const required = 'common:validation.required';
const registerForm = z.object({
  nameEn: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  nameAr: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
});
type FormValues = z.infer<typeof registerForm>;
const AFFECTS = ['cash-registers'];

function RegisterDialog({
  locationId,
  register,
  onClose,
}: {
  locationId: string;
  register: CashRegisterAdmin | null;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(registerForm),
    defaultValues: { nameEn: register?.nameEn ?? '', nameAr: register?.nameAr ?? '' },
  });
  const save = useAdminMutation(
    (values: FormValues) =>
      register
        ? api.admin.cashRegisters.update(locationId, register.id, values)
        : api.admin.cashRegisters.create(locationId, values),
    AFFECTS,
  );
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
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>
          {register ? t('admin:cashRegisters.edit') : t('admin:cashRegisters.new')}
        </DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <LocalizedFields register={form.register} errors={form.formState.errors} />
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

function Registers({ locationId }: { locationId: string }) {
  const { t } = useTranslation(['admin', 'common', 'menu']);
  const locale = useCurrentLocale();
  const errorText = useAdminErrorText();
  const { canAt } = usePermissions();
  const canManage = canAt(locationId, 'settings.manage');
  const [editing, setEditing] = useState<CashRegisterAdmin | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: keys.cashRegisters(locationId),
    queryFn: () => api.admin.cashRegisters.list(locationId),
  });
  const archive = useAdminMutation(
    (id: string) => api.admin.cashRegisters.archive(locationId, id),
    AFFECTS,
  );
  const restore = useAdminMutation(
    (id: string) => api.admin.cashRegisters.restore(locationId, id),
    AFFECTS,
  );
  const guarded = (fn: () => Promise<unknown>) => () =>
    fn().catch((error: unknown) => {
      setActionError(errorText(error));
    });
  return (
    <>
      {canManage ? (
        <div className="mb-4 flex justify-end">
          <Button
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus aria-hidden />
            {t('admin:cashRegisters.new')}
          </Button>
        </div>
      ) : null}
      {actionError ? (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      ) : null}
      <QueryState
        query={query}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('admin:cashRegisters.empty') }}
      >
        {(rows) => (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('menu:fields.name')}</TableHead>
                  <TableHead>{t('admin:cashRegisters.shift')}</TableHead>
                  <TableHead>{t('admin:shared.status')}</TableHead>
                  <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">
                      {pickLocalized(row, 'name', locale)}
                    </TableCell>
                    <TableCell>
                      {row.openShiftId ? (
                        <Badge variant="warning">{t('admin:cashRegisters.openShift')}</Badge>
                      ) : (
                        <span className="text-muted-foreground">
                          {t('admin:cashRegisters.noShift')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <ArchivedBadge archivedAt={row.archivedAt} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {canManage && !row.archivedAt ? (
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
                          canArchive={canManage}
                          canRestore={canManage}
                          pending={archive.isPending || restore.isPending}
                          onArchive={guarded(() => archive.mutateAsync(row.id))}
                          onRestore={guarded(() => restore.mutateAsync(row.id))}
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
          <RegisterDialog
            key={editing === 'new' ? 'new' : editing.id}
            locationId={locationId}
            register={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

export function CashRegistersPage() {
  const { t } = useTranslation('admin');
  return (
    <>
      <PageHeader title={t('cashRegisters.title')} description={t('cashRegisters.description')} />
      <LocationRequired>
        {(locationId) => <Registers key={locationId} locationId={locationId} />}
      </LocationRequired>
    </>
  );
}
