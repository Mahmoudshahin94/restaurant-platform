import './app.css';
import { DirectionBridge, ThemeProvider, applyStoredThemeMode, initialLocale } from '@pos/app-kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { AppRoutes } from './app-routes';
import { setupI18n } from './i18n';
import { usePreferences } from './stores/preferences';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

async function bootstrap(): Promise<void> {
  // Light or dark before the first paint (the device's choice, else the platform default).
  applyStoredThemeMode();
  const i18n = await setupI18n(initialLocale(usePreferences.getState().locale));

  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root');
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <DirectionBridge i18n={i18n}>
          <ThemeProvider app="platform">
            <QueryClientProvider client={queryClient}>
              <AppRoutes />
            </QueryClientProvider>
          </ThemeProvider>
        </DirectionBridge>
      </I18nextProvider>
    </StrictMode>,
  );
}

void bootstrap();
