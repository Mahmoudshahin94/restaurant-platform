import type { DeviceVersions, ReleaseDto, ReleasesOverview } from '@pos/validation';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TID, signIn, stubApi } from '../test/api-stub';
import { renderWithProviders } from '../test/render';
import { ReleasesPage } from './releases-page';

afterEach(() => {
  vi.unstubAllGlobals();
});

const release: ReleaseDto = {
  id: '01a146e8-0000-7000-8000-000000000020',
  version: '1.0.0',
  channel: 'STABLE',
  notes: 'MADAR 1.0',
  publishedAt: '2026-10-29T08:00:00.000Z',
  minSupportedHubVersion: '1.0.0',
  minSupportedClientVersion: null,
  publishedById: null,
  publishedByName: 'Test Operator',
};

const overview: ReleasesOverview = {
  cloudVersion: '1.0.0',
  minimums: { hub: '1.0.0', client: null },
  latest: { STABLE: '1.0.0', BETA: null },
  releases: [release],
};

const versions: DeviceVersions = {
  generatedAt: '2026-10-29T08:00:00.000Z',
  cloudVersion: '1.0.0',
  minimums: { hub: '1.0.0', client: null },
  tenants: [
    {
      tenantId: TID,
      slug: 'demo-kitchen',
      nameEn: 'Demo Kitchen',
      nameAr: 'مطبخ تجريبي',
      channel: 'STABLE',
      pinnedVersion: null,
      targetVersion: '1.0.0',
      outdated: 0,
      unsupported: 1,
      devices: [
        {
          id: '01a146e8-0000-7000-8000-000000000030',
          tenantId: TID,
          locationId: '01a146e8-0000-7000-8000-000000000031',
          locationCode: 'MAIN',
          name: 'Back-office hub',
          type: 'GATEWAY',
          status: 'ACTIVE',
          appVersion: '0.9.0',
          lastVersionAt: '2026-10-29T07:00:00.000Z',
          lastSeenAt: '2026-10-29T08:00:00.000Z',
          online: true,
          versionStatus: 'UNSUPPORTED',
        },
      ],
    },
  ],
};

function stub() {
  return stubApi()
    .on('GET', /\/platform\/releases$/, overview)
    .on('GET', /\/platform\/device-versions$/, versions);
}

describe('ReleasesPage (ADR 0026)', () => {
  it('shows the cloud version, the releases and the unsupported hub', async () => {
    signIn('OPERATOR');
    stub();
    await renderWithProviders(<ReleasesPage />);
    expect(await screen.findByText('MADAR 1.0')).toBeInTheDocument();
    expect(screen.getByText('Cloud version').parentElement).toHaveTextContent('1.0.0');
    const hub = await screen.findByRole('row', { name: /Back-office hub/ });
    expect(hub).toHaveTextContent('0.9.0');
    expect(hub).toHaveTextContent('Unsupported');
    expect(screen.getByText('1 unsupported')).toBeInTheDocument();
  });

  it('starts every publication from an empty form', async () => {
    signIn('OPERATOR');
    const api = stub().on('POST', /\/platform\/releases$/, (body) => ({
      status: 201,
      body: { ...release, ...(body as object), id: '01a146e8-0000-7000-8000-000000000021' },
    }));
    await renderWithProviders(<ReleasesPage />);
    const publish = await screen.findByRole('button', { name: 'Publish a release' });
    fireEvent.click(publish);
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Version'), {
      target: { value: '1.1.0-beta.1' },
    });
    fireEvent.change(within(dialog).getByLabelText('Channel'), { target: { value: 'BETA' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish a release' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(api.calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      version: '1.1.0-beta.1',
      channel: 'BETA',
      minSupportedHubVersion: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Publish a release' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Version')).toHaveValue('');
    expect(within(dialog).getByLabelText('Channel')).toHaveValue('STABLE');
  });

  it('reads only for a viewer, in Arabic', async () => {
    signIn('VIEWER');
    stub();
    await renderWithProviders(<ReleasesPage />, { locale: 'ar' });
    expect(await screen.findByText('غير مدعوم')).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.queryByRole('button', { name: 'نشر إصدار' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تغيير القناة' })).not.toBeInTheDocument();
  });
});
