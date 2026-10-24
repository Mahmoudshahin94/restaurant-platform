import { useCallback, useEffect, useMemo, useRef } from 'react';
import { type KeyboardWedgeOptions, KeyboardWedgeScanner } from './keyboard-wedge';
import { ManualEntry } from './manual-entry';
import type { ScanEvent, ScannerSource } from './types';

export interface UseBarcodeScannerOptions {
  /**
   * Listen to scanners only while true (e.g. while no dialog is open). Default true. Codes
   * submitted by hand (`submit`) are always reported: the person asked for it.
   */
  enabled?: boolean;
  /** Timing of the keyboard wedge. */
  wedge?: Omit<KeyboardWedgeOptions, 'target'>;
  /** More sources (a `NativeScanner` once there is one); unavailable ones are skipped. */
  sources?: readonly ScannerSource[];
}

/**
 * Calls `onScan` for every code a scanner types (keyboard wedge), a person submits (`submit`,
 * the manual entry), or another source reads. The latest `onScan` is used without restarting
 * the sources.
 */
export function useBarcodeScanner(
  onScan: (scan: ScanEvent) => void,
  { enabled = true, wedge, sources = [] }: UseBarcodeScannerOptions = {},
): { submit: (code: string) => boolean } {
  const handler = useRef(onScan);
  handler.current = onScan;
  const manual = useMemo(() => new ManualEntry(), []);
  const { maxKeyIntervalMs, minLength, terminators, now } = wedge ?? {};
  const terminatorKey = terminators?.join('\u0000');

  useEffect(
    () =>
      manual.start((scan) => {
        handler.current(scan);
      }),
    [manual],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const keyboard = new KeyboardWedgeScanner({
      maxKeyIntervalMs,
      minLength,
      terminators: terminatorKey === undefined ? undefined : terminatorKey.split('\u0000'),
      now,
    });
    const stops = [keyboard, ...sources]
      .filter((source) => source.available)
      .map((source) =>
        source.start((scan) => {
          handler.current(scan);
        }),
      );
    return () => {
      for (const stop of stops) stop();
    };
  }, [enabled, maxKeyIntervalMs, minLength, terminatorKey, now, sources]);

  const submit = useCallback((code: string) => manual.submit(code), [manual]);
  return { submit };
}
