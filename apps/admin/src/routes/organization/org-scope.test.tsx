import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORG, PIZZA, RID, signIn, stubApi } from '../../test/api-stub';
import { renderNeutral } from '../../test/render';
import { OrgScope } from './org-scope';

const brands = [
  { id: RID, nameEn: 'Burger House', nameAr: 'بيت البرغر', logoFileId: null, organizationId: ORG },
  {
    id: PIZZA,
    nameEn: 'Pizza Point',
    nameAr: 'بيتزا بوينت',
    logoFileId: null,
    organizationId: ORG,
  },
];
const group = (role: 'OWNER' | 'MANAGER' | 'FINANCE') => ({
  id: ORG,
  nameEn: 'Demo Group',
  nameAr: 'مجموعة العرض',
  role,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function open(route: string) {
  return renderNeutral(
    <Routes>
      <Route path="org/:organizationId" element={<OrgScope />}>
        <Route index element={<p>Overview page</p>} />
        <Route path="members" element={<p>Members page</p>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('organization scope', () => {
  it('shows the overview, reports and, for an owner, members', async () => {
    signIn(undefined, null, { tenants: brands, organizations: [group('OWNER')] });
    stubApi();
    await open(`/org/${ORG}`);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Organization overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Reports' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByText('Overview page')).toBeInTheDocument();
    // No brand location picker on organization pages; the switcher and user menu are there.
    expect(screen.queryByLabelText('Location')).toBeNull();
    expect(screen.getByRole('button', { name: /Demo Group/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Account/ })).toBeInTheDocument();
  });

  it('hides the members link from anyone but an owner', async () => {
    signIn(undefined, null, { tenants: brands, organizations: [group('FINANCE')] });
    stubApi();
    await open(`/org/${ORG}`);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).queryByRole('link', { name: 'Members' })).toBeNull();
  });

  it('is not found for an organization the person is not a member of', async () => {
    signIn(undefined, null, { tenants: brands, organizations: [group('OWNER')] });
    stubApi();
    await open('/org/01a146e8-0000-7000-8000-0000000000ff');
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByText('Overview page')).toBeNull();
  });
});
