import { SUPPORTED_CURRENCIES } from '@pos/domain';
import { DEFAULT_TENANT_CURRENCY } from '@pos/shared-types';
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
import { type CreateOrganizationRequest, createOrganizationSchema } from '@pos/validation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { pickLocalized } from '@pos/i18n';
import { useCurrentLocale } from '@pos/app-kit';
import { api } from '../../lib/api';
import { usePlatformErrorText } from '../../lib/errors';

interface FormState {
  slug: string;
  nameEn: string;
  nameAr: string;
  currencyCode: string;
  ownerEmail: string;
  ownerName: string;
  ownerPassword: string;
}

const initial = (): FormState => ({
  slug: '',
  nameEn: '',
  nameAr: '',
  currencyCode: DEFAULT_TENANT_CURRENCY,
  ownerEmail: '',
  ownerName: '',
  ownerPassword: '',
});

function toRequest(form: FormState): CreateOrganizationRequest {
  return {
    slug: form.slug,
    nameEn: form.nameEn,
    nameAr: form.nameAr,
    currencyCode: form.currencyCode,
    owner: {
      email: form.ownerEmail,
      displayName: form.ownerName,
      // Only a person with no account yet needs one; an existing account keeps its own.
      ...(form.ownerPassword === '' ? {} : { password: form.ownerPassword }),
    },
  };
}

/** Creates an organization with its first owner, then opens it. */
export function CreateOrganizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['platform', 'common']);
  const locale = useCurrentLocale();
  const errorText = usePlatformErrorText();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(initial);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({ mutationFn: api.organizations.create });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const close = (next: boolean) => {
    if (!next) {
      setForm(initial());
      setError(null);
    }
    onOpenChange(next);
  };

  const submit = async () => {
    setError(null);
    const request = toRequest(form);
    if (!createOrganizationSchema.safeParse(request).success) {
      setError(t('common:validation.invalid'));
      return;
    }
    try {
      const created = await create.mutateAsync(request);
      await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast({
        title: t('platform:organizations.form.created', {
          name: pickLocalized(created, 'name', locale),
        }),
        variant: 'success',
      });
      close(false);
      void navigate(`/organizations/${created.id}`);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const text = (
    key: keyof FormState,
    label: string,
    props: { dir?: 'ltr' | 'rtl'; hint?: string; type?: string; autoComplete?: string } = {},
  ) => (
    <Field label={label} hint={props.hint}>
      <Input
        type={props.type}
        dir={props.dir}
        autoComplete={props.autoComplete ?? 'off'}
        value={form[key]}
        onChange={(e) => {
          set(key, e.target.value);
        }}
      />
    </Field>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent closeLabel={t('common:actions.close')} className="max-w-2xl">
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('platform:organizations.form.title')}</DialogTitle>
            <DialogDescription>{t('platform:organizations.form.description')}</DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="destructive">{error}</Alert> : null}

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-medium">{t('platform:organizations.name')}</legend>
            {text('slug', t('platform:provision.slug'), {
              dir: 'ltr',
              hint: t('platform:organizations.form.slugHint'),
            })}
            <Field
              label={t('platform:organizations.currency')}
              hint={t('platform:organizations.form.currencyHint')}
            >
              <NativeSelect
                value={form.currencyCode}
                onChange={(e) => {
                  set('currencyCode', e.target.value);
                }}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {text('nameEn', t('platform:provision.nameEn'), { dir: 'ltr' })}
            {text('nameAr', t('platform:provision.nameAr'), { dir: 'rtl' })}
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 font-medium">{t('platform:organizations.form.owner')}</legend>
            {text('ownerEmail', t('platform:organizations.form.ownerEmail'), {
              dir: 'ltr',
              type: 'email',
            })}
            {text('ownerName', t('platform:organizations.form.ownerName'))}
            <div className="sm:col-span-2">
              {text('ownerPassword', t('platform:organizations.form.ownerPassword'), {
                dir: 'ltr',
                type: 'password',
                autoComplete: 'new-password',
                hint: t('platform:organizations.form.ownerPasswordHint'),
              })}
            </div>
          </fieldset>

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
            <Button type="submit" loading={create.isPending}>
              {create.isPending
                ? t('platform:organizations.form.submitting')
                : t('platform:organizations.form.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
