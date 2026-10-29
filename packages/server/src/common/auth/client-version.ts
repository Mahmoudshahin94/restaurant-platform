import { isMadarVersion } from '@pos/domain';
import { CLIENT_VERSION_HEADER } from '@pos/shared-types';

/**
 * The MADAR version a caller reports in `x-madar-client-version` (ADR 0026), or null when it sends
 * none or something that is not a semantic version (which is then never stored or compared).
 */
export function reportedVersion(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const value = headers[CLIENT_VERSION_HEADER];
  return typeof value === 'string' && isMadarVersion(value) ? value : null;
}
