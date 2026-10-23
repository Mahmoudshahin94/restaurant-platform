import type { RealtimeEvent } from '@pos/shared-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectRealtime, realtimeUrl } from './realtime';

type Listener = (event: { data?: string; code?: number }) => void;

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: unknown[] = [];
  closed = false;
  private listeners = new Map<string, Listener[]>();
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  emit(type: string, event: { data?: string; code?: number } = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  serverSays(message: unknown) {
    this.emit('message', { data: JSON.stringify(message) });
  }
}

const event = (eventId: string): RealtimeEvent => ({
  eventId,
  type: 'order.created',
  tenantId: 'r',
  locationId: 'l',
  occurredAt: '2026-10-17T10:00:00.000Z',
  payload: {
    orderId: 'o',
    orderNumber: 'MAIN-001',
    channel: 'TAKEAWAY',
    status: 'CONFIRMED',
    paymentStatus: 'UNPAID',
    version: 1,
  },
});

function setup(token: { value: string | null } = { value: 'token-1' }) {
  const events: RealtimeEvent[] = [];
  const statuses: string[] = [];
  const refreshSession = vi.fn(() => {
    token.value = 'token-2';
    return Promise.resolve(true);
  });
  const connection = connectRealtime({
    baseUrl: '',
    origin: 'https://pos.example',
    locationId: 'loc-1',
    getAccessToken: () => token.value,
    refreshSession,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
  });
  return { events, statuses, refreshSession, connection };
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('realtimeUrl', () => {
  it('derives the socket URL from the API base or the page origin', () => {
    expect(realtimeUrl('', 'https://pos.example')).toBe('wss://pos.example/api/v1/realtime');
    expect(realtimeUrl('http://hub.local:3000', 'https://x')).toBe(
      'ws://hub.local:3000/api/v1/realtime',
    );
  });
});

describe('connectRealtime', () => {
  it('authenticates in the first message and delivers each event once', () => {
    const { events, statuses } = setup();
    const socket = FakeSocket.all[0]!;
    socket.emit('open');
    expect(socket.sent).toEqual([{ type: 'auth', token: 'token-1', locationId: 'loc-1' }]);
    socket.serverSays({ type: 'ready', locationId: 'loc-1' });
    socket.serverSays({ type: 'event', event: event('e1') });
    socket.serverSays({ type: 'event', event: event('e1') });
    socket.serverSays({ type: 'event', event: event('e2') });
    expect(events.map((e) => e.eventId)).toEqual(['e1', 'e2']);
    expect(statuses).toEqual(['connecting', 'live']);
  });

  it('refreshes the token and reconnects when the server reports it expired', async () => {
    const { refreshSession } = setup();
    FakeSocket.all[0]!.emit('close', { code: 4401 });
    await vi.waitFor(() => {
      expect(FakeSocket.all).toHaveLength(2);
    });
    expect(refreshSession).toHaveBeenCalledOnce();
    FakeSocket.all[1]!.emit('open');
    expect(FakeSocket.all[1]!.sent).toEqual([
      { type: 'auth', token: 'token-2', locationId: 'loc-1' },
    ]);
  });

  it('backs off after network drops and stops for good when forbidden', () => {
    const { statuses } = setup();
    FakeSocket.all[0]!.emit('close', { code: 1006 });
    expect(statuses.at(-1)).toBe('offline');
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.all).toHaveLength(2);

    FakeSocket.all[1]!.emit('close', { code: 4403 });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(2);
    expect(statuses.at(-1)).toBe('forbidden');
  });

  it('closes cleanly and never reconnects afterwards', () => {
    const { connection } = setup();
    connection.close();
    const socket = FakeSocket.all[0]!;
    expect(socket.closed).toBe(true);
    socket.emit('close', { code: 1000 });
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
