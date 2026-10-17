import { describe, expect, it } from 'vitest';
import { quickTenders } from './payment-dialog';

describe('quickTenders', () => {
  it('offers the exact amount and the next note sizes', () => {
    expect(quickTenders(3850, 'SAR')).toEqual([3850, 4000, 5000, 10_000]);
    expect(quickTenders(1200, 'SAR')).toEqual([1200, 1500, 2000, 5000]);
    expect(quickTenders(5000, 'SAR')).toEqual([5000, 6000, 10_000, 20_000]);
  });

  it('respects 3-decimal currencies', () => {
    expect(quickTenders(3850, 'KWD')).toEqual([3850, 5000, 10_000, 20_000]);
  });
});
