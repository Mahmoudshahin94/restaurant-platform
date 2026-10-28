import { Spinner } from '@pos/ui';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import { session, useSession } from '../lib/api';

/** Restores the operator's session from the refresh cookie, or sends them to sign in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const status = useSession((s) => s.status);
  const location = useLocation();

  useEffect(() => {
    if (status === 'unknown') void session.refreshSession();
  }, [status]);

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
