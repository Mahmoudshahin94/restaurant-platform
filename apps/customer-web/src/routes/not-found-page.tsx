import { EmptyState, buttonVariants } from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

export function NotFoundPage() {
  const { t } = useTranslation('customer');
  return (
    <EmptyState
      title={t('status.notFound')}
      action={
        <Link to="/" className={buttonVariants()}>
          {t('nav.home')}
        </Link>
      }
    />
  );
}
