import { useCurrentLocale } from '@pos/app-kit';
import { formatBusinessDate } from '@pos/i18n';
import { OrganizationRole, enumValues } from '@pos/shared-types';
import {
  Alert,
  AlertDialog,
  Button,
  Card,
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
  toast,
} from '@pos/ui';
import {
  type AddMemberRequest,
  type MemberDto,
  type PlatformOrganizationDetail,
  addMemberSchema,
} from '@pos/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { usePlatformErrorText } from '../../lib/errors';
import { usePlatformCan } from '../../lib/permissions';
import { invalidateOrganization } from './organization-queries';

const ROLES = enumValues(OrganizationRole);

function AddMemberDialog({
  organization,
  open,
  onOpenChange,
}: {
  organization: PlatformOrganizationDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['admin', 'common']);
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<OrganizationRole>('MANAGER');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (body: AddMemberRequest) => api.organizations.members.add(organization.id, body),
  });

  const close = (next: boolean) => {
    if (!next) {
      setEmail('');
      setDisplayName('');
      setRole('MANAGER');
      setPassword('');
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    setError(null);
    const body: AddMemberRequest = {
      email,
      displayName,
      role,
      // Only for a person with no account yet; the server tells when it is missing.
      ...(password === '' ? {} : { password }),
    };
    if (!addMemberSchema.safeParse(body).success) {
      setError(t('common:validation.invalid'));
      return;
    }
    try {
      const member = await add.mutateAsync(body);
      await invalidateOrganization(queryClient, organization.id);
      toast({
        title: t('admin:org.members.addedToast', { name: member.displayName }),
        ...(member.skippedTenantIds.length > 0
          ? { description: t('admin:org.members.skipped') }
          : {}),
        variant: 'success',
      });
      close(false);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent closeLabel={t('common:actions.close')}>
        <form
          className="grid gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('admin:org.members.addTitle')}</DialogTitle>
            <DialogDescription>{t('admin:org.members.addBody')}</DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Field label={t('admin:org.members.email')}>
            <Input
              type="email"
              dir="ltr"
              autoComplete="off"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </Field>
          <Field label={t('admin:org.members.name')}>
            <Input
              autoComplete="off"
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
              }}
            />
          </Field>
          <Field label={t('admin:org.members.role')} hint={t(`admin:org.roleHints.${role}`)}>
            <NativeSelect
              value={role}
              onChange={(e) => {
                setRole(e.target.value as OrganizationRole);
              }}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`admin:org.roles.${r}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('admin:org.members.password')} hint={t('admin:org.members.passwordHint')}>
            <Input
              type="password"
              dir="ltr"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                close(false);
              }}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" loading={add.isPending}>
              {t('common:actions.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The organization's members: the same actions as its own owners have. */
export function MembersTab({ organization }: { organization: PlatformOrganizationDetail }) {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useCurrentLocale();
  const can = usePlatformCan();
  const manage = can('organizations.manage');
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const changeRole = useMutation({
    mutationFn: ({ member, role }: { member: MemberDto; role: OrganizationRole }) =>
      api.organizations.members.changeRole(organization.id, member.id, { role }),
  });
  const remove = useMutation({
    mutationFn: (member: MemberDto) => api.organizations.members.remove(organization.id, member.id),
  });

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
    } finally {
      // Also after a refusal: the select shows what the server has.
      await invalidateOrganization(queryClient, organization.id);
    }
  };

  // A refusal (the last owner) shows in the dialog, which stays open.
  const onRemove = async (member: MemberDto) => {
    await remove.mutateAsync(member);
    await invalidateOrganization(queryClient, organization.id);
    toast({
      title: t('admin:org.members.removed', { name: member.displayName }),
      variant: 'success',
    });
  };

  const columns: DataTableColumn<MemberDto>[] = [
    {
      id: 'name',
      header: t('admin:org.members.name'),
      sortValue: (m) => m.displayName,
      cell: (m) => <span className="font-medium">{m.displayName}</span>,
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
      cell: (m) =>
        manage ? (
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
        ) : (
          t(`admin:org.roles.${m.role}`)
        ),
    },
    {
      id: 'added',
      header: t('admin:org.members.added'),
      sortValue: (m) => m.createdAt,
      cell: (m) => formatBusinessDate(m.createdAt.slice(0, 10), locale),
    },
    ...(manage
      ? [
          {
            id: 'actions',
            header: <span className="sr-only">{t('admin:shared.actions')}</span>,
            align: 'end' as const,
            cell: (m: MemberDto) => (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`${t('admin:org.members.remove')}: ${m.displayName}`}
                onClick={() => {
                  setRemoving(m);
                }}
              >
                <Trash2 aria-hidden />
                {t('admin:org.members.remove')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-4">
      {manage ? (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              setAdding(true);
            }}
          >
            <Plus aria-hidden />
            {t('admin:org.members.add')}
          </Button>
        </div>
      ) : null}
      <Card>
        <DataTable
          columns={columns}
          rows={organization.members}
          rowKey={(m) => m.id}
          empty={t('admin:org.members.empty')}
        />
      </Card>
      {manage ? (
        <>
          <AddMemberDialog organization={organization} open={adding} onOpenChange={setAdding} />
          <AlertDialog
            open={removing !== null}
            title={t('admin:org.members.removeTitle', { name: removing?.displayName ?? '' })}
            description={t('admin:org.members.removeBody')}
            confirmLabel={t('admin:org.members.remove')}
            cancelLabel={t('common:actions.cancel')}
            destructive
            errorText={errorText}
            onConfirm={() => (removing ? onRemove(removing) : undefined)}
            onOpenChange={(open) => {
              if (!open) setRemoving(null);
            }}
          />
        </>
      ) : null}
    </div>
  );
}
