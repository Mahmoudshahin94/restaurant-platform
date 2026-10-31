import {
  BRAND_SURFACES,
  type BrandingLayer,
  type BrandingValues,
  type SurfaceOverrides,
} from '@pos/shared-types';
import { contrastRatio, mixColours } from './colour';
import {
  BRAND_FOREGROUNDS,
  MIN_SURFACE_CONTRAST,
  MIN_TEXT_CONTRAST,
  PRIMARY_SUBTLE_WEIGHT,
  THEME_BACKGROUNDS,
  THEME_FOREGROUNDS,
  THEME_SURFACES,
} from './theme-tokens';

type ColourKey = 'primaryColor' | 'secondaryColor' | 'accentColor';
const COLOUR_KEYS: readonly ColourKey[] = ['primaryColor', 'secondaryColor', 'accentColor'];
/** Colours drawn on the page itself (buttons' edges, links, focus rings, selected states). */
const ON_PAGE: ReadonlySet<ColourKey> = new Set(['primaryColor', 'accentColor']);

/** The readable text colour on a brand colour: white or near-black, whichever contrasts more. */
export function readableForeground(colour: string): string {
  return contrastRatio(colour, BRAND_FOREGROUNDS.light) >=
    contrastRatio(colour, BRAND_FOREGROUNDS.dark)
    ? BRAND_FOREGROUNDS.light
    : BRAND_FOREGROUNDS.dark;
}

/**
 * The `primary-subtle` fill a primary colour makes in a theme (a tint over the card), as the
 * contrast check sees it. The screen derives it with `color-mix` and the same weight.
 */
export function primarySubtle(primary: string, mode: 'DARK' | 'LIGHT'): string {
  return mixColours(primary, THEME_SURFACES[mode], PRIMARY_SUBTLE_WEIGHT);
}

export interface ContrastIssue {
  /** Where the colour is set: `['primaryColor']` or `['surfaces', 'kds', 'primaryColor']`. */
  path: string[];
  colour: string;
  /**
   * What it was checked against: its own text, the page of the dark or light theme, or (for the
   * primary) the theme's text on the `primary-subtle` fill of that theme.
   */
  against: 'FOREGROUND' | 'DARK' | 'LIGHT' | 'SUBTLE_DARK' | 'SUBTLE_LIGHT';
  ratio: number;
  required: number;
}

/**
 * Whether brand colours stay readable (ADR 0019): text on each colour reaches WCAG AA, and the
 * colours drawn on the page (primary, accent) stand out from the page of both themes, since a
 * device may always choose light or dark, and the primary's `primary-subtle` tint (selected rows
 * and tabs) keeps the theme's text readable. Unset colours use the theme's own, which pass.
 */
export function colourContrastIssues(
  colours: Partial<Pick<BrandingValues, ColourKey>>,
  path: string[] = [],
): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const round = (n: number) => Math.round(n * 100) / 100;
  for (const key of COLOUR_KEYS) {
    const colour = colours[key];
    if (!colour) continue;
    const text = contrastRatio(colour, readableForeground(colour));
    if (text < MIN_TEXT_CONTRAST) {
      issues.push({
        path: [...path, key],
        colour,
        against: 'FOREGROUND',
        ratio: round(text),
        required: MIN_TEXT_CONTRAST,
      });
    }
    if (!ON_PAGE.has(key)) continue;
    for (const mode of ['DARK', 'LIGHT'] as const) {
      const ratio = contrastRatio(colour, THEME_BACKGROUNDS[mode]);
      if (ratio < MIN_SURFACE_CONTRAST) {
        issues.push({
          path: [...path, key],
          colour,
          against: mode,
          ratio: round(ratio),
          required: MIN_SURFACE_CONTRAST,
        });
      }
    }
    if (key !== 'primaryColor') continue;
    for (const mode of ['DARK', 'LIGHT'] as const) {
      const ratio = contrastRatio(THEME_FOREGROUNDS[mode], primarySubtle(colour, mode));
      if (ratio < MIN_TEXT_CONTRAST) {
        issues.push({
          path: [...path, key],
          colour,
          against: `SUBTLE_${mode}`,
          ratio: round(ratio),
          required: MIN_TEXT_CONTRAST,
        });
      }
    }
  }
  return issues;
}

/** Every unreadable colour of a tenant's branding, its defaults and each surface override. */
export function brandingContrastIssues(
  tenant: BrandingLayer | null | undefined,
  surfaces: SurfaceOverrides | null | undefined,
): ContrastIssue[] {
  const strip = (layer: BrandingLayer | null | undefined) => ({
    primaryColor: layer?.primaryColor ?? null,
    secondaryColor: layer?.secondaryColor ?? null,
    accentColor: layer?.accentColor ?? null,
  });
  return [
    ...colourContrastIssues(strip(tenant)),
    ...BRAND_SURFACES.flatMap((surface) =>
      colourContrastIssues(strip(surfaces?.[surface]), ['surfaces', surface]),
    ),
  ];
}
