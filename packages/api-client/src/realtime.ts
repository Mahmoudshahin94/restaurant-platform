import type { RealtimeEvent } from '@pos/shared-types';
import { REALTIME_CLOSE } from '@pos/validation';

export type RealtimeStatus = 'connecting' | 'live' | 'offline' | 'forbidden';

export interface RealtimeOptions {
  /** API origin (`''` = same origin as the page). */
  baseUrl: string;
  locationId: string;
  getAccessToken: () => string | null;
  /** Called when the server says the token expired; resolves false when signed out. */
  refreshSession: () => Promise<boolean>;
  onEvent: (event: RealtimeEvent) => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** Injected in tests (defaults: the browser WebSocket and the page origin). */
  createSocket?: (url: string) => WebSocket;
  origin?: string;
}

export interface RealtimeConnection {
  close: () => void;
}

const MAX_BACKOFF_MS = 30_000;
const PING_MS = 25_000;

export function realtimeUrl(baseUrl: string, origin: string): string {
  const url = new URL(`${baseUrl}/api/v1/realtime`, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/**
 * Keeps a realtime socket open for one location: authenticates with the current access token,
 * refreshes it when the server closes with 4401, and reconnects with capped, jittered backoff.
 * Events only say *what* changed; callers re-fetch the data they display. Duplicate deliveries
 * (after reconnects) are dropped by event id.
 */
export function connectRealtime(options: RealtimeOptions): RealtimeConnection {
  const createSocket = options.createSocket ?? ((url: string) => new WebSocket(url));
  const url = realtimeUrl(options.baseUrl, options.origin ?? globalThis.location.origin);
  const seen = new Set<string>();
  let socket: WebSocket | null = null;
  let attempt = 0;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

  const setStatus = (status: RealtimeStatus) => options.onStatus?.(status);

  const schedule = () => {
    if (stopped) return;
    attempt += 1;
    const ceiling = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempt);
    retry = setTimeout(open, Math.random() * ceiling);
  };

  function open(): void {
    if (stopped) return;
    const token = options.getAccessToken();
    if (!token) {
      // Not signed in (yet): try to obtain a token, otherwise stay offline.
      void options.refreshSession().then((ok) => {
        if (ok) open();
        else setStatus('offline');
      });
      return;
    }
    setStatus('connecting');
    const current = createSocket(url);
    socket = current;
    current.addEventListener('open', () => {
      current.send(JSON.stringify({ type: 'auth', token, locationId: options.locationId }));
    });
    current.addEventListener('message', (message) => {
      const data = JSON.parse(String(message.data)) as
        { type: 'ready' } | { type: 'pong' } | { type: 'event'; event: RealtimeEvent };
      if (data.type === 'ready') {
        attempt = 0;
        setStatus('live');
        ping = setInterval(() => {
          current.send(JSON.stringify({ type: 'ping' }));
        }, PING_MS);
      } else if (data.type === 'event' && !seen.has(data.event.eventId)) {
        seen.add(data.event.eventId);
        if (seen.size > 500) seen.delete(seen.values().next().value as string);
        options.onEvent(data.event);
      }
    });
    current.addEventListener('close', (event) => {
      if (ping) clearInterval(ping);
      ping = null;
      if (stopped || socket !== current) return;
      if (event.code === REALTIME_CLOSE.FORBIDDEN) {
        setStatus('forbidden');
        return;
      }
      setStatus('offline');
      if (event.code === REALTIME_CLOSE.UNAUTHENTICATED) {
        void options.refreshSession().then((ok) => {
          if (ok) open();
        });
        return;
      }
      schedule();
    });
  }

  open();
  return {
    close: () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      socket?.close();
    },
  };
}
