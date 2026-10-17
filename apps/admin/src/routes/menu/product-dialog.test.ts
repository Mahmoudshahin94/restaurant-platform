import { describe, expect, it } from 'vitest';
import { validOverride } from './product-dialog';

const doneness = { id: 'g1', minSelect: 1, maxSelect: 1, options: 3 };
const extras = { id: 'g2', minSelect: 0, maxSelect: null, options: 4 };

describe('per-product modifier overrides', () => {
  it('falls back to the group’s rule for empty fields', () => {
    expect(validOverride(doneness, '', '')).toBe(true);
    expect(validOverride(extras, '2', '')).toBe(true);
  });

  it('keeps min within max and the group’s options', () => {
    expect(validOverride(doneness, '2', '')).toBe(false); // 2 > the group's max of 1
    expect(validOverride(doneness, '2', '3')).toBe(true);
    expect(validOverride(extras, '5', '')).toBe(false); // only 4 options
    expect(validOverride(extras, '', '0')).toBe(false); // max must be at least 1
  });
});
