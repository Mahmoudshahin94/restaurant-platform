// Pairs a fresh location hub with a cloud API that keeps running (unlike prepare-hub.mjs, which
// stops the cloud afterwards). Used by the customer-website suite, where website orders travel
// cloud → hub → POS and back while both are online.
//
// Env: CLOUD_PORT, HUB_DATA_DIR, SEED_OWNER_EMAIL/PASSWORD.
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cloudPort = process.env.CLOUD_PORT ?? '3199';
const dataDir = process.env.HUB_DATA_DIR;
if (!dataDir) throw new Error('HUB_DATA_DIR is required');

const deadline = Date.now() + 120_000;
for (;;) {
  try {
    if ((await fetch(`http://localhost:${cloudPort}/ready`)).ok) break;
  } catch {
    // not listening yet
  }
  if (Date.now() > deadline) throw new Error('cloud API did not become ready');
  await new Promise((r) => setTimeout(r, 300));
}

rmSync(dataDir, { recursive: true, force: true });
execFileSync(
  'node',
  [
    resolve(root, 'apps/gateway/dist/cli/pair.js'),
    '--cloud',
    `http://localhost:${cloudPort}`,
    '--email',
    process.env.SEED_OWNER_EMAIL ?? '',
    '--location',
    'MAIN',
    '--name',
    'E2E hub (online)',
  ],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HUB_DATA_DIR: dataDir,
      HUB_PAIR_PASSWORD: process.env.SEED_OWNER_PASSWORD ?? '',
    },
  },
);
console.log('hub paired; the cloud keeps running');
