/**
 * The colours of the theme that branding is checked against (ADR 0019). A token file: the same
 * values are declared in `packages/ui/src/styles/theme.css`, and a test there keeps them equal.
 */
export const THEME_BACKGROUNDS = {
  DARK: 'oklch(0.16 0.006 265)',
  LIGHT: 'oklch(0.985 0.002 265)',
} as const;

/**
 * The two foregrounds a brand colour can carry; the more readable one is chosen. Pure black and
 * white: with them every colour reaches 4.5:1 with one of the two (any softer pair leaves a band
 * of mid-tones unreadable).
 */
export const BRAND_FOREGROUNDS = {
  light: '#ffffff',
  dark: '#000000',
} as const;

/** WCAG 2 AA: text on a brand colour (normal size). */
export const MIN_TEXT_CONTRAST = 4.5;
/** WCAG 2 AA for interface components and large text: a brand colour against the page. */
export const MIN_SURFACE_CONTRAST = 3;
