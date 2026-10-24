import { QueryState } from '@pos/app-kit';
import { useSite } from '../lib/queries';
import { SectionList } from '../sections/registry';

/** The home page: the tenant's website, section by section (ADR 0023). */
export function LandingPage() {
  const site = useSite();
  return <QueryState query={site}>{(s) => <SectionList site={s} />}</QueryState>;
}
