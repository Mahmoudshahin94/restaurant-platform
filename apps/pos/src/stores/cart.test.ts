import { beforeEach, describe, expect, it } from 'vitest';
import type { Order } from '@pos/validation';
import { cartToRequest, useCart } from './cart';

const LOC = '01890a5d-ac96-774b-bcce-b302099a8001';
const P1 = '01890a5d-ac96-774b-bcce-b302099a8011';
const M1 = '01890a5d-ac96-774b-bcce-b302099a8021';
const M2 = '01890a5d-ac96-774b-bcce-b302099a8022';

beforeEach(() => {
  useCart.getState().ensureLocation(LOC);
  useCart.getState().clear();
});

describe('cart store', () => {
  it('merges identical lines regardless of modifier order', () => {
    const cart = useCart.getState();
    cart.addLine({ productId: P1, variantId: null, modifierIds: [M1, M2] });
    cart.addLine({ productId: P1, variantId: null, modifierIds: [M2, M1] });
    cart.addLine({ productId: P1, variantId: null, modifierIds: [M1] });
    expect(useCart.getState().lines.map((l) => l.quantity)).toEqual([2, 1]);
  });

  it('removes a line when its quantity reaches zero and caps quantities', () => {
    useCart.getState().addLine({ productId: P1, variantId: null, modifierIds: [] });
    const [line] = useCart.getState().lines;
    useCart.getState().setQuantity(line!.id, 5000);
    expect(useCart.getState().lines[0]!.quantity).toBe(999);
    useCart.getState().setQuantity(line!.id, 0);
    expect(useCart.getState().lines).toEqual([]);
  });

  it('keeps the same draft id (idempotency key) until the cart is cleared', () => {
    const before = useCart.getState().draftId;
    useCart.getState().addLine({ productId: P1, variantId: null, modifierIds: [] });
    expect(useCart.getState().draftId).toBe(before);
    useCart.getState().clear();
    expect(useCart.getState().draftId).not.toBe(before);
  });

  it('selecting a table switches to dine-in; other channels drop the table', () => {
    useCart.getState().setTable('01890a5d-ac96-774b-bcce-b302099a8031');
    expect(useCart.getState()).toMatchObject({ channel: 'DINE_IN' });
    useCart.getState().setChannel('TAKEAWAY');
    expect(useCart.getState().tableId).toBeNull();
  });

  it('starts a new cart when the terminal changes location', () => {
    useCart.getState().addLine({ productId: P1, variantId: null, modifierIds: [] });
    useCart.getState().ensureLocation('01890a5d-ac96-774b-bcce-b302099a8002');
    expect(useCart.getState().lines).toEqual([]);
  });

  it('builds a request without any prices and loads existing orders for editing', () => {
    useCart.getState().addLine({ productId: P1, variantId: null, modifierIds: [M1] });
    useCart.getState().setDetails({ customerName: '  Sara ', notes: ' ' });
    const body = cartToRequest(useCart.getState());
    expect(body).toMatchObject({
      channel: 'TAKEAWAY',
      customerName: 'Sara',
      notes: null,
      tableId: null,
    });
    expect(JSON.stringify(body)).not.toMatch(/price|total/i);

    const order = {
      id: 'o1',
      locationId: LOC,
      version: 3,
      orderNumber: 'MAIN-007',
      channel: 'PHONE',
      tableId: null,
      customerName: null,
      customerPhone: '+966500000000',
      guestCount: null,
      notes: null,
      discounts: [],
      items: [
        {
          id: 'line-1',
          productId: P1,
          variantId: null,
          modifiers: [{ modifierId: M2 }],
          quantity: 2,
          notes: 'x',
        },
      ],
    } as unknown as Order;
    useCart.getState().loadOrder(order);
    expect(useCart.getState()).toMatchObject({
      editing: { orderId: 'o1', version: 3, orderNumber: 'MAIN-007' },
      channel: 'PHONE',
      lines: [{ id: 'line-1', modifierIds: [M2], quantity: 2, notes: 'x' }],
    });
  });
});
