#!/usr/bin/env node
// One MADAR version (ADR 0026). The root package.json holds it; this script stamps it on every
// app and package, the POS desktop app (Tauri and Cargo) and the `MADAR_VERSION` constant the
// servers and apps report. `tools/release/set-version.test.mjs` fails when any of them drifts.
//
//   node tools/release/set-version.mjs 1.1.0   set the version and stamp it everywhere
//   node tools/release/set-version.mjs         stamp the root's version again
//   node tools/release/set-version.mjs --check list what drifted, exit 1 if anything did
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Semantic versioning 2.0 (`1.0.0`, `1.2.0-beta.1`, `1.2.0+42`), at most 40 characters. */
export const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isVersion(value) {
  return typeof value === 'string' && value.length <= 40 && SEMVER.test(value);
}

/** The top-level `"version"` of a JSON file indented with two spaces, kept as it is written. */
const JSON_VERSION = /^( {2}"version": ")([^"]*)(")/m;

/**
 * Every place the version is written: the pattern finds it (group 2) without reformatting the
 * file, so stamping changes nothing but the version.
 */
export function versionTargets(root) {
  const packages = ['apps', 'packages'].flatMap((folder) =>
    existsSync(join(root, folder))
      ? readdirSync(join(root, folder), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(folder, entry.name, 'package.json'))
          .filter((file) => existsSync(join(root, file)))
          .sort()
      : [],
  );
  return [
    ...packages.map((file) => ({ file, pattern: JSON_VERSION })),
    { file: 'apps/pos/src-tauri/tauri.conf.json', pattern: JSON_VERSION },
    {
      file: 'apps/pos/src-tauri/Cargo.toml',
      pattern: /^(\[package\]\n(?:(?!\[)[^\n]*\n)*?version = ")([^"]*)(")/m,
    },
    {
      file: 'apps/pos/src-tauri/Cargo.lock',
      pattern: /^(\[\[package\]\]\nname = "pos"\nversion = ")([^"]*)(")/m,
    },
    {
      file: 'packages/shared-types/src/version.ts',
      pattern: /^(export const MADAR_VERSION = ')([^']*)(')/m,
    },
  ];
}

/** The MADAR version: the root package.json's. */
export function rootVersion(root) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!isVersion(version)) {
    throw new Error(`The root package.json has no valid version (found ${String(version)})`);
  }
  return version;
}

/** Each target whose version differs from the root's (a missing file or version counts too). */
export function drift(root) {
  const expected = rootVersion(root);
  const drifted = [];
  for (const { file, pattern } of versionTargets(root)) {
    const path = join(root, file);
    const found = existsSync(path)
      ? (readFileSync(path, 'utf8').match(pattern)?.[2] ?? null)
      : null;
    if (found !== expected) drifted.push({ file, found, expected });
  }
  return drifted;
}

/** Sets the root's version (when given) and writes it to every target; returns what changed. */
export function stamp(root, version = rootVersion(root)) {
  if (!isVersion(version)) throw new Error(`Not a semantic version: ${version}`);
  const changed = [];
  const write = (file, pattern) => {
    const path = join(root, file);
    if (!existsSync(path)) throw new Error(`${file} is missing`);
    const text = readFileSync(path, 'utf8');
    if (!pattern.test(text)) throw new Error(`No version found in ${file}`);
    const next = text.replace(pattern, (_match, head, _old, tail) => `${head}${version}${tail}`);
    if (next !== text) {
      writeFileSync(path, next);
      changed.push(file);
    }
  };
  write('package.json', JSON_VERSION);
  for (const { file, pattern } of versionTargets(root)) write(file, pattern);
  return changed;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const [arg] = process.argv.slice(2);
  try {
    if (arg === '--check') {
      const drifted = drift(root);
      for (const d of drifted) {
        console.error(`${d.file}: ${d.found ?? 'no version'} (expected ${d.expected})`);
      }
      if (drifted.length > 0) {
        console.error('Run `pnpm version:set` to stamp the root version everywhere.');
        process.exit(1);
      }
      console.log(`MADAR ${rootVersion(root)}: every app and package agrees.`);
    } else {
      const changed = stamp(root, arg);
      const version = rootVersion(root);
      console.log(
        changed.length === 0
          ? `MADAR ${version}: nothing to change.`
          : `MADAR ${version} stamped on:\n${changed.map((f) => `  ${relative('.', join(root, f)) || f}`).join('\n')}`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
