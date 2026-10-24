import { expect, test } from '@playwright/test';
import { cashier, findOrder, pairKiosk, pairingCode } from './hub';

const marketHub = process.env.KIOSK_E2E_MARKET_HUB ?? '';

test('scans items into the cart and completes a self-checkout sale', async ({ page, request }) => {
  await pairKiosk(page, pairingCode('market', 0));
  // The supermarket speaks Arabic first (its default language).
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('button', { name: 'المس للبدء، أو امسح منتجًا' })).toBeVisible();

  // A scanner types the code fast and presses Enter: scanning on the welcome screen starts.
  await page.keyboard.type('7291000000012');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('scan-notice')).toContainText('أرز 5 كغ');
  await page.keyboard.type('7291000000029');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('cart-lines').getByRole('listitem')).toHaveCount(2);

  // A code the scanner cannot read is typed in.
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.getByRole('button', { name: 'type the code' }).click();
  await page.getByRole('textbox', { name: 'Barcode' }).fill('7291000000036');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('cart-lines')).toContainText('Labneh 500 g');
  await expect(page.getByTestId('cart-lines')).toContainText('Olive oil 1 L');
  const total = (await page.getByTestId('cart-total').textContent()) ?? '';

  await page.getByRole('button', { name: 'Review and pay' }).click();
  await page.getByRole('button', { name: `Pay ${total}` }).click();
  await expect(page.getByTestId('done-message')).toHaveText(
    'Payment complete. Take your items, and have a nice day.',
  );
  const orderNumber = (await page.getByTestId('order-number').textContent()) ?? '';

  // The sale is complete at the hub: paid by the kiosk's card terminal, no cash drawer.
  const pos = await cashier(request, marketHub, process.env.SEED_MARKET_CASHIER_PIN ?? '');
  const sale = await findOrder(request, pos, orderNumber);
  expect(sale).toMatchObject({ channel: 'KIOSK', status: 'COMPLETED', paymentStatus: 'PAID' });
  expect(sale?.payments).toEqual([
    expect.objectContaining({ methodType: 'CARD', shiftId: null, deviceId: expect.any(String) }),
  ]);
});
