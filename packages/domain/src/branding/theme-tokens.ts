/**
 * The colours of the theme that branding is checked against (ADR 0019). A token file: the same
 * values are declared in `packages/ui/src/styles/theme.css`, and a test there keeps them equal.
 */
export const THEME_BACKGROUNDS = {
  DARK: 'oklch(0.16 0.006 265)',
  LIGHT: 'oklch(0.985 0.002 265)',
} as const;

/** The card colour of each theme (`--color-card`): what the tinted `primary-subtle` sits on. */
export const THEME_SURFACES = {
  DARK: 'oklch(0.2 0.007 265)',
  LIGHT: 'oklch(1 0 0)',
} as const;

/** The text colour of each theme (`--color-foreground`). */
export const THEME_FOREGROUNDS = {
  DARK: 'oklch(0.965 0.003 265)',
  LIGHT: 'oklch(0.2 0.015 265)',
} as const;

/**
 * How a tenant's primary colour derives `primary-hover` and `primary-subtle` (applyTenantTheme
 * writes them as `color-mix`; the contrast check uses the same weights): hover is the primary
 * mixed with the theme's text colour, subtle is a tint of the primary over the card.
 */
export const PRIMARY_HOVER_WEIGHT = 0.85;
export const PRIMARY_SUBTLE_WEIGHT = 0.12;
export const PRIMARY_SUBTLE_BORDER_WEIGHT = 0.3;

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
