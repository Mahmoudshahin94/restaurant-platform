import { Badge } from '@pos/ui';
import { useTranslation } from 'react-i18next';

export function ArchivedBadge({ archivedAt }: { archivedAt: string | null }) {
  const { t } = useTranslation();
  return archivedAt ? (
    <Badge variant="secondary">{t('states.archived')}</Badge>
  ) : (
    <Badge variant="success">{t('states.active')}</Badge>
  );
}
