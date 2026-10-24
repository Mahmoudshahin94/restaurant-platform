import { describe, expect, it } from 'vitest';
import { useSession } from './session';

describe('a customer visit', () => {
  it('adds the same item to its line, and forgets everything on reset', () => {
    const s = useSession.getState();
    const item = { productId: 'p', variantId: null, modifierIds: ['b', 'a'], barcode: null };
    const first = s.addLine(item);
    const second = useSession.getState().addLine({ ...item, modifierIds: ['a', 'b'], quantity: 2 });
    expect(second).toBe(first);
    expect(useSession.getState().lines).toMatchObject([{ id: first, quantity: 3 }]);
    useSession.getState().addLine({ ...item, barcode: '5449000000996' });
    expect(useSession.getState().lines).toHaveLength(2);

    const { orderId } = useSession.getState();
    useSession.getState().setLocale('ar');
    useSession.getState().toggleLargeText();
    useSession.getState().setCustomerName('Lina');
    useSession.getState().reset();
    const after = useSession.getState();
    expect(after).toMatchObject({
      stage: 'welcome',
      lines: [],
      locale: null,
      largeText: false,
      customerName: '',
    });
    // The next customer's order can never replay the last one's.
    expect(after.orderId).not.toBe(orderId);
  });

  it('removes a line at quantity zero', () => {
    useSession.getState().reset();
    const id = useSession.getState().addLine({
      productId: 'p',
      variantId: null,
      modifierIds: [],
      barcode: null,
    });
    useSession.getState().setQuantity(id, 0);
    expect(useSession.getState().lines).toEqual([]);
  });
});
