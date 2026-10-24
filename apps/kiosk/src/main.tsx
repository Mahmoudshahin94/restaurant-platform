import './app.css';
import { DirectionBridge, ThemeProvider, applyStoredThemeMode, initialLocale } from '@pos/app-kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { setupI18n } from './i18n';
import { KioskApp } from './kiosk-app';

/** A kiosk keeps no theme choice of its own: the tenant's kiosk surface decides (ADR 0019). */
const THEME_KEY = 'kiosk:theme-mode';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 } },
});

async function bootstrap(): Promise<void> {
  applyStoredThemeMode(THEME_KEY);
  const i18n = await setupI18n(initialLocale(null));
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root');
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <DirectionBridge i18n={i18n}>
          <ThemeProvider app="kiosk" surface="kiosk" storageKey={THEME_KEY}>
            <QueryClientProvider client={queryClient}>
              <KioskApp />
            </QueryClientProvider>
          </ThemeProvider>
        </DirectionBridge>
      </I18nextProvider>
    </StrictMode>,
  );
}

void bootstrap();
