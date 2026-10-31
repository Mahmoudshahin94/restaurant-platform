import { useCurrentLocale, useSupportedLocales, useTheme } from '@pos/app-kit';
import { showsLanguageSwitcher } from '@pos/domain';
import { type Locale, THEME_MODES, type ThemeMode } from '@pos/shared-types';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@pos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CircleUser, LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { session } from '../lib/api';
import { usePreferences } from '../stores/preferences';
import { useSession } from '../stores/session';

/** Stands for "follow the business" in the theme group (a radio value cannot be null). */
const INHERIT = 'inherit';

/**
 * The header's account menu (design finding A2): who is signed in, the language and light/dark
 * choices of this browser, and sign out.
 */
export function UserMenu() {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const user = useSession((s) => s.user);
  const locale = useCurrentLocale();
  const offered = useSupportedLocales();
  const setLocale = usePreferences((s) => s.setLocale);
  const { devicePreference, setDevicePreference } = useTheme();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const signOut = async () => {
    try {
      await session.signOut();
    } finally {
      queryClient.clear();
      void navigate('/login', { replace: true });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <CircleUser aria-hidden />
          <span className="hidden max-w-40 truncate sm:inline">{user?.displayName}</span>
          <span className="sr-only">{t('admin:userMenu.label')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="grid gap-0.5 font-normal">
          <span className="text-sm font-semibold text-foreground">{user?.displayName}</span>
          <span className="text-xs" dir="ltr">
            {user?.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {showsLanguageSwitcher(offered) ? (
          <>
            <DropdownMenuLabel>{t('common:language.label')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={locale}
              onValueChange={(next) => {
                setLocale(next as Locale);
                void i18n.changeLanguage(next);
              }}
            >
              {offered.map((l) => (
                <DropdownMenuRadioItem key={l} value={l} lang={l}>
                  {t(`common:language.${l}`)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel>{t('common:theme.label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={devicePreference ?? INHERIT}
          onValueChange={(next) => {
            setDevicePreference(next === INHERIT ? null : (next as ThemeMode));
          }}
        >
          <DropdownMenuRadioItem value={INHERIT}>{t('common:theme.inherit')}</DropdownMenuRadioItem>
          {THEME_MODES.map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              {t(`common:theme.${mode}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            void signOut();
          }}
        >
          <LogOut aria-hidden className="rtl:-scale-x-100" />
          {t('common:actions.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
