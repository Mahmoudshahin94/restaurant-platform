import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { CLIENT_VERSION_HEADER, MADAR_VERSION } from '@pos/shared-types';
import type { LocationList } from './pair-types';
import { loadHubConfig } from '../config';
import { HubStateService } from '../hub-state.service';
import { HubModule } from '../hub.module';
import { SnapshotSyncService } from '../snapshot/snapshot-sync.service';

/**
 * Pairs this hub with its location in the cloud, once per installation:
 *
 *   pnpm --filter @pos/gateway pair --cloud https://api.example.com --email owner@example.com \
 *     --location MAIN [--name "Front counter hub"] [--force]
 *
 * The password is read from HUB_PAIR_PASSWORD or prompted for (not echoed). It is used only to
 * register the device; the hub then authenticates with its own device credential.
 */
async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const output = rl as unknown as { _writeToOutput: (s: string) => void };
  let asked = false;
  output._writeToOutput = (s: string) => {
    if (!asked) {
      process.stdout.write(s);
      asked = true;
    }
  };
  const answer = await new Promise<string>((done) => {
    rl.question(question, done);
  });
  rl.close();
  process.stdout.write('\n');
  return answer;
}

async function json<T>(response: Response, what: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { code?: string };
  if (!response.ok)
    throw new Error(`${what} failed: ${String(response.status)} ${body.code ?? ''}`);
  return body;
}

async function main(): Promise<void> {
  const envFile = resolve(__dirname, '../../../../.env');
  if (process.env.NODE_ENV !== 'production' && existsSync(envFile)) process.loadEnvFile(envFile);
  const { values } = parseArgs({
    options: {
      cloud: { type: 'string' },
      email: { type: 'string' },
      location: { type: 'string' },
      name: { type: 'string', default: 'Location hub' },
      force: { type: 'boolean', default: false },
    },
  });
  if (!values.cloud || !values.email) {
    throw new Error(
      'usage: pair --cloud <url> --email <owner email> [--location CODE] [--name ...]',
    );
  }
  const cloud = values.cloud.replace(/\/+$/, '');
  const password = process.env.HUB_PAIR_PASSWORD ?? (await promptHidden('Password: '));

  const config = loadHubConfig({ ...process.env, HUB_SNAPSHOT_INTERVAL_SECONDS: '0' });
  const app = await NestFactory.createApplicationContext(HubModule.forRoot(config), {
    logger: ['error', 'warn'],
  });
  try {
    const state = app.get(HubStateService);
    const existing = await state.get('pairing');
    if (existing && !values.force) {
      throw new Error(`Already paired with ${existing.cloudUrl}; pass --force to pair again`);
    }

    const login = await json<{
      accessToken: string;
      refreshToken?: string;
      user: { tenantId: string };
    }>(
      await fetch(`${cloud}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CLIENT_VERSION_HEADER]: MADAR_VERSION },
        body: JSON.stringify({ email: values.email, password, client: 'native' }),
      }),
      'Sign-in',
    );
    const headers = {
      authorization: `Bearer ${login.accessToken}`,
      'content-type': 'application/json',
      [CLIENT_VERSION_HEADER]: MADAR_VERSION,
    };
    const locations = await json<LocationList>(
      await fetch(`${cloud}/api/v1/tenants/${login.user.tenantId}/locations`, { headers }),
      'Listing locations',
    );
    const location = values.location
      ? locations.find((l) => l.code === values.location?.toUpperCase())
      : locations.length === 1
        ? locations[0]
        : undefined;
    if (!location) {
      throw new Error(
        `Choose a location with --location: ${locations.map((l) => l.code).join(', ')}`,
      );
    }
    const paired = await json<{ device: { id: string }; credential: string }>(
      await fetch(`${cloud}/api/v1/locations/${location.id}/devices`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: values.name, type: 'GATEWAY' }),
      }),
      'Pairing',
    );
    await fetch(`${cloud}/api/v1/auth/logout`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refreshToken: login.refreshToken }),
    });

    await state.set('pairing', {
      cloudUrl: cloud,
      deviceId: paired.device.id,
      credential: paired.credential,
      tenantId: login.user.tenantId,
      locationId: location.id,
      pairedAt: new Date().toISOString(),
    });
    const outcome = await app.get(SnapshotSyncService).syncNow();
    console.log(
      `Paired with ${location.code} (device ${paired.device.id}); first snapshot: ${outcome}.`,
    );
    if (outcome !== 'applied' && outcome !== 'unchanged') process.exitCode = 1;
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
