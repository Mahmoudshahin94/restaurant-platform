import { TenantLogo } from '@pos/app-kit';
import { Button } from '@pos/ui';
import { RotateCcw, Type, UserCog } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../stores/session';
import { LanguageButtons } from './language-buttons';

/** The bar above every customer screen: the business, language, text size, start over, staff. */
export function KioskHeader({
  onStartOver,
  onAttendant,
}: {
  onStartOver: (() => void) | null;
  onAttendant: () => void;
}) {
  const { t } = useTranslation('kiosk');
  const largeText = useSession((s) => s.largeText);
  const toggleLargeText = useSession((s) => s.toggleLargeText);
  return (
    <header className="surface flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <TenantLogo className="me-auto" />
      <LanguageButtons />
      <Button
        type="button"
        variant="outline"
        size="xl"
        aria-pressed={largeText}
        onClick={toggleLargeText}
      >
        <Type aria-hidden className="size-5" />
        {largeText ? t('a11y.normalText') : t('a11y.largeText')}
      </Button>
      {onStartOver ? (
        <Button type="button" variant="outline" size="xl" onClick={onStartOver}>
          <RotateCcw aria-hidden className="size-5" />
          {t('menu.startOver')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="xl"
        className="text-muted-foreground"
        onClick={onAttendant}
        aria-label={t('attendant.open')}
      >
        <UserCog aria-hidden className="size-5" />
      </Button>
    </header>
  );
}
