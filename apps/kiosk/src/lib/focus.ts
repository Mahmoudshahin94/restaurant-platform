import { useEffect, useRef } from 'react';

/**
 * Moves focus to a screen's heading when it appears, so a screen reader announces each new step
 * and keyboard users start from the top (the heading has `tabIndex={-1}`).
 */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
