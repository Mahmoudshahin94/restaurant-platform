/**
 * The business day an instant belongs to, as `YYYY-MM-DD` in the location's timezone. Order
 * numbers restart each business day. (A configurable day-start hour for venues open past
 * midnight is a planned extension.)
 */
export function businessDateFor(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Human-readable order number: `<prefix>-<sequence>`, e.g. `MAIN-042`. The prefix is the
 * location code for hub/POS orders and `W` for website orders, so independent writers never
 * collide (ADR 0003).
 */
export function formatOrderNumber(prefix: string, sequence: number): string {
  return `${prefix}-${String(sequence).padStart(3, '0')}`;
}
