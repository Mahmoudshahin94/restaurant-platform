import { PERMISSIONS } from '@pos/shared-types';
import { describe, expect, it } from 'vitest';
import { PERMISSION_GROUPS, permissionsOf } from './permission-groups';

describe('permission groups', () => {
  it('cover the whole catalog, each permission once', () => {
    const grouped = PERMISSION_GROUPS.flatMap(permissionsOf);
    expect([...grouped].sort()).toEqual([...PERMISSIONS].sort());
  });
});
