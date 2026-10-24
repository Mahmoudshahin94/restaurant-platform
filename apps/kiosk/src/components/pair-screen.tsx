import { isApiError } from '@pos/api-client';
import {
  type BrandingFileSource,
  PlatformFooter,
  TenantLogo,
  useApplyBranding,
  useErrorText,
} from '@pos/app-kit';
import { Alert, Button, Field, Input } from '@pos/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type SyntheticEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useFocusOnMount } from '../lib/focus';
import { useDevice } from '../stores/device';

const hubFiles: BrandingFileSource = (fileId) => api.brandingFileUrl(fileId);

/**
 * First start, or after unpairing: the code the admin showed for this kiosk (ADR 0022). The hub
 * checks it, even without the internet, and returns the kiosk's own credential.
 */
export function PairScreen() {
  const { t } = useTranslation(['kiosk', 'common']);
  const errorText = useErrorText();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  const paired = useDevice((s) => s.paired);
  const [code, setCode] = useState('');
  const pair = useMutation({ mutationFn: (value: string) => api.pair({ code: value }) });
  // The business's look, from its hub, before the kiosk knows who it is.
  const branding = useQuery({
    queryKey: ['hub-branding', 'kiosk'],
    queryFn: () => api.hubBranding(),
    retry: false,
    staleTime: 60_000,
  });
  useApplyBranding(branding.data, hubFiles);

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    try {
      paired(await pair.mutateAsync(code));
    } catch {
      // shown below
    }
  };
  const error = pair.error;
  return (
    <main className="grid min-h-full place-items-center p-6">
      <form
        className="surface grid w-full max-w-lg gap-6 rounded-xl border p-8"
        noValidate
        onSubmit={(e) => void submit(e)}
      >
        <TenantLogo className="justify-self-center" />
        <div className="grid gap-2 text-center">
          <h1 ref={heading} tabIndex={-1} className="text-3xl font-bold outline-none">
            {t('kiosk:pair.title')}
          </h1>
          <p className="text-muted-foreground">{t('kiosk:pair.hint')}</p>
        </div>
        {error ? (
          <Alert variant="destructive">
            {isApiError(error) && error.code === 'NETWORK_ERROR'
              ? t('kiosk:pair.hubUnreachable')
              : errorText(error)}
          </Alert>
        ) : null}
        <Field label={t('kiosk:pair.code')}>
          <Input
            dir="ltr"
            value={code}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={12}
            className="h-16 text-center font-mono text-3xl tracking-widest uppercase"
            onChange={(e) => {
              setCode(e.target.value);
            }}
          />
        </Field>
        <Button type="submit" size="touch" disabled={pair.isPending || code.trim().length < 8}>
          {t('kiosk:pair.submit')}
        </Button>
        <PlatformFooter app="kiosk" className="text-center" />
      </form>
    </main>
  );
}
