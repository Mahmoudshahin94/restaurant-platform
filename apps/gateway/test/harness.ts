import { mkdtempSync, rmSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LocationSnapshot } from '@pos/validation';
import { createHub } from '../src/bootstrap';
import { loadHubConfig } from '../src/config';
import { HubStateService } from '../src/hub-state.service';
import { SnapshotSyncService } from '../src/snapshot/snapshot-sync.service';

/** A stand-in for the cloud's snapshot endpoint, switchable between up, down and rejecting. */
export class FakeCloud {
  snapshot: LocationSnapshot | null = null;
  mode: 'up' | 'reject' = 'up';
  requests = 0;
  readonly credential = 'device-id.secret-value';
  private server: Server | null = null;
  url = '';

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.requests += 1;
      if (req.url !== '/api/v1/sync/snapshot') return void res.writeHead(404).end();
      if (this.mode === 'reject' || req.headers.authorization !== `Device ${this.credential}`) {
        return void res.writeHead(401).end('{"code":"UNAUTHENTICATED"}');
      }
      const etag = `"${this.snapshot?.version ?? ''}"`;
      if (req.headers['if-none-match'] === etag) return void res.writeHead(304).end();
      res.writeHead(200, { 'content-type': 'application/json', etag });
      res.end(JSON.stringify(this.snapshot));
    });
    await new Promise<void>((done) => this.server?.listen(0, '127.0.0.1', done));
    this.url = `http://127.0.0.1:${String((this.server.address() as AddressInfo).port)}`;
  }

  /** The Internet goes away: connections are refused. */
  async stop(): Promise<void> {
    const server = this.server;
    if (server) {
      await new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      });
    }
    this.server = null;
  }
}

export interface TestHub {
  app: NestFastifyApplication;
  state: HubStateService;
  snapshots: SnapshotSyncService;
  dataDir: string;
  close: () => Promise<void>;
}

export async function startHub(
  dataDir = mkdtempSync(join(tmpdir(), 'pos-hub-')),
): Promise<TestHub> {
  const config = loadHubConfig({
    ...process.env,
    NODE_ENV: 'test',
    HUB_DATA_DIR: dataDir,
    HUB_SNAPSHOT_INTERVAL_SECONDS: '0',
    HUB_CLOUD_TIMEOUT_MS: '2000',
    HUB_CORS_ORIGINS: 'http://localhost:5174',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
  });
  const app = await createHub(config);
  return {
    app,
    state: app.get(HubStateService),
    snapshots: app.get(SnapshotSyncService),
    dataDir,
    close: async () => {
      await app.close();
    },
  };
}

export async function pair(hub: TestHub, cloud: FakeCloud): Promise<void> {
  if (!cloud.snapshot) throw new Error('cloud has no snapshot');
  await hub.state.set('pairing', {
    cloudUrl: cloud.url,
    deviceId: 'device-id',
    credential: cloud.credential,
    restaurantId: cloud.snapshot.restaurantId,
    locationId: cloud.snapshot.locationId,
    pairedAt: new Date().toISOString(),
  });
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
