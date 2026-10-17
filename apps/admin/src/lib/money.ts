import { useMoneyFormat } from '@pos/app-kit';
import { useRestaurant } from './queries';

export { moneyField, optionalMoneyField } from '@pos/app-kit';

/** Money helpers bound to the restaurant currency and the active locale. */
export function useMoney() {
  return useMoneyFormat(useRestaurant().data?.currencyCode ?? null);
}
