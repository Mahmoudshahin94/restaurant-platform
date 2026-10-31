import { OrganizationStatus, enumValues } from '@pos/shared-types';
import {
  Alert,
  Button,
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
  type PlatformOrganizationDetail,
  type UpdateOrganizationRequest,
  updateOrganizationSchema,
} from '@pos/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { pickLocalized } from '@pos/i18n';
import { useCurrentLocale } from '@pos/app-kit';
import { api } from '../../lib/api';
import { usePlatformErrorText } from '../../lib/errors';
import { invalidateOrganization } from './organization-queries';

/** The organization's names and status. Only what changed is sent. */
export function EditOrganizationDialog({
  organization,
  open,
  onOpenChange,
}: {
  organization: PlatformOrganizationDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['platform', 'common']);
  const locale = useCurrentLocale();
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const [nameEn, setNameEn] = useState(organization.nameEn);
  const [nameAr, setNameAr] = useState(organization.nameAr);
  const [status, setStatus] = useState<OrganizationStatus>(organization.status);
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (body: UpdateOrganizationRequest) =>
      api.organizations.update(organization.id, body),
  });

  const submit = async () => {
    setError(null);
    const body: UpdateOrganizationRequest = {
      ...(nameEn !== organization.nameEn ? { nameEn } : {}),
      ...(nameAr !== organization.nameAr ? { nameAr } : {}),
      ...(status !== organization.status ? { status } : {}),
    };
    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }
    if (!updateOrganizationSchema.safeParse(body).success) {
      setError(t('common:validation.invalid'));
      return;
    }
    try {
      await update.mutateAsync(body);
      await invalidateOrganization(queryClient, organization.id);
      toast({ title: t('platform:organization.saved'), variant: 'success' });
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            <DialogTitle>
              {t('platform:organization.editTitle', {
                name: pickLocalized(organization, 'name', locale),
              })}
            </DialogTitle>
            <DialogDescription>{t('platform:organization.editDescription')}</DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <Field label={t('platform:provision.nameEn')}>
            <Input
              dir="ltr"
              value={nameEn}
              onChange={(e) => {
                setNameEn(e.target.value);
              }}
            />
          </Field>
          <Field label={t('platform:provision.nameAr')}>
            <Input
              dir="rtl"
              value={nameAr}
              onChange={(e) => {
                setNameAr(e.target.value);
              }}
            />
          </Field>
          <Field label={t('platform:organization.newStatus')}>
            <NativeSelect
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as OrganizationStatus);
              }}
            >
              {enumValues(OrganizationStatus).map((s) => (
                <option key={s} value={s}>
                  {t(`platform:statuses.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" loading={update.isPending}>
              {t('platform:organization.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
