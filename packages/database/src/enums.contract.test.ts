import {
  ActionSource,
  DeviceStatus,
  DeviceType,
  LOCALES,
  OnlineOrderingState,
} from '@pos/shared-types';
import { $Enums } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/** The database enums must match the shared contract exactly, or sync payloads will break. */
describe('Prisma enums mirror @pos/shared-types', () => {
  it.each([
    ['OnlineOrderingState', $Enums.OnlineOrderingState, OnlineOrderingState],
    ['DeviceType', $Enums.DeviceType, DeviceType],
    ['DeviceStatus', $Enums.DeviceStatus, DeviceStatus],
    ['ActionSource', $Enums.ActionSource, ActionSource],
  ])('%s', (_name, prismaEnum, sharedEnum) => {
    expect(Object.values(prismaEnum).sort()).toEqual(Object.values(sharedEnum).sort());
  });

  it('Locale', () => {
    expect(Object.values($Enums.Locale).sort()).toEqual([...LOCALES].sort());
  });
});
