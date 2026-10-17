import { Button, EmptyState } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation(['admin', 'common']);
  return (
    <EmptyState
      title={t('admin:notFound.title')}
      action={
        <Button asChild variant="outline">
          <Link to="/">{t('admin:nav.dashboard')}</Link>
        </Button>
      }
    />
  );
}

export function ForbiddenPage() {
  const { t } = useTranslation('admin');
  return <EmptyState title={t('forbidden.title')} description={t('forbidden.body')} />;
}
