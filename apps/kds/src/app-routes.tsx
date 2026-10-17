import { RequireAuth } from '@pos/app-kit';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { KdsShell } from './components/kds-shell';
import { session } from './lib/session';
import { BoardPage } from './routes/board-page';
import { LocationPage } from './routes/location-page';
import { LoginPage } from './routes/login-page';
import { SettingsPage } from './routes/settings-page';
import { usePreferences } from './stores/preferences';

function RequireLocation({ children }: { children: ReactNode }) {
  const locationId = usePreferences((s) => s.locationId);
  return locationId ? <>{children}</> : <Navigate to="/location" replace />;
}

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/location"
          element={
            <RequireAuth session={session}>
              <LocationPage />
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth session={session}>
              <RequireLocation>
                <KdsShell />
              </RequireLocation>
            </RequireAuth>
          }
        >
          <Route index element={<BoardPage view="active" />} />
          <Route path="/bumped" element={<BoardPage view="completed" />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
