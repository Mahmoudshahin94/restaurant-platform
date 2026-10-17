import { Spinner } from '@pos/ui';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import type { SessionClient } from '../session';

/** Restores the session (refresh token) on first load, then gates the subtree. */
export function RequireAuth({
  session,
  children,
}: {
  session: SessionClient;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const status = session.useSession((s) => s.status);
  const location = useLocation();

  useEffect(() => {
    if (status === 'unknown') void session.refreshSession();
  }, [status, session]);

  if (status === 'unknown') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label={t('states.loading')} />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
