import { type RealtimeStatus, connectRealtime } from '@pos/api-client';
import type { RealtimeEvent } from '@pos/shared-types';
import { cn } from '@pos/ui';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionClient } from './session';

/**
 * Subscribes to the location's realtime events while the component is mounted. The handler may
 * change on every render; the socket only reconnects when the session or location changes.
 */
export function useRealtime(
  session: SessionClient,
  locationId: string | null,
  onEvent: (event: RealtimeEvent) => void,
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  const signedIn = session.useSession((s) => s.status === 'authenticated');

  useEffect(() => {
    if (!locationId || !signedIn) return;
    const connection = connectRealtime({
      baseUrl: session.baseUrl,
      locationId,
      getAccessToken: () => session.useSession.getState().accessToken,
      refreshSession: session.refreshSession,
      onEvent: (event) => {
        handler.current(event);
      },
      onStatus: setStatus,
    });
    return () => {
      connection.close();
    };
  }, [session, locationId, signedIn]);

  return status;
}

const DOT: Record<RealtimeStatus, string> = {
  live: 'bg-success',
  connecting: 'border-2 border-warning',
  offline: 'border-2 border-destructive',
  forbidden: 'border-2 border-muted-foreground',
};

/** Connection state as text plus a dot that differs in shape (filled = live), not only colour. */
export function RealtimeIndicator({
  status,
  className,
}: {
  status: RealtimeStatus;
  className?: string;
}) {
  const { t } = useTranslation('common');
  return (
    <span
      role="status"
      className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)}
    >
      <span aria-hidden className={cn('size-2.5 rounded-full', DOT[status])} />
      {t(`realtime.${status}`)}
    </span>
  );
}
