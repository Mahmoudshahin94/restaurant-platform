import { readFileSync } from 'node:fs';
import { type APIRequestContext, type Page, expect, test } from '@playwright/test';

/**
 * Releases (ADR 0026): an operator publishes a release with minimum versions, puts a business on
 * the beta channel and finds its outdated hub flagged; then an app older than the cloud serves
 * shows the update message, in English and Arabic.
 */
const operator = {
  email: process.env.PLATFORM_E2E_OPERATOR_EMAIL ?? '',
  password: process.env.PLATFORM_USER_PASSWORD ?? '',
};
const API = '/api/v1';
const ADMIN_URL = process.env.PLATFORM_E2E_ADMIN_URL ?? 'http://localhost:5199';
/** The MADAR version of this build: the root package.json's. */
const { version: MADAR_VERSION } = JSON.parse(
  readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
) as { version: string };
const OLD = '0.9.0';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.setItem(
        'madar-platform-preferences',
        JSON.stringify({ state: { locale: 'en' }, version: 0 }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(operator.email);
  await page.getByLabel('Password').fill(operator.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
}

/** The operator's platform token, through the API. */
async function platformToken(request: APIRequestContext): Promise<Record<string, string>> {
  const res = await request.post(`${API}/platform/auth/login`, { data: operator });
  expect(res.ok()).toBe(true);
  return { authorization: `Bearer ${((await res.json()) as { accessToken: string }).accessToken}` };
}

/** A new business with a paired hub that reports an old version; returns the hub's credential. */
async function businessWithOldHub(request: APIRequestContext, slug: string): Promise<string> {
  const platform = await platformToken(request);
  const provisioned = await request.post(`${API}/platform/tenants`, {
    headers: platform,
    data: {
      tenant: {
        slug,
        nameEn: `Store ${slug}`,
        nameAr: `متجر ${slug}`,
        businessType: 'SUPERMARKET',
        defaultLocale: 'en',
        timezone: 'Asia/Jerusalem',
      },
      location: { code: 'MAIN', nameEn: 'Main', nameAr: 'الرئيسي' },
      owner: { email: `owner-${slug}@e2e.test`, displayName: 'Store Owner' },
    },
  });
  expect(provisioned.status(), await provisioned.text()).toBe(201);
  const { temporaryPassword } = (
    (await provisioned.json()) as { owner: { temporaryPassword: string } }
  ).owner;
  const login = await request.post(`${API}/auth/login`, {
    data: { email: `owner-${slug}@e2e.test`, password: temporaryPassword, client: 'native' },
  });
  expect(login.ok()).toBe(true);
  const { accessToken, user } = (await login.json()) as {
    accessToken: string;
    user: { tenantId: string };
  };
  const owner = { authorization: `Bearer ${accessToken}` };
  const [location] = (await (
    await request.get(`${API}/tenants/${user.tenantId}/locations`, { headers: owner })
  ).json()) as { id: string }[];
  const paired = await request.post(`${API}/locations/${location!.id}/devices`, {
    headers: owner,
    data: { name: 'Back-office hub', type: 'GATEWAY' },
  });
  expect(paired.status()).toBe(201);
  const { credential } = (await paired.json()) as { credential: string };
  // The hub checks in, reporting the version it runs.
  expect((await hubSnapshot(request, credential)).status()).toBe(200);
  return credential;
}

const hubSnapshot = (request: APIRequestContext, credential: string) =>
  request.get(`${API}/sync/snapshot`, {
    headers: { authorization: `Device ${credential}`, 'x-madar-client-version': OLD },
  });

test('an operator publishes a release, moves a business to beta and finds its outdated hub', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const slug = `mart-${Date.now().toString(36)}`;
  const credential = await businessWithOldHub(request, slug);
  await signIn(page);

  // The cloud's version, and no minimum yet.
  await page.getByRole('link', { name: 'Releases' }).click();
  await expect(page.getByRole('heading', { name: 'Releases', level: 1 })).toBeVisible();
  await expect(page.getByText('Cloud version')).toBeVisible();
  await expect(page.getByText(MADAR_VERSION).first()).toBeVisible();

  // Publish this version with a hub minimum: older hubs are refused from now on.
  await page.getByRole('button', { name: 'Publish a release' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Version', { exact: true }).fill(MADAR_VERSION);
  await dialog.getByLabel('Channel').selectOption('STABLE');
  await dialog.getByLabel('Minimum hub version').fill(MADAR_VERSION);
  await dialog.getByLabel('Notes').fill('MADAR 1.0: versions and releases');
  await dialog.getByRole('button', { name: 'Publish a release' }).click();
  await expect(dialog).toBeHidden();
  const published = page.getByRole('row', { name: /MADAR 1\.0: versions and releases/ });
  await expect(published).toContainText('Stable');
  await expect(published).toContainText(MADAR_VERSION);

  // The business's hub runs an older version: flagged, and refused by the cloud.
  await page.getByLabel('Show').selectOption('outdated');
  const card = page.getByTestId(`versions-${slug}`);
  await expect(card.getByRole('row', { name: /Back-office hub/ })).toContainText('Unsupported');
  await expect(card.getByRole('row', { name: /Back-office hub/ })).toContainText(OLD);
  await expect(card).toContainText('1 unsupported');
  const refused = await hubSnapshot(request, credential);
  expect(refused.status()).toBe(426);
  expect(((await refused.json()) as { code: string }).code).toBe('HUB_UPGRADE_REQUIRED');

  // Put the business on the beta channel, with a reason.
  await card.getByRole('button', { name: 'Change channel' }).click();
  const rollout = page.getByRole('dialog');
  await rollout.getByLabel('Channel').selectOption('BETA');
  await rollout.getByLabel('Reason').fill('Pilot store for the next version');
  await rollout.getByRole('button', { name: 'Confirm' }).click();
  await expect(rollout).toBeHidden();
  await expect(card).toContainText('Beta');

  // The health board counts it too.
  await page.getByRole('link', { name: 'Health board' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Store ${slug}`) })).toContainText(
    '1 unsupported',
  );
});

test('an app older than the cloud serves shows the update message, in English and Arabic', async ({
  browser,
  request,
}) => {
  test.setTimeout(90_000);
  // This version's release requires apps of this version at least.
  const platform = await platformToken(request);
  const overview = (await (
    await request.get(`${API}/platform/releases`, { headers: platform })
  ).json()) as { releases: { id: string; version: string }[] };
  const current = overview.releases.find((r) => r.version === MADAR_VERSION);
  const saved = current
    ? await request.patch(`${API}/platform/releases/${current.id}`, {
        headers: platform,
        data: { minSupportedClientVersion: MADAR_VERSION },
      })
    : await request.post(`${API}/platform/releases`, {
        headers: platform,
        data: {
          version: MADAR_VERSION,
          channel: 'STABLE',
          minSupportedClientVersion: MADAR_VERSION,
        },
      });
  expect(saved.ok(), await saved.text()).toBe(true);

  // The business admin; `asOld` makes it call the cloud as a build of an older version would.
  const context = await browser.newContext({ baseURL: ADMIN_URL });
  const openAdmin = async (locale: 'en' | 'ar', asOld: boolean) => {
    const page = await context.newPage();
    await page.addInitScript((value) => {
      localStorage.setItem(
        'pos-admin-preferences',
        JSON.stringify({ state: { locale: value, locationId: null }, version: 0 }),
      );
    }, locale);
    if (asOld) {
      await page.route('**/api/**', (route) =>
        route.continue({
          headers: { ...route.request().headers(), 'x-madar-client-version': OLD },
        }),
      );
    }
    await page.goto('/login');
    return page;
  };

  const english = await openAdmin('en', true);
  await english.getByLabel('Email').fill('someone@e2e.test');
  await english.getByLabel('Password').fill('Any-Password-1');
  await english.getByRole('button', { name: 'Sign in' }).click();
  await expect(english.getByRole('heading', { name: 'Update required' })).toBeVisible();
  const notice = english.getByRole('alert');
  await expect(notice).toContainText('This version of MADAR Admin is no longer supported');
  await expect(notice).toContainText(OLD);
  await expect(notice).toContainText(MADAR_VERSION);
  await expect(english.getByRole('button', { name: 'Check again' })).toBeVisible();

  const arabic = await openAdmin('ar', true);
  await expect(arabic.locator('html')).toHaveAttribute('dir', 'rtl');
  await arabic.getByLabel('البريد الإلكتروني').fill('someone@e2e.test');
  await arabic.getByLabel('كلمة المرور').fill('Any-Password-1');
  await arabic.getByRole('button', { name: 'تسجيل الدخول' }).click();
  await expect(arabic.getByRole('heading', { name: 'يلزم التحديث' })).toBeVisible();
  await expect(arabic.getByRole('button', { name: 'تحقّق مجددًا' })).toBeVisible();

  // An app of this version is served as usual: a wrong password is just that.
  const currentApp = await openAdmin('en', false);
  await currentApp.getByLabel('Email').fill('someone@e2e.test');
  await currentApp.getByLabel('Password').fill('Any-Password-1');
  await currentApp.getByRole('button', { name: 'Sign in' }).click();
  await expect(currentApp.getByRole('alert')).toBeVisible();
  await expect(currentApp.getByRole('heading', { name: 'Update required' })).toBeHidden();
  await context.close();
});
