import type { Order } from '@pos/validation';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { WebOrderDetails } from './web-orders-prompt';

const id = (n: number) => `01890a5d-ac96-774b-bcce-b302099a80${String(n).padStart(2, '0')}`;
const placedAt = '2026-10-17T12:00:00.000Z';
const acceptBy = '2026-10-17T12:10:00.000Z';

function webOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: id(1),
    restaurantId: id(2),
    locationId: id(3),
    orderNumber: 'W-003',
    businessDate: '2026-10-17',
    channel: 'WEBSITE',
    status: 'PLACED',
    paymentStatus: 'UNPAID',
    source: 'WEBSITE',
    tableId: null,
    tableLabel: null,
    customerName: 'Sara',
    customerPhone: '+966500000001',
    guestCount: null,
    customerEmail: null,
    fulfillmentType: 'DELIVERY',
    deliveryAddress: {
      line1: 'Olaya St 12',
      line2: 'Floor 3',
      city: 'Riyadh',
      notes: 'Ring twice',
    },
    notes: 'Extra napkins',
    currencyCode: 'SAR',
    taxInclusive: true,
    subtotal: 5000,
    discountTotal: 0,
    taxTotal: 652,
    feeTotal: 1000,
    total: 6000,
    version: 1,
    createdById: null,
    placedAt,
    acceptBy,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: placedAt,
    updatedAt: placedAt,
    items: [
      {
        id: id(10),
        productId: id(11),
        variantId: null,
        nameEn: 'Burger',
        nameAr: 'برجر',
        variantNameEn: null,
        variantNameAr: null,
        quantity: 2,
        basePrice: 2500,
        unitPrice: 2500,
        gross: 5000,
        discount: 0,
        tax: 652,
        total: 5000,
        notes: null,
        stationIds: [],
        modifiers: [
          {
            modifierId: id(12),
            modifierGroupId: id(13),
            nameEn: 'Medium',
            nameAr: 'متوسط',
            priceDelta: 0,
          },
        ],
      },
    ],
    taxes: [],
    discounts: [],
    payments: [],
    tickets: [],
    paidTotal: 0,
    refundedTotal: 0,
    balanceDue: 6000,
    statusHistory: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('WebOrderDetails', () => {
  it('shows what the restaurant needs to decide: items, delivery, payment and time left', async () => {
    const now = new Date('2026-10-17T12:01:30.000Z').getTime();
    await renderWithProviders(
      <WebOrderDetails order={webOrder()} now={now} timeZone="Asia/Riyadh" />,
    );
    expect(screen.getByText('Delivery', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Cash on delivery')).toBeInTheDocument();
    expect(screen.getByTestId('accept-countdown')).toHaveTextContent('Accept within 08:30');
    expect(screen.getByText(/Deliver to Olaya St 12, Floor 3, Riyadh/)).toBeInTheDocument();
    expect(screen.getByText('Ring twice')).toBeInTheDocument();
    expect(screen.getByText('Extra napkins')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('marks an expired order and an online payment, in Arabic', async () => {
    const now = new Date('2026-10-17T12:11:00.000Z').getTime();
    const paid = webOrder({
      fulfillmentType: 'PICKUP',
      deliveryAddress: null,
      payments: [
        {
          id: id(20),
          type: 'CHARGE',
          status: 'CAPTURED',
          paymentMethodId: id(21),
          methodType: 'ONLINE',
          methodNameEn: 'Online card',
          methodNameAr: 'بطاقة',
          amount: 6000,
          tendered: null,
          change: 0,
          roundingAdjustment: 0,
          reference: null,
          refundOfId: null,
          reason: null,
          shiftId: null,
          createdAt: placedAt,
        },
      ],
    });
    await renderWithProviders(<WebOrderDetails order={paid} now={now} timeZone="Asia/Riyadh" />, {
      locale: 'ar',
    });
    expect(screen.getByText('مدفوع عبر الإنترنت')).toBeInTheDocument();
    expect(screen.getByText('استلام', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByTestId('accept-countdown')).toHaveTextContent('انتهى وقت القبول');
  });
});
