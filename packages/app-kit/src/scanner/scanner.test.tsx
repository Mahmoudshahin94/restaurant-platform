import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardWedgeScanner, SCANNER_IGNORE_ATTRIBUTE } from './keyboard-wedge';
import { ManualEntry } from './manual-entry';
import { NativeScanner } from './native-scanner';
import type { ScanEvent } from './types';
import { useBarcodeScanner } from './use-barcode-scanner';

afterEach(cleanup);

/** A clock the test moves: each key is typed `gap` ms after the previous one. */
function clock() {
  let t = 1_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** Types `text` then Enter on `target`, one key every `gap` ms. Returns the Enter event. */
function type(
  target: EventTarget,
  time: ReturnType<typeof clock>,
  text: string,
  gap: number,
  terminator = 'Enter',
): KeyboardEvent {
  for (const key of text) {
    time.advance(gap);
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    // What the browser does after an unprevented key: the character reaches a focused field.
    if (target instanceof HTMLInputElement) target.value += key;
  }
  time.advance(gap);
  const end = new KeyboardEvent('keydown', { key: terminator, bubbles: true, cancelable: true });
  target.dispatchEvent(end);
  return end;
}

function listen(options: ConstructorParameters<typeof KeyboardWedgeScanner>[0] = {}) {
  const time = clock();
  const scans: ScanEvent[] = [];
  const stop = new KeyboardWedgeScanner({ now: time.now, ...options }).start((s) => scans.push(s));
  return { time, scans, stop };
}

describe('KeyboardWedgeScanner', () => {
  it('reports a fast burst ending in Enter as a scan, and stops the Enter', () => {
    const { time, scans, stop } = listen();
    const enter = type(document.body, time, '6291234000018', 8);
    expect(scans.map(({ code, source }) => ({ code, source }))).toEqual([
      { code: '6291234000018', source: 'keyboard-wedge' },
    ]);
    expect(enter.defaultPrevented).toBe(true);
    stop();
  });

  it('leaves normal typing alone, Enter included', () => {
    const { time, scans, stop } = listen();
    const enter = type(document.body, time, 'hello world', 120);
    expect(scans).toEqual([]);
    expect(enter.defaultPrevented).toBe(false);
    stop();
  });

  it('ignores bursts shorter than a code, and codes that stall', () => {
    const { time, scans, stop } = listen({ minLength: 6 });
    type(document.body, time, '1234', 5);
    // Fast, then a pause before Enter: someone typed and pressed Enter later.
    for (const key of '6291234000018') {
      time.advance(5);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    time.advance(400);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(scans).toEqual([]);
    stop();
  });

  it('starts a new burst after a pause, so slow typing before a scan does not spoil it', () => {
    const { time, scans, stop } = listen();
    for (const key of 'ab') {
      time.advance(300);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    time.advance(300);
    type(document.body, time, 'TEE-S-WHT', 10);
    expect(scans.map((s) => s.code)).toEqual(['TEE-S-WHT']);
    stop();
  });

  it('keeps capitals typed with Shift in one burst, and drops bursts broken by other keys', () => {
    const { time, scans, stop } = listen();
    for (const key of ['Shift', 'T', 'Shift', 'E', 'E', '-', '1']) {
      time.advance(5);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    time.advance(5);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    for (const key of ['1', '2', 'ArrowLeft', '3', '4']) {
      time.advance(5);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    time.advance(5);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(scans.map((s) => s.code)).toEqual(['TEE-1']);
    stop();
  });

  it('gives a field the burst landed in its text back', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.value = 'cola';
    const { time, scans, stop } = listen();
    type(input, time, '6291000001010', 6);
    expect(scans.map((s) => s.code)).toEqual(['6291000001010']);
    expect(input.value).toBe('cola');
    stop();
    input.remove();
  });

  it('leaves fields marked for typed codes alone', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute(SCANNER_IGNORE_ATTRIBUTE, '');
    const input = document.createElement('input');
    wrapper.append(input);
    document.body.append(wrapper);
    const { time, scans, stop } = listen();
    const enter = type(input, time, '6291000001010', 6);
    expect(scans).toEqual([]);
    expect(enter.defaultPrevented).toBe(false);
    expect(input.value).toBe('6291000001010');
    stop();
    wrapper.remove();
  });

  it('follows its timing options and stops listening when stopped', () => {
    const { time, scans, stop } = listen({ maxKeyIntervalMs: 80, terminators: ['Tab'] });
    type(document.body, time, 'ABCD1234', 60, 'Tab');
    expect(scans).toHaveLength(1);
    stop();
    type(document.body, time, 'ABCD1234', 5, 'Tab');
    expect(scans).toHaveLength(1);
  });
});

describe('ManualEntry and NativeScanner', () => {
  it('reports typed codes, trimmed, and nothing for an empty one', () => {
    const manual = new ManualEntry();
    const listener = vi.fn();
    const stop = manual.start(listener);
    expect(manual.submit('  RICE-5KG ')).toBe(true);
    expect(manual.submit('   ')).toBe(false);
    stop();
    manual.submit('ignored');
    expect(listener.mock.calls.map(([scan]) => (scan as ScanEvent).code)).toEqual(['RICE-5KG']);
  });

  it('has no native scanner yet', () => {
    const native = new NativeScanner();
    expect(native.available).toBe(false);
    expect(typeof native.start()).toBe('function');
  });
});

describe('useBarcodeScanner', () => {
  it('reports keyboard scans and manual codes to the latest handler', () => {
    const time = clock();
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onScan }) => useBarcodeScanner(onScan, { wedge: { now: time.now } }),
      { initialProps: { onScan: first } },
    );
    rerender({ onScan: second });
    type(document.body, time, '7291000001019', 5);
    act(() => {
      result.current.submit('TEE-S-WHT');
    });
    expect(first).not.toHaveBeenCalled();
    expect(
      second.mock.calls.map(([scan]) => [(scan as ScanEvent).code, (scan as ScanEvent).source]),
    ).toEqual([
      ['7291000001019', 'keyboard-wedge'],
      ['TEE-S-WHT', 'manual'],
    ]);
  });

  it('listens to scanners only while enabled, and always to codes typed by hand', () => {
    const time = clock();
    const onScan = vi.fn();
    let submit: (code: string) => boolean = () => false;
    function Till() {
      const [open, setOpen] = useState(false);
      ({ submit } = useBarcodeScanner(onScan, { enabled: !open, wedge: { now: time.now } }));
      return (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          open dialog
        </button>
      );
    }
    render(<Till />);
    type(document.body, time, '7291000001019', 5);
    fireEvent.click(screen.getByRole('button', { name: 'open dialog' }));
    type(document.body, time, '7291000001026', 5);
    // A code typed into the dialog is still reported.
    act(() => {
      submit('7291000001033');
    });
    expect(onScan.mock.calls.map(([scan]) => (scan as ScanEvent).code)).toEqual([
      '7291000001019',
      '7291000001033',
    ]);
  });
});
