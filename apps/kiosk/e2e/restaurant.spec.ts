import { expect, test } from '@playwright/test';
import { cashier, collectAtCounter, findOrder, pairKiosk, pairingCode } from './hub';

const kitchen = {
  email: process.env.SEED_KITCHEN_EMAIL ?? '',
  password: process.env.SEED_KITCHEN_PASSWORD ?? '',
};
const restaurantHub = process.env.KIOSK_E2E_RESTAURANT_HUB ?? '';

test.describe.configure({ mode: 'serial' });

test('a kiosk order paid by card reaches the kitchen screen through the hub', async ({
  page,
  context,
}) => {
  await pairKiosk(page, pairingCode('restaurant', 0));
  await page.getByRole('button', { name: 'Tap to start, or scan an item' }).click();

  // A burger opens its options (doneness preset to the default); fries go straight in.
  await page.getByRole('button', { name: /Classic Burger/ }).click();
  const options = page.getByRole('dialog');
  await expect(options.getByRole('radio', { name: /Medium/ })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await options.getByRole('radio', { name: /Well done/ }).click();
  await options.getByRole('button', { name: /Add to order/ }).click();
  await expect(page.getByTestId('cart-lines')).toContainText('Well done');
  await page.getByRole('button', { name: 'Sides' }).click();
  await page.getByRole('button', { name: /Fries/ }).click();
  await expect(page.getByTestId('announcer')).toContainText('Fries added');
  await expect(page.getByTestId('cart-lines').getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Review and pay' }).click();
  await page.getByLabel('Your name (optional)').fill('Lina');
  await expect(page.getByRole('radio', { name: /Card/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: /^Pay / }).click();

  await expect(page.getByRole('heading', { name: 'Thank you!' })).toBeVisible();
  await expect(page.getByTestId('done-message')).toHaveText(
    'We are preparing your order. Watch the screen for your number.',
  );
  const orderNumber = (await page.getByTestId('order-number').textContent()) ?? '';
  expect(orderNumber).toMatch(/^MAIN-\d{3}$/);

  // The kitchen screen, on the same hub, shows it at its stations.
  const kds = await context.newPage();
  await kds.goto(`${process.env.KIOSK_E2E_KITCHEN_URL ?? ''}/login`);
  await kds.getByLabel('Email').fill(kitchen.email);
  await kds.getByLabel('Password').fill(kitchen.password);
  await kds.getByRole('button', { name: 'Sign in' }).click();
  const tickets = kds.getByRole('article', { name: orderNumber });
  await expect(tickets.filter({ hasText: 'Grill' })).toContainText('Classic Burger');
  await expect(tickets.filter({ hasText: 'Fryer' })).toContainText('Fries');

  // Done: the kiosk is ready for the next customer.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('button', { name: 'Tap to start, or scan an item' })).toBeVisible();
});

test('pay at the counter, in Arabic: the order waits for the cashier, who collects it', async ({
  page,
  request,
}) => {
  await pairKiosk(page, pairingCode('restaurant', 1));
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'المس للبدء، أو امسح منتجًا' }).click();
  await page.getByRole('button', { name: 'الأطباق الجانبية' }).click();
  await page.getByRole('button', { name: /بطاطس/ }).click();
  await page.getByRole('button', { name: 'المراجعة والدفع' }).click();
  await page.getByRole('radio', { name: /عند الكاشير/ }).click();
  await page.getByRole('button', { name: /أرسل الطلب/ }).click();
  await expect(page.getByTestId('done-message')).toHaveText(
    'يُرجى الدفع عند الكاشير وإظهار هذا الرقم.',
  );
  const orderNumber = (await page.getByTestId('order-number').textContent()) ?? '';

  const pos = await cashier(request, restaurantHub, process.env.SEED_CASHIER_PIN ?? '');
  const waiting = await findOrder(request, pos, orderNumber);
  expect(waiting).toMatchObject({
    channel: 'KIOSK',
    source: 'KIOSK',
    status: 'PLACED',
    paymentStatus: 'UNPAID',
  });
  const collected = await collectAtCounter(request, pos, waiting!);
  expect(collected).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
});
