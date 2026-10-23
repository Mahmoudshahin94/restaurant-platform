import { FeatureGate, RequireAuth, TenantProvider } from '@pos/app-kit';
import { Feature } from '@pos/shared-types';
import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { KdsShell } from './components/kds-shell';
import { ModuleDisabled } from './components/module-disabled';
import { api, session, useSession } from './lib/session';
import { BoardPage } from './routes/board-page';
import { LocationPage } from './routes/location-page';
import { LoginPage } from './routes/login-page';
import { SettingsPage } from './routes/settings-page';
import { usePreferences } from './stores/preferences';

function RequireLocation({ children }: { children: ReactNode }) {
  const locationId = usePreferences((s) => s.locationId);
  return locationId ? <>{children}</> : <Navigate to="/location" replace />;
}

/**
 * The kitchen screen exists only where the KDS module is on for the location (ADR 0018);
 * elsewhere it says so instead of calling routes the hub would refuse.
 */
function RequireKitchen({ children }: { children: ReactNode }) {
  const tenantId = useSession((s) => s.user?.tenantId);
  const locationId = usePreferences((s) => s.locationId);
  if (!tenantId) return null;
  return (
    <TenantProvider api={api} tenantId={tenantId} locationId={locationId}>
      <FeatureGate feature={Feature.KDS} fallback={<ModuleDisabled />}>
        {children}
      </FeatureGate>
    </TenantProvider>
  );
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
                <RequireKitchen>
                  <KdsShell />
                </RequireKitchen>
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
