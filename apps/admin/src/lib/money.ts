import { useMoneyFormat } from '@pos/app-kit';
import { useTenant } from './queries';

export { moneyField, optionalMoneyField } from '@pos/app-kit';

/** Money helpers bound to the tenant currency and the active locale. */
export function useMoney() {
  return useMoneyFormat(useTenant().data?.currencyCode ?? null);
}
