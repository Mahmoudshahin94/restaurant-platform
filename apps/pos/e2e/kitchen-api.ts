import type { APIRequestContext } from '@playwright/test';

/** The E2E location hub (see playwright.config.ts); the kitchen is driven through it directly. */
const API = `http://localhost:${process.env.POS_E2E_API_PORT ?? '4110'}/api/v1`;

/** The kitchen (seeded Kitchen user) marks every station of an order ready. */
export async function kitchenMarksReady(
  request: APIRequestContext,
  orderNumber: string,
): Promise<void> {
  const login = await request.post(`${API}/auth/login`, {
    data: {
      email: process.env.SEED_KITCHEN_EMAIL,
      password: process.env.SEED_KITCHEN_PASSWORD,
      client: 'native',
    },
  });
  const { accessToken, user } = (await login.json()) as {
    accessToken: string;
    user: { tenantId: string };
  };
  const headers = { authorization: `Bearer ${accessToken}`, 'x-client-source': 'KDS' };
  const locations = (await (
    await request.get(`${API}/tenants/${user.tenantId}/locations`, { headers })
  ).json()) as { id: string }[];
  for (const location of locations) {
    const tickets = (await (
      await request.get(`${API}/locations/${location.id}/kitchen/tickets`, { headers })
    ).json()) as { id: string; orderNumber: string; version: number }[];
    for (const ticket of tickets.filter((t) => t.orderNumber === orderNumber)) {
      const res = await request.post(
        `${API}/locations/${location.id}/kitchen/tickets/${ticket.id}/transitions`,
        { headers, data: { to: 'READY', version: ticket.version } },
      );
      if (!res.ok()) throw new Error(`ticket ${ticket.id}: ${res.status()} ${await res.text()}`);
    }
  }
}
