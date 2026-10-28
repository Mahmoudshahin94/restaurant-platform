import type { PlatformErrorEventDto } from '@pos/validation';
import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@pos/ui';
import { useTranslation } from 'react-i18next';
import { useDateTime } from '../lib/format';

/** Recent server errors: route pattern, code and a redacted message, never a request body. */
export function ErrorEvents({ events }: { events: readonly PlatformErrorEventDto[] }) {
  const { t } = useTranslation('platform');
  const formatDate = useDateTime();
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('health.noErrors')}</p>;
  }
  return (
    <Card className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('health.when')}</TableHead>
            <TableHead>{t('health.code')}</TableHead>
            <TableHead>{t('health.route')}</TableHead>
            <TableHead>{t('health.message')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="whitespace-nowrap">{formatDate(e.createdAt)}</TableCell>
              <TableCell>
                <Badge variant="destructive">
                  <span dir="ltr">
                    {e.status} {e.code}
                  </span>
                </Badge>
              </TableCell>
              <TableCell dir="ltr" className="text-start font-mono text-xs">
                {e.method} {e.route}
              </TableCell>
              <TableCell dir="ltr" className="text-start text-xs">
                {e.message}
                {e.suppressed > 0 ? (
                  <span className="ms-2 text-muted-foreground">
                    {t('health.suppressed', { count: e.suppressed })}
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
