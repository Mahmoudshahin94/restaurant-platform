import { AsyncLocalStorage } from 'node:async_hooks';
import type { ActionSource } from '@pos/shared-types';

/**
 * Per-request context propagated through async calls, so audit records and logs carry the
 * request id, actor and tenant without threading them through every function signature.
 */
export interface RequestContextStore {
  requestId: string;
  source: ActionSource;
  userId?: string;
  restaurantId?: string;
  locationId?: string;
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
