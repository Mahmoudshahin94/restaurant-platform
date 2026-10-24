import type { ScannerSource } from './types';

/**
 * Placeholder for a scanner the browser cannot see as a keyboard: a camera, or a hardware
 * scanner reached through the POS app shell (Tauri) or WebHID. Not built yet (ADR 0021), so it
 * is never available and screens use the keyboard wedge and manual entry.
 */
export class NativeScanner implements ScannerSource {
  readonly kind = 'native' as const;
  readonly available = false;

  start(): () => void {
    return () => undefined;
  }
}
