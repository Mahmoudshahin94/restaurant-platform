import { useMoneyFormat } from '@pos/app-kit';

export { moneyField, optionalMoneyField } from '@pos/app-kit';

/**
 * Money helpers bound to the tenant's currency configuration (ADR 0020) and the active locale.
 * The tenant context is loaded before any page renders, so the currency is always known.
 */
export function useMoney() {
  return useMoneyFormat();
}
