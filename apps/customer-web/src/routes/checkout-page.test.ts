import { describe, expect, it } from 'vitest';
import { cola, id } from '../test/fixtures';
import { checkoutSchema, toWebOrder } from './checkout-page';

const base = {
  name: 'Sara',
  phone: '+966500000001',
  email: '',
  line1: '',
  line2: '',
  city: '',
  addressNotes: '',
  notes: '',
  payment: 'PAY_AT_PICKUP' as const,
  testCard: 'tok_mock_visa' as const,
  fulfillment: 'PICKUP' as const,
};
const lines = [
  {
    id: id(60),
    productId: cola.id,
    variantId: cola.variants[0]!.id,
    modifierIds: [],
    quantity: 2,
    notes: null,
  },
];

describe('checkout', () => {
  it('requires an address for delivery and a valid phone', () => {
    expect(checkoutSchema.safeParse(base).success).toBe(true);
    const delivery = checkoutSchema.safeParse({ ...base, fulfillment: 'DELIVERY' });
    expect(delivery.success).toBe(false);
    expect(delivery.error?.issues[0]).toMatchObject({
      path: ['line1'],
      message: 'customer:checkout.addressRequired',
    });
    expect(checkoutSchema.safeParse({ ...base, phone: 'call me' }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, email: 'nope' }).success).toBe(false);
  });

  it('sends choices only, never a price, and the card token only for online payment', () => {
    const pickup = toWebOrder(id(1), id(81), lines, checkoutSchema.parse(base));
    expect(pickup).toEqual({
      id: id(1),
      locationId: id(81),
      fulfillment: 'PICKUP',
      deliveryAddress: null,
      customer: { name: 'Sara', phone: '+966500000001', email: null },
      items: [
        {
          id: id(60),
          productId: cola.id,
          variantId: cola.variants[0]!.id,
          modifierIds: [],
          quantity: 2,
          notes: null,
        },
      ],
      notes: null,
      payment: { option: 'PAY_AT_PICKUP', cardToken: null },
    });
    expect(JSON.stringify(pickup)).not.toMatch(/price|total/i);

    const delivery = toWebOrder(
      id(1),
      id(81),
      lines,
      checkoutSchema.parse({
        ...base,
        fulfillment: 'DELIVERY',
        line1: 'Olaya St 1',
        payment: 'ONLINE_CARD',
      }),
    );
    expect(delivery.deliveryAddress).toEqual({
      line1: 'Olaya St 1',
      line2: null,
      city: null,
      notes: null,
    });
    expect(delivery.payment).toEqual({ option: 'ONLINE_CARD', cardToken: 'tok_mock_visa' });
  });
});
