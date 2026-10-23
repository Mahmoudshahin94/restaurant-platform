import { THEME_MODES, type ThemeMode } from '@pos/shared-types';
import { NativeSelect } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { useTheme } from './theme-provider';

/**
 * This device's light/dark choice (ADR 0019): the business's default, or always light, dark or
 * the system's. Kept on the device; it wins over the business's default.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { devicePreference, setDevicePreference } = useTheme();
  return (
    <NativeSelect
      aria-label={t('theme.label')}
      className={className ?? 'h-9 w-auto'}
      value={devicePreference ?? ''}
      onChange={(event) => {
        setDevicePreference((event.target.value || null) as ThemeMode | null);
      }}
    >
      <option value="">{t('theme.inherit')}</option>
      {THEME_MODES.map((mode) => (
        <option key={mode} value={mode}>
          {t(`theme.${mode}`)}
        </option>
      ))}
    </NativeSelect>
  );
}
