import { zodResolver } from '@hookform/resolvers/zod';
import { QueryState, tKey, useCurrentLocale } from '@pos/app-kit';
import { formatBusinessDate } from '@pos/i18n';
import { OrganizationRole, enumValues } from '@pos/shared-types';
import type { MemberDto } from '@pos/validation';
import {
  Alert,
  AlertDialog,
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
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
  toast,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { z } from 'zod';
import { useAdminErrorText } from '../../lib/admin-errors';
import { api } from '../../lib/api';
import { keys, useAdminMutation } from '../../lib/queries';
import { useSession } from '../../stores/session';
import { NotFoundPage } from '../not-found-page';

const ROLES = enumValues(OrganizationRole);
const AFFECTS = ['org-members'];

const addForm = z.object({
  email: z.string().trim().pipe(z.email('admin:org.members.emailInvalid')),
  displayName: z
    .string()
    .trim()
    .min(1, 'common:validation.required')
    .max(120, 'common:validation.tooLong'),
  role: z.enum(ROLES),
  // Only for a person with no account yet; the server tells when it is missing.
  password: z
    .string()
    .refine(
      (v) => v === '' || (v.length >= 10 && v.length <= 256),
      'admin:org.members.passwordInvalid',
    ),
});
type AddValues = z.infer<typeof addForm>;

function AddMemberDialog({
  organizationId,
  onClose,
}: {
  organizationId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = useAdminErrorText();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<AddValues>({
    resolver: zodResolver(addForm),
    defaultValues: { email: '', displayName: '', role: 'MANAGER', password: '' },
  });
  const add = useAdminMutation(
    (values: AddValues) =>
      api.organizations.members.add(organizationId, {
        email: values.email,
        displayName: values.displayName,
        role: values.role,
        ...(values.password ? { password: values.password } : {}),
      }),
    AFFECTS,
  );
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const member = await add.mutateAsync(values);
      toast({
        title: t('admin:org.members.addedToast', { name: member.displayName }),
        ...(member.skippedTenantIds.length > 0
          ? { description: t('admin:org.members.skipped') }
          : {}),
        variant: 'success',
      });
      onClose();
    } catch (error) {
      setFormError(errorText(error));
    }
  });
  const errors = form.formState.errors;
  const msg = (m?: string) => (m ? tKey(t, m) : undefined);
  const role = form.watch('role');
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('admin:org.members.addTitle')}</DialogTitle>
        <DialogDescription>{t('admin:org.members.addBody')}</DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
        {formError ? <Alert variant="destructive">{formError}</Alert> : null}
        <Field label={t('admin:org.members.email')} error={msg(errors.email?.message)}>
          <Input type="email" dir="ltr" autoComplete="off" {...form.register('email')} />
        </Field>
        <Field label={t('admin:org.members.name')} error={msg(errors.displayName?.message)}>
          <Input autoComplete="off" {...form.register('displayName')} />
        </Field>
        <Field label={t('admin:org.members.role')} hint={t(`admin:org.roleHints.${role}`)}>
          <NativeSelect {...form.register('role')}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`admin:org.roles.${r}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label={t('admin:org.members.password')}
          hint={t('admin:org.members.passwordHint')}
          error={msg(errors.password?.message)}
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
          <Button type="submit" loading={form.formState.isSubmitting}>
            {t('common:actions.add')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function MembersTable({
  organizationId,
  members,
}: {
  organizationId: string;
  members: MemberDto[];
}) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const errorText = useAdminErrorText();
  const accountId = useSession((s) => s.user?.accountId);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const changeRole = useAdminMutation(
    ({ member, role }: { member: MemberDto; role: OrganizationRole }) =>
      api.organizations.members.changeRole(organizationId, member.id, { role }),
    AFFECTS,
  );
  const remove = useAdminMutation(
    (member: MemberDto) => api.organizations.members.remove(organizationId, member.id),
    AFFECTS,
  );

  const onChangeRole = async (member: MemberDto, role: OrganizationRole) => {
    try {
      await changeRole.mutateAsync({ member, role });
      toast({
        title: t('admin:org.members.roleChanged', {
          name: member.displayName,
          role: t(`admin:org.roles.${role}`),
        }),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: t('admin:org.members.roleFailed'),
        description: errorText(error),
        variant: 'destructive',
      });
    }
  };

  // A refusal (the last owner, say) shows as a toast; the dialog closes either way.
  const onRemove = async (member: MemberDto) => {
    try {
      await remove.mutateAsync(member);
      toast({
        title: t('admin:org.members.removed', { name: member.displayName }),
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: t('admin:org.members.removeFailed'),
        description: errorText(error),
        variant: 'destructive',
      });
    }
  };

  const columns: DataTableColumn<MemberDto>[] = [
    {
      id: 'name',
      header: t('admin:org.members.name'),
      sortValue: (m) => m.displayName,
      cell: (m) => (
        <span className="flex items-center gap-2 font-medium">
          {m.displayName}
          {m.accountId === accountId ? (
            <Badge variant="outline">{t('admin:org.members.you')}</Badge>
          ) : null}
        </span>
      ),
    },
    {
      id: 'email',
      header: t('admin:org.members.email'),
      sortValue: (m) => m.email,
      cell: (m) => <span dir="ltr">{m.email}</span>,
    },
    {
      id: 'role',
      header: t('admin:org.members.role'),
      cell: (m) => (
        <NativeSelect
          aria-label={t('admin:org.members.roleOf', { name: m.displayName })}
          className="h-8 w-auto"
          value={m.role}
          disabled={changeRole.isPending}
          onChange={(e) => {
            void onChangeRole(m, e.target.value as OrganizationRole);
          }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`admin:org.roles.${r}`)}
            </option>
          ))}
        </NativeSelect>
      ),
    },
    {
      id: 'added',
      header: t('admin:org.members.added'),
      sortValue: (m) => m.createdAt,
      cell: (m) => formatBusinessDate(m.createdAt.slice(0, 10), locale),
    },
    {
      id: 'actions',
      header: <span className="sr-only">{t('admin:shared.actions')}</span>,
      align: 'end',
      cell: (m) => (
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('admin:org.members.removeMember', { name: m.displayName })}
          onClick={() => {
            setRemoving(m);
          }}
        >
          <Trash2 aria-hidden />
          {t('admin:org.members.remove')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={members}
        rowKey={(m) => m.id}
        empty={t('admin:org.members.empty')}
      />
      <AlertDialog
        open={removing !== null}
        title={t('admin:org.members.removeTitle', { name: removing?.displayName ?? '' })}
        description={t('admin:org.members.removeBody')}
        confirmLabel={t('admin:org.members.remove')}
        cancelLabel={t('common:actions.cancel')}
        destructive
        onConfirm={() => (removing ? onRemove(removing) : undefined)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      />
    </>
  );
}

/** `/org/:organizationId/members`: Owners only; anyone else gets the not-found page. */
export function OrgMembersPage() {
  const { t } = useTranslation('admin');
  const { organizationId = '' } = useParams();
  const role = useSession((s) => s.user?.organizations.find((o) => o.id === organizationId)?.role);
  const [adding, setAdding] = useState(false);
  const members = useQuery({
    queryKey: keys.orgMembers(organizationId),
    queryFn: () => api.organizations.members.list(organizationId),
    enabled: role === 'OWNER',
  });
  if (role !== 'OWNER') return <NotFoundPage />;
  return (
    <>
      <PageHeader
        title={t('org.members.title')}
        description={t('org.members.description')}
        actions={
          <Button
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus aria-hidden />
            {t('org.members.add')}
          </Button>
        }
      />
      <QueryState
        query={members}
        isEmpty={(rows) => rows.length === 0}
        empty={{ title: t('org.members.empty') }}
      >
        {(rows) => <MembersTable organizationId={organizationId} members={rows} />}
      </QueryState>
      <Dialog open={adding} onOpenChange={setAdding}>
        {adding ? (
          <AddMemberDialog
            organizationId={organizationId}
            onClose={() => {
              setAdding(false);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
