import { describe, expect, it } from 'vitest';
import { isUuid, isUuidV7, newId } from './ids';

describe('newId', () => {
  it('generates unique, time-ordered UUIDv7 values', () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(isUuidV7)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});
