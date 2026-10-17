import { cn } from '@pos/ui';
import type { HubStatus } from '@pos/validation';
import { CloudOff, RefreshCw, TriangleAlert, Cloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

const ICON = {
  ONLINE: Cloud,
  OFFLINE: CloudOff,
  SYNCING: RefreshCw,
  SYNC_ERROR: TriangleAlert,
} as const;

/**
 * The connectivity indicator the POS always shows (docs/sync.md): ONLINE · 12 synchronized,
 * OFFLINE · 3 pending, SYNCING · 5 pending, SYNC ERROR · 2 failed. Opens the detail screen.
 */
export function SyncIndicator({ status }: { status: HubStatus }) {
  const { t } = useTranslation('pos');
  const Icon = ICON[status.state];
  const detail =
    status.state === 'SYNC_ERROR'
      ? t('hub.failed', { count: status.failedOperations })
      : status.state === 'ONLINE'
        ? t('hub.synced', { count: status.syncedOperations })
        : t('hub.pending', { count: status.pendingOperations });
  return (
    <Link
      to="/sync"
      role="status"
      aria-label={`${t(`hub.${status.state}`)} · ${detail}. ${t('hub.open')}`}
      className={cn(
        'flex items-center gap-1.5 rounded px-1.5 hover:bg-muted',
        status.state === 'OFFLINE' && 'font-semibold text-foreground',
        status.state === 'SYNC_ERROR' && 'font-semibold text-destructive',
      )}
    >
      <Icon
        aria-hidden
        className={cn('size-3.5', status.state === 'SYNCING' && 'motion-safe:animate-spin')}
      />
      <span>
        {t(`hub.${status.state}`)} · {detail}
      </span>
    </Link>
  );
}
