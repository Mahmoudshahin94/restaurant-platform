import {
  type SyncOrder,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  syncOrderSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@pos/validation';
import type { Pairing } from '../hub-state.service';

/** The cloud could not be reached or answered 5xx/429: try again later. */
export class CloudUnavailable extends Error {}

/** The cloud refused the hub's credential (device disabled or re-paired). */
export class CloudCredentialRejected extends Error {}

/** The cloud refused the request itself (4xx): retrying the same request will not help. */
export class CloudRequestRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The hub's HTTP client for the cloud's `/sync/*` endpoints, authenticated as the device. */
export class CloudClient {
  constructor(
    private readonly pairing: Pairing,
    private readonly timeoutMs: number,
  ) {}

  push(request: SyncPushRequest, signal?: AbortSignal): Promise<SyncPushResponse> {
    return this.call('POST', '/api/v1/sync/push', syncPushResponseSchema, {
      body: request,
      signal,
    });
  }

  /** Without a cursor the cloud answers with the head of the feed. */
  pull(
    cursor: string | null,
    waitSeconds: number,
    signal?: AbortSignal,
  ): Promise<SyncPullResponse> {
    const query = new URLSearchParams({ wait: String(waitSeconds), limit: '100' });
    if (cursor !== null) query.set('cursor', cursor);
    return this.call('GET', `/api/v1/sync/pull?${query.toString()}`, syncPullResponseSchema, {
      signal,
      timeoutMs: this.timeoutMs + waitSeconds * 1000,
    });
  }

  /** A website order announced on the change feed (`ORDER` topic). */
  order(orderId: string, signal?: AbortSignal): Promise<SyncOrder> {
    return this.call('GET', `/api/v1/sync/orders/${encodeURIComponent(orderId)}`, syncOrderSchema, {
      signal,
    });
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: { parse: (value: unknown) => T },
    options: { body?: unknown; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<T> {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${this.pairing.cloudUrl}${path}`, {
        method,
        headers: {
          authorization: `Device ${this.pairing.credential}`,
          'x-client-source': 'HUB',
          ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal ? AbortSignal.any([timeout, options.signal]) : timeout,
      });
    } catch (error) {
      // Connection refused, DNS failure, timeout, abort.
      throw new CloudUnavailable(error instanceof Error ? error.message : String(error));
    }
    if (response.status === 401 || response.status === 403) {
      throw new CloudCredentialRejected('The cloud rejected this hub’s credential (re-pair it)');
    }
    if (response.status >= 500 || response.status === 429) {
      throw new CloudUnavailable(`Cloud answered ${String(response.status)}`);
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new CloudRequestRejected(response.status, text.slice(0, 500));
    }
    return schema.parse(await response.json());
  }
}
