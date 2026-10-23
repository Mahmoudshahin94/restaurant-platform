/**
 * Colour arithmetic for readable branding (ADR 0019): WCAG 2 relative luminance and contrast,
 * for `#rgb`/`#rrggbb` colours (what tenants enter) and the `oklch(L C H)` colours of the theme
 * tokens.
 */

/** Linear-light sRGB channels, each 0..1. */
export type LinearRgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*[\d.]+%?\s*)?\)$/i;

export function isHexColour(value: string): boolean {
  return HEX.test(value);
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function oklchToLinear(l: number, c: number, hDegrees: number): LinearRgb {
  const h = (hDegrees * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
  ];
}

/** The colour's linear sRGB channels (out-of-gamut OKLCH is clipped). Throws on other syntax. */
export function parseColour(value: string): LinearRgb {
  const trimmed = value.trim();
  const hex = HEX.exec(trimmed)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((d) => d + d).join('') : hex;
    return [0, 2, 4].map((i) => toLinear(parseInt(full.slice(i, i + 2), 16) / 255)) as unknown as LinearRgb;
  }
  const oklch = OKLCH.exec(trimmed);
  if (oklch) {
    const [, l = '0', percent, c = '0', h = '0'] = oklch;
    return oklchToLinear(Number(l) / (percent ? 100 : 1), Number(c), Number(h));
  }
  throw new Error(`Unsupported colour: ${value}`);
}

/** WCAG 2 relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(colour: string): number {
  const [r, g, b] = parseColour(colour);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Lower-case `#rrggbb`. */
export function normalizeHex(value: string): string {
  const hex = HEX.exec(value.trim())?.[1];
  if (!hex) throw new Error(`Not a hex colour: ${value}`);
  return `#${(hex.length === 3 ? [...hex].map((d) => d + d).join('') : hex).toLowerCase()}`;
}
