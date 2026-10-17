import { DomainError } from '../errors';

/**
 * One weekly opening window in the location's timezone. `day` is the weekday the window starts
 * on (0 = Sunday … 6 = Saturday). A `close` at or before `open` runs past midnight into the next
 * day (`18:00`–`02:00`); `00:00`–`00:00` is the whole day.
 */
export interface OpeningWindow {
  day: number;
  open: string;
  close: string;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since midnight of an `HH:MM` string. */
export function minutesOf(time: string): number {
  const match = TIME.exec(time);
  if (!match) throw new DomainError('VALIDATION_FAILED', 'Invalid time', { time });
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidOpeningWindow(window: OpeningWindow): boolean {
  return (
    Number.isInteger(window.day) &&
    window.day >= 0 &&
    window.day <= 6 &&
    TIME.test(window.open) &&
    TIME.test(window.close)
  );
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Weekday and minute of the day of an instant, in a timezone. */
export function localWeekMinute(instant: Date, timeZone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  const day = WEEKDAYS[get('weekday') ?? ''] ?? 0;
  return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * Whether the location is open at an instant. No windows means no restriction (always open):
 * a restaurant that has not configured hours relies on its OPEN/PAUSED/CLOSED switch alone.
 */
export function isWithinOpeningHours(
  windows: readonly OpeningWindow[],
  timeZone: string,
  instant: Date,
): boolean {
  if (windows.length === 0) return true;
  const { day, minute } = localWeekMinute(instant, timeZone);
  const previous = (day + 6) % 7;
  return windows.some((w) => {
    const open = minutesOf(w.open);
    const close = minutesOf(w.close);
    const overnight = close <= open;
    if (w.day === day && minute >= open && (overnight || minute < close)) return true;
    // The tail of yesterday's window after midnight.
    return overnight && w.day === previous && minute < close;
  });
}

/** Parses stored opening hours (a JSON column), dropping malformed entries. */
export function parseOpeningHours(value: unknown): OpeningWindow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (w): w is OpeningWindow =>
      typeof w === 'object' && w !== null && isValidOpeningWindow(w as OpeningWindow),
  );
}
