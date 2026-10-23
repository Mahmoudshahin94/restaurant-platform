import { describe, expect, it } from 'vitest';
import { createOrderSchema, listOrdersQuerySchema } from './orders';
import { createDiscountSchema, updateDiscountSchema } from './pricing-config';

const id = (n: number) => `01890a5d-ac96-774b-bcce-b302099a80${String(n).padStart(2, '0')}`;
const item = { id: id(1), productId: id(2), quantity: 1 };

describe('order schemas', () => {
  it('fills defaults for takeaway orders', () => {
    const parsed = createOrderSchema.parse({ id: id(9), channel: 'TAKEAWAY', items: [item] });
    expect(parsed).toMatchObject({ status: 'PLACED', discountIds: [], tableId: null });
    expect(parsed.items[0]).toMatchObject({ variantId: null, modifierIds: [], notes: null });
  });

  it('enforces channel rules', () => {
    // A table is required only where the TABLES module is on: the server decides (ADR 0018).
    expect(
      createOrderSchema.safeParse({ id: id(9), channel: 'DINE_IN', items: [item] }).success,
    ).toBe(true);
    expect(
      createOrderSchema.safeParse({ id: id(9), channel: 'TAKEAWAY', tableId: id(3), items: [item] })
        .success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({ id: id(9), channel: 'PHONE', items: [item] }).success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({
        id: id(9),
        channel: 'PHONE',
        customerPhone: '+966 50 000 0000',
        items: [item],
      }).success,
    ).toBe(true);
    expect(
      createOrderSchema.safeParse({ id: id(9), channel: 'WEBSITE', items: [item] }).success,
    ).toBe(false);
  });

  it('never accepts client prices and rejects bad quantities or duplicate lines', () => {
    const withPrice = createOrderSchema.parse({
      id: id(9),
      channel: 'TAKEAWAY',
      items: [{ ...item, unitPrice: 1 }],
      total: 1,
    });
    expect(withPrice).not.toHaveProperty('total');
    expect(withPrice.items[0]).not.toHaveProperty('unitPrice');
    expect(
      createOrderSchema.safeParse({
        id: id(9),
        channel: 'TAKEAWAY',
        items: [{ ...item, quantity: 0 }],
      }).success,
    ).toBe(false);
    expect(
      createOrderSchema.safeParse({ id: id(9), channel: 'TAKEAWAY', items: [item, item] }).success,
    ).toBe(false);
    expect(createOrderSchema.safeParse({ id: id(9), channel: 'TAKEAWAY', items: [] }).success).toBe(
      false,
    );
  });

  it('parses status lists', () => {
    expect(listOrdersQuerySchema.parse({ status: 'PLACED,CONFIRMED' }).status).toEqual([
      'PLACED',
      'CONFIRMED',
    ]);
    expect(listOrdersQuerySchema.safeParse({ status: 'NOPE' }).success).toBe(false);
  });
});

describe('discount schemas', () => {
  it('caps percentages and requires type+value together on update', () => {
    expect(
      createDiscountSchema.safeParse({
        nameEn: 'a',
        nameAr: 'b',
        type: 'PERCENTAGE',
        value: 10_001,
      }).success,
    ).toBe(false);
    expect(
      createDiscountSchema.safeParse({ nameEn: 'a', nameAr: 'b', type: 'FIXED', value: 50_000 })
        .success,
    ).toBe(true);
    expect(updateDiscountSchema.safeParse({ value: 100 }).success).toBe(false);
    expect(updateDiscountSchema.safeParse({ nameEn: 'x' }).success).toBe(true);
  });
});
