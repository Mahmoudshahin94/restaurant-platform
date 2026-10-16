import { Spinner } from '@pos/ui';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router';
import { refreshSession } from '../lib/api';
import { useSession } from '../stores/session';

/** Restores the session from the refresh cookie on first load, then gates the subtree. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const status = useSession((s) => s.status);
  const location = useLocation();

  useEffect(() => {
    if (status === 'unknown') void refreshSession();
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
