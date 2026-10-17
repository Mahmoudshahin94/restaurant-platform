import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';

/** The E2E location hub (see playwright.config.ts). */
const API = `http://localhost:${process.env.KDS_E2E_API_PORT ?? '4120'}/api/v1`;

interface Session {
  headers: Record<string, string>;
  locationId: string;
}

/** Signs a seeded user in on behalf of the POS (cashiers cannot cancel; owners can). */
export async function posSession(
  request: APIRequestContext,
  who: 'CASHIER' | 'OWNER' = 'CASHIER',
): Promise<Session> {
  const login = await request.post(`${API}/auth/login`, {
    data: {
      email: process.env[`SEED_${who}_EMAIL`],
      password: process.env[`SEED_${who}_PASSWORD`],
      client: 'native',
    },
  });
  const { accessToken, user } = (await login.json()) as {
    accessToken: string;
    user: { restaurantId: string };
  };
  const headers = { authorization: `Bearer ${accessToken}`, 'x-client-source': 'POS' };
  const locations = (await (
    await request.get(`${API}/restaurants/${user.restaurantId}/locations`, { headers })
  ).json()) as { id: string; code: string }[];
  const main = locations.find((l) => l.code === 'MAIN') ?? locations[0];
  if (!main) throw new Error('no location');
  return { headers, locationId: main.id };
}

interface MenuProduct {
  id: string;
  nameEn: string;
  variants: { id: string }[];
  modifierGroups: { minSelect: number; modifiers: { id: string }[] }[];
}

/** Places a takeaway order exactly as the POS does (confirmed, so it goes to the kitchen). */
export async function placeOrder(
  request: APIRequestContext,
  session: Session,
  lines: { product: string; quantity?: number; notes?: string }[],
  extra: Record<string, unknown> = {},
): Promise<{ id: string; orderNumber: string; version: number }> {
  const menu = (await (
    await request.get(`${API}/locations/${session.locationId}/menu`, { headers: session.headers })
  ).json()) as { categories: { products: MenuProduct[] }[] };
  const products = menu.categories.flatMap((c) => c.products);
  const items = lines.map((line) => {
    const product = products.find((p) => p.nameEn === line.product);
    if (!product) throw new Error(`unknown product ${line.product}`);
    return {
      id: randomUUID(),
      productId: product.id,
      variantId: product.variants[0]?.id ?? null,
      modifierIds: product.modifierGroups.flatMap((g) =>
        g.modifiers.slice(0, g.minSelect).map((m) => m.id),
      ),
      quantity: line.quantity ?? 1,
      notes: line.notes ?? null,
    };
  });
  const res = await request.post(`${API}/locations/${session.locationId}/orders`, {
    headers: session.headers,
    data: { id: randomUUID(), channel: 'TAKEAWAY', status: 'CONFIRMED', items, ...extra },
  });
  if (!res.ok()) throw new Error(`order: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; orderNumber: string; version: number };
}

export async function cancelOrder(
  request: APIRequestContext,
  session: Session,
  order: { id: string; version: number },
  reason: string,
): Promise<void> {
  const res = await request.post(
    `${API}/locations/${session.locationId}/orders/${order.id}/transitions`,
    { headers: session.headers, data: { to: 'CANCELLED', reason } },
  );
  if (!res.ok()) throw new Error(`cancel: ${res.status()} ${await res.text()}`);
}
