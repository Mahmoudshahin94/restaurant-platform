import { SUPPORT_OPERATION_ROLES } from '@pos/shared-types';
import type { SupportPreview } from '@pos/validation';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ORDER, TID, signIn, stubApi, tenantSummary } from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { RepairPanel, SupportPage } from './support-page';

const operations = Object.entries(SUPPORT_OPERATION_ROLES).map(([key, roles]) => ({
  key,
  roles,
}));

const preview: SupportPreview = {
  operation: 'order.correct_status',
  tenantId: TID,
  entity: { type: 'Order', id: ORDER, label: 'MAIN-0042', locationId: null },
  before: { status: 'PLACED', paymentStatus: 'UNPAID' },
  after: { status: 'CANCELLED', paymentStatus: 'UNPAID' },
  changes: [{ field: 'status', before: 'PLACED', after: 'CANCELLED' }],
  executable: true,
  blockedReason: null,
  confirmation: {
    token: 'confirm-token-1',
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillOrderStatus() {
  await userEvent.type(screen.getByLabelText('Order id'), ORDER);
  await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
}

describe('RepairPanel', () => {
  it('previews before and after, needs a reason, then executes with the confirmation', async () => {
    signIn('OPERATOR');
    const api = stubApi()
      .on('GET', /\/support\/operations$/, operations)
      .on('POST', /\/support\/preview$/, preview)
      .on('POST', /\/support\/execute$/, {
        operation: preview.operation,
        tenantId: TID,
        entity: preview.entity,
        before: preview.before,
        after: preview.after,
        changes: preview.changes,
        reason: 'Stuck order reported by the owner',
        executedAt: new Date().toISOString(),
      });
    await renderWithProviders(<RepairPanel tenant={{ id: TID, name: 'Demo Kitchen' }} />);
    await screen.findByRole('option', { name: "Correct an order's status" });
    await userEvent.selectOptions(screen.getByLabelText('Repair'), "Correct an order's status");
    await fillOrderStatus();

    const shown = await screen.findByTestId('support-preview');
    const changes = within(shown).getByTestId('support-changes');
    expect(changes).toHaveTextContent('PLACED');
    expect(changes).toHaveTextContent('CANCELLED');
    expect(api.calls.find((c) => c.path.endsWith('/support/preview'))?.body).toEqual({
      operation: 'order.correct_status',
      params: { orderId: ORDER, to: 'CANCELLED' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const apply = screen.getByRole('button', { name: 'Apply repair' });
    expect(apply).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'Stuck order reported by the owner');
    expect(apply).toBeEnabled();
    await userEvent.click(apply);

    expect(await screen.findByTestId('support-result')).toHaveTextContent('MAIN-0042');
    expect(api.calls.find((c) => c.path.endsWith('/support/execute'))?.body).toEqual({
      operation: 'order.correct_status',
      params: { orderId: ORDER, to: 'CANCELLED' },
      confirmationToken: 'confirm-token-1',
      reason: 'Stuck order reported by the owner',
    });
  });

  it('asks to preview again when the record changed since the preview', async () => {
    signIn('OWNER');
    stubApi()
      .on('GET', /\/support\/operations$/, operations)
      .on('POST', /\/support\/preview$/, preview)
      .on('POST', /\/support\/execute$/, () => ({
        status: 409,
        body: { code: 'SUPPORT_PREVIEW_STALE', message: 'stale', details: {} },
      }));
    await renderWithProviders(<RepairPanel tenant={{ id: TID, name: 'Demo Kitchen' }} />);
    await screen.findByRole('option', { name: "Correct an order's status" });
    await userEvent.selectOptions(screen.getByLabelText('Repair'), "Correct an order's status");
    await fillOrderStatus();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText('Reason'), 'Fixing a stuck order');
    await userEvent.click(screen.getByRole('button', { name: 'Apply repair' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed or the preview expired/);
    expect(screen.getAllByRole('button', { name: 'Preview again' }).length).toBeGreaterThan(0);
  });

  it('shows why a finalized order cannot be changed, without a way to execute', async () => {
    signIn('OPERATOR');
    stubApi()
      .on('GET', /\/support\/operations$/, operations)
      .on('POST', /\/support\/preview$/, {
        ...preview,
        operation: 'order.recalculate_totals',
        executable: false,
        blockedReason: 'FINALIZED',
        confirmation: null,
        changes: [{ field: 'total', before: 1000, after: 1100 }],
      });
    await renderWithProviders(<RepairPanel tenant={{ id: TID, name: 'Demo Kitchen' }} />);
    await screen.findByRole('option', { name: "Recalculate an order's totals" });
    await userEvent.selectOptions(screen.getByLabelText('Repair'), "Recalculate an order's totals");
    await fillOrderStatus();
    expect(await screen.findByText(/cannot be applied: FINALIZED/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});

describe('SupportPage', () => {
  it('lets a support role find records but offers no repair', async () => {
    signIn('SUPPORT');
    stubApi()
      .on('GET', /\/platform\/tenants$/, {
        items: [tenantSummary],
        page: 1,
        pageSize: 10,
        total: 1,
      })
      .on('GET', /\/support\/find$/, { kind: 'ORDER', items: [] });
    await renderWithProviders(<SupportPage />);
    await userEvent.type(screen.getByLabelText('Search for a tenant'), 'demo');
    await userEvent.click(await screen.findByRole('button', { name: /Demo Kitchen/ }));

    expect(screen.getByRole('button', { name: 'Find' })).toBeInTheDocument();
    expect(screen.getByTestId('no-repairs')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });
});
