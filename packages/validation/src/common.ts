import { LOCALES } from '@pos/shared-types';
import { isSupportedCurrency } from '@pos/domain';
import { z } from 'zod';

export const idSchema = z.uuid();

export const localeSchema = z.enum(LOCALES as unknown as ['en', 'ar']);

/** Integer minor units (e.g. 1850 = 18.50 SAR). Never a float. */
export const minorUnitsSchema = z.int().min(0).max(1_000_000_000);

/** Basis points: 0..10000 (0%..100%). */
export const bpsSchema = z.int().min(0).max(10_000);

export const currencyCodeSchema = z
  .string()
  .length(3)
  .refine(isSupportedCurrency, { message: 'Unsupported currency' });

export const timezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Unknown IANA timezone' },
);

export const nameEnSchema = z.string().trim().min(1).max(120);
export const nameArSchema = z.string().trim().min(1).max(120);
export const descriptionSchema = z.string().trim().max(1000).nullable();

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.int(),
    pageSize: z.int(),
    total: z.int(),
  });
}
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** ISO-8601 timestamp as serialized by the API (always UTC). */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
