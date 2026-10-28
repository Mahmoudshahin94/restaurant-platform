import { AsyncLocalStorage } from 'node:async_hooks';
import type { ActionSource, Feature } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';

/**
 * Per-request context propagated through async calls, so audit records and logs carry the
 * request id, actor and tenant without threading them through every function signature.
 */
export interface RequestContextStore {
  requestId: string;
  source: ActionSource;
  userId?: string;
  /** A platform operator on a platform route (ADR 0025); never set together with `userId`. */
  platformUserId?: string;
  /** A paired hub calling the cloud with its device credential. */
  deviceId?: string;
  tenantId?: string;
  locationId?: string;
  /** The order the request is about, when its route names one. */
  orderId?: string;
  /** Values computed once per request (resolved modules), shared by guards and handlers. */
  memo?: Map<string, unknown>;
  /**
   * Modules a public route requires (`@RequireFeature`). A public request has no tenant until the
   * route finds one, so the storefront's tenant resolver checks them then (ADR 0018).
   */
  requiredFeatures?: readonly Feature[];
}

declare module 'fastify' {
  interface FastifyRequest {
    memo?: Map<string, unknown>;
    requiredFeatures?: readonly Feature[];
  }
}

/** The request's memo, created on first use (guards run before the request context exists). */
export function requestMemo(request: FastifyRequest): Map<string, unknown> {
  request.memo ??= new Map();
  return request.memo;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },
};
