/** Where a scanned code came from. */
export type ScanSourceKind = 'keyboard-wedge' | 'manual' | 'native';

/** One code read by a scanner or typed by a person (ADR 0021). */
export interface ScanEvent {
  /** The code, without surrounding whitespace. */
  code: string;
  source: ScanSourceKind;
  /** When it was read, `Date.now()`. */
  at: number;
}

export type ScanListener = (scan: ScanEvent) => void;

/**
 * Anything that produces codes: a USB/Bluetooth scanner typing as a keyboard, a person typing
 * one, later a camera or a scanner reached through the POS app shell. Screens listen to all of
 * them the same way (`useBarcodeScanner`).
 */
export interface ScannerSource {
  readonly kind: ScanSourceKind;
  /** Whether the source can work here; unavailable sources are never started. */
  readonly available: boolean;
  /** Starts listening; returns the function that stops it. */
  start(listener: ScanListener): () => void;
}
