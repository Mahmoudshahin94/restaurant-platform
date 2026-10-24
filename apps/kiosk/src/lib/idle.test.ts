import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdleReset } from './idle';

describe('idle reset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('warns after a quiet minute, counts down, then resets once', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() =>
      useIdleReset({ enabled: true, onIdle, idleAfterMs: 60_000, countdownS: 15 }),
    );
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current.warning).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1_500);
    });
    expect(result.current.warning).toBe(15);
    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(result.current.warning).toBeNull();
  });

  it('starts again with any touch', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() =>
      useIdleReset({ enabled: true, onIdle, idleAfterMs: 10_000, countdownS: 5 }),
    );
    act(() => {
      vi.advanceTimersByTime(12_000);
    });
    expect(result.current.warning).not.toBeNull();
    act(() => {
      window.dispatchEvent(new Event('pointerdown'));
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.warning).toBeNull();
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('does nothing while off (the welcome screen, a payment in progress)', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleReset({ enabled: false, onIdle, idleAfterMs: 1_000, countdownS: 1 }));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onIdle).not.toHaveBeenCalled();
  });
});
