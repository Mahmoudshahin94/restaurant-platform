import { Toaster } from '@pos/ui';
import { useTranslation } from 'react-i18next';

/** The admin's one toast region, with translated labels. Mount it once, above the routes. */
export function AdminToaster() {
  const { t } = useTranslation(['admin', 'common']);
  return <Toaster closeLabel={t('common:actions.close')} label={t('admin:shared.notifications')} />;
}
