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
 * OFFLINE · 3 pending, SYNCING · 5 pending, SYNC ERROR · 2 failed, Hub update required · 3 pending.
 * Opens the detail screen.
 */
export function SyncIndicator({ status }: { status: HubStatus }) {
  const { t } = useTranslation('pos');
  // The cloud no longer serves this hub's version (ADR 0026): say so instead of "Offline".
  const upgrade = status.upgradeRequired !== null;
  const Icon = upgrade ? TriangleAlert : ICON[status.state];
  const label = upgrade ? t('hub.upgradeRequired') : t(`hub.${status.state}`);
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
      aria-label={`${label} · ${detail}. ${t('hub.open')}`}
      className={cn(
        'flex items-center gap-1.5 rounded px-1.5 hover:bg-muted',
        status.state === 'OFFLINE' && 'font-semibold text-foreground',
        (upgrade || status.state === 'SYNC_ERROR') && 'font-semibold text-destructive',
      )}
    >
      <Icon
        aria-hidden
        className={cn('size-3.5', status.state === 'SYNCING' && 'motion-safe:animate-spin')}
      />
      <span>
        {label} · {detail}
      </span>
    </Link>
  );
}
