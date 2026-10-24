import { describe, expect, it } from 'vitest';
import {
  customDomainIssue,
  isPlatformHost,
  normalizeHostname,
  platformSubdomain,
  txtRecordsProve,
  verificationRecord,
} from './domains';

describe('normalizeHostname', () => {
  it.each([
    ['shop.example', 'shop.example'],
    ['SHOP.Example', 'shop.example'],
    ['shop.example:5175', 'shop.example'],
    ['shop.example.', 'shop.example'],
    ['shop.example.:443', 'shop.example'],
    ['  www.Shop.example  ', 'www.shop.example'],
    ['https://www.shop.example/menu?x=1', 'www.shop.example'],
    ['demo-kitchen.localhost:5175', 'demo-kitchen.localhost'],
    ['localhost', 'localhost'],
    // IDNA: Unicode names become punycode.
    ['café.example', 'xn--caf-dma.example'],
    ['مطعم.example', 'xn--2gbe8ac.example'],
    ['CAFÉ.EXAMPLE', 'xn--caf-dma.example'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeHostname(input)).toBe(expected);
  });

  it.each(['', '   ', 'user@shop.example', '[::1]:3000', 'shop example', 'a\\b.example', ':80'])(
    'refuses %j',
    (input) => {
      expect(normalizeHostname(input)).toBeNull();
    },
  );
});

describe('customDomainIssue', () => {
  const platform = 'madar.app';

  it('accepts ordinary and international domains', () => {
    expect(customDomainIssue('shop.example', platform)).toBeNull();
    expect(customDomainIssue('www.shop.co.il', platform)).toBeNull();
    expect(customDomainIssue('xn--caf-dma.example', platform)).toBeNull();
  });

  it('refuses MADAR addresses, which belong to the tenant of that slug', () => {
    expect(customDomainIssue('madar.app', platform)).toBe('PLATFORM_DOMAIN');
    expect(customDomainIssue('other-tenant.madar.app', platform)).toBe('PLATFORM_DOMAIN');
    expect(customDomainIssue('www.other-tenant.madar.app', platform)).toBe('PLATFORM_DOMAIN');
    expect(customDomainIssue('notmadar.app', platform)).toBeNull();
  });

  it('refuses names that are not public domains', () => {
    expect(customDomainIssue('localhost', platform)).toBe('SINGLE_LABEL');
    expect(customDomainIssue('10.0.0.1', platform)).toBe('IP_ADDRESS');
    expect(customDomainIssue('-shop.example', platform)).toBe('INVALID');
    expect(customDomainIssue('shop_1.example', platform)).toBe('INVALID');
    expect(customDomainIssue('shop.123', platform)).toBe('INVALID');
    expect(
      customDomainIssue(
        `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.example`,
        platform,
      ),
    ).toBe('TOO_LONG');
  });
});

describe('platform addresses', () => {
  it('builds the sub-domain of a slug', () => {
    expect(platformSubdomain('demo-kitchen', 'madar.app')).toBe('demo-kitchen.madar.app');
    expect(isPlatformHost('demo-kitchen.localhost', 'localhost')).toBe(true);
    expect(isPlatformHost('evil-localhost', 'localhost')).toBe(false);
  });
});

describe('DNS verification', () => {
  it('names the TXT record and its value', () => {
    expect(verificationRecord('shop.example', 'abc123')).toEqual({
      type: 'TXT',
      name: '_madar-verify.shop.example',
      value: 'madar-verify=abc123',
    });
  });

  it('finds the token among other records, joining chunks', () => {
    expect(
      txtRecordsProve([['google-site-verification=x'], ['madar-verify=abc123']], 'abc123'),
    ).toBe(true);
    expect(txtRecordsProve([['madar-verify=', 'abc123']], 'abc123')).toBe(true);
    expect(txtRecordsProve([[' madar-verify=abc123 ']], 'abc123')).toBe(true);
  });

  it('refuses another token, a prefix of it, or nothing', () => {
    expect(txtRecordsProve([['madar-verify=abc124']], 'abc123')).toBe(false);
    expect(txtRecordsProve([['madar-verify=abc1234']], 'abc123')).toBe(false);
    expect(txtRecordsProve([['abc123']], 'abc123')).toBe(false);
    expect(txtRecordsProve([], 'abc123')).toBe(false);
  });
});
