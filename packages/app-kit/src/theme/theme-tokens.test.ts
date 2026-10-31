import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_BACKGROUNDS, THEME_FOREGROUNDS, THEME_SURFACES, contrastRatio } from '@pos/domain';
import { describe, expect, it } from 'vitest';

/**
 * The design tokens themselves (packages/ui/src/styles/theme.css, ADR 0019): both themes keep
 * every text pair readable, the light palette's two copies agree, and the page colours are the
 * ones branding is checked against.
 */
const css = readFileSync(resolve(__dirname, '../../../ui/src/styles/theme.css'), 'utf8');

/** The `--color-*` declarations of the first block that follows `selector`. */
function tokensAfter(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const body = css.slice(open + 1, css.indexOf('}', open));
  return Object.fromEntries(
    [...body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map((m): [string, string] => [
      m[1] ?? '',
      (m[2] ?? '').trim(),
    ]),
  );
}

const dark = tokensAfter('@theme static {');
const darkAttribute = tokensAfter("[data-theme='dark'] {");
const light = tokensAfter("[data-theme='light'] {");
const systemLight = tokensAfter(
  "@media (prefers-color-scheme: light) {\n  [data-theme='system'] {",
);

/** Foreground tokens and what they are read on. */
const PAIRS: [fg: string, bgs: string[]][] = [
  ['foreground', ['background', 'card', 'muted']],
  ['card-foreground', ['card']],
  ['muted-foreground', ['background', 'card', 'muted']],
  ['primary-foreground', ['primary']],
  ['secondary-foreground', ['secondary']],
  ['accent-foreground', ['accent']],
  ['destructive-foreground', ['destructive']],
  ['success-foreground', ['success']],
  ['warning-foreground', ['warning']],
  ['info-foreground', ['info']],
  ['foreground', ['surface-raised', 'surface-sunken']],
  ['muted-foreground', ['surface-raised']],
  [
    'foreground',
    ['primary-subtle', 'success-subtle', 'warning-subtle', 'destructive-subtle', 'info-subtle'],
  ],
];

describe('design tokens', () => {
  it('declares each palette the same way in both of its places', () => {
    expect(Object.keys(light).length).toBeGreaterThan(15);
    expect(systemLight).toEqual(light);
    expect(darkAttribute).toEqual(dark);
  });

  it('gives the light theme every colour of the dark one', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
  });

  it('uses the page colours branding is checked against', () => {
    expect(dark.background).toBe(THEME_BACKGROUNDS.DARK);
    expect(light.background).toBe(THEME_BACKGROUNDS.LIGHT);
  });

  it('uses the card and text colours the primary-subtle check is made with', () => {
    expect(dark.card).toBe(THEME_SURFACES.DARK);
    expect(light.card).toBe(THEME_SURFACES.LIGHT);
    expect(dark.foreground).toBe(THEME_FOREGROUNDS.DARK);
    expect(light.foreground).toBe(THEME_FOREGROUNDS.LIGHT);
  });

  it('declares the enterprise tokens (ADR 0028)', () => {
    const names = [
      'surface',
      'surface-raised',
      'surface-sunken',
      'border-strong',
      'primary-hover',
      'primary-subtle',
      'primary-subtle-border',
      'info',
      'info-foreground',
      'info-subtle',
      'success-subtle',
      'warning-subtle',
      'destructive-subtle',
    ];
    for (const name of names) {
      expect(dark, name).toHaveProperty(name);
      expect(light, name).toHaveProperty(name);
    }
    for (const token of ['--shadow-1', '--shadow-4', '--ease-standard', '--text-caption']) {
      expect(css).toContain(`${token}:`);
    }
    for (const profile of ['storefront', 'counter', 'console']) {
      expect(css).toContain(`[data-profile='${profile}']`);
    }
    // Every radius derives from the tenant radius.
    expect(css).toContain('--radius-sm: calc(var(--radius) * 0.6);');
    expect(css).toContain('--radius-xl: calc(var(--radius) * 2);');
  });

  it.each([
    ['dark', dark],
    ['light', light],
  ] as const)('keeps every text pair readable (WCAG AA) in the %s theme', (_name, tokens) => {
    const failures: string[] = [];
    for (const [fg, bgs] of PAIRS) {
      for (const bg of bgs) {
        const ratio = contrastRatio(tokens[fg]!, tokens[bg]!);
        if (ratio < 4.5) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
    // Brand-coloured controls stand out from the page (non-text contrast, 3:1).
    for (const colour of ['primary', 'ring']) {
      expect(contrastRatio(tokens[colour]!, tokens.background!)).toBeGreaterThanOrEqual(3);
    }
    // Control outlines stand out from every surface they sit on (3:1).
    for (const surface of ['background', 'card', 'surface-raised']) {
      expect(
        contrastRatio(tokens['border-strong']!, tokens[surface]!),
        surface,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('matches the recorded palettes', () => {
    expect({ dark, light }).toMatchSnapshot();
  });
});
