import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEME_BACKGROUNDS, contrastRatio } from '@pos/domain';
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

const dark = tokensAfter('@theme {');
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
  });

  it('matches the recorded palettes', () => {
    expect({ dark, light }).toMatchSnapshot();
  });
});
