import type { OrderStatus } from '@pos/shared-types';

/**
 * Where a self-service order goes once it is paid at the kiosk (ADR 0022): with a kitchen screen
 * at the location (`KDS`) it is CONFIRMED and its kitchen tickets are made, like an order taken
 * at the POS; without one nothing is prepared, so it is handed over at once, COMPLETED (a
 * supermarket's self-checkout: the goods are in the customer's hands). Decided by the module,
 * never by the business type. Each step is a SYSTEM transition of the state machine.
 */
export function selfServicePath(kitchen: boolean): readonly OrderStatus[] {
  return kitchen ? ['CONFIRMED'] : ['CONFIRMED', 'COMPLETED'];
}
