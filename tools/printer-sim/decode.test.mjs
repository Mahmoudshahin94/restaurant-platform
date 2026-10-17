// node --test tools/printer-sim
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeRasterJob } from './decode.mjs';

test('reassembles raster bands and detects the cut', () => {
  const band = (rows, fill) => [
    0x1d,
    0x76,
    0x30,
    0x00,
    1,
    0,
    rows,
    0,
    ...new Array(rows).fill(fill),
  ];
  const job = Uint8Array.from([
    0x1b,
    0x40,
    ...band(2, 0xff),
    ...band(1, 0x0f),
    0x1b,
    0x64,
    4,
    0x1d,
    0x56,
    0x42,
    0x00,
  ]);
  const image = decodeRasterJob(job);
  assert.equal(image.width, 8);
  assert.equal(image.height, 3);
  assert.deepEqual([...image.data], [0xff, 0xff, 0x0f]);
  assert.equal(image.cut, true);
});

test('returns null for jobs without raster data', () => {
  assert.equal(decodeRasterJob(Uint8Array.from([0x1b, 0x40, 0x41])), null);
});
