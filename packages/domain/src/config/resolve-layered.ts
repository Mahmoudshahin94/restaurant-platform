import { CONFIG_LAYERS, type ConfigLayer } from '@pos/shared-types';

/** What one layer says about each setting; a missing key means "inherit from the layer above". */
export type LayerValues<K extends string, T> = Partial<Record<K, T>>;

/**
 * The layers of one resolution. The platform layer is complete (every setting has a default); the
 * others are optional and partial.
 */
export type Layers<K extends string, T> = { PLATFORM: Record<K, T> } & Partial<
  Record<Exclude<ConfigLayer, 'PLATFORM'>, LayerValues<K, T>>
>;

export interface LayeredValue<T> {
  value: T;
  /** The most specific layer that set the value. */
  source: ConfigLayer;
}

/**
 * Resolves settings through the configuration layers (docs/configuration.md): platform defaults,
 * then business-type defaults, then tenant, location and device. For each setting the most
 * specific layer that says something wins, and the result names that layer. "Unset" (a missing
 * key, or `undefined`) inherits; any other value, `false` included, overrides.
 *
 * Pure and shared by the cloud, the location hub (offline) and the apps.
 */
export function resolveLayered<K extends string, T>(
  keys: readonly K[],
  layers: Layers<K, T>,
): Record<K, LayeredValue<T>> {
  const result = {} as Record<K, LayeredValue<T>>;
  for (const key of keys) {
    let resolved: LayeredValue<T> = { value: layers.PLATFORM[key], source: 'PLATFORM' };
    for (const layer of CONFIG_LAYERS) {
      if (layer === 'PLATFORM') continue;
      const value = layers[layer]?.[key];
      if (value !== undefined) resolved = { value, source: layer };
    }
    result[key] = resolved;
  }
  return result;
}
