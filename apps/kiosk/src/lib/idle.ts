import { useCallback, useEffect, useRef, useState } from 'react';

/** Quiet this long, the kiosk asks whether the customer is still there… */
export const IDLE_AFTER_MS = 60_000;
/** …and clears the order this many seconds later. */
export const IDLE_COUNTDOWN_S = 15;

const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * The idle reset: after `idleAfterMs` without a touch, a key or a scan, `warning` counts down from
 * `countdownS`; any activity (or `dismiss`) stops it, and reaching zero calls `onIdle` once.
 */
export function useIdleReset({
  enabled,
  onIdle,
  idleAfterMs = IDLE_AFTER_MS,
  countdownS = IDLE_COUNTDOWN_S,
}: {
  enabled: boolean;
  onIdle: () => void;
  idleAfterMs?: number;
  countdownS?: number;
}): { warning: number | null; dismiss: () => void } {
  const [warning, setWarning] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());
  const idle = useRef(onIdle);
  idle.current = onIdle;

  const dismiss = useCallback(() => {
    lastActivity.current = Date.now();
    setWarning(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setWarning(null);
      return undefined;
    }
    lastActivity.current = Date.now();
    const touch = () => {
      lastActivity.current = Date.now();
      setWarning(null);
    };
    for (const type of ACTIVITY) window.addEventListener(type, touch, { capture: true });
    const tick = setInterval(() => {
      const quietMs = Date.now() - lastActivity.current;
      if (quietMs < idleAfterMs) return;
      const left = countdownS - Math.floor((quietMs - idleAfterMs) / 1000);
      if (left <= 0) {
        clearInterval(tick);
        setWarning(null);
        idle.current();
      } else {
        setWarning(left);
      }
    }, 250);
    return () => {
      clearInterval(tick);
      for (const type of ACTIVITY) window.removeEventListener(type, touch, { capture: true });
    };
  }, [enabled, idleAfterMs, countdownS]);

  return { warning, dismiss };
}
