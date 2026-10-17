import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey } from '@pos/app-kit';
import type { Employee, StaffUser } from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Label,
  NativeSelect,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { useLocationLookup } from '../../lib/format';
import { keys, useAdminMutation, useRestaurantId } from '../../lib/queries';

const required = 'common:validation.required';
const AFFECTS = ['employees', 'users'];
const pinField = z.string().regex(/^\d{4,8}$/, 'common:validation.invalid');

const employeeForm = z.object({
  employeeCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,20}$/, 'common:validation.invalid'),
  displayName: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  homeLocationId: z.string(),
  userId: z.string(),
  pin: z.union([z.literal(''), pinField]),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof employeeForm>;

function EmployeeDialog({
  employee,
  users,
  employees,
  onClose,
}: {
  employee: Employee | null;
  users: StaffUser[];
  employees: Employee[];
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const rid = useRestaurantId();
  const errorText = useAdminErrorText();
  const { list, name } = useLocationLookup();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(employeeForm),
    defaultValues: {
      employeeCode: employee?.employeeCode ?? '',
      displayName: employee?.displayName ?? '',
      homeLocationId: employee?.homeLocationId ?? '',
      userId: employee?.userId ?? '',
      pin: '',
      isActive: employee?.isActive ?? true,
    },
  });
  // A user signs in as at most one employee.
  const linked = new Set(
    employees.filter((e) => e.id !== employee?.id).flatMap((e) => (e.userId ? [e.userId] : [])),
  );
  const linkable = users.filter((u) => !linked.has(u.id));
  const save = useAdminMutation((v: FormValues) => {
    const common = {
      displayName: v.displayName,
      homeLocationId: v.homeLocationId || null,
      userId: v.userId || null,
    };
    return employee
      ? api.admin.employees.update(rid, employee.id, { ...common, isActive: v.isActive })
      : api.admin.employees.create(rid, {
          ...common,
          employeeCode: v.employeeCode,
          ...(v.pin ? { pin: v.pin } : {}),
        });
  }, AFFECTS);
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await save.mutateAsync(values);
      onClose();
    } catch (error) {
      setFormError(errorText(error));
    }
  });
  const errors = form.formState.errors;
  const msg = (m?: string) => (m ? tKey(t, m) : undefined);
  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{employee ? t('admin:employees.edit') : t('admin:employees.new')}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('admin:employees.code')}
            hint={t('admin:employees.codeHint')}
            error={msg(errors.employeeCode?.message)}
          >
            <Input
              dir="ltr"
              autoComplete="off"
              readOnly={employee !== null}
              {...form.register('employeeCode')}
            />
          </Field>
          <Field label={t('admin:employees.name')} error={msg(errors.displayName?.message)}>
            <Input autoComplete="off" {...form.register('displayName')} />
          </Field>
          <Field label={t('admin:employees.homeLocation')}>
            <NativeSelect {...form.register('homeLocationId')}>
              <option value="">{t('admin:employees.noHomeLocation')}</option>
              {list.map((l) => (
                <option key={l.id} value={l.id}>
                  {name(l.id)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('admin:employees.user')} hint={t('admin:employees.userHint')}>
            <NativeSelect {...form.register('userId')}>
              <option value="">{t('admin:employees.noUser')}</option>
              {linkable.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.email})
                </option>
              ))}
            </NativeSelect>
          </Field>
          {employee ? null : (
            <Field
              label={t('admin:employees.pin')}
              hint={t('admin:employees.pinHint')}
              error={msg(errors.pin?.message)}
            >
              <Input
                type="password"
                inputMode="numeric"
                dir="ltr"
                autoComplete="new-password"
                {...form.register('pin')}
              />
            </Field>
          )}
        </div>
        {employee ? (
          <Controller
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="employee-active"
                  checked={field.value}
                  onCheckedChange={(v) => {
                    field.onChange(v === true);
                  }}
                />
                <Label htmlFor="employee-active">{t('common:states.active')}</Label>
              </div>
            )}
          />
        ) : null}
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

function PinDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const rid = useRestaurantId();
  const errorText = useAdminErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<{ pin: string }>({
    resolver: zodResolver(z.object({ pin: pinField })),
    defaultValues: { pin: '' },
  });
  const save = useAdminMutation(
    ({ pin }: { pin: string }) => api.admin.employees.setPin(rid, employee.id, pin),
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
  const error = form.formState.errors.pin?.message;
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('admin:employees.pinTitle', { name: employee.displayName })}</DialogTitle>
        <DialogDescription>{t('admin:employees.pinHint')}</DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <Field label={t('admin:employees.pin')} error={error ? tKey(t, error) : undefined}>
          <Input
            type="password"
            inputMode="numeric"
            dir="ltr"
            autoComplete="new-password"
            className="w-40"
            {...form.register('pin')}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {employee.hasPin ? t('admin:employees.resetPin') : t('admin:employees.setPin')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

type Editing = { kind: 'new' } | { kind: 'edit' | 'pin'; employee: Employee } | null;

export function EmployeesPage() {
  const { t } = useTranslation(['admin', 'common']);
  const rid = useRestaurantId();
  const { name } = useLocationLookup();
  const [editing, setEditing] = useState<Editing>(null);
  const employees = useQuery({
    queryKey: keys.employees(rid),
    queryFn: () => api.admin.employees.list(rid),
  });
  const users = useQuery({ queryKey: keys.users(rid), queryFn: () => api.admin.users.list(rid) });
  const close = () => {
    setEditing(null);
  };
  return (
    <>
      <PageHeader
        title={t('admin:employees.title')}
        description={t('admin:employees.description')}
        actions={
          <Button
            onClick={() => {
              setEditing({ kind: 'new' });
            }}
          >
            <Plus aria-hidden />
            {t('admin:employees.new')}
          </Button>
        }
      />
      <QueryState
        query={employees}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('admin:employees.empty') }}
      >
        {(rows) => (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:employees.code')}</TableHead>
                  <TableHead>{t('admin:employees.name')}</TableHead>
                  <TableHead>{t('admin:employees.homeLocation')}</TableHead>
                  <TableHead>{t('admin:employees.user')}</TableHead>
                  <TableHead>{t('admin:employees.pin')}</TableHead>
                  <TableHead>{t('admin:shared.status')}</TableHead>
                  <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell className="ltr-nums font-medium">{employee.employeeCode}</TableCell>
                    <TableCell>{employee.displayName}</TableCell>
                    <TableCell>
                      {employee.homeLocationId ? name(employee.homeLocationId) : ''}
                    </TableCell>
                    <TableCell dir="ltr" className="text-start">
                      {employee.userEmail ?? ''}
                    </TableCell>
                    <TableCell>
                      <Badge variant={employee.hasPin ? 'success' : 'outline'}>
                        {employee.hasPin ? t('admin:employees.hasPin') : t('admin:employees.noPin')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={employee.isActive ? 'success' : 'secondary'}>
                        {employee.isActive
                          ? t('common:states.active')
                          : t('common:states.inactive')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing({ kind: 'edit', employee });
                          }}
                        >
                          <Pencil aria-hidden />
                          {t('common:actions.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing({ kind: 'pin', employee });
                          }}
                        >
                          <KeyRound aria-hidden />
                          {employee.hasPin
                            ? t('admin:employees.resetPin')
                            : t('admin:employees.setPin')}
                        </Button>
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
          if (!open) close();
        }}
      >
        {editing?.kind === 'new' || editing?.kind === 'edit' ? (
          <EmployeeDialog
            employee={editing.kind === 'edit' ? editing.employee : null}
            users={users.data ?? []}
            employees={employees.data ?? []}
            onClose={close}
          />
        ) : null}
        {editing?.kind === 'pin' ? <PinDialog employee={editing.employee} onClose={close} /> : null}
      </Dialog>
    </>
  );
}
