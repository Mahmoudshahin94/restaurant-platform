// Provisions a location hub for end-to-end tests, then leaves the cloud switched OFF:
//   1. prepares the cloud's *_e2e database (migrate, clear orders, seed),
//   2. starts the cloud API just long enough to pair a fresh hub and give it its snapshot,
//   3. stops the cloud again.
// The test suite then runs the POS/KDS against the hub alone, proving they work offline.
//
// Env: DATABASE_URL (cloud *_e2e database), CLOUD_PORT, HUB_DATA_DIR, SEED_OWNER_EMAIL/PASSWORD.
import { execFileSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cloudPort = process.env.CLOUD_PORT ?? '3199';
const dataDir = process.env.HUB_DATA_DIR;
if (!dataDir) throw new Error('HUB_DATA_DIR is required');

execFileSync('node', [resolve(root, 'tools/e2e/prepare-db.mjs')], { stdio: 'inherit' });

const cloud = spawn('node', [resolve(root, 'apps/api/dist/main.js')], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    API_PORT: cloudPort,
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  },
  stdio: 'inherit',
});
const stopCloud = () => {
  if (cloud.exitCode === null) cloud.kill('SIGTERM');
};
process.on('exit', stopCloud);

try {
  const deadline = Date.now() + 60_000;
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
      'E2E hub',
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
} finally {
  stopCloud();
}
console.log('hub provisioned; cloud stopped');
