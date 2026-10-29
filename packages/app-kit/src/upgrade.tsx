import { type ApiError } from '@pos/api-client';
import { MADAR_VERSION, type PlatformApp } from '@pos/shared-types';
import { Button } from '@pos/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { PlatformFooter } from './theme/platform-footer';

interface UpgradeState {
  /**
   * The cloud refused this app as too old (ADR 0026): the oldest version it serves and the version
   * it saw, when it said.
   */
  required: { minimumVersion: string | null; version: string | null } | null;
}

export const useUpgradeRequired = create<UpgradeState>(() => ({ required: null }));

/**
 * The API clients' `onUpgradeRequired`: remembers that the cloud refused this app
 * (`426 CLIENT_UPGRADE_REQUIRED`), so `UpgradeRequiredGate` replaces the app with the notice.
 */
export function reportUpgradeRequired(error: ApiError): void {
  const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, 40) : null);
  useUpgradeRequired.setState({
    required: {
      minimumVersion: text(error.details.minimumVersion),
      version: text(error.details.version),
    },
  });
}

/**
 * Shows the app, or, once the cloud refused it as too old, a clear notice in the user's language:
 * which version runs, which one the cloud needs, and a way to check again (a web app reloads its
 * newest build; the desktop app needs its installer).
 */
export function UpgradeRequiredGate({ app, children }: { app: PlatformApp; children: ReactNode }) {
  const { t } = useTranslation();
  const required = useUpgradeRequired((s) => s.required);
  if (!required) return <>{children}</>;
  return (
    <main
      role="alert"
      className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-6 text-center text-foreground"
    >
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-2xl font-semibold">{t('upgrade.title')}</h1>
        <p className="text-muted-foreground">
          {t('upgrade.body', { product: t(`platform.products.${app}`) })}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-end text-muted-foreground">{t('upgrade.running')}</dt>
          <dd className="text-start font-medium">
            <span dir="ltr">{required.version ?? MADAR_VERSION}</span>
          </dd>
          {required.minimumVersion ? (
            <>
              <dt className="text-end text-muted-foreground">{t('upgrade.required')}</dt>
              <dd className="text-start font-medium">
                <span dir="ltr">{required.minimumVersion}</span>
              </dd>
            </>
          ) : null}
        </dl>
      </div>
      <Button
        onClick={() => {
          window.location.reload();
        }}
      >
        {t('upgrade.checkAgain')}
      </Button>
      <PlatformFooter app={app} />
    </main>
  );
}
