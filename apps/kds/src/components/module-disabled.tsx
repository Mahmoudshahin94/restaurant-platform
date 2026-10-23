import { EmptyState, Button } from '@pos/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ChefHat, LogOut, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { session } from '../lib/session';

/**
 * Shown instead of the board where the KDS module is off for the chosen location (ADR 0018): the
 * screen cannot show tickets, because none are made. Rechecked every minute, so the board appears
 * once an administrator turns the module on.
 */
export function ModuleDisabled() {
  const { t } = useTranslation(['kds', 'common']);
  const navigate = useNavigate();
  const client = useQueryClient();
  const signOut = async () => {
    await session.signOut();
    client.clear();
    void navigate('/login', { replace: true });
  };
  return (
    <main className="flex h-full items-center justify-center bg-background p-6">
      <div className="grid max-w-lg justify-items-center gap-4 text-center">
        <ChefHat aria-hidden className="size-12 text-muted-foreground" />
        <EmptyState
          title={t('kds:moduleDisabled.title')}
          description={t('kds:moduleDisabled.description')}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" className="h-12" onClick={() => void navigate('/location')}>
                <MapPin aria-hidden />
                {t('kds:moduleDisabled.changeLocation')}
              </Button>
              <Button variant="ghost" className="h-12" onClick={() => void signOut()}>
                <LogOut aria-hidden className="rtl:-scale-x-100" />
                {t('common:actions.signOut')}
              </Button>
            </div>
          }
        />
      </div>
    </main>
  );
}
