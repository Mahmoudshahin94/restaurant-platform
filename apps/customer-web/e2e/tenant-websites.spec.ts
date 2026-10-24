import { type APIRequestContext, type Page, expect, request, test } from '@playwright/test';

/**
 * MADAR Phase M7 (ADR 0023): two businesses' websites on their own domains. The demo restaurant
 * adds `a.localhost` and the coffee shop `b.localhost` through the domains API, each verified by
 * the mock DNS verifier, and publishes its own hero. The same website build then shows each
 * business's branding, sections and menu on its own host, and an order placed on each host lands
 * in that business. Browsers resolve every `*.localhost` name to this machine.
 *
 * It runs after the other website suites (files run in name order): the demo restaurant's order
 * it leaves waiting would otherwise be the first one the POS announces to them.
 */
const CLOUD = `http://localhost:${process.env.WEB_E2E_CLOUD_PORT ?? '3130'}`;
const PORT = process.env.WEB_E2E_WEB_PORT ?? '5195';
const SITE_A = `http://a.localhost:${PORT}`;
const SITE_B = `http://b.localhost:${PORT}`;
const TEAL = '#0d9488';

interface Business {
  token: string;
  tenantId: string;
  locationId: string;
}

let api: APIRequestContext;
let a: Business;
let b: Business;

async function call<T>(
  token: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  data?: unknown,
): Promise<T> {
  const res = await api.fetch(`${CLOUD}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
    ...(data === undefined ? {} : { data }),
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
}

/** Signs the owner in, adds and verifies the domain, and publishes a hero of its own. */
async function prepare(
  email: string,
  password: string,
  domain: string,
  hero: { en: string; ar: string },
  locationCode: string,
): Promise<Business> {
  const login = await api.post(`${CLOUD}/api/v1/auth/login`, {
    data: { email, password, client: 'native' },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const { accessToken: token, user } = (await login.json()) as {
    accessToken: string;
    user: { tenantId: string };
  };
  const tid = user.tenantId;

  const added = await api.post(`${CLOUD}/api/v1/tenants/${tid}/domains`, {
    headers: { authorization: `Bearer ${token}` },
    data: { domain },
  });
  expect(added.ok(), await added.text()).toBe(true);
  const { id } = (await added.json()) as { id: string };
  const verified = await call<{ status: string }>(
    token,
    'POST',
    `/tenants/${tid}/domains/${id}/verify`,
  );
  expect(verified.status).toBe('VERIFIED');

  type Website = { draft: { sections: { type: string; content: { title: unknown } }[] } };
  const { draft } = await call<Website>(token, 'GET', `/tenants/${tid}/website`);
  for (const section of draft.sections) {
    if (section.type === 'HERO') section.content.title = hero;
  }
  await call(token, 'PUT', `/tenants/${tid}/website/draft`, draft);
  await call(token, 'POST', `/tenants/${tid}/website/publish`);

  const locations = await call<{ id: string; code: string }[]>(
    token,
    'GET',
    `/tenants/${tid}/locations`,
  );
  const location = locations.find((l) => l.code === locationCode);
  if (!location) throw new Error(`no location ${locationCode}`);
  return { token, tenantId: tid, locationId: location.id };
}

test.beforeAll(async () => {
  api = await request.newContext();
  a = await prepare(
    process.env.SEED_OWNER_EMAIL ?? '',
    process.env.SEED_OWNER_PASSWORD ?? '',
    'a.localhost',
    { en: 'Grill and burgers by Demo Kitchen', ar: 'مشويات وبرغر من مطبخ تجريبي' },
    'MAIN',
  );
  b = await prepare(
    process.env.SEED_CAFE_OWNER_EMAIL ?? '',
    process.env.SEED_CAFE_OWNER_PASSWORD ?? '',
    'b.localhost',
    { en: 'Fresh roasts from Ramallah', ar: 'تحميص طازج من رام الله' },
    'RMH',
  );

  // The coffee shop's own look: a teal brand colour.
  const branding = await call<{ tenant: Record<string, unknown>; surfaces: object }>(
    b.token,
    'GET',
    `/tenants/${b.tenantId}/branding`,
  );
  await call(b.token, 'PUT', `/tenants/${b.tenantId}/branding`, {
    ...branding.tenant,
    primaryColor: TEAL,
    surfaces: branding.surfaces,
  });
  // The coffee shop takes pickup orders: switched on, with its hub online (a paired hub calls the
  // cloud; here one call with its credential stands for its heartbeat).
  await call(b.token, 'PUT', `/locations/${b.locationId}/online-ordering`, {
    state: 'OPEN',
    pickupEnabled: true,
  });
  const hub = await call<{ credential: string }>(
    b.token,
    'POST',
    `/locations/${b.locationId}/devices`,
    {
      name: 'E2E cafe hub',
      type: 'GATEWAY',
    },
  );
  await api.get(`${CLOUD}/api/v1/sync/orders/00000000-0000-7000-8000-000000000000`, {
    headers: { authorization: `Device ${hub.credential}` },
  });
});

test.afterAll(async () => {
  await api.dispose();
});

/** A visitor in a language (or none: the store's default), with an empty cart. */
async function visitor(page: Page, locale: 'en' | 'ar' | null): Promise<void> {
  await page.addInitScript((lng) => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear();
      if (lng) {
        localStorage.setItem(
          'web-preferences',
          JSON.stringify({ state: { locale: lng }, version: 1 }),
        );
      }
      sessionStorage.setItem('e2e-init', '1');
    }
  }, locale);
}

const primaryColour = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--color-primary'));

/** Fetches the tracked order from the page's own host (same origin as its API). */
const trackFrom = (page: Page, token: string) =>
  page.evaluate(async (t) => {
    const res = await fetch('/api/v1/orders/track', { headers: { 'x-tracking-token': t } });
    return { status: res.status, body: (await res.json()) as { id?: string } };
  }, token);

test('two businesses on their own domains show their own branding, sections and menus', async ({
  browser,
}) => {
  const restaurant = await (await browser.newContext()).newPage();
  await visitor(restaurant, 'en');
  await restaurant.goto(SITE_A);
  await expect(
    restaurant.getByRole('heading', { level: 1, name: 'Grill and burgers by Demo Kitchen' }),
  ).toBeVisible();
  await expect(restaurant.getByRole('link', { name: 'Demo Kitchen' }).first()).toBeVisible();
  await expect(restaurant.getByRole('heading', { name: 'Our branches' })).toBeVisible();
  await expect(restaurant.getByRole('link', { name: 'View menu · Main Branch' })).toBeVisible();
  expect(await primaryColour(restaurant)).not.toBe(TEAL);
  await restaurant.getByRole('link', { name: 'View menu · Main Branch' }).click();
  await expect(restaurant.getByRole('button', { name: 'Add Classic Burger' })).toBeVisible();
  await expect(restaurant.getByRole('button', { name: 'Add Espresso' })).toHaveCount(0);

  // The coffee shop's default language is Arabic: its site starts in Arabic, right to left.
  const cafe = await (await browser.newContext()).newPage();
  await visitor(cafe, null);
  await cafe.goto(SITE_B);
  await expect(cafe.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(
    cafe.getByRole('heading', { level: 1, name: 'تحميص طازج من رام الله' }),
  ).toBeVisible();
  await expect(cafe.getByRole('link', { name: 'عرض القائمة · الطيرة' })).toBeVisible();
  await expect(cafe.getByRole('link', { name: 'عرض القائمة · الفرع الرئيسي' })).toHaveCount(0);
  await expect.poll(() => primaryColour(cafe)).toBe(TEAL);
  await cafe.getByRole('link', { name: 'عرض القائمة · الطيرة' }).click();
  await expect(cafe.getByRole('button', { name: 'أضف إسبريسو' })).toBeVisible();
  await expect(cafe.getByRole('button', { name: 'أضف برجر كلاسيكي' })).toHaveCount(0);

  // A domain nobody verified shows no business.
  const nobody = await (await browser.newContext()).newPage();
  await nobody.goto(`http://c.localhost:${PORT}`);
  await expect(nobody.getByText('This website was not found.')).toBeVisible();
});

