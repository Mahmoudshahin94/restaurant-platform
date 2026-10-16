import { pickLocalized } from '@pos/i18n';
import { Alert, Card, CardDescription, CardHeader, CardTitle, PageHeader } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { useCurrentLocale } from '../lib/locale';
import { useRestaurant } from '../lib/queries';
import { useSession } from '../stores/session';

export function DashboardPage() {
  const { t } = useTranslation('admin');
  const locale = useCurrentLocale();
  const user = useSession((s) => s.user);
  const restaurant = useRestaurant();
  return (
    <>
      <PageHeader title={t('dashboard.title')} />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{t('dashboard.welcome', { name: user?.displayName ?? '' })}</CardTitle>
          {restaurant.data ? (
            <CardDescription>{pickLocalized(restaurant.data, 'name', locale)}</CardDescription>
          ) : null}
        </CardHeader>
      </Card>
      <Alert>{t('dashboard.phaseNotice')}</Alert>
    </>
  );
}
