import type { WebOrderCreated } from '@pos/validation';

const KEY = 'web-placed-orders';

/**
 * The orders placed from this browser tab, for the confirmation page (sessionStorage: it holds the
 * tracking token, a bearer secret, so it does not outlive the tab). Never business data.
 */
export function rememberPlacedOrder(created: WebOrderCreated): void {
  try {
    const all = placedOrders();
    all[created.trackingToken] = created;
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage is optional: the confirmation page then loads the order by its token.
  }
}

export function placedOrder(token: string): WebOrderCreated | null {
  return placedOrders()[token] ?? null;
}

function placedOrders(): Record<string, WebOrderCreated> {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, WebOrderCreated>) : {};
  } catch {
    return {};
  }
}
