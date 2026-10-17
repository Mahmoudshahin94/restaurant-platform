import type { SyncIssueDetail } from '@pos/validation';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOC, signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { SyncIssuePage } from './sync-page';

const OP = '01a146e8-0000-7000-8000-0000000000c1';

function detail(overrides: Partial<SyncIssueDetail['options']> = {}): SyncIssueDetail {
  const at = '2026-10-17T10:00:00.000Z';
  const version = (notes: string, total: number, v: number) => ({
    label: 'MAIN-007',
    status: 'CONFIRMED',
    paymentStatus: 'UNPAID',
    total,
    itemCount: 1,
    paymentCount: 0,
    paidTotal: 0,
    version: v,
    updatedAt: at,
    data: { notes },
  });
  return {
    issue: {
      operationId: OP,
      deviceId: '01a146e8-0000-7000-8000-0000000000d1',
      entityType: 'Order',
      entityId: '01a146e8-0000-7000-8000-0000000000e1',
      operationType: 'ORDER_UPSERT',
      entityVersion: 2,
      status: 'CONFLICT',
      errorCode: 'SYNC_CONFLICT',
      errorMessage: 'Order was changed in the cloud since this hub last synchronized it',
      attempts: 1,
      label: 'MAIN-007',
      hasPayload: true,
      resolution: null,
      resolvedAt: null,
      resolvedBy: null,
      resolutionNote: null,
      resendRequestedAt: null,
      createdAt: at,
      updatedAt: at,
    },
    hubVersion: version('Changed at the till', 2800, 2),
    cloudVersion: version('Edited in the cloud', 3100, 2),
    options: {
      applyHub: { allowed: true, reason: null },
      keepCloud: { allowed: false, reason: 'HUB_HAS_PAYMENTS' },
      resend: { allowed: true, reason: null },
      ...overrides,
    },
  };
}

function renderIssue(locale: 'en' | 'ar' = 'en') {
  return renderWithProviders(
    <Routes>
      <Route path="/system/sync/:locationId/:operationId" element={<SyncIssuePage />} />
    </Routes>,
    { locale, route: `/system/sync/${LOC}/${OP}` },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sync issue page', () => {
  it('compares both versions, flags differences and explains blocked choices', async () => {
    signIn();
    stubApi().on('GET', /\/sync\/issues\/[^/]+$/, detail());
    await renderIssue();
    const total = await screen.findByRole('row', { name: /Total/ });
    expect(within(total).getByText('Differs')).toBeInTheDocument();
    expect(await within(total).findByText(/28\.00/)).toBeInTheDocument();
    expect(within(total).getByText(/31\.00/)).toBeInTheDocument();
    const keep = screen.getByRole('radio', { name: /Keep the cloud's version/ });
    expect(keep).toBeDisabled();
    expect(keep).toHaveTextContent('payments the cloud has not recorded');
  });

  it('records a decision with a note and reports the API’s reason when refused', async () => {
    signIn();
    const api = stubApi()
      .on('GET', /\/sync\/issues\/[^/]+$/, detail())
      .on('POST', /\/resolve$/, () => ({
        status: 409,
        body: { code: 'CONFLICT', message: 'x', details: { reason: 'APPLY_FAILED' } },
      }));
    await renderIssue();
    await userEvent.click(
      await screen.findByRole('radio', { name: /Use the restaurant's version/ }),
    );
    const confirm = screen.getByRole('button', { name: 'Confirm decision' });
    expect(confirm).toBeDisabled(); // a note is required
    await userEvent.type(screen.getByLabelText('Note for the record'), 'Branch confirmed the sale');
    await userEvent.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The restaurant's version could not be applied",
    );
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({
      action: 'APPLY_HUB',
      note: 'Branch confirmed the sale',
    });
  });

  it('shows the issue read-only to people without sync.resolve, in Arabic', async () => {
    signIn(['sync.view', 'locations.view']);
    stubApi().on('GET', /\/sync\/issues\/[^/]+$/, detail());
    await renderIssue('ar');
    expect(await screen.findByText(/حل تعارضات المزامنة/)).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByText('نسخة الفرع')).toBeInTheDocument();
  });
});
