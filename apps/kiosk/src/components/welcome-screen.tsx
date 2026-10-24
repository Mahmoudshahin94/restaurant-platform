import { TenantLogo, useBrandName } from '@pos/app-kit';
import { useTranslation } from 'react-i18next';
import { useFocusOnMount } from '../lib/focus';
import { LanguageButtons } from './language-buttons';

/** The attract screen between customers: the business, its languages and one big button. */
export function WelcomeScreen({ onStart, scanning }: { onStart: () => void; scanning: boolean }) {
  const { t } = useTranslation('kiosk');
  const name = useBrandName();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <main className="grid min-h-full place-items-center p-8">
      <div className="grid w-full max-w-3xl justify-items-center gap-10 text-center">
        <TenantLogo className="scale-150" />
        <h1 ref={heading} tabIndex={-1} className="text-5xl font-bold outline-none">
          {name}
        </h1>
        <button
          type="button"
          onClick={onStart}
          className="w-full rounded-3xl bg-primary px-10 py-12 text-4xl font-bold text-primary-foreground shadow-lg outline-offset-4 transition-transform focus-visible:outline-4 active:scale-[0.98]"
        >
          {scanning ? t('welcome.startScan') : t('welcome.start')}
        </button>
        <LanguageButtons className="justify-center" />
      </div>
    </main>
  );
}
