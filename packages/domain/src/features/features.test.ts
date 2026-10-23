import { BusinessType, CONFIG_LAYERS, FEATURES, Feature } from '@pos/shared-types';
import { describe, expect, it } from 'vitest';
import { resolveLayered } from '../config/resolve-layered';
import { BUSINESS_TYPE_DEFAULTS, PLATFORM_FEATURE_DEFAULTS } from './defaults';
import { featureLayersFromRows, resolveFeatures } from './resolve-features';

const enabledOf = (layers: Parameters<typeof resolveFeatures>[0]) =>
  FEATURES.filter((feature) => resolveFeatures(layers)[feature].enabled);

describe('resolveLayered', () => {
  const keys = ['a', 'b', 'c'] as const;

  it('takes the most specific layer that sets a value, and names it', () => {
    const result = resolveLayered(keys, {
      PLATFORM: { a: 1, b: 1, c: 1 },
      BUSINESS_TYPE: { b: 2 },
      TENANT: { b: 3, c: 3 },
      LOCATION: { c: 4 },
    });
    expect(result).toEqual({
      a: { value: 1, source: 'PLATFORM' },
      b: { value: 3, source: 'TENANT' },
      c: { value: 4, source: 'LOCATION' },
    });
  });

  it('treats undefined as unset and false as a value', () => {
    const result = resolveLayered(['x', 'y'] as const, {
      PLATFORM: { x: true, y: true },
      TENANT: { x: false, y: undefined },
      DEVICE: {},
    });
    expect(result.x).toEqual({ value: false, source: 'TENANT' });
    expect(result.y).toEqual({ value: true, source: 'PLATFORM' });
  });

  it('applies the layers in the documented order', () => {
    expect(CONFIG_LAYERS).toEqual(['PLATFORM', 'BUSINESS_TYPE', 'TENANT', 'LOCATION', 'DEVICE']);
    const result = resolveLayered(['k'] as const, {
      DEVICE: { k: 'device' },
      LOCATION: { k: 'location' },
      TENANT: { k: 'tenant' },
      BUSINESS_TYPE: { k: 'type' },
      PLATFORM: { k: 'platform' },
    });
    expect(result.k).toEqual({ value: 'device', source: 'DEVICE' });
  });
});

describe('business-type defaults', () => {
  it('covers every business type and the whole catalog at platform level', () => {
    expect(Object.keys(BUSINESS_TYPE_DEFAULTS).sort()).toEqual(Object.values(BusinessType).sort());
    expect(Object.keys(PLATFORM_FEATURE_DEFAULTS).sort()).toEqual([...FEATURES].sort());
  });

  it('gives a restaurant the kitchen, the floor and online ordering', () => {
    expect(enabledOf({ businessType: 'RESTAURANT' })).toEqual([
      'POS',
      'KDS',
      'KITCHEN_PRINTER',
      'ONLINE_ORDERING',
      'TABLES',
      'MODIFIERS',
      'PRODUCT_VARIANTS',
      'DELIVERY',
    ]);
  });

  it('gives a coffee shop the kitchen screen and modifiers but no tables', () => {
    expect(enabledOf({ businessType: 'COFFEE_SHOP' })).toEqual([
      'POS',
      'KDS',
      'ONLINE_ORDERING',
      'MODIFIERS',
      'SELF_CHECKOUT',
    ]);
  });

  it('gives supermarkets and clothing stores barcodes and stock, no kitchen', () => {
    for (const type of ['SUPERMARKET', 'GROCERY', 'CLOTHING', 'RETAIL']) {
      const enabled = enabledOf({ businessType: type });
      expect(enabled).toEqual(expect.arrayContaining(['POS', 'BARCODE', 'INVENTORY']));
      expect(enabled).not.toContain('KDS');
      expect(enabled).not.toContain('TABLES');
    }
    expect(enabledOf({ businessType: 'CLOTHING' })).toContain('PRODUCT_VARIANTS');
    expect(enabledOf({ businessType: 'SUPERMARKET' })).toContain('SELF_CHECKOUT');
  });

  it('gives other and unknown types the platform defaults only', () => {
    expect(enabledOf({ businessType: 'OTHER' })).toEqual(['POS']);
    expect(enabledOf({ businessType: 'SPACESHIP' })).toEqual(['POS']);
    expect(resolveFeatures({ businessType: 'OTHER' }).POS.source).toBe('PLATFORM');
    expect(resolveFeatures({ businessType: 'RESTAURANT' }).KDS.source).toBe('BUSINESS_TYPE');
  });
});

