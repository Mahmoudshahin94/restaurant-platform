// Runs the location hubs of the kiosk end-to-end tests (ADR 0022), with the cloud switched OFF:
//   1. prepares the cloud's *_e2e database (migrate, clear orders, seed),
//   2. starts the cloud API, and for each hub: creates two self-service kiosks at its location
//      (their pairing codes go to KIOSK_E2E_CODES), then pairs a fresh hub, whose first snapshot
//      brings the kiosks waiting to pair,
//   3. stops the cloud, and serves every hub until this process is stopped.
// The kiosks then pair with their hub and order through it alone, as on a location's network.
//
// Env: DATABASE_URL (*_e2e), CLOUD_PORT, KIOSK_E2E_CODES (output file), KIOSK_E2E_HUBS (JSON:
// [{ key, email, password, location, port, dataDir }]), HUB_CORS_ORIGINS.
import { execFileSync, spawn } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cloudPort = process.env.CLOUD_PORT ?? '3198';
const cloudUrl = `http://localhost:${cloudPort}`;
const hubs = JSON.parse(process.env.KIOSK_E2E_HUBS ?? '[]');
const codesFile = process.env.KIOSK_E2E_CODES;
if (hubs.length === 0 || !codesFile)
  throw new Error('KIOSK_E2E_HUBS and KIOSK_E2E_CODES are required');

async function waitReady(url) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`${url} did not become ready`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function json(response, what) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${what} failed: ${response.status} ${body.code ?? ''}`);
  return body;
}

/** Two kiosks waiting to pair at the hub's location: one pairing code per test. */
async function createKiosks(hub) {
  const login = await json(
    await fetch(`${cloudUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: hub.email, password: hub.password }),
    }),
    `Sign-in of ${hub.email}`,
  );
  const headers = {
    authorization: `Bearer ${login.accessToken}`,
    'content-type': 'application/json',
  };
  const locations = await json(
    await fetch(`${cloudUrl}/api/v1/tenants/${login.user.tenantId}/locations`, { headers }),
    'Listing locations',
  );
  const location = locations.find((l) => l.code === hub.location);
  if (!location) throw new Error(`No location ${hub.location} for ${hub.email}`);
  const codes = [];
  for (const name of ['E2E kiosk 1', 'E2E kiosk 2']) {
    const created = await json(
      await fetch(`${cloudUrl}/api/v1/locations/${location.id}/devices`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name, type: 'KIOSK' }),
      }),
      'Creating a kiosk',
    );
    codes.push(created.pairing.code);
  }
  return codes;
}

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
const codes = {};
try {
  await waitReady(`${cloudUrl}/ready`);
  for (const hub of hubs) {
    codes[hub.key] = await createKiosks(hub);
    rmSync(hub.dataDir, { recursive: true, force: true });
    execFileSync(
      'node',
      [
        resolve(root, 'apps/gateway/dist/cli/pair.js'),
        '--cloud',
        cloudUrl,
        '--email',
        hub.email,
        '--location',
        hub.location,
        '--name',
        `E2E hub ${hub.key}`,
      ],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          HUB_DATA_DIR: hub.dataDir,
          HUB_PAIR_PASSWORD: hub.password,
        },
      },
    );
  }
} finally {
  stopCloud();
}
writeFileSync(codesFile, JSON.stringify(codes, null, 2));
console.log('hubs provisioned with their kiosks; cloud stopped');

const running = hubs.map((hub) =>
  spawn('node', [resolve(root, 'apps/gateway/dist/main.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HUB_PORT: String(hub.port),
      HUB_DATA_DIR: hub.dataDir,
      HUB_SNAPSHOT_INTERVAL_SECONDS: '3600',
      HUB_CLOUD_TIMEOUT_MS: '1000',
      AUTH_RATE_LIMIT_PER_MINUTE: '1000',
      // The documented test adapter of kiosk card terminals.
      PAYMENT_TERMINAL_PROVIDER: 'mock',
    },
    stdio: 'inherit',
  }),
);
const stopHubs = () => {
  for (const hub of running) if (hub.exitCode === null) hub.kill('SIGTERM');
};
process.on('exit', stopHubs);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopHubs();
    process.exit(0);
  });
}
for (const hub of running) {
  hub.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`a hub exited with ${code}`);
      stopHubs();
      process.exit(1);
    }
  });
}
