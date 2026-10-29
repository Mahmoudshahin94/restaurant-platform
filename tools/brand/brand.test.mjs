// The platform's names live in one place, PLATFORM_BRAND (packages/shared-types/src/brand.ts,
// ADR 0019). This test fails when an app, a component, a translation or a page spells the brand
// out instead of reading it from there, and when the POS app's bundle drifts from it.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BRAND_FILE = 'packages/shared-types/src/brand.ts';

/** PLATFORM_BRAND, read from its source (no build needed). */
function platformBrand() {
  const source = readFileSync(join(root, BRAND_FILE), 'utf8');
  const field = (name) => {
    const match = source.match(new RegExp(`\\b${name}: '([^']+)'`));
    assert.ok(match, `PLATFORM_BRAND.${name} not found in ${BRAND_FILE}`);
    return match[1];
  };
  return {
    name: field('name'),
    nameAr: field('nameAr'),
    company: field('company'),
    pos: field('pos'),
    identifier: field('identifier'),
    keychainService: field('keychainService'),
  };
}

const brand = platformBrand();
/** Names that must come from PLATFORM_BRAND, plus the names the platform had before MADAR. */
const FORBIDDEN = [
  brand.name,
  brand.nameAr,
  brand.company,
  'Restaurant Platform',
  'Restaurant POS',
  'Tenant POS',
  'منصة المطاعم',
];

function walk(dir, accept) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, accept));
    else if (accept(path)) out.push(path);
  }
  return out;
}

/** Source without its comments: comments may name the platform, code and text may not. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/**
 * Whether `text` spells `name` out. A code identifier that contains it (`MADAR_VERSION`, ADR 0026)
 * is not the brand shown to anyone, so letters, digits or `_` of the Latin alphabet around it do
 * not count; Arabic text matches anywhere (its prefixes attach to the word).
 */
function spellsOut(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(text);
}

function offenders(files, read = (f) => readFileSync(f, 'utf8')) {
  const found = [];
  for (const file of files) {
    const text = read(file);
    for (const name of FORBIDDEN) {
      if (spellsOut(text, name)) found.push(`${relative(root, file)}: "${name}"`);
    }
  }
  return found;
}

const sourceDirs = ['apps', 'packages'].flatMap((top) =>
  readdirSync(join(root, top)).map((name) => join(root, top, name, 'src')),
);

describe('platform brand', () => {
  it('counts the brand as a word, not inside an identifier', () => {
    assert.equal(spellsOut("label: 'MADAR Admin'", brand.name), true);
    assert.equal(spellsOut('<p>MADAR</p>', brand.name), true);
    assert.equal(spellsOut('بدعم من مدار', brand.nameAr), true);
    assert.equal(spellsOut('شكرًا لمدار', brand.nameAr), true);
    assert.equal(spellsOut('clientVersion: MADAR_VERSION', brand.name), false);
    assert.equal(spellsOut('const MADARX = 1', brand.name), false);
  });

  it('is never spelled out in app or package code', () => {
    const files = sourceDirs
      .filter((dir) => {
        try {
          return statSync(dir).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap((dir) =>
        walk(dir, (f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts')),
      )
      .filter((f) => relative(root, f) !== BRAND_FILE);
    assert.ok(files.length > 100, 'expected to scan the apps and packages');
    assert.deepEqual(
      offenders(files, (f) => withoutComments(readFileSync(f, 'utf8'))),
      [],
    );
  });

  it('is never spelled out in a translation', () => {
    const files = walk(join(root, 'packages/i18n/src/locales'), (f) => f.endsWith('.json'));
    assert.deepEqual(offenders(files), []);
  });

  it('names every page through the index.html placeholders', () => {
    const pages = readdirSync(join(root, 'apps'))
      .map((app) => join(root, 'apps', app, 'index.html'))
      .filter((f) => {
        try {
          return statSync(f).isFile();
        } catch {
          return false;
        }
      });
    assert.ok(pages.length >= 4);
    for (const page of pages) {
      const html = readFileSync(page, 'utf8');
      assert.match(html, /<title>%PLATFORM_TITLE%<\/title>/, relative(root, page));
    }
    assert.deepEqual(offenders(pages), []);
  });

  it('matches the POS app bundle', () => {
    const tauri = JSON.parse(
      readFileSync(join(root, 'apps/pos/src-tauri/tauri.conf.json'), 'utf8'),
    );
    assert.equal(tauri.productName, brand.pos);
    assert.equal(tauri.identifier, brand.identifier);
    for (const window of tauri.app.windows) assert.equal(window.title, brand.pos);
    const store = readFileSync(join(root, 'apps/pos/src-tauri/src/secure_store.rs'), 'utf8');
    assert.match(store, new RegExp(`const SERVICE: &str = "${brand.keychainService}";`));
  });

  it('catches a hardcoded brand', () => {
    const component = `export const Footer = () => <p>${brand.name} · Powered by ${brand.company}</p>;`;
    const comment = `// ${brand.name} footer\nexport const Footer = () => <p>{t('poweredBy')}</p>;`;
    assert.equal(offenders(['x.tsx'], () => withoutComments(component)).length, 2);
    assert.deepEqual(
      offenders(['x.tsx'], () => withoutComments(comment)),
      [],
    );
  });
});
