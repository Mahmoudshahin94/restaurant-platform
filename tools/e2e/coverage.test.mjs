// Keeps the critical-scenario matrix in docs/testing.md honest: the specification's 19 end-to-end
// scenarios (and any added since) are numbered in order, each names at least one Playwright test,
// and every test named exists.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const doc = readFileSync(resolve(root, 'docs/testing.md'), 'utf8');
const section = doc.slice(doc.indexOf('## Critical end-to-end scenarios'));
const rows = section
  .slice(0, section.indexOf('\n## ', 3))
  .split('\n')
  .map((line) => /^\|\s*(\d+)\s*\|[^|]*\|(.*)\|\s*$/.exec(line))
  .filter((match) => match !== null);
const REFERENCE = /\]\(\.\.\/(apps\/[^)]+\.spec\.ts)\)\s*“([^”]+)”/g;

test('the matrix lists at least the 19 scenarios, numbered in order', () => {
  assert.ok(rows.length >= 19, `only ${rows.length} scenarios listed`);
  assert.deepEqual(
    rows.map((row) => Number(row[1])),
    Array.from({ length: rows.length }, (_, i) => i + 1),
  );
});

test('every scenario names Playwright tests that exist', () => {
  for (const [, scenario, cell] of rows) {
    const references = [...cell.matchAll(REFERENCE)];
    assert.ok(references.length > 0, `scenario ${scenario} names no test`);
    for (const [, file, title] of references) {
      const source = readFileSync(resolve(root, file), 'utf8');
      assert.ok(
        source.includes(`test('${title}'`) || source.includes(`test(\n  '${title}'`),
        `scenario ${scenario}: no test “${title}” in ${file}`,
      );
    }
  }
});
