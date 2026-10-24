import type { ScanListener, ScannerSource } from './types';

export interface KeyboardWedgeOptions {
  /**
   * Longest pause between two keys of one scan, in ms. A scanner types a character every few
   * milliseconds; people do not keep that pace for a whole code.
   */
  maxKeyIntervalMs?: number;
  /** Fewest characters a scan has: a shorter burst ending in a terminator is typing. */
  minLength?: number;
  /** Keys that end a scan (scanners are usually set to send Enter). */
  terminators?: readonly string[];
  /** Where keys are listened to (the window by default). */
  target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** The clock, in ms (tests). */
  now?: () => number;
}

export const KEYBOARD_WEDGE_DEFAULTS = {
  maxKeyIntervalMs: 35,
  minLength: 4,
  terminators: ['Enter'],
} as const;

/** Elements (or their ancestors) with this attribute receive scans as plain typing. */
export const SCANNER_IGNORE_ATTRIBUTE = 'data-scanner-ignore';

type Editable = HTMLInputElement | HTMLTextAreaElement;

function editableTarget(target: EventTarget | null): Editable | null {
  if (typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement) return target;
  if (typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement) {
    return target;
  }
  return null;
}

/** Puts back what a field held before a scan typed into it, the way React notices. */
function restoreValue(field: Editable, value: string): void {
  if (field.value === value) return;
  // The element's own `value` setter is React's tracker; the prototype's writes the DOM.
  Reflect.set(Object.getPrototypeOf(field) as object, 'value', value, field);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * A barcode scanner in keyboard ("HID wedge") mode: it types the code and presses Enter, faster
 * than anyone types. Keys are watched, never blocked, so typing works as usual. When a burst of
 * at least `minLength` characters, each within `maxKeyIntervalMs` of the previous one, ends in a
 * terminator, it is a scan: the terminator is stopped (no form is submitted, no button pressed),
 * a field the burst landed in gets its previous text back, and the code is reported.
 */
export class KeyboardWedgeScanner implements ScannerSource {
  readonly kind = 'keyboard-wedge' as const;
  readonly available = typeof window !== 'undefined';
  private readonly options: Required<Omit<KeyboardWedgeOptions, 'target'>> &
    Pick<KeyboardWedgeOptions, 'target'>;

  constructor(options: KeyboardWedgeOptions = {}) {
    this.options = {
      maxKeyIntervalMs: options.maxKeyIntervalMs ?? KEYBOARD_WEDGE_DEFAULTS.maxKeyIntervalMs,
      minLength: options.minLength ?? KEYBOARD_WEDGE_DEFAULTS.minLength,
      terminators: options.terminators ?? KEYBOARD_WEDGE_DEFAULTS.terminators,
      now: options.now ?? (() => performance.now()),
      target: options.target,
    };
  }

  start(listener: ScanListener): () => void {
    const { maxKeyIntervalMs, minLength, terminators } = this.options;
    const now = () => this.options.now();
    const target = this.options.target ?? window;
    let buffer = '';
    let lastAt = 0;
    let field: Editable | null = null;
    let fieldBefore = '';
    const reset = () => {
      buffer = '';
      field = null;
    };

    const onKeyDown = (event: Event) => {
      const key = event as KeyboardEvent;
      const element = key.target instanceof Element ? key.target : null;
      if (
        element?.closest(`[${SCANNER_IGNORE_ATTRIBUTE}]`) ||
        key.ctrlKey ||
        key.metaKey ||
        key.altKey
      ) {
        reset();
        return;
      }
      const at = now();
      const inTime = buffer.length > 0 && at - lastAt <= maxKeyIntervalMs;

      if (terminators.includes(key.key)) {
        if (inTime && buffer.length >= minLength) {
          key.preventDefault();
          key.stopPropagation();
          if (field) restoreValue(field, fieldBefore);
          listener({ code: buffer.trim(), source: 'keyboard-wedge', at: Date.now() });
        }
        reset();
        return;
      }
      if (key.key.length !== 1) {
        // Shift comes with every capital a scanner types; anything else ends a burst.
        if (key.key !== 'Shift') reset();
        return;
      }
      if (!inTime) {
        buffer = '';
        field = editableTarget(key.target);
        // The key has not reached the field yet: this is its text before the burst.
        fieldBefore = field?.value ?? '';
      }
      buffer += key.key;
      lastAt = at;
    };

    // Capture: seen before any handler of the page can act on the terminator.
    target.addEventListener('keydown', onKeyDown, true);
    return () => {
      target.removeEventListener('keydown', onKeyDown, true);
    };
  }
}
