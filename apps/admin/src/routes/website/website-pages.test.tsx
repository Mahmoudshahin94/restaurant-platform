import {
  type TenantDomainDto,
  type WebsiteConfig,
  type WebsiteState,
  defaultWebsiteConfig,
} from '@pos/validation';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signIn, stubApi } from '../../test/api-stub';
import { renderWithProviders } from '../../test/render';
import { DomainsPage } from './domains-page';
import { WebsiteEditorPage } from './website-editor-page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function state(draft: WebsiteConfig = defaultWebsiteConfig('RESTAURANT')): WebsiteState {
  return {
    draft,
    published: null,
    version: 0,
    publishedAt: null,
    updatedAt: null,
    hasUnpublishedChanges: true,
  };
}

describe('website editor (ADR 0023)', () => {
  it('switches, reorders and edits sections, then saves and publishes the draft', async () => {
    signIn();
    const api = stubApi()
      .on('GET', /\/website$/, state())
      .on('PUT', /\/website\/draft$/, (body) => ({
        body: { ...state(body as WebsiteConfig), updatedAt: '2026-10-24T12:00:00.000Z' },
      }))
      .on('POST', /\/website\/publish$/, () => ({
        body: { ...state(), published: state().draft, version: 1, hasUnpublishedChanges: false },
      }));
    await renderWithProviders(<WebsiteEditorPage />);

    const list = await screen.findByRole('list', { name: 'Sections' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(8);
    await userEvent.click(screen.getByRole('switch', { name: 'Show About' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move Featured products up' }));

    // The hero is selected first: its title in each of the tenant's languages.
    const arabicTitle = screen.getByRole('textbox', { name: 'Title (العربية)' });
    expect(arabicTitle).toHaveAttribute('dir', 'rtl');
    await userEvent.clear(arabicTitle);
    await userEvent.type(arabicTitle, 'أهلًا');

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await vi.waitFor(() => {
      expect(api.calls.some((c) => c.method === 'PUT')).toBe(true);
    });
    const saved = api.calls.find((c) => c.method === 'PUT')?.body as WebsiteConfig;
    const byId = (id: string) => saved.sections.find((s) => s.id === id);
    expect(byId('about')?.enabled).toBe(false);
    expect(byId('featured')?.order).toBe(0);
    expect(byId('hero')?.order).toBe(10);
    const hero = byId('hero');
    expect(hero?.type === 'HERO' ? hero.content.title.ar : null).toBe('أهلًا');
    expect(await screen.findByText(/Draft saved/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText('Published. Visitors now see version 1.')).toBeInTheDocument();
  });

  it('adds a section before the footer and refuses a second footer', async () => {
    signIn();
    stubApi().on('GET', /\/website$/, state());
    await renderWithProviders(<WebsiteEditorPage />);
    const newSection = await screen.findByRole('combobox', { name: 'New section' });
    expect(within(newSection).getByRole('option', { name: 'Footer' })).toBeDisabled();
    await userEvent.selectOptions(newSection, 'TESTIMONIALS');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const items = within(screen.getByRole('list', { name: 'Sections' })).getAllByRole('listitem');
    expect(items.at(-2)).toHaveTextContent('Testimonials');
    expect(items.at(-1)).toHaveTextContent('Footer');
    expect(screen.getByRole('button', { name: 'Add a testimonial' })).toBeInTheDocument();
  });

  it('works in Arabic, right to left', async () => {
    signIn();
    stubApi().on('GET', /\/website$/, state());
    await renderWithProviders(<WebsiteEditorPage />, { locale: 'ar' });
    expect(await screen.findByRole('heading', { name: 'الموقع الإلكتروني' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'نشر' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'إظهار من نحن' })).toBeChecked();
  });
});

describe('domains page (ADR 0023)', () => {
  const subdomain: TenantDomainDto = {
    id: '01a146e8-0000-7000-8000-0000000000d1',
    domain: 'demo.localhost',
    url: 'http://demo.localhost:5175',
    kind: 'SUBDOMAIN',
    status: 'VERIFIED',
    isPrimary: true,
    verification: null,
    verifiedAt: '2026-10-24T10:00:00.000Z',
    lastCheckedAt: null,
    createdAt: '2026-10-24T10:00:00.000Z',
  };
  const custom: TenantDomainDto = {
    ...subdomain,
    id: '01a146e8-0000-7000-8000-0000000000d2',
    domain: 'shop.example',
    url: 'http://shop.example:5175',
    kind: 'CUSTOM',
    status: 'PENDING',
    isPrimary: false,
    verification: {
      type: 'TXT',
      name: '_madar-verify.shop.example',
      value: 'madar-verify=0123456789abcdef0123456789abcdef',
    },
    verifiedAt: null,
  };

  it('adds a domain and shows the TXT record to publish', async () => {
    signIn();
    let domains = [subdomain];
    const api = stubApi()
      .on('GET', /\/domains$/, () => ({ body: domains }))
      .on('POST', /\/domains$/, () => {
        domains = [subdomain, custom];
        return { status: 201, body: custom };
      });
    await renderWithProviders(<DomainsPage />);
    expect(await screen.findByText('demo.localhost')).toBeInTheDocument();
    expect(screen.getByText('Your MADAR address')).toBeInTheDocument();

    await userEvent.type(screen.getByRole('textbox', { name: 'Domain' }), 'Shop.Example');
    await userEvent.click(screen.getByRole('button', { name: 'Add domain' }));
    expect(api.calls.find((c) => c.method === 'POST')?.body).toEqual({ domain: 'Shop.Example' });
    expect(await screen.findByDisplayValue('_madar-verify.shop.example')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('madar-verify=0123456789abcdef0123456789abcdef'),
    ).toBeInTheDocument();
    expect(screen.getByText('Waiting for verification')).toBeInTheDocument();
  });

  it('says when the record is not found yet, and verifies once it is', async () => {
    signIn();
    let verified = false;
    stubApi()
      .on('GET', /\/domains$/, () => ({
        body: [subdomain, verified ? { ...custom, status: 'VERIFIED' } : custom],
      }))
      .on('POST', /\/verify$/, () =>
        verified
          ? { body: { ...custom, status: 'VERIFIED' } }
          : {
              status: 422,
              body: { code: 'DOMAIN_NOT_VERIFIED', message: 'x', details: {} },
            },
      );
    await renderWithProviders(<DomainsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Verify' }));
    expect(
      await screen.findByText(/The verification record was not found yet/),
    ).toBeInTheDocument();
    verified = true;
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    const cards = await screen.findAllByTestId('domain-card');
    await vi.waitFor(() => {
      expect(within(cards[1] as HTMLElement).getByText('Verified')).toBeInTheDocument();
    });
    expect(screen.getAllByRole('button', { name: 'Make primary' })).toHaveLength(1);
  });

  it('explains why a domain cannot be added', async () => {
    signIn();
    stubApi()
      .on('GET', /\/domains$/, [subdomain])
      .on('POST', /\/domains$/, () => ({
        status: 422,
        body: { code: 'DOMAIN_INVALID', message: 'x', details: { reason: 'PLATFORM_DOMAIN' } },
      }));
    await renderWithProviders(<DomainsPage />, { locale: 'ar' });
    await userEvent.type(await screen.findByRole('textbox', { name: 'النطاق' }), 'x.localhost');
    await userEvent.click(screen.getByRole('button', { name: 'إضافة النطاق' }));
    expect(await screen.findByText('لا يمكن إضافة عناوين مدار كنطاق خاص بك.')).toBeInTheDocument();
  });
});