describe('resolveFeatures', () => {
  it('lets the tenant, a location and a device override in turn', () => {
    const layers = {
      businessType: 'RESTAURANT',
      tenant: { KDS: false, LOYALTY: true },
      location: { KDS: true },
      device: { KDS: false },
    };
    const resolved = resolveFeatures(layers);
    expect(resolved.KDS).toMatchObject({ enabled: false, source: 'DEVICE' });
    expect(resolved.LOYALTY).toMatchObject({ enabled: true, source: 'TENANT' });
    expect(resolved.TABLES).toMatchObject({ enabled: true, source: 'BUSINESS_TYPE' });
    expect(resolveFeatures({ ...layers, device: {} }).KDS).toMatchObject({
      enabled: true,
      source: 'LOCATION',
    });
  });

  it('caps every layer with the entitlement', () => {
    const resolved = resolveFeatures({
      businessType: 'RESTAURANT',
      entitlements: {
        KDS: { entitled: false, tenantConfigurable: true },
        LOYALTY: { entitled: false, tenantConfigurable: true },
      },
      tenant: { LOYALTY: true },
      location: { KDS: true },
    });
    expect(resolved.KDS).toEqual({
      feature: 'KDS',
      enabled: false,
      source: 'PLATFORM',
      entitled: false,
      configurable: true,
    });
    expect(resolved.LOYALTY.enabled).toBe(false);
  });

  it('ignores tenant, location and device layers for a module the tenant may not configure', () => {
    const resolved = resolveFeatures({
      businessType: 'RESTAURANT',
      entitlements: { TABLES: { entitled: true, tenantConfigurable: false } },
      tenant: { TABLES: false },
      location: { TABLES: false },
    });
    expect(resolved.TABLES).toMatchObject({
      enabled: true,
      source: 'BUSINESS_TYPE',
      configurable: false,
    });
  });

  it('entitles and lets tenants configure every module by default', () => {
    for (const feature of FEATURES) {
      expect(resolveFeatures({ businessType: 'OTHER' })[feature]).toMatchObject({
        entitled: true,
        configurable: true,
      });
    }
  });
});

describe('featureLayersFromRows', () => {
  const rows = [
    { feature: Feature.KDS, enabled: false, locationId: null, deviceId: null },
    { feature: Feature.KDS, enabled: true, locationId: 'loc-1', deviceId: null },
    { feature: Feature.KDS, enabled: true, locationId: 'loc-2', deviceId: null },
    { feature: Feature.TABLES, enabled: false, locationId: 'loc-1', deviceId: 'dev-1' },
    { feature: 'TELEPORTER', enabled: true, locationId: null, deviceId: null },
  ];
  const entitlements = [
    { feature: Feature.LOYALTY, entitled: false, tenantConfigurable: false },
    { feature: 'TELEPORTER', entitled: true, tenantConfigurable: true },
  ];

  it('splits rows into the layers of the requested scope', () => {
    const layers = featureLayersFromRows({
      businessType: 'RESTAURANT',
      entitlements,
      overrides: rows,
      locationId: 'loc-1',
      deviceId: 'dev-1',
    });
    expect(layers.tenant).toEqual({ KDS: false });
    expect(layers.location).toEqual({ KDS: true });
    expect(layers.device).toEqual({ TABLES: false });
    expect(layers.entitlements).toEqual({
      LOYALTY: { entitled: false, tenantConfigurable: false },
    });
  });

  it('leaves out other locations and devices', () => {
    const tenantWide = featureLayersFromRows({
      businessType: 'RESTAURANT',
      entitlements: [],
      overrides: rows,
    });
    expect(tenantWide.location).toEqual({});
    expect(tenantWide.device).toEqual({});
    expect(resolveFeatures(tenantWide).KDS).toMatchObject({ enabled: false, source: 'TENANT' });
  });
});
