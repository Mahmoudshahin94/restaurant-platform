import type { OrgDashboard, OrganizationOverview } from '@pos/validation';
import { ORG, PIZZA, RID } from './api-stub';

export const L_BURGER = '01a146e8-0000-7000-8000-0000000000d1';
export const L_PIZZA = '01a146e8-0000-7000-8000-0000000000d2';

/** An organization with two brands, one branch each (the demo group). */
export const overview: OrganizationOverview = {
  organization: {
    id: ORG,
    slug: 'demo-group',
    nameEn: 'Demo Group',
    nameAr: 'مجموعة العرض',
    currencyCode: 'SAR',
    role: 'OWNER',
  },
  brands: [
    {
      id: RID,
      nameEn: 'Burger House',
      nameAr: 'بيت البرغر',
      logoFileId: null,
      locations: [
        {
          id: L_BURGER,
          code: 'BH1',
          nameEn: 'Burger Downtown',
          nameAr: 'برغر وسط البلد',
          timezone: 'Asia/Riyadh',
        },
      ],
    },
    {
      id: PIZZA,
      nameEn: 'Pizza Point',
      nameAr: 'بيتزا بوينت',
      logoFileId: null,
      locations: [
        {
          id: L_PIZZA,
          code: 'PP1',
          nameEn: 'Pizza Harbor',
          nameAr: 'بيتزا الميناء',
          timezone: 'Asia/Riyadh',
        },
      ],
    },
  ],
};

export const dashboard: OrgDashboard = {
  currencyCode: 'SAR',
  periods: {
    today: { salesTotal: 125_000, orderCount: 10, averageTicket: 12_500 },
    last7: { salesTotal: 800_000, orderCount: 64, averageTicket: 12_500 },
    last30: { salesTotal: 3_300_000, orderCount: 300, averageTicket: 11_000 },
  },
  byBrand: [
    { tenantId: RID, salesTotal: 2_000_000, orderCount: 180 },
    { tenantId: PIZZA, salesTotal: 1_300_000, orderCount: 120 },
  ],
  byLocation: [
    {
      tenantId: RID,
      locationId: L_BURGER,
      salesTotal: 2_000_000,
      orderCount: 180,
      hubOnline: true,
    },
    {
      tenantId: PIZZA,
      locationId: L_PIZZA,
      salesTotal: 1_300_000,
      orderCount: 120,
      hubOnline: false,
    },
  ],
  daily: [
    { date: '2026-10-29', byTenant: { [RID]: 60_000, [PIZZA]: 40_000 } },
    { date: '2026-10-30', byTenant: { [RID]: 70_000, [PIZZA]: 30_000 } },
  ],
};
