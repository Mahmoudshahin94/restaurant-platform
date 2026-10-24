import type { ScanListener, ScannerSource } from './types';

/**
 * Codes typed by a person: a barcode that will not scan, or a till without a scanner. The screen
 * calls `submit` with what was typed; listeners get it like any scan.
 */
export class ManualEntry implements ScannerSource {
  readonly kind = 'manual' as const;
  readonly available = true;
  private readonly listeners = new Set<ScanListener>();

  start(listener: ScanListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Reports a typed code; false (and nothing reported) when it is empty. */
  submit(raw: string): boolean {
    const code = raw.trim();
    if (code.length === 0) return false;
    const scan = { code, source: 'manual' as const, at: Date.now() };
    for (const listener of this.listeners) listener(scan);
    return true;
  }
}
