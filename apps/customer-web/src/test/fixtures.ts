import { resolveBranding, resolveCurrency, resolveLocales } from '@pos/domain';
import type { Locale } from '@pos/shared-types';
import type {
  PublicOrder,
  PublicTenant,
  PublishedMenu,
  PublishedMenuProduct,
} from '@pos/validation';

export const id = (n: number) => `01890a5d-ac96-774b-bcce-b302099a80${String(n).padStart(2, '0')}`;

export const burger: PublishedMenuProduct = {
  id: id(1),
  sku: null,
  nameEn: 'Burger',
  nameAr: 'برجر',
  descriptionEn: 'Beef patty',
  descriptionAr: 'لحم بقري',
  price: 2500,
  isAvailable: true,
  stationIds: [],
  taxIds: [id(90)],
  variants: [],
  barcodes: [],
  modifierGroups: [
    {
      id: id(10),
      nameEn: 'Doneness',
      nameAr: 'الاستواء',
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: id(11), nameEn: 'Medium', nameAr: 'متوسط', priceDelta: 0, isDefault: false },
        { id: id(12), nameEn: 'Well done', nameAr: 'مستوي', priceDelta: 0, isDefault: false },
      ],
    },
    {
      id: id(20),
      nameEn: 'Extras',
      nameAr: 'إضافات',
      minSelect: 0,
      maxSelect: 2,
      modifiers: [
        { id: id(21), nameEn: 'Cheese', nameAr: 'جبن', priceDelta: 300, isDefault: false },
      ],
    },
  ],
};

export const cola: PublishedMenuProduct = {
  ...burger,
  id: id(2),
  nameEn: 'Cola',
  nameAr: 'كولا',
  descriptionEn: null,
  descriptionAr: null,
  price: 600,
  modifierGroups: [],
  variants: [
    { id: id(31), nameEn: 'Small', nameAr: 'صغير', sku: null, price: 600, barcodes: [] },
    { id: id(32), nameEn: 'Large', nameAr: 'كبير', sku: null, price: 800, barcodes: [] },
  ],
  barcodes: [],
};

export const menu: PublishedMenu = {
  tenantId: id(80),
  locationId: id(81),
  currencyCode: 'SAR',
  taxInclusive: true,
  version: 'v1',
  taxes: [{ id: id(90), nameEn: 'VAT', nameAr: 'ضريبة', rateBps: 1500 }],
  categories: [
    {
      id: id(70),
      nameEn: 'Mains',
      nameAr: 'رئيسية',
      descriptionEn: null,
      descriptionAr: null,
      products: [burger, cola],
    },
  ],
};

export function publicOrder(overrides: Partial<PublicOrder> = {}): PublicOrder {
  return {
    id: id(50),
    orderNumber: 'W-007',
    locationId: id(81),
    location: {
      nameEn: 'Main Branch',
      nameAr: 'الفرع الرئيسي',
      phone: '+966110000000',
      addressLine: null,
      timezone: 'Asia/Riyadh',
    },
    status: 'PLACED',
    paymentStatus: 'UNPAID',
    paymentOption: 'PAY_AT_PICKUP',
    fulfillmentType: 'PICKUP',
    deliveryAddress: null,
    customerName: 'Sara',
    notes: null,
    currencyCode: 'SAR',
    taxInclusive: true,
    items: [
      {
        id: id(51),
        nameEn: 'Burger',
        nameAr: 'برجر',
        variantNameEn: null,
        variantNameAr: null,
        quantity: 2,
        unitPrice: 2500,
        total: 5000,
        notes: null,
        modifiers: [{ nameEn: 'Medium', nameAr: 'متوسط', priceDelta: 0 }],
      },
    ],
    subtotal: 5000,
    discountTotal: 0,
    taxTotal: 652,
    feeTotal: 0,
    total: 5000,
    placedAt: '2026-10-17T12:00:00.000Z',
    acceptBy: '2026-10-17T12:10:00.000Z',
    cancelledAt: null,
    cancelReason: null,
    timeline: [{ status: 'PLACED', at: '2026-10-17T12:00:00.000Z' }],
    ...overrides,
  };
}

/** The store: in shekels, offering `supported` with `defaultLocale` first (ADR 0020). */
export function publicTenant(defaultLocale: Locale = 'en', supported: Locale[] = ['en', 'ar']) {
  const names = { nameEn: 'Demo Kitchen', nameAr: 'مطبخ تجريبي' };
  return {
    id: id(80),
    slug: 'demo-kitchen',
    ...names,
    currency: resolveCurrency('ILS'),
    locales: resolveLocales({ defaultLocale, supportedLocales: supported }),
    timezone: 'Asia/Hebron',
    locations: [],
    branding: resolveBranding({ tenantNames: names, surface: 'website' }),
  } satisfies PublicTenant;
}
