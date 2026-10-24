import { Resolver } from 'node:dns/promises';
import { txtRecordsProve, verificationRecord } from '@pos/domain';

/**
 * Proves that a tenant controls a custom domain (ADR 0023): the TXT record
 * `_madar-verify.<domain>` must hold `madar-verify=<token>`. Behind an interface so tests and
 * development use the mock adapter, and a DNS-over-HTTPS or registrar API can replace DNS later.
 */
export interface DomainVerifier {
  readonly name: 'dns' | 'mock';
  verify(domain: string, token: string): Promise<boolean>;
}

export const DOMAIN_VERIFIER = Symbol('DOMAIN_VERIFIER');

/** The TXT records at a name, each as its chunks; none when the name or record does not exist. */
export type TxtLookup = (name: string) => Promise<string[][]>;

const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

/** Asks DNS (a short timeout: the admin waits for the answer). */
export function systemTxtLookup(timeoutMs = 3000): TxtLookup {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });
  return async (name) => {
    try {
      return await resolver.resolveTxt(name);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code && NO_RECORD.has(code)) return [];
      throw error;
    }
  };
}

export class DnsDomainVerifier implements DomainVerifier {
  readonly name = 'dns';

  constructor(private readonly lookup: TxtLookup = systemTxtLookup()) {}

  async verify(domain: string, token: string): Promise<boolean> {
    return txtRecordsProve(await this.lookup(verificationRecord(domain, token).name), token);
  }
}

/**
 * The documented test adapter (`DOMAIN_VERIFIER=mock`, refused in production): every record is
 * found published, except for domains a test refuses.
 */
export class MockDomainVerifier implements DomainVerifier {
  readonly name = 'mock';
  private readonly refused = new Set<string>();

  verify(domain: string): Promise<boolean> {
    return Promise.resolve(!this.refused.has(domain));
  }

  /** The domain's record is missing until `publish` (tests). */
  refuse(domain: string): void {
    this.refused.add(domain);
  }

  publish(domain: string): void {
    this.refused.delete(domain);
  }
}
