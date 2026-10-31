import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey } from '@pos/app-kit';
import type { Role, RoleAssignmentInput, StaffUser } from '@pos/validation';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
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
import { KeyRound, Pencil, Plus, ShieldCheck, Trash2, UserX, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { useDateTime, useLocationLookup } from '../../lib/format';
import { keys, useAdminMutation, useTenantId } from '../../lib/queries';
import { useSession } from '../../stores/session';

const required = 'common:validation.required';
const AFFECTS = ['users', 'roles', 'employees'];
const passwordField = z
  .string()
  .min(10, 'common:validation.invalid')
  .max(256, 'common:validation.tooLong');

/** Role assignments editor: each row is a role, tenant-wide or at one location. */
function AssignmentsEditor({
  value,
  onChange,
  roles,
}: {
  value: RoleAssignmentInput[];
  onChange: (next: RoleAssignmentInput[]) => void;
  roles: Role[];
}) {
  const { t } = useTranslation(['admin', 'common']);
  const { list, name } = useLocationLookup();
  const update = (index: number, patch: Partial<RoleAssignmentInput>) => {
    onChange(value.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium">{t('admin:users.roles')}</legend>
      <p className="text-xs text-muted-foreground">{t('admin:users.rolesHint')}</p>
      {value.length === 0 ? <p className="text-sm">{t('admin:users.noRoles')}</p> : null}
      {value.map((assignment, index) => (
        <div
          key={`${assignment.roleId}:${assignment.locationId ?? '*'}:${String(index)}`}
          className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <Field label={t('admin:users.role')}>
            <NativeSelect
              value={assignment.roleId}
              onChange={(e) => {
                update(index, { roleId: e.target.value });
              }}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('admin:users.where')}>
            <NativeSelect
              value={assignment.locationId ?? ''}
              onChange={(e) => {
                update(index, { locationId: e.target.value || null });
              }}
            >
              <option value="">{t('admin:users.tenantWide')}</option>
              {list.map((l) => (
                <option key={l.id} value={l.id}>
                  {name(l.id)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            variant="ghost"
            size="icon-md"
            aria-label={t('common:actions.remove')}
            onClick={() => {
              onChange(value.filter((_, i) => i !== index));
            }}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={roles.length === 0}
          onClick={() => {
            const first = roles.find((r) => !r.isSystem) ?? roles[0];
            if (first) onChange([...value, { roleId: first.id, locationId: null }]);
          }}
        >
          <Plus aria-hidden />
          {t('admin:users.addRole')}
        </Button>
      </div>
    </fieldset>
  );
}

const newUserForm = z.object({
  email: z.email('common:validation.invalid'),
  displayName: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  preferredLocale: z.enum(['en', 'ar']),
  password: passwordField,
});
type NewUserValues = z.infer<typeof newUserForm>;

function NewUserDialog({ roles, onClose }: { roles: Role[]; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const [assignments, setAssignments] = useState<RoleAssignmentInput[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<NewUserValues>({
    resolver: zodResolver(newUserForm),
    defaultValues: { email: '', displayName: '', preferredLocale: 'en', password: '' },
  });
  const save = useAdminMutation(
    (values: NewUserValues) => api.admin.users.create(tid, { ...values, roles: assignments }),
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
  const errors = form.formState.errors;
  const msg = (m?: string) => (m ? tKey(t, m) : undefined);
  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t('admin:users.new')}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin:users.email')} error={msg(errors.email?.message)}>
            <Input type="email" dir="ltr" autoComplete="off" {...form.register('email')} />
          </Field>
          <Field label={t('admin:users.name')} error={msg(errors.displayName?.message)}>
            <Input autoComplete="off" {...form.register('displayName')} />
          </Field>
          <Field label={t('admin:users.language')}>
            <NativeSelect {...form.register('preferredLocale')}>
              <option value="en">{t('common:language.en')}</option>
              <option value="ar">{t('common:language.ar')}</option>
            </NativeSelect>
          </Field>
          <Field
            label={t('admin:users.password')}
            hint={t('admin:users.passwordHint')}
            error={msg(errors.password?.message)}
          >
            <Input
              type="password"
              dir="ltr"
              autoComplete="new-password"
              {...form.register('password')}
            />
          </Field>
        </div>
        <AssignmentsEditor value={assignments} onChange={setAssignments} roles={roles} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('common:states.saving') : t('common:actions.create')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

const editUserForm = z.object({
  displayName: z.string().trim().min(1, required).max(120, 'common:validation.tooLong'),
  preferredLocale: z.enum(['en', 'ar']),
});
type EditUserValues = z.infer<typeof editUserForm>;

function EditUserDialog({ user, onClose }: { user: StaffUser; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<EditUserValues>({
    resolver: zodResolver(editUserForm),
    defaultValues: { displayName: user.displayName, preferredLocale: user.preferredLocale },
  });
  const save = useAdminMutation(
    (values: EditUserValues) => api.admin.users.update(tid, user.id, values),
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
  const nameError = form.formState.errors.displayName?.message;
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('admin:users.edit')}</DialogTitle>
        <DialogDescription dir="ltr">{user.email}</DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <Field label={t('admin:users.name')} error={nameError ? tKey(t, nameError) : undefined}>
          <Input autoComplete="off" {...form.register('displayName')} />
        </Field>
        <Field label={t('admin:users.language')}>
          <NativeSelect {...form.register('preferredLocale')}>
            <option value="en">{t('common:language.en')}</option>
            <option value="ar">{t('common:language.ar')}</option>
          </NativeSelect>
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

function RolesDialog({
  user,
  roles,
  onClose,
}: {
  user: StaffUser;
  roles: Role[];
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const [assignments, setAssignments] = useState<RoleAssignmentInput[]>(
    user.roles.map((r) => ({ roleId: r.roleId, locationId: r.locationId })),
  );
  const [error, setError] = useState<string | null>(null);
  const save = useAdminMutation(() => api.admin.users.setRoles(tid, user.id, assignments), AFFECTS);
  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{t('admin:users.rolesTitle', { name: user.displayName })}</DialogTitle>
      </DialogHeader>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <AssignmentsEditor value={assignments} onChange={setAssignments} roles={roles} />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          disabled={save.isPending}
          onClick={() => {
            setError(null);
            save.mutateAsync(undefined).then(onClose, (e: unknown) => {
              setError(errorText(e));
            });
          }}
        >
          {save.isPending ? t('common:states.saving') : t('common:actions.save')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function PasswordDialog({ user, onClose }: { user: StaffUser; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<{ password: string }>({
    resolver: zodResolver(z.object({ password: passwordField })),
    defaultValues: { password: '' },
  });
  const save = useAdminMutation(
    ({ password }: { password: string }) => api.admin.users.resetPassword(tid, user.id, password),
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
  const error = form.formState.errors.password?.message;
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('admin:users.resetTitle', { name: user.displayName })}</DialogTitle>
        <DialogDescription>{t('admin:users.resetBody')}</DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <Field
          label={t('admin:users.password')}
          hint={t('admin:users.passwordHint')}
          error={error ? tKey(t, error) : undefined}
        >
          <Input
            type="password"
            dir="ltr"
            autoComplete="new-password"
            {...form.register('password')}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {t('admin:users.resetPassword')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

type Editing =
  { kind: 'new' } | { kind: 'edit' | 'roles' | 'password' | 'active'; user: StaffUser } | null;

export function UsersPage() {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const me = useSession((s) => s.user);
  const formatDate = useDateTime();
  const { name } = useLocationLookup();
  const [editing, setEditing] = useState<Editing>(null);
  const users = useQuery({ queryKey: keys.users(tid), queryFn: () => api.admin.users.list(tid) });
  const roles = useQuery({ queryKey: keys.roles(tid), queryFn: () => api.admin.roles.list(tid) });
  const setActive = useAdminMutation(
    ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.admin.users.update(tid, id, { isActive }),
    AFFECTS,
  );
  const errorText = useAdminErrorText();
  const close = () => {
    setEditing(null);
  };
  const roleList = roles.data ?? [];

  return (
    <>
      <PageHeader
        title={t('admin:users.title')}
        description={t('admin:users.description')}
        actions={
          <Button
            onClick={() => {
              setEditing({ kind: 'new' });
            }}
          >
            <Plus aria-hidden />
            {t('admin:users.new')}
          </Button>
        }
      />
      {setActive.isError && editing === null ? (
        <Alert variant="destructive" className="mb-4">
          {errorText(setActive.error)}
        </Alert>
      ) : null}
      <QueryState
        query={users}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('admin:users.empty') }}
      >
        {(rows) => (
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin:users.name')}</TableHead>
                  <TableHead>{t('admin:users.roles')}</TableHead>
                  <TableHead>{t('admin:users.employee')}</TableHead>
                  <TableHead>{t('admin:users.lastLogin')}</TableHead>
                  <TableHead>{t('admin:shared.status')}</TableHead>
                  <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((user) => {
                  const self = user.id === me?.id;
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="font-medium">
                          {user.displayName}{' '}
                          {self ? <Badge variant="outline">{t('admin:users.you')}</Badge> : null}
                          {user.managedByOrganization ? (
                            <Badge variant="secondary">{t('admin:users.organization')}</Badge>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground" dir="ltr">
                          {user.email}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {user.roles.map((r) => (
                            <Badge key={`${r.roleId}:${r.locationId ?? '*'}`} variant="secondary">
                              {r.roleName} ·{' '}
                              {r.locationId ? name(r.locationId) : t('admin:users.tenantWide')}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="ltr-nums">
                        {user.employee?.employeeCode ?? ''}
                      </TableCell>
                      <TableCell>
                        {user.lastLoginAt ? formatDate(user.lastLoginAt) : t('admin:shared.never')}
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.isActive ? 'success' : 'secondary'}>
                          {user.isActive ? t('common:states.active') : t('common:states.inactive')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {user.managedByOrganization ? (
                          // Edited from the organization instead (the API refuses it here).
                          <p className="text-end text-xs text-muted-foreground">
                            {t('admin:users.managedByOrganization')}
                          </p>
                        ) : (
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditing({ kind: 'edit', user });
                              }}
                            >
                              <Pencil aria-hidden />
                              {t('common:actions.edit')}
                            </Button>
                            {self ? null : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditing({ kind: 'roles', user });
                                  }}
                                >
                                  <ShieldCheck aria-hidden />
                                  {t('admin:users.editRoles')}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setEditing({ kind: 'password', user });
                                  }}
                                >
                                  <KeyRound aria-hidden />
                                  {t('admin:users.resetPassword')}
                                </Button>
                                {user.isActive ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setEditing({ kind: 'active', user });
                                    }}
                                  >
                                    <UserX aria-hidden />
                                    {t('admin:users.deactivate')}
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setActive.mutate({ id: user.id, isActive: true });
                                    }}
                                  >
                                    <UserCheck aria-hidden />
                                    {t('admin:users.reactivate')}
                                  </Button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </QueryState>
      <Dialog
        open={editing !== null && editing.kind !== 'active'}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {editing?.kind === 'new' ? <NewUserDialog roles={roleList} onClose={close} /> : null}
        {editing?.kind === 'edit' ? <EditUserDialog user={editing.user} onClose={close} /> : null}
        {editing?.kind === 'roles' ? (
          <RolesDialog user={editing.user} roles={roleList} onClose={close} />
        ) : null}
        {editing?.kind === 'password' ? (
          <PasswordDialog user={editing.user} onClose={close} />
        ) : null}
      </Dialog>
      <AlertDialog
        open={editing?.kind === 'active'}
        title={t('admin:users.deactivateTitle', {
          name: editing && editing.kind !== 'new' ? editing.user.displayName : '',
        })}
        description={t('admin:users.deactivateBody')}
        confirmLabel={t('admin:users.deactivate')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        onConfirm={() =>
          setActive.mutateAsync({
            id: editing && editing.kind !== 'new' ? editing.user.id : '',
            isActive: false,
          })
        }
        errorText={errorText}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      />
    </>
  );
}
