import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { type Page, expect, test } from '@playwright/test';
// @ts-expect-error — plain ESM helper without type declarations
import { decodeRasterJob as untypedDecode } from '../../../tools/printer-sim/decode.mjs';

interface DecodedImage {
  width: number;
  height: number;
  data: Buffer;
  cut: boolean;
}
const decodeRasterJob = untypedDecode as (bytes: Uint8Array) => DecodedImage | null;

const cashier = {
  email: process.env.SEED_CASHIER_EMAIL ?? '',
  password: process.env.SEED_CASHIER_PASSWORD ?? '',
};

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear();
      localStorage.setItem(
        'pos-terminal-preferences',
        JSON.stringify({
          state: {
            locale: 'en',
            locationId: null,
            shiftId: null,
            printer: { kind: 'browser', paper: '80mm' },
          },
          version: 1,
        }),
      );
      sessionStorage.setItem('e2e-init', '1');
    }
  });
});

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(cashier.email);
  await page.getByLabel('Password').fill(cashier.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeVisible();
}

async function ensureShift(page: Page): Promise<void> {
  await page.keyboard.press('F8');
  const continueOpen = page.getByRole('button', { name: 'Continue that shift' });
  const openButton = page.getByRole('button', { name: 'Open shift' });
  await expect(
    continueOpen.or(openButton).or(page.getByRole('button', { name: 'Close shift' })),
  ).toBeVisible();
  if (await continueOpen.isVisible()) {
    await continueOpen.click();
  } else if (await openButton.isVisible()) {
    await page.getByLabel(/Opening cash/).fill('100');
    await openButton.click();
  }
  await expect(page.getByRole('button', { name: 'Close shift' })).toBeVisible();
}

test('cashier takes cash with change, completes the order and sees the receipt', async ({
  page,
}) => {
  await signIn(page);
  await ensureShift(page);

  await page.keyboard.press('F2');
  await page.getByRole('button', { name: /^Fries/ }).click();
  await page.getByRole('button', { name: /^Fries/ }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByText(/Order MAIN-\d+ placed/)).toBeVisible();

  await page.getByRole('button', { name: 'Take payment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('balance-due')).toHaveText(/18\.00/);
  await dialog.getByRole('button', { name: /20\.00/ }).click();
  await expect(dialog.getByTestId('change')).toHaveText(/2\.00/);
  await dialog.getByRole('button', { name: /^Confirm/ }).click();
  await expect(dialog.getByText(/Change: SAR\s2\.00 · Order fully paid/)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('F4');
  await page.getByRole('list', { name: 'Open' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Print receipt' }).click();
  const receipt = page.getByTestId('receipt');
  await expect(receipt).toContainText('Demo Kitchen');
  await expect(receipt).toContainText(/Received\s*SAR\s20\.00/);
  await expect(receipt).toContainText(/Change\s*SAR\s2\.00/);
  await page.keyboard.press('Escape');

  // New → Confirmed (accepted for preparation) → Completed (handed over, fully paid).
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('button', { name: 'Complete order' }).click();
  await expect(page.getByRole('button', { name: 'Complete order' })).toBeHidden();

  await page.keyboard.press('F8');
  await expect(page.getByTestId('expected-cash')).toHaveText(/118\.00/);
});

test('a bill can be split between card and cash; card numbers are refused', async ({ page }) => {
  await signIn(page);
  await ensureShift(page);
  await page.keyboard.press('F2');
  await page.getByRole('button', { name: /Kunafa/ }).click();
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.getByRole('button', { name: 'Take payment' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Mada' }).click();
  await dialog.getByLabel(/Amount/).fill('10');
  await dialog.getByLabel('Approval code').fill('4111111111111111');
  await dialog.getByRole('button', { name: /^Confirm/ }).click();
  await expect(
    dialog.getByText('That looks like a card number. Enter the approval code only.'),
  ).toBeVisible();
  await dialog.getByLabel('Approval code').fill('AUTH-7731');
  await dialog.getByRole('button', { name: /^Confirm/ }).click();
  await expect(dialog.getByTestId('balance-due')).toHaveText(/8\.00/);

  await dialog.getByRole('radio', { name: 'Cash' }).click();
  await dialog.getByRole('button', { name: 'Exact' }).click();
  await dialog.getByRole('button', { name: /^Confirm/ }).click();
  await expect(dialog.getByText(/Order fully paid/)).toBeVisible();
});

test('closing the shift reports the cash difference', async ({ page }) => {
  await signIn(page);
  await ensureShift(page);
  const expected = (await page.getByTestId('expected-cash').innerText()).replace(/[^\d.]/g, '');
  await page.getByRole('button', { name: 'Close shift' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Counted cash/).fill((Number(expected) - 1).toFixed(2));
  await expect(dialog.getByTestId('cash-difference')).toContainText('Short');
  await dialog.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByText(/Shift closed\. Difference: -SAR\s1\.00/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open shift' })).toBeVisible();
});

/** Minimal PNG writer (grayscale, 8-bit) so the decoded receipt can be inspected. */
function writePng(path: string, width: number, height: number, mono: Uint8Array): void {
  const bytesPerRow = width / 8;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const bit = ((mono[y * bytesPerRow + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
      raw[y * (width + 1) + 1 + x] = bit ? 0 : 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

test('an Arabic receipt renders to a valid ESC/POS raster job', async ({ page }) => {
  await signIn(page);
  const bytes = await page.evaluate(async () => {
    // Loaded from the Vite dev server: the exact code the POS uses to print.
    const modulePath = '/src/lib/printing.ts';
    const printing = (await import(/* @vite-ignore */ modulePath)) as {
      receiptToEscPos: (doc: unknown, width: number) => Promise<Uint8Array>;
    };
    const doc = {
      locale: 'ar',
      direction: 'rtl',
      blocks: [
        { kind: 'text', text: 'مطبخ تجريبي', align: 'center', size: 'large', bold: true },
        { kind: 'divider' },
        { kind: 'row', start: '2 × برجر كلاسيك', end: '50.00 ر.س.', bold: false, size: 'normal' },
        { kind: 'text', text: '  + جبن إضافي', align: 'start', size: 'normal', bold: false },
        { kind: 'row', start: 'الإجمالي', end: '58.50 ر.س.', bold: true, size: 'large' },
        { kind: 'divider' },
        { kind: 'text', text: 'شكرًا لزيارتكم!', align: 'center', size: 'normal', bold: true },
      ],
    };
    return Array.from(await printing.receiptToEscPos(doc, 576));
  });
  const image = decodeRasterJob(Uint8Array.from(bytes));
  expect(image).not.toBeNull();
  expect(image?.width).toBe(576);
  expect(image?.height).toBeGreaterThan(150);
  expect(image?.cut).toBe(true);
  const black = [...(image?.data ?? [])].reduce(
    (n, b) => n + b.toString(2).replace(/0/g, '').length,
    0,
  );
  expect(black).toBeGreaterThan(2000);
  if (image)
    writePng(
      resolve(import.meta.dirname, '../test-results/arabic-receipt.png'),
      image.width,
      image.height,
      image.data,
    );
});
