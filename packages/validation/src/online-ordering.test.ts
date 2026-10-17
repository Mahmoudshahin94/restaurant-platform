import { describe, expect, it } from 'vitest';
import { createWebOrderSchema, onlineOrderingSettingsSchema } from './online-ordering';

const id = '0199e4a0-0000-7000-8000-000000000001';
const base = {
  id,
  locationId: '0199e4a0-0000-7000-8000-000000000002',
  fulfillment: 'PICKUP',
  customer: { name: 'Sara', phone: '+966 50 000 0000' },
  items: [{ id: '0199e4a0-0000-7000-8000-000000000003', productId: id, quantity: 2 }],
  payment: { option: 'PAY_AT_PICKUP' },
};

describe('createWebOrderSchema', () => {
  it('accepts a pickup order and strips any prices the browser sends', () => {
    const parsed = createWebOrderSchema.parse({
      ...base,
      total: 1,
      items: [{ ...base.items[0], unitPrice: 1, total: 1 }],
    });
    expect(parsed).not.toHaveProperty('total');
    expect(parsed.items[0]).not.toHaveProperty('unitPrice');
    expect(parsed.customer.email).toBeNull();
    expect(parsed.deliveryAddress).toBeNull();
  });

  it('requires an address for delivery, and none for pickup', () => {
    expect(createWebOrderSchema.safeParse({ ...base, fulfillment: 'DELIVERY' }).success).toBe(
      false,
    );
    expect(
      createWebOrderSchema.safeParse({ ...base, deliveryAddress: { line1: 'King Fahd Rd 1' } })
        .success,
    ).toBe(false);
    expect(
      createWebOrderSchema.safeParse({
        ...base,
        fulfillment: 'DELIVERY',
        deliveryAddress: { line1: 'King Fahd Rd 1' },
        payment: { option: 'CASH_ON_DELIVERY' },
      }).success,
    ).toBe(true);
  });

  it('takes a card token for online payment only, never a card number', () => {
    const online = { ...base, payment: { option: 'ONLINE_CARD', cardToken: 'tok_mock_visa' } };
    expect(createWebOrderSchema.safeParse(online).success).toBe(true);
    expect(
      createWebOrderSchema.safeParse({ ...base, payment: { option: 'ONLINE_CARD' } }).success,
    ).toBe(false);
    expect(
      createWebOrderSchema.safeParse({
        ...base,
        payment: { option: 'ONLINE_CARD', cardToken: '4111111111111111' },
      }).success,
    ).toBe(false);
  });
});

describe('onlineOrderingSettingsSchema', () => {
  it('validates opening windows and never lets OFFLINE be set by hand', () => {
    const settings = {
      state: 'OPEN',
      openingHours: [{ day: 5, open: '18:00', close: '02:00' }],
      acceptMinutes: 10,
      pickupEnabled: true,
      deliveryEnabled: false,
      deliveryFee: 0,
    };
    expect(onlineOrderingSettingsSchema.safeParse(settings).success).toBe(true);
    expect(onlineOrderingSettingsSchema.safeParse({ ...settings, state: 'OFFLINE' }).success).toBe(
      false,
    );
    expect(
      onlineOrderingSettingsSchema.safeParse({
        ...settings,
        openingHours: [{ day: 7, open: '25:00', close: '02:00' }],
      }).success,
    ).toBe(false);
  });
});
