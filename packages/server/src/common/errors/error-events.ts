/**
 * Server errors for the platform's health board (ADR 0025). The exception filter hands every 5xx
 * answer to an `ErrorEventSink` when the application provides one (the cloud stores them as
 * `PlatformErrorEvent`s; the hub has none). What is handed over is already safe to keep: the route
 * pattern instead of the URL, no body, no headers, and a redacted, shortened message.
 */
export interface ServerErrorEvent {
  status: number;
  code: string;
  method: string;
  /** The route pattern (`/api/v1/locations/:locationId/orders`), or `unmatched`. */
  route: string;
  message: string;
  tenantId: string | null;
  locationId: string | null;
  requestId: string | null;
}

export interface ErrorEventSink {
  /** Must not throw and must not delay the answer: storing happens in the background. */
  record(event: ServerErrorEvent): void;
}

const MAX_MESSAGE = 500;

/**
 * Removes what an error message may quote about people or credentials: e-mail addresses, long
 * digit runs (phones, card numbers), bearer and device credentials and long opaque tokens. Record
 * ids (UUIDs) stay, because they are what an operator needs to find the record.
 */
export function redactErrorMessage(message: string): string {
  const redacted = message
    .replace(/(Bearer|Device)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g, '[EMAIL]')
    .replace(
      /\b(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)[A-Za-z0-9_\-+/=]{32,}/g,
      '[REDACTED]',
    )
    .replace(/\+?\d[\d\s-]{6,}\d/g, '[NUMBER]');
  return redacted.length > MAX_MESSAGE ? `${redacted.slice(0, MAX_MESSAGE - 1)}…` : redacted;
}

/**
 * Keeps at most `perMinute` events per key (route and code) in each minute, counting the ones it
 * drops so the next kept event says how many were suppressed. One storm cannot fill the table or
 * hide other routes' errors.
 */
export class ErrorSampler {
  private readonly windows = new Map<string, { start: number; kept: number; dropped: number }>();

  constructor(private readonly perMinute: number) {}

  admit(key: string, now: number = Date.now()): { keep: boolean; suppressed: number } {
    const window = this.windows.get(key);
    if (!window || now - window.start >= 60_000) {
      const suppressed = window?.dropped ?? 0;
      this.windows.set(key, { start: now, kept: 1, dropped: 0 });
      if (this.windows.size > 1000) this.prune(now);
      return { keep: this.perMinute > 0, suppressed };
    }
    if (window.kept < this.perMinute) {
      window.kept += 1;
      const suppressed = window.dropped;
      window.dropped = 0;
      return { keep: true, suppressed };
    }
    window.dropped += 1;
    return { keep: false, suppressed: 0 };
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.start >= 60_000 && window.dropped === 0) this.windows.delete(key);
    }
  }
}
