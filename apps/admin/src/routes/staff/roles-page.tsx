import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey } from '@pos/app-kit';
import { resolvePermissions } from '@pos/domain';
import type { Permission } from '@pos/shared-types';
import type { Role } from '@pos/validation';
import {
  Alert,
  AlertDialog,
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
import { useQuery } from '@tanstack/react-query';
import { Check, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { PERMISSION_GROUPS, permissionsOf } from '../../lib/permission-groups';
import { usePermissions } from '../../lib/permissions';
import { keys, useAdminMutation, useTenantId } from '../../lib/queries';
import { useSession } from '../../stores/session';

const required = 'common:validation.required';
const roleForm = z.object({
  name: z.string().trim().min(1, required).max(60, 'common:validation.tooLong'),
  description: z.string().trim().max(300, 'common:validation.tooLong'),
  permissions: z.array(z.string()),
});
type FormValues = z.infer<typeof roleForm>;
const AFFECTS = ['roles', 'users'];

/** Permissions the signed-in user holds tenant-wide: the only ones they can hand out. */
function useGrantable(): ReadonlySet<Permission> {
  const user = useSession((s) => s.user);
  return useMemo(() => resolvePermissions(user?.roles ?? [], null), [user]);
}

function PermissionLabel({ permission }: { permission: Permission }) {
  const { t } = useTranslation('admin');
  return <>{tKey(t, `admin:permissions.${permission}`)}</>;
}

function RoleDialog({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const tid = useTenantId();
  const errorText = useAdminErrorText();
  const grantable = useGrantable();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(roleForm),
    defaultValues: {
      name: role?.name ?? '',
      description: role?.description ?? '',
      permissions: role?.permissions ?? [],
    },
  });
  const save = useAdminMutation((values: FormValues) => {
    const body = {
      name: values.name,
      description: values.description || null,
      permissions: values.permissions as Permission[],
    };
    return role ? api.admin.roles.update(tid, role.id, body) : api.admin.roles.create(tid, body);
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
  const nameError = form.formState.errors.name?.message;
  return (
    <DialogContent closeLabel={t('common:actions.close')} className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>{role ? t('admin:roles.edit') : t('admin:roles.new')}</DialogTitle>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('admin:roles.name')} error={nameError ? tKey(t, nameError) : undefined}>
            <Input autoComplete="off" {...form.register('name')} />
          </Field>
          <Field label={t('admin:roles.roleDescription')} hint={t('common:states.optional')}>
            <Input autoComplete="off" {...form.register('description')} />
          </Field>
        </div>
        <Controller
          control={form.control}
          name="permissions"
          render={({ field }) => (
            <div className="grid gap-4 sm:grid-cols-2">
              {PERMISSION_GROUPS.map((group) => (
                <fieldset
                  key={group.key}
                  className="grid content-start gap-2 rounded-md border p-3"
                >
                  <legend className="px-1 text-sm font-medium">
                    {t(`admin:permissionGroups.${group.key}`)}
                  </legend>
                  {permissionsOf(group).map((permission) => {
                    const id = `perm-${permission}`;
                    const held = grantable.has(permission);
                    return (
                      <div key={permission} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={field.value.includes(permission)}
                          disabled={!held}
                          onCheckedChange={(v) => {
                            field.onChange(
                              v === true
                                ? [...field.value, permission]
                                : field.value.filter((p) => p !== permission),
                            );
                          }}
                        />
                        <Label
                          htmlFor={id}
                          title={held ? undefined : t('admin:roles.notGrantable')}
                          className={held ? undefined : 'text-muted-foreground'}
                        >
                          <PermissionLabel permission={permission} />
                        </Label>
                      </div>
                    );
                  })}
                </fieldset>
              ))}
            </div>
          )}
        />
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

/** Rows: permissions by group; columns: roles. Ticks are icons with a text alternative. */
function Matrix({ roles }: { roles: Role[] }) {
  const { t } = useTranslation(['admin', 'common']);
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('admin:roles.permissions')}</TableHead>
            {roles.map((role) => (
              <TableHead key={role.id} className="text-center">
                {role.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {PERMISSION_GROUPS.map((group) => [
            <TableRow key={group.key} className="bg-muted/50">
              <TableCell colSpan={roles.length + 1} className="text-xs font-semibold uppercase">
                {t(`admin:permissionGroups.${group.key}`)}
              </TableCell>
            </TableRow>,
            ...permissionsOf(group).map((permission) => (
              <TableRow key={permission}>
                <TableCell>
                  <PermissionLabel permission={permission} />
                </TableCell>
                {roles.map((role) => {
                  const has = role.permissions.includes(permission);
                  return (
                    <TableCell key={role.id} className="text-center">
                      {has ? (
                        <Check aria-label={t('common:states.yes')} className="mx-auto size-4" />
                      ) : (
                        <Minus
                          aria-label={t('common:states.no')}
                          className="mx-auto size-4 text-muted-foreground"
                        />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            )),
          ])}
        </TableBody>
      </Table>
    </Card>
  );
}

export function RolesPage() {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const tid = useTenantId();
  const { can } = usePermissions();
  const canManage = can('roles.manage');
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  const query = useQuery({ queryKey: keys.roles(tid), queryFn: () => api.admin.roles.list(tid) });
  const remove = useAdminMutation((id: string) => api.admin.roles.remove(tid, id), AFFECTS);

  return (
    <>
      <PageHeader
        title={t('admin:roles.title')}
        description={t('admin:roles.description')}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setEditing('new');
              }}
            >
              <Plus aria-hidden />
              {t('admin:roles.new')}
            </Button>
          ) : null
        }
      />
      <QueryState
        query={query}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('admin:roles.empty') }}
      >
        {(roles) => (
          <div className="grid gap-6">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('admin:roles.name')}</TableHead>
                    <TableHead>{t('admin:roles.permissions')}</TableHead>
                    <TableHead>{t('admin:roles.users')}</TableHead>
                    <TableHead className="text-end">{t('admin:shared.actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roles.map((role) => (
                    <TableRow key={role.id}>
                      <TableCell>
                        <div className="font-medium">
                          {role.name}{' '}
                          {role.isSystem ? (
                            <Badge variant="outline" title={t('admin:roles.systemHint')}>
                              {t('admin:roles.system')}
                            </Badge>
                          ) : null}
                        </div>
                        {role.description ? (
                          <div className="text-xs text-muted-foreground">{role.description}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="ltr-nums">
                        {t('admin:roles.count', {
                          count: role.permissions.length,
                          total: PERMISSION_GROUPS.flatMap(permissionsOf).length,
                        })}
                      </TableCell>
                      <TableCell className="ltr-nums">{role.userCount}</TableCell>
                      <TableCell>
                        {canManage && !role.isSystem ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setEditing(role);
                              }}
                            >
                              <Pencil aria-hidden />
                              {t('common:actions.edit')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setDeleting(role);
                              }}
                            >
                              <Trash2 aria-hidden />
                              {t('common:actions.delete')}
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
            <Matrix roles={roles} />
          </div>
        )}
      </QueryState>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        {editing !== null ? (
          <RoleDialog
            key={editing === 'new' ? 'new' : editing.id}
            role={editing === 'new' ? null : editing}
            onClose={() => {
              setEditing(null);
            }}
          />
        ) : null}
      </Dialog>
      <AlertDialog
        open={deleting !== null}
        title={t('admin:roles.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('admin:roles.deleteBody')}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        onConfirm={() => remove.mutateAsync(deleting?.id ?? '')}
        errorText={errorText}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      />
    </>
  );
}
