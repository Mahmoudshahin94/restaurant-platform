import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRAND_ID,
  MEMBER_ID,
  OID,
  TID,
  apiError,
  organizationDetail,
  signIn,
  stubApi,
  tenantSummary,
} from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { OrganizationDetailPage } from './organization-detail-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

const ORG_PATH = '/organizations/:organizationId/:tab?';
const GET_ORG = new RegExp(`/platform/organizations/${OID}$`);
const render = (tab = 'brands', locale: 'en' | 'ar' = 'en') =>
  renderWithProviders(<OrganizationDetailPage />, {
    route: `/organizations/${OID}/${tab}`,
    path: ORG_PATH,
    locale,
  });

/** An unattached brand that the attach dialog offers. */
const free = { ...tenantSummary, organization: null };
const taken = {
  ...tenantSummary,
  id: '01a146e8-0000-7000-8000-0000000000d1',
  slug: 'taken-brand',
  nameEn: 'Taken Brand',
  organization: { id: OID, nameEn: 'Other', nameAr: 'أخرى' },
};

async function openAttachDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Attach a brand' }));
  return screen.findByRole('dialog');
}

describe('OrganizationDetailPage brands', () => {
  it('lists the brands of the organization with its details', async () => {
    signIn('OPERATOR');
    stubApi().on('GET', GET_ORG, organizationDetail);
    await render();
    expect(await screen.findByRole('heading', { name: 'Burger House Group' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Burger House' })).toHaveAttribute(
      'href',
      `/tenants/${BRAND_ID}`,
    );
    expect(screen.getByRole('link', { name: 'Brands' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members' })).toBeInTheDocument();
  });

  it('attaches an unattached brand and leaves out brands that belong elsewhere', async () => {
    signIn('OPERATOR');
    const api = stubApi()
      .on('GET', GET_ORG, organizationDetail)
      .on('GET', /\/platform\/tenants$/, { items: [free, taken], page: 1, pageSize: 50, total: 2 })
      .on('POST', new RegExp(`/organizations/${OID}/tenants$`), {
        ...organizationDetail,
        skippedMemberIds: [],
      });
    await render();
    const dialog = await openAttachDialog();
    expect(await within(dialog).findByText('Demo Kitchen')).toBeInTheDocument();
    expect(within(dialog).queryByText('Taken Brand')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Attach: Demo Kitchen/ }));
    await waitFor(() => {
      expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ tenantId: TID });
    });
  });

  it('shows the currency mismatch when a brand uses another currency', async () => {
    signIn('OPERATOR');
    stubApi()
      .on('GET', GET_ORG, organizationDetail)
      .on('GET', /\/platform\/tenants$/, { items: [free], page: 1, pageSize: 50, total: 1 })
      .on('POST', new RegExp(`/organizations/${OID}/tenants$`), () =>
        apiError('ORGANIZATION_CURRENCY_MISMATCH'),
      );
    await render();
    const dialog = await openAttachDialog();
    await userEvent.click(await within(dialog).findByRole('button', { name: /Attach: Demo/ }));
    expect(await within(dialog).findByText(/different currency/i)).toBeInTheDocument();
  });

  it('shows why a brand of another organization cannot be attached', async () => {
    signIn('OPERATOR');
    stubApi()
      .on('GET', GET_ORG, organizationDetail)
      .on('GET', /\/platform\/tenants$/, { items: [free], page: 1, pageSize: 50, total: 1 })
      .on('POST', new RegExp(`/organizations/${OID}/tenants$`), () =>
        apiError('CONFLICT', { reason: 'TENANT_IN_ORGANIZATION' }),
      );
    await render();
    const dialog = await openAttachDialog();
    await userEvent.click(await within(dialog).findByRole('button', { name: /Attach: Demo/ }));
    expect(
      await within(dialog).findByText('This brand already belongs to another organization.'),
    ).toBeInTheDocument();
  });

  it('detaches a brand after confirmation', async () => {
    signIn('OWNER');
    const api = stubApi()
      .on('GET', GET_ORG, organizationDetail)
      .on('DELETE', new RegExp(`/organizations/${OID}/tenants/${BRAND_ID}$`), { status: 204 });
    await render();
    await userEvent.click(await screen.findByRole('button', { name: 'Detach: Burger House' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Detach' }));
    await waitFor(() => {
      expect(api.calls.some((c) => c.method === 'DELETE')).toBe(true);
    });
  });

  it('keeps the dialog open and explains when the brand has no owner of its own', async () => {
    signIn('OPERATOR');
    stubApi()
      .on('GET', GET_ORG, organizationDetail)
      .on('DELETE', new RegExp(`/organizations/${OID}/tenants/${BRAND_ID}$`), () =>
        apiError('CONFLICT', { reason: 'LAST_OWNER' }),
      );
    await render();
    await userEvent.click(await screen.findByRole('button', { name: 'Detach: Burger House' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Detach' }));
    expect(
      await within(dialog).findByText('The business needs at least one active owner.'),
    ).toBeInTheDocument();
  });

  it('creates a new brand inside the organization without an owner and with its currency', async () => {
    signIn('OPERATOR');
    const api = stubApi()
      .on('GET', GET_ORG, organizationDetail)
      .on('POST', /\/platform\/tenants$/, {
        tenant: {
          tenant: { ...tenantSummary, id: TID },
        },
        owner: null,
      });
    await render();
    await userEvent.click(await screen.findByRole('button', { name: 'New brand' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Owner email')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Currency/)).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Web address name'), 'new-brand');
    await userEvent.type(within(dialog).getAllByLabelText('Name (English)')[0]!, 'New Brand');
    await userEvent.type(within(dialog).getAllByLabelText('Name (Arabic)')[0]!, 'علامة');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Provision' }));
    await waitFor(() => {
      const body = api.calls.find((c) => c.method === 'POST')?.body as Record<string, unknown>;
      expect(body.organizationId).toBe(OID);
      expect(body).not.toHaveProperty('owner');
      expect((body.tenant as { currencyCode: string }).currencyCode).toBe('ILS');
    });
  });

  it('shows no actions to a viewer', async () => {
    signIn('VIEWER');
    stubApi().on('GET', GET_ORG, organizationDetail);
    await render();
    await screen.findByRole('link', { name: 'Burger House' });
    for (const name of ['Attach a brand', 'New brand', 'Edit']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /^Detach/ })).not.toBeInTheDocument();
  });

  it('renders right to left in Arabic', async () => {
    signIn('OPERATOR');
    stubApi().on('GET', GET_ORG, organizationDetail);
    await render('brands', 'ar');
    expect(await screen.findByRole('heading', { name: 'مجموعة بيت البرغر' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('button', { name: 'ربط علامة تجارية' })).toBeInTheDocument();
  });
});

describe('OrganizationDetailPage members', () => {
  it('lists the members and changes a role', async () => {
    signIn('OPERATOR');
    const api = stubApi()
      .on('GET', GET_ORG, organizationDetail)
      .on('PATCH', new RegExp(`/organizations/${OID}/members/${MEMBER_ID}$`), {
        ...organizationDetail.members[0],
        role: 'MANAGER',
        skippedTenantIds: [],
      });
    await render('members');
    expect(await screen.findByText('owner@burger.test')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Role of Dana Owner'), 'MANAGER');
    await waitFor(() => {
      expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ role: 'MANAGER' });
    });
  });

  it('adds a member', async () => {
    signIn('OPERATOR');
    const api = stubApi()
      .on('GET', GET_ORG, organizationDetail)
      .on('POST', new RegExp(`/organizations/${OID}/members$`), {
        ...organizationDetail.members[0],
        skippedTenantIds: [],
      });
    await render('members');
    await userEvent.click(await screen.findByRole('button', { name: 'Add member' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'fin@burger.test');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Fay Finance');
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'FINANCE');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
        email: 'fin@burger.test',
        displayName: 'Fay Finance',
        role: 'FINANCE',
      });
    });
  });

  it('explains that the last owner cannot be removed', async () => {
    signIn('OWNER');
    stubApi()
      .on('GET', GET_ORG, organizationDetail)
      .on('DELETE', new RegExp(`/organizations/${OID}/members/${MEMBER_ID}$`), () =>
        apiError('ORGANIZATION_LAST_OWNER'),
      );
    await render('members');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove: Dana Owner' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(
      await within(dialog).findByText('An organization must keep at least one owner.'),
    ).toBeInTheDocument();
  });

  it('shows the members read-only to a viewer', async () => {
    signIn('VIEWER');
    stubApi().on('GET', GET_ORG, organizationDetail);
    await render('members');
    expect(await screen.findByText('owner@burger.test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Role of Dana Owner')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });
});
