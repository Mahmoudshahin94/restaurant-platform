import type { Prisma } from '@pos/database';

/** Reads a JSON column that stores an array of strings (e.g. `OrderItem.stationIds`). */
export function jsonStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