test('an order placed on each business’s domain lands in that business', async ({ browser }) => {
  // On a.localhost, in English.
  const restaurant = await (await browser.newContext()).newPage();
  await visitor(restaurant, 'en');
  await restaurant.goto(SITE_A);
  await restaurant.getByRole('link', { name: 'View menu · Main Branch' }).click();
  await restaurant.getByRole('button', { name: 'Add Fries' }).click();
  await restaurant
    .getByRole('dialog')
    .getByRole('button', { name: /Add to cart/ })
    .click();
  await restaurant.getByRole('link', { name: /View cart/ }).click();
  await restaurant.getByRole('link', { name: 'Checkout' }).click();
  await restaurant.getByLabel('Name', { exact: true }).fill('Host A');
  await restaurant.getByLabel('Mobile number').fill('+970590000201');
  await restaurant.getByRole('button', { name: /Place order/ }).click();
  await expect(restaurant.getByText(/Order W-\d+ was sent to Main Branch/)).toBeVisible();
  const tokenA = decodeURIComponent(/\/confirmation\/([^/?#]+)/.exec(restaurant.url())?.[1] ?? '');

  // On b.localhost, in Arabic.
  const cafe = await (await browser.newContext()).newPage();
  await visitor(cafe, 'ar');
  await cafe.goto(SITE_B);
  await cafe.getByRole('link', { name: 'عرض القائمة · الطيرة' }).click();
  await cafe.getByRole('button', { name: 'أضف إسبريسو' }).click();
  await cafe
    .getByRole('dialog')
    .getByRole('button', { name: /أضف إلى السلة/ })
    .click();
  await cafe.getByRole('link', { name: /عرض السلة/ }).click();
  await cafe.getByRole('link', { name: 'إتمام الطلب' }).click();
  await cafe.getByLabel('الاسم', { exact: true }).fill('مضيف ب');
  await cafe.getByLabel('رقم الجوال').fill('+970590000202');
  await cafe.getByRole('button', { name: /تقديم الطلب/ }).click();
  await expect(cafe.getByText(/أُرسل الطلب W-\d+ إلى الطيرة/)).toBeVisible();
  const tokenB = decodeURIComponent(/\/confirmation\/([^/?#]+)/.exec(cafe.url())?.[1] ?? '');

  // Each order is followed on its own business's site only.
  const onA = await trackFrom(restaurant, tokenA);
  const onB = await trackFrom(cafe, tokenB);
  expect(onA.status).toBe(200);
  expect(onB.status).toBe(200);
  expect((await trackFrom(restaurant, tokenB)).status).toBe(404);
  expect((await trackFrom(cafe, tokenA)).status).toBe(404);

  // And each is the business's own in the cloud.
  const owns = async (owner: Business, locationId: string, orderId: string) =>
    (
      await api.get(`${CLOUD}/api/v1/locations/${locationId}/orders/${orderId}`, {
        headers: { authorization: `Bearer ${owner.token}` },
      })
    ).status();
  expect(await owns(a, a.locationId, onA.body.id ?? '')).toBe(200);
  expect(await owns(b, b.locationId, onB.body.id ?? '')).toBe(200);
  expect(await owns(a, a.locationId, onB.body.id ?? '')).toBe(404);
  expect(await owns(b, b.locationId, onA.body.id ?? '')).toBe(404);
});
