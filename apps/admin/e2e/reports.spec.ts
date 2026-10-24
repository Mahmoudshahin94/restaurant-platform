import { readFile } from 'node:fs/promises';
import {
  type APIRequestContext,
  type APIResponse,
  type Page,
  expect,
  test,
} from '@playwright/test';

/**
 * Phase 9 reports: a takeaway order goes through the kitchen, is paid in cash and handed over
 * (all through the API, as the POS would), then the owner reads it in the reports in English and
 * Arabic and exports a CSV. Runs against the seeded E2E database (see playwright.config.ts).
 */
const owner = {
  email: process.env.SEED_OWNER_EMAIL ?? '',
  password: process.env.SEED_OWNER_PASSWORD ?? '',
};
const API = '/api/v1';

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/** The response body of a request that must succeed (the caller names its type). */
async function json<T>(response: Promise<APIResponse>): Promise<T> {
  const res = await response;
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as T;
}

/** A completed, cash-paid takeaway order of two fries at the main branch, kitchen included. */
async function completedOrder(request: APIRequestContext) {
  const login = await json<{ accessToken: string; user: { tenantId: string } }>(
    request.post(`${API}/auth/login`, { data: { ...owner, client: 'native' } }),
  );
  const headers = { authorization: `Bearer ${login.accessToken}` };
  const tid = login.user.tenantId;
  const locations = await json<{ id: string; code: string }[]>(
    request.get(`${API}/tenants/${tid}/locations`, { headers }),
  );
  const lid = locations.find((l) => l.code === 'MAIN')?.id ?? '';
  const loc = `${API}/locations/${lid}`;
  const menu = await json<{
    categories: { products: { id: string; nameEn: string; variants: unknown[] }[] }[];
  }>(request.get(`${loc}/menu`, { headers }));
  const fries = menu.categories.flatMap((c) => c.products).find((p) => p.nameEn === 'Fries');
  const methods = await json<{ id: string; type: string }[]>(
    request.get(`${API}/tenants/${tid}/payment-methods`, { headers }),
  );
  const registers = await json<{ id: string; openShiftId: string | null }[]>(
    request.get(`${loc}/cash-registers`, { headers }),
  );
  const register = registers[0];
  if (!fries || !register) throw new Error('seeded menu or drawer missing');
  const shiftId =
    register.openShiftId ??
    (
      await json<{ id: string }>(
        request.post(`${loc}/shifts`, {
          headers,
          data: { id: crypto.randomUUID(), cashRegisterId: register.id, openingFloat: 0 },
        }),
      )
    ).id;

  let order = await json<{ id: string; total: number; taxTotal: number; version: number }>(
    request.post(`${loc}/orders`, {
      headers,
      data: {
        id: crypto.randomUUID(),
        channel: 'TAKEAWAY',
        status: 'CONFIRMED',
        items: [{ id: crypto.randomUUID(), productId: fries.id, quantity: 2 }],
      },
    }),
  );
  // The kitchen starts and finishes its ticket.
  const tickets = await json<{ id: string; orderId: string; version: number }[]>(
    request.get(`${loc}/kitchen/tickets`, { headers }),
  );
  for (const ticket of tickets.filter((t) => t.orderId === order.id)) {
    const started = await json<{ version: number }>(
      request.post(`${loc}/kitchen/tickets/${ticket.id}/transitions`, {
        headers,
        data: { to: 'PREPARING', version: ticket.version },
      }),
    );
    await json(
      request.post(`${loc}/kitchen/tickets/${ticket.id}/transitions`, {
        headers,
        data: { to: 'READY', version: started.version },
      }),
    );
  }
  await json(
    request.post(`${loc}/orders/${order.id}/payments`, {
      headers,
      data: {
        id: crypto.randomUUID(),
        shiftId,
        paymentMethodId: methods.find((m) => m.type === 'CASH')?.id,
        amount: order.total,
        tendered: order.total,
      },
    }),
  );
  order = await json(
    request.post(`${loc}/orders/${order.id}/transitions`, {
      headers,
      data: { to: 'COMPLETED' },
    }),
  );
  return order;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.setItem(
        'pos-admin-preferences',
        JSON.stringify({ state: { locale: 'en', locationId: null }, version: 0 }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  });
});

test('the owner reads today’s sales, channels and kitchen times in English and Arabic', async ({
  page,
  request,
}) => {
  const order = await completedOrder(request);
  const money = (minor: number) => (minor / 100).toFixed(2);

  await signIn(page);
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
  await page.getByLabel('Period').selectOption('today');
  const daily = page.getByRole('table', { name: 'Daily sales' });
  const total = daily.getByRole('row', { name: /^Total/ });
  await expect(total).toContainText(money(order.total));
  await expect(total).toContainText(money(order.taxTotal));

  // The CSV holds the same figures, as plain decimals.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^daily-sales_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const csv = await readFile(await file.path(), 'utf8');
  expect(csv).toContain('Business day,Orders,Gross sales');
  expect(csv).toMatch(new RegExp(`\\nTotal,\\d+,[^\\n]*${money(order.total)}`));

  await page.getByRole('link', { name: 'Orders by channel' }).click();
  const channels = page.getByRole('table', { name: 'Orders by channel' });
  await expect(channels.getByRole('row', { name: /Takeaway/ })).toContainText(money(order.total));
  await expect(channels.getByRole('row')).toHaveCount(8); // header, six channels, total

  await page.getByRole('link', { name: 'Kitchen prep times' }).click();
  const prep = page.getByRole('table', { name: 'Kitchen prep times' });
  await expect(prep.getByRole('row', { name: /^Total/ })).toContainText(/^Total\s*[1-9]/);

  // Arabic, right to left, keeping the filters.
  await page.getByRole('combobox', { name: 'Language' }).selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('link', { name: 'المبيعات اليومية' }).click();
  await expect(page.getByRole('heading', { name: 'التقارير' })).toBeVisible();
  await expect(page.getByLabel('الفترة')).toHaveValue('today');
  const dailyAr = page.getByRole('table', { name: 'المبيعات اليومية' });
  await expect(dailyAr.getByRole('columnheader', { name: 'صافي المبيعات' })).toBeVisible();
  await expect(dailyAr.getByRole('row', { name: /الإجمالي/ })).toContainText(money(order.total));
  await page.getByRole('link', { name: 'الطلبات حسب القناة' }).click();
  await expect(
    page.getByRole('table', { name: 'الطلبات حسب القناة' }).getByRole('row', { name: /سفري/ }),
  ).toContainText(money(order.total));
});
