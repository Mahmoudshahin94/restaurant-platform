import { Button } from '@pos/ui';
import { Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFocusOnMount } from '../lib/focus';

/** "Are you still there?": a touch anywhere keeps the order; otherwise it is cleared. */
export function IdleOverlay({ seconds, onContinue }: { seconds: number; onContinue: () => void }) {
  const { t } = useTranslation('kiosk');
  const button = useFocusOnMount<HTMLButtonElement>();
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="idle-title"
      aria-describedby="idle-body"
      className="fixed inset-0 z-50 grid place-items-center bg-background/90 p-8 text-center backdrop-blur"
    >
      <div className="surface grid max-w-xl justify-items-center gap-6 rounded-3xl border p-10">
        <Hourglass aria-hidden className="size-16 text-primary" />
        <h2 id="idle-title" className="text-4xl font-bold">
          {t('idle.title')}
        </h2>
        <p id="idle-body" className="text-2xl text-muted-foreground">
          {t('idle.body', { seconds })}
        </p>
        <Button
          ref={button}
          type="button"
          size="touch"
          className="h-16 text-xl"
          onClick={onContinue}
        >
          {t('idle.continue')}
        </Button>
      </div>
    </div>
  );
}
