import type { MemberDto } from '@pos/validation';
import { Toaster, dismissToast } from '@pos/ui';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORG, signIn, stubApi } from '../../test/api-stub';
import { renderNeutral } from '../../test/render';
import { OrgMembersPage } from './org-members-page';

const at = '2026-10-01T00:00:00.000Z';
const owner: MemberDto = {
  id: '01a146e8-0000-7000-8000-0000000000e1',
  accountId: '01a146e8-0000-7000-8000-0000000000ac',
  email: 'owner@test.local',
  displayName: 'Test Owner',
  role: 'OWNER',
  createdAt: at,
};
const sara: MemberDto = {
  id: '01a146e8-0000-7000-8000-0000000000e2',
  accountId: '01a146e8-0000-7000-8000-0000000000e3',
  email: 'sara@test.local',
  displayName: 'Sara Finance',
  role: 'FINANCE',
  createdAt: at,
};

const group = (role: 'OWNER' | 'MANAGER' | 'FINANCE') => ({
  id: ORG,
  nameEn: 'Demo Group',
  nameAr: 'مجموعة العرض',
  role,
});

afterEach(() => {
  vi.unstubAllGlobals();
  dismissToast();
});

function page() {
  return (
    <>
      <Routes>
        <Route path="/org/:organizationId/members" element={<OrgMembersPage />} />
      </Routes>
      <Toaster closeLabel="Close" />
    </>
  );
}

async function open() {
  return renderNeutral(page(), { route: `/org/${ORG}/members` });
}

describe('organization members page', () => {
  it('lists the members with their roles', async () => {
    signIn(undefined, null, { organizations: [group('OWNER')] });
    stubApi().on('GET', /\/organizations\/[^/]+\/members$/, [owner, sara]);
    await open();
    const row = await screen.findByRole('row', { name: /Sara Finance/ });
    expect(within(row).getByText('sara@test.local')).toBeInTheDocument();
    expect(within(row).getByLabelText('Role of Sara Finance')).toHaveValue('FINANCE');
    expect(screen.getByRole('row', { name: /Test Owner/ })).toHaveTextContent('You');
  });

  it('validates the e-mail before adding, then adds the member', async () => {
    signIn(undefined, null, { organizations: [group('OWNER')] });
    const api = stubApi()
      .on('GET', /\/organizations\/[^/]+\/members$/, [owner])
      .on('POST', /\/organizations\/[^/]+\/members$/, (body) => ({
        status: 201,
        body: { ...sara, ...(body as object), skippedTenantIds: [] },
      }));
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'not-an-email');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Nora Finance');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'FINANCE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(await within(dialog).findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);

    await userEvent.clear(within(dialog).getByLabelText('Email'));
    await userEvent.type(within(dialog).getByLabelText('Email'), 'nora@test.local');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await vi.waitFor(() => {
      expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
        email: 'nora@test.local',
        displayName: 'Nora Finance',
        role: 'FINANCE',
      });
    });
    expect(await screen.findByText('Nora Finance was added.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks for confirmation before removing a member', async () => {
    signIn(undefined, null, { organizations: [group('OWNER')] });
    const api = stubApi()
      .on('GET', /\/organizations\/[^/]+\/members$/, [owner, sara])
      .on('DELETE', /\/organizations\/[^/]+\/members\/[^/]+$/, { status: 204 });
    await open();
    const row = await screen.findByRole('row', { name: /Sara Finance/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove Sara Finance?')).toBeInTheDocument();
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => {
      expect(api.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(sara.id))).toBe(true);
    });
    expect(await screen.findByText('Sara Finance was removed.')).toBeInTheDocument();
  });

  it('shows the last-owner error as a toast', async () => {
    signIn(undefined, null, { organizations: [group('OWNER')] });
    stubApi()
      .on('GET', /\/organizations\/[^/]+\/members$/, [owner])
      .on('DELETE', /\/organizations\/[^/]+\/members\/[^/]+$/, () => ({
        status: 409,
        body: { code: 'ORGANIZATION_LAST_OWNER', message: 'x', details: {} },
      }));
    await open();
    const row = await screen.findByRole('row', { name: /Test Owner/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Could not remove the member')).toBeInTheDocument();
    expect(screen.getByText('An organization must keep at least one owner.')).toBeInTheDocument();
  });

  it('changes a role', async () => {
    signIn(undefined, null, { organizations: [group('OWNER')] });
    const api = stubApi()
      .on('GET', /\/organizations\/[^/]+\/members$/, [owner, sara])
      .on('PATCH', /\/organizations\/[^/]+\/members\/[^/]+$/, (body) => ({
        body: { ...sara, ...(body as object), skippedTenantIds: [] },
      }));
    await open();
    const row = await screen.findByRole('row', { name: /Sara Finance/ });
    await userEvent.selectOptions(within(row).getByLabelText('Role of Sara Finance'), 'MANAGER');
    await vi.waitFor(() => {
      expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ role: 'MANAGER' });
    });
    expect(await screen.findByText('Sara Finance is now Manager.')).toBeInTheDocument();
  });

  it('is not found for anyone but an owner', async () => {
    signIn(undefined, null, { organizations: [group('FINANCE')] });
    const api = stubApi();
    await open();
    expect(await screen.findByText(/not found/i)).toBeInTheDocument();
    expect(api.calls.some((c) => c.path.includes('/members'))).toBe(false);
  });
});
