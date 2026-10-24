import { describe, expect, it } from 'vitest';
import { DnsDomainVerifier, MockDomainVerifier, type TxtLookup } from './domain-verifier';
import { PREVIEW_TTL_SECONDS, WebsitePreviewTokens, previewSecret } from './preview-token';

describe('DNS domain verification (mocked DNS)', () => {
  /** A DNS that holds these TXT records, and logs what it was asked. */
  function dns(records: Record<string, string[][]>) {
    const asked: string[] = [];
    const lookup: TxtLookup = (name) => {
      asked.push(name);
      return Promise.resolve(records[name] ?? []);
    };
    return { lookup, asked };
  }

  it('looks the record up at _madar-verify.<domain> and finds the token', async () => {
    const { lookup, asked } = dns({
      '_madar-verify.shop.example': [['v=spf1 -all'], ['madar-verify=', 'abc123']],
    });
    const verifier = new DnsDomainVerifier(lookup);
    await expect(verifier.verify('shop.example', 'abc123')).resolves.toBe(true);
    expect(asked).toEqual(['_madar-verify.shop.example']);
  });

  it('fails without the record, with another token, or with the record at the wrong name', async () => {
    const { lookup } = dns({
      '_madar-verify.shop.example': [['madar-verify=other']],
      'shop.example': [['madar-verify=abc123']],
    });
    const verifier = new DnsDomainVerifier(lookup);
    await expect(verifier.verify('shop.example', 'abc123')).resolves.toBe(false);
    await expect(verifier.verify('nobody.example', 'abc123')).resolves.toBe(false);
  });

  it('lets the mock refuse and then publish a domain', async () => {
    const mock = new MockDomainVerifier();
    await expect(mock.verify('shop.example')).resolves.toBe(true);
    mock.refuse('shop.example');
    await expect(mock.verify('shop.example')).resolves.toBe(false);
    mock.publish('shop.example');
    await expect(mock.verify('shop.example')).resolves.toBe(true);
  });
});

describe('website preview tokens', () => {
  const tokens = new WebsitePreviewTokens('x'.repeat(40));
  const tenantId = '0199e4a0-0000-7000-8000-000000000001';
  const now = new Date('2026-10-24T12:00:00Z');

  it('names the tenant until it expires', () => {
    const { token, expiresAt } = tokens.issue(tenantId, now);
    expect(expiresAt.getTime() - now.getTime()).toBe(PREVIEW_TTL_SECONDS * 1000);
    expect(tokens.verify(token, now)).toBe(tenantId);
    expect(tokens.verify(token, new Date(expiresAt.getTime() - 1))).toBe(tenantId);
    expect(tokens.verify(token, expiresAt)).toBeNull();
  });

  it('refuses tampering, other keys and garbage', () => {
    const { token } = tokens.issue(tenantId, now);
    const [, expires, signature] = token.split('.');
    const otherTenant = '0199e4a0-0000-7000-8000-000000000002';
    expect(tokens.verify(`${otherTenant}.${expires ?? ''}.${signature ?? ''}`, now)).toBeNull();
    expect(tokens.verify(`${tenantId}.99999999999.${signature ?? ''}`, now)).toBeNull();
    expect(tokens.verify(`${token}x`, now)).toBeNull();
    expect(new WebsitePreviewTokens('y'.repeat(40)).verify(token, now)).toBeNull();
    expect(tokens.verify('garbage', now)).toBeNull();
  });

  it('derives its key from the access-token key unless one is configured', () => {
    const derived = previewSecret({ JWT_ACCESS_SECRET: 'a'.repeat(40) });
    expect(derived).not.toBe('a'.repeat(40));
    expect(previewSecret({ JWT_ACCESS_SECRET: 'a'.repeat(40), WEBSITE_PREVIEW_SECRET: 'k' })).toBe(
      'k',
    );
  });
});
