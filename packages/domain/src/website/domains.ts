import { DOMAIN_VERIFICATION_LABEL, DOMAIN_VERIFICATION_PREFIX } from '@pos/shared-types';

/**
 * Domain names of tenant websites (ADR 0023). A name is compared in one form only: lower case,
 * IDNA (punycode) ASCII, without a port or a trailing dot. The `Host` of every request and every
 * domain a tenant adds go through `normalizeHostname`, so `Shop.example:443`, `shop.example.`
 * and `SHOP.EXAMPLE` are the same site, and `café.example` is `xn--caf-dma.example`.
 */

/**
 * The WHATWG URL parser, global in browsers and in Node. `@pos/domain` compiles without the DOM
 * and Node type libraries, so the one member used is declared here.
 */
declare const URL: new (input: string) => { hostname: string };

const MAX_DOMAIN_LENGTH = 253;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The canonical form of a host name, or null when it is not one. Accepts what a `Host` header
 * holds (`name[:port]`) and what a person pastes (`https://name/path`).
 */
export function normalizeHostname(input: string): string | null {
  let value = input.trim();
  if (value.length === 0 || value.length > 1024) return null;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  value = value.split(/[/?#]/, 1)[0] ?? '';
  // An IPv6 literal never names a website.
  if (value.startsWith('[')) return null;
  value = value.replace(/:\d{0,5}$/, '').replace(/\.+$/, '');
  if (value.length === 0 || /[\s@:\\]/.test(value)) return null;
  let hostname: string;
  try {
    // WHATWG URL parsing lowercases and applies IDNA (punycode), in browsers and in Node alike.
    hostname = new URL(`http://${value}`).hostname;
  } catch {
    return null;
  }
  return hostname.length > 0 ? hostname : null;
}

export type DomainIssue =
  'INVALID' | 'TOO_LONG' | 'IP_ADDRESS' | 'SINGLE_LABEL' | 'PLATFORM_DOMAIN';

/**
 * Why a normalized name cannot be a tenant's custom domain, or null. `platformDomain` is
 * MADAR's own (`PLATFORM_WEB_DOMAIN`): neither it nor a name under it can be claimed, because
 * `<slug>.<platform>` addresses belong to the tenants with those slugs.
 */
export function customDomainIssue(domain: string, platformDomain: string): DomainIssue | null {
  if (domain.length > MAX_DOMAIN_LENGTH) return 'TOO_LONG';
  if (IPV4.test(domain)) return 'IP_ADDRESS';
  const labels = domain.split('.');
  if (labels.length < 2) return 'SINGLE_LABEL';
  if (!labels.every((label) => LABEL.test(label))) return 'INVALID';
  // A top-level domain is never all digits.
  if (/^\d+$/.test(labels[labels.length - 1] ?? '')) return 'INVALID';
  if (isPlatformHost(domain, platformDomain)) return 'PLATFORM_DOMAIN';
  return null;
}

/** Whether `domain` is MADAR's web domain or one of its sub-domains. */
export function isPlatformHost(domain: string, platformDomain: string): boolean {
  return domain === platformDomain || domain.endsWith(`.${platformDomain}`);
}

/** The address every tenant gets at provisioning: `<slug>.<PLATFORM_WEB_DOMAIN>`. */
export function platformSubdomain(slug: string, platformDomain: string): string {
  return `${slug}.${platformDomain}`;
}

/** The DNS record that proves a tenant controls `domain`. */
export interface DomainVerificationRecord {
  type: 'TXT';
  name: string;
  value: string;
}

export function verificationRecord(domain: string, token: string): DomainVerificationRecord {
  return {
    type: 'TXT',
    name: `${DOMAIN_VERIFICATION_LABEL}.${domain}`,
    value: `${DOMAIN_VERIFICATION_PREFIX}${token}`,
  };
}

/**
 * Whether the TXT records found at `_madar-verify.<domain>` hold the token. DNS returns each
 * record as chunks of at most 255 characters, which are joined first; other records (several
 * services may verify the same name) are ignored.
 */
export function txtRecordsProve(records: readonly (readonly string[])[], token: string): boolean {
  const expected = `${DOMAIN_VERIFICATION_PREFIX}${token}`;
  return records.some((chunks) => chunks.join('').trim() === expected);
}
