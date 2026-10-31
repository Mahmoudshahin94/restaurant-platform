import {
  PRIMARY_HOVER_WEIGHT,
  PRIMARY_SUBTLE_BORDER_WEIGHT,
  PRIMARY_SUBTLE_WEIGHT,
  readableForeground,
} from '@pos/domain';
import type { FontFamily, ResolvedBranding, ThemeMode } from '@pos/shared-types';

/** Type stacks for each choice; Arabic text always falls back to the bundled Arabic face. */
export const FONT_STACKS: Record<FontFamily, string> = {
  INTER: "'Inter Variable', 'Noto Sans Arabic Variable', ui-sans-serif, system-ui, sans-serif",
  SYSTEM:
    "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'Noto Sans Arabic Variable', sans-serif",
  SERIF: "ui-serif, Georgia, 'Times New Roman', 'Noto Sans Arabic Variable', serif",
};

type ThemeBranding = Pick<
  ResolvedBranding,
  'primaryColor' | 'secondaryColor' | 'accentColor' | 'borderRadius' | 'fontFamily' | 'surfaceStyle'
>;

const percent = (weight: number) => `${String(Math.round(weight * 100))}%`;

/**
 * The CSS variables a tenant's branding sets (ADR 0019, 0028): each brand colour with a readable
 * foreground computed for it, the focus ring, the primary's hover and subtle (selected) fills,
 * the corner radii and the typeface. A colour the
 * tenant left unset keeps the theme's own (light and dark differ), so it is not written.
 */
export function brandingVariables(branding: ThemeBranding): Record<string, string> {
  const vars: Record<string, string> = {};
  const colour = (name: string, value: string | null) => {
    if (!value) return;
    vars[`--color-${name}`] = value;
    vars[`--color-${name}-foreground`] = readableForeground(value);
  };
  colour('primary', branding.primaryColor);
  colour('secondary', branding.secondaryColor);
  colour('accent', branding.accentColor);
  if (branding.primaryColor) {
    const primary = branding.primaryColor;
    vars['--color-ring'] = primary;
    // Mixed on screen, so each follows the theme: hover darkens in light mode and lightens in
    // dark mode (towards the text colour), and the subtle fills are tints over the card.
    vars['--color-primary-hover'] =
      `color-mix(in oklch, ${primary} ${percent(PRIMARY_HOVER_WEIGHT)}, var(--color-foreground))`;
    vars['--color-primary-subtle'] =
      `color-mix(in oklch, ${primary} ${percent(PRIMARY_SUBTLE_WEIGHT)}, var(--color-card))`;
    vars['--color-primary-subtle-border'] =
      `color-mix(in oklch, ${primary} ${percent(PRIMARY_SUBTLE_BORDER_WEIGHT)}, var(--color-card))`;
  }
  // Every radius derives from the tenant's r: sm .6r, md r, lg 1.4r, xl 2r.
  const r = branding.borderRadius;
  const px = (n: number) => `${String(Math.round(n))}px`;
  vars['--radius'] = px(r);
  vars['--radius-sm'] = px(r * 0.6);
  vars['--radius-md'] = px(r);
  vars['--radius-lg'] = px(r * 1.4);
  vars['--radius-xl'] = px(r * 2);
  vars['--font-sans'] = FONT_STACKS[branding.fontFamily];
  return vars;
}

/**
 * Writes a tenant's branding onto the document (by default <html>): its CSS variables and
 * `data-surface`. Returns a function that removes them again, back to the platform's look.
 */
export function applyTenantTheme(
  branding: ThemeBranding,
  root: HTMLElement = document.documentElement,
): () => void {
  const vars = brandingVariables(branding);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  root.dataset.surface = branding.surfaceStyle.toLowerCase();
  return () => {
    for (const name of Object.keys(vars)) root.style.removeProperty(name);
    delete root.dataset.surface;
  };
}

/** Sets the theme on the document: `data-theme` is `light`, `dark` or `system` (CSS decides). */
export function applyThemeMode(
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.theme = mode.toLowerCase();
}

/** Light or dark, as the screen shows it now (SYSTEM asks the operating system). */
export function resolvedThemeMode(mode: ThemeMode): 'LIGHT' | 'DARK' {
  if (mode !== 'SYSTEM') return mode;
  const light =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches;
  return light ? 'LIGHT' : 'DARK';
}
