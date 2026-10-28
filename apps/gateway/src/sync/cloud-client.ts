import {
  type SyncOrder,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncResolution,
  syncOrderSchema,
  syncResolutionSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
} from '@pos/validation';
import type { Pairing } from '../hub-state.service';

/** The cloud could not be reached or answered 5xx/429: try again later. */
export class CloudUnavailable extends Error {}

/**
 * The platform suspended (or archived) this hub's business (ADR 0025): nothing is lost, the
 * outbox keeps its changes and the hub keeps trying, as while the cloud is unreachable.
 */
export class CloudTenantSuspended extends CloudUnavailable {}

/** The cloud refused the hub's credential (device disabled or re-paired). */
export class CloudCredentialRejected extends Error {}

const TENANT_REFUSALS = new Set(['TENANT_SUSPENDED', 'TENANT_ARCHIVED']);

/**
 * The refusal code when a 403 says the platform suspended or archived the hub's business, else
 * null (a refused credential). Reads a clone, so the response stays readable.
 */
export async function tenantRefusalOf(response: Response): Promise<string | null> {
  if (response.status !== 403) return null;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { code?: unknown } | null;
  return typeof body?.code === 'string' && TENANT_REFUSALS.has(body.code) ? body.code : null;
}

/** The cloud refused the request itself (4xx): retrying the same request will not help. */
export class CloudRequestRejected extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * What the hub keeps of a refusal: the status and the error envelope's code and message, never the
 * raw body (it is logged and shown on the hub's status, which the LAN can read without signing in).
 */
async function rejectionSummary(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    code?: unknown;
    message?: unknown;
  } | null;
  const code = typeof body?.code === 'string' ? body.code.slice(0, 64) : null;
  const message = typeof body?.message === 'string' ? body.message.slice(0, 200) : null;
  return [String(response.status), code, message].filter((part) => part !== null).join(' ');
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

  /** An administrator's decision on an operation this hub pushed (`RESOLUTION` topic). */
  resolution(operationId: string, signal?: AbortSignal): Promise<SyncResolution> {
    return this.call(
      'GET',
      `/api/v1/sync/resolutions/${encodeURIComponent(operationId)}`,
      syncResolutionSchema,
      { signal },
    );
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
    const refusal = await tenantRefusalOf(response);
    if (refusal) {
      throw new CloudTenantSuspended(
        `The platform refused this business (${refusal}); changes wait in the outbox`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new CloudCredentialRejected('The cloud rejected this hub’s credential (re-pair it)');
    }
    if (response.status >= 500 || response.status === 429) {
      throw new CloudUnavailable(`Cloud answered ${String(response.status)}`);
    }
    if (!response.ok) {
      throw new CloudRequestRejected(response.status, await rejectionSummary(response));
    }
    return schema.parse(await response.json());
  }
}
