import { describe, expect, it } from 'vitest';
import {
  type PlatformProviders,
  type ProviderAccountRef,
  resolvePaymentProviders,
} from './providers';

const platform: PlatformProviders = {
  CASH: { accountId: null, providerKey: 'cash', mode: 'LIVE' },
  CARD: { accountId: null, providerKey: 'external-card', mode: 'LIVE' },
  ONLINE: null,
  TERMINAL: null,
};

const account = (
  id: string,
  method: ProviderAccountRef['method'],
  locationId: string | null,
  status: ProviderAccountRef['status'] = 'ACTIVE',
): ProviderAccountRef => ({
  id,
  method,
  locationId,
  providerKey: 'mock-online',
  mode: 'TEST',
  status,
});

describe('resolvePaymentProviders (ADR 0024)', () => {
  it('keeps the platform defaults without accounts: built-in tenders, no online checkout', () => {
    const resolved = resolvePaymentProviders([], 'loc-1', platform);
    expect(resolved.CASH).toEqual({ value: platform.CASH, source: 'PLATFORM' });
    expect(resolved.ONLINE).toEqual({ value: null, source: 'PLATFORM' });
  });

  it('lets the tenant set a method and a location override it', () => {
    const accounts = [account('wide', 'ONLINE', null), account('here', 'ONLINE', 'loc-2')];
    expect(resolvePaymentProviders(accounts, 'loc-1', platform).ONLINE).toEqual({
      value: { accountId: 'wide', providerKey: 'mock-online', mode: 'TEST' },
      source: 'TENANT',
    });
    expect(resolvePaymentProviders(accounts, 'loc-2', platform).ONLINE).toMatchObject({
      value: { accountId: 'here' },
      source: 'LOCATION',
    });
    // Without a location, only the tenant's layer applies.
    expect(resolvePaymentProviders(accounts, null, platform).ONLINE.value?.accountId).toBe('wide');
  });

  it('ignores disabled accounts: they inherit from the layer above', () => {
    const accounts = [
      account('wide', 'ONLINE', null),
      account('here', 'ONLINE', 'loc-2', 'DISABLED'),
      account('kiosk', 'TERMINAL', null, 'DISABLED'),
    ];
    const resolved = resolvePaymentProviders(accounts, 'loc-2', platform);
    expect(resolved.ONLINE).toMatchObject({ value: { accountId: 'wide' }, source: 'TENANT' });
    expect(resolved.TERMINAL).toEqual({ value: null, source: 'PLATFORM' });
  });
});
