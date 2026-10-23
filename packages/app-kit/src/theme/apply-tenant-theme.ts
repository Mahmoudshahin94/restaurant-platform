import { readableForeground } from '@pos/domain';
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

/**
 * The CSS variables a tenant's branding sets (ADR 0019): each brand colour with a readable
 * foreground computed for it, the focus ring, the corner radii and the typeface. A colour the
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
  if (branding.primaryColor) vars['--color-ring'] = branding.primaryColor;
  const r = branding.borderRadius;
  vars['--radius-sm'] = `${String(Math.round(r * 0.75))}px`;
  vars['--radius-md'] = `${String(r)}px`;
  vars['--radius-lg'] = `${String(Math.round(r * 1.5))}px`;
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
