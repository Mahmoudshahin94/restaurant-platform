import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { type APIRequestContext, type Page, expect } from '@playwright/test';

/** The pairing codes the setup created at each hub (see tools/e2e/prepare-kiosk-hubs.mjs). */
export function pairingCode(hub: 'restaurant' | 'market', index: number): string {
  const codes = JSON.parse(readFileSync(process.env.KIOSK_E2E_CODES ?? '', 'utf8')) as Record<
    string,
    string[]
  >;
  const code = codes[hub]?.[index];
  if (!code) throw new Error(`no pairing code ${hub}[${index}]`);
  return code;
}

/** Pairs this browser as a kiosk, as staff would on a new kiosk, with the admin's code. */
export async function pairKiosk(page: Page, code: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Pairing code').fill(code.toLowerCase());
  await page.getByRole('button', { name: 'Pair' }).click();
}

interface Session {
  api: string;
  headers: Record<string, string>;
  tenantId: string;
  locationId: string;
}

/** A cashier at the hub's POS: employee code and PIN, as the till signs in. */
export async function cashier(
  request: APIRequestContext,
  hub: string,
  pin: string,
): Promise<Session> {
  const api = `${hub}/api/v1`;
  const login = await request.post(`${api}/auth/pin`, {
    data: { employeeCode: '1001', pin, client: 'native' },
  });
  expect(login.ok()).toBe(true);
  const { accessToken, user } = (await login.json()) as {
    accessToken: string;
    user: { tenantId: string };
  };
  const headers = { authorization: `Bearer ${accessToken}`, 'x-client-source': 'POS' };
  const locations = (await (
    await request.get(`${api}/tenants/${user.tenantId}/locations`, { headers })
  ).json()) as { id: string }[];
  const location = locations[0];
  if (!location) throw new Error('no location');
  return { api, headers, tenantId: user.tenantId, locationId: location.id };
}

export interface HubOrder {
  id: string;
  orderNumber: string;
  channel: string;
  source: string;
  status: string;
  paymentStatus: string;
  total: number;
  payments: { methodType: string; shiftId: string | null; deviceId: string | null }[];
}

export async function findOrder(
  request: APIRequestContext,
  session: Session,
  orderNumber: string,
): Promise<HubOrder | undefined> {
  const orders = (await (
    await request.get(`${session.api}/locations/${session.locationId}/orders?limit=50`, {
      headers: session.headers,
    })
  ).json()) as HubOrder[];
  return orders.find((o) => o.orderNumber === orderNumber);
}

/** The cashier takes the money in cash and confirms the order (the POS's own routes). */
export async function collectAtCounter(
  request: APIRequestContext,
  session: Session,
  order: HubOrder,
): Promise<HubOrder> {
  const base = `${session.api}/locations/${session.locationId}`;
  const registers = (await (
    await request.get(`${base}/cash-registers`, { headers: session.headers })
  ).json()) as { id: string }[];
  const shift = (await (
    await request.post(`${base}/shifts`, {
      headers: session.headers,
      data: { id: randomUUID(), cashRegisterId: registers[0]?.id, openingFloat: 0 },
    })
  ).json()) as { id: string };
  const methods = (await (
    await request.get(`${session.api}/tenants/${session.tenantId}/payment-methods`, {
      headers: session.headers,
    })
  ).json()) as { id: string; type: string }[];
  const cash = methods.find((m) => m.type === 'CASH');
  const paid = await request.post(`${base}/orders/${order.id}/payments`, {
    headers: session.headers,
    data: { id: randomUUID(), shiftId: shift.id, paymentMethodId: cash?.id, amount: order.total },
  });
  expect(paid.ok()).toBe(true);
  const confirmed = await request.post(`${base}/orders/${order.id}/transitions`, {
    headers: session.headers,
    data: { to: 'CONFIRMED' },
  });
  expect(confirmed.ok()).toBe(true);
  return (await confirmed.json()) as HubOrder;
}
