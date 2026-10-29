// One MADAR version (ADR 0026): stamping writes the root's version everywhere without touching
// anything else, and the drift check fails when an app, a package, the POS desktop app or the
// reported constant disagrees with it. The last test is that check on this repository.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { drift, isVersion, rootVersion, stamp, versionTargets } from './set-version.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(repo, 'tools/release/set-version.mjs');
const temporary = [];

after(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

const CARGO_TOML = `[package]
name = "pos"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0.0", features = ["derive"] }
`;
const CARGO_LOCK = `[[package]]
name = "plist"
version = "0.1.0"

[[package]]
name = "pos"
version = "0.1.0"
dependencies = [
 "serde",
]
`;

/** A small copy of the repository's layout, every file at 0.1.0. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'madar-version-'));
  temporary.push(root);
  const write = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const pkg = (name) =>
    `{\n  "name": "${name}",\n  "version": "0.1.0",\n  "dependencies": {\n    "x": "0.1.0"\n  }\n}\n`;
  write('package.json', `{\n  "name": "root",\n  "version": "0.1.0",\n  "private": true\n}\n`);
  write('apps/admin/package.json', pkg('@pos/admin'));
  write('apps/pos/package.json', pkg('@pos/pos'));
  write('packages/domain/package.json', pkg('@pos/domain'));
  write('packages/shared-types/package.json', pkg('@pos/shared-types'));
  write(
    'apps/pos/src-tauri/tauri.conf.json',
    `{\n  "productName": "MADAR POS",\n  "version": "0.1.0",\n  "app": { "version": "keep" }\n}\n`,
  );
  write('apps/pos/src-tauri/Cargo.toml', CARGO_TOML);
  write('apps/pos/src-tauri/Cargo.lock', CARGO_LOCK);
  write(
    'packages/shared-types/src/version.ts',
    `/** doc */\nexport const MADAR_VERSION = '0.1.0';\n\nexport const OTHER = '0.1.0';\n`,
  );
  return root;
}

const read = (root, file) => readFileSync(join(root, file), 'utf8');

describe('MADAR version stamping (ADR 0026)', () => {
  it('accepts semantic versions only', () => {
    for (const ok of ['1.0.0', '0.0.1', '1.2.0-beta.1', '1.2.0+42', '10.20.30-rc.1+build.7']) {
      assert.ok(isVersion(ok), ok);
    }
    for (const bad of [
      '1.0',
      'v1.0.0',
      '01.0.0',
      '1.0.0-',
      '1.0.0 beta',
      '',
      `1.0.0-${'a'.repeat(40)}`,
    ]) {
      assert.equal(isVersion(bad), false, bad);
    }
  });

  it('lists every app and package, the desktop app and the constant', () => {
    const files = versionTargets(fixture()).map((t) => t.file);
    assert.deepEqual(files, [
      'apps/admin/package.json',
      'apps/pos/package.json',
      'packages/domain/package.json',
      'packages/shared-types/package.json',
      'apps/pos/src-tauri/tauri.conf.json',
      'apps/pos/src-tauri/Cargo.toml',
      'apps/pos/src-tauri/Cargo.lock',
      'packages/shared-types/src/version.ts',
    ]);
  });

  it('stamps a new version everywhere and nothing else', () => {
    const root = fixture();
    const changed = stamp(root, '1.4.0-beta.2');
    assert.equal(changed.length, 9);
    assert.equal(rootVersion(root), '1.4.0-beta.2');
    assert.deepEqual(drift(root), []);
    // Only the version itself moved: dependencies, nested versions and other packages stay.
    assert.match(read(root, 'apps/admin/package.json'), /"x": "0.1.0"/);
    assert.match(
      read(root, 'apps/pos/src-tauri/tauri.conf.json'),
      /"app": \{ "version": "keep" \}/,
    );
    assert.match(read(root, 'apps/pos/src-tauri/Cargo.toml'), /serde = \{ version = "1.0.0"/);
    assert.match(read(root, 'apps/pos/src-tauri/Cargo.toml'), /^version = "1.4.0-beta.2"$/m);
    assert.match(read(root, 'apps/pos/src-tauri/Cargo.lock'), /name = "plist"\nversion = "0.1.0"/);
    assert.match(
      read(root, 'apps/pos/src-tauri/Cargo.lock'),
      /name = "pos"\nversion = "1.4.0-beta.2"/,
    );
    assert.match(read(root, 'packages/shared-types/src/version.ts'), /OTHER = '0.1.0'/);
    // Stamping again changes nothing.
    assert.deepEqual(stamp(root), []);
  });

  it('re-stamps the root version when none is given', () => {
    const root = fixture();
    writeFileSync(
      join(root, 'package.json'),
      read(root, 'package.json').replace('"version": "0.1.0"', '"version": "2.0.0"'),
    );
    stamp(root);
    assert.deepEqual(drift(root), []);
  });

  it('refuses a version that is not semantic', () => {
    const root = fixture();
    assert.throws(() => stamp(root, '1.0'), /Not a semantic version/);
    assert.equal(rootVersion(root), '0.1.0');
  });

  it('reports each file that drifted, and the check fails', () => {
    const root = fixture();
    stamp(root, '1.0.0');
    writeFileSync(
      join(root, 'apps/pos/src-tauri/Cargo.toml'),
      read(root, 'apps/pos/src-tauri/Cargo.toml').replace('version = "1.0.0"', 'version = "0.9.0"'),
    );
    writeFileSync(
      join(root, 'packages/domain/package.json'),
      read(root, 'packages/domain/package.json').replace(
        '"version": "1.0.0"',
        '"version": "1.0.1"',
      ),
    );
    assert.deepEqual(drift(root), [
      { file: 'packages/domain/package.json', found: '1.0.1', expected: '1.0.0' },
      { file: 'apps/pos/src-tauri/Cargo.toml', found: '0.9.0', expected: '1.0.0' },
    ]);
  });

  it('this repository has one version everywhere', () => {
    assert.deepEqual(drift(repo), []);
    // The CLI check agrees (exit code 0).
    const output = execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    assert.match(output, new RegExp(`MADAR ${rootVersion(repo).replaceAll('.', '\\.')}`));
  });
});
