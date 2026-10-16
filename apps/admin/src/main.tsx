import './app.css';
import { isLocale } from '@pos/i18n';
import { DirectionProvider } from '@pos/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import type { i18n as I18nInstance } from 'i18next';
import { AppRoutes } from './app-routes';
import { setupI18n } from './i18n';
import { usePreferences } from './stores/preferences';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

/** Re-renders on language change so Radix primitives get the right direction. */
function DirectionBridge({ i18n, children }: { i18n: I18nInstance; children: React.ReactNode }) {
  const lng = useSyncExternalStore(
    (notify) => {
      i18n.on('languageChanged', notify);
      return () => {
        i18n.off('languageChanged', notify);
      };
    },
    () => i18n.language,
  );
  return <DirectionProvider dir={i18n.dir(lng)}>{children}</DirectionProvider>;
}

async function bootstrap(): Promise<void> {
  const stored = usePreferences.getState().locale;
  const browser = navigator.language.slice(0, 2);
  const locale = stored ?? (isLocale(browser) ? browser : 'en');
  const i18n = await setupI18n(locale);

  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root');
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <DirectionBridge i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <AppRoutes />
          </QueryClientProvider>
        </DirectionBridge>
      </I18nextProvider>
    </StrictMode>,
  );
}

void bootstrap();
