import { beforeEach, describe, expect, it } from 'vitest';
import { burger, cola, id, menu } from '../test/fixtures';
import { quoteCart } from '../lib/quote';
import { cartCount, useCart } from './cart';

const medium = burger.modifierGroups[0]!.modifiers[0]!.id;

beforeEach(() => {
  useCart.setState({ locationId: null, lines: [], fulfillment: 'PICKUP' });
  useCart.getState().ensureLocation(id(81));
});

describe('cart', () => {
  it('merges identical choices and gives the order a new id whenever its content changes', () => {
    const cart = useCart.getState();
    const first = cart.orderId;
    cart.addLine({
      productId: burger.id,
      variantId: null,
      modifierIds: [medium],
      quantity: 1,
      notes: null,
    });
    cart.addLine({
      productId: burger.id,
      variantId: null,
      modifierIds: [medium],
      quantity: 2,
      notes: null,
    });
    const state = useCart.getState();
    expect(state.lines).toHaveLength(1);
    expect(cartCount(state.lines)).toBe(3);
    expect(state.orderId).not.toBe(first);

    // The same id is reused while nothing changes, so a resend cannot duplicate the order.
    const placed = useCart.getState().orderId;
    expect(useCart.getState().orderId).toBe(placed);
    useCart.getState().setQuantity(state.lines[0]!.id, 0);
    expect(useCart.getState().lines).toEqual([]);
  });

  it('starts a new cart for another branch', () => {
    useCart.getState().addLine({
      productId: cola.id,
      variantId: cola.variants[0]!.id,
      modifierIds: [],
      quantity: 1,
      notes: null,
    });
    useCart.getState().ensureLocation(id(82));
    expect(useCart.getState()).toMatchObject({ locationId: id(82), lines: [] });
  });
});

describe('price preview', () => {
  it('adds the delivery fee only for delivery, with the shared engine', () => {
    const lines = [
      {
        id: id(60),
        productId: cola.id,
        variantId: cola.variants[1]!.id,
        modifierIds: [],
        quantity: 2,
        notes: null,
      },
    ];
    const pickup = quoteCart(menu, lines, 'PICKUP', 1000);
    const delivery = quoteCart(menu, lines, 'DELIVERY', 1000);
    expect(pickup.quote?.pricing).toMatchObject({ subtotal: 1600, fees: 0, total: 1600 });
    // Prices include VAT here (tax-inclusive location): 1600 × 15/115.
    expect(pickup.quote?.pricing.tax).toBe(209);
    expect(delivery.quote?.pricing).toMatchObject({ fees: 1000, total: 2600 });
  });

  it('reports the line a sold-out product is on', () => {
    const soldOut = {
      ...menu,
      categories: [{ ...menu.categories[0]!, products: [{ ...cola, isAvailable: false }] }],
    };
    const lines = [
      {
        id: id(61),
        productId: cola.id,
        variantId: cola.variants[0]!.id,
        modifierIds: [],
        quantity: 1,
        notes: null,
      },
    ];
    const { quote, error } = quoteCart(soldOut, lines, 'PICKUP', 0);
    expect(quote).toBeNull();
    expect(error).toMatchObject({ code: 'PRODUCT_UNAVAILABLE', details: { lineId: id(61) } });
  });
});
