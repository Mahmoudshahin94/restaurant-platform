import { mkdtempSync, rmSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  ChangeEntry,
  LocationSnapshot,
  SyncOperationResult,
  SyncOrder,
  SyncPushRequest,
  SyncResolution,
} from '@pos/validation';
import { createHub } from '../src/bootstrap';
import { loadHubConfig } from '../src/config';
import { HubStateService } from '../src/hub-state.service';
import { SnapshotSyncService } from '../src/snapshot/snapshot-sync.service';
import { SyncEngineService } from '../src/sync/sync-engine.service';

type PushOperation = SyncPushRequest['operations'][number];

/**
 * A stand-in for the cloud's `/sync/*` endpoints: snapshot, push (answers APPLIED unless told
 * otherwise, DUPLICATE for repeats) and the change feed. Switchable between up, down (stopped),
 * failing (HTTP 500) and rejecting the credential.
 */
export class FakeCloud {
  snapshot: LocationSnapshot | null = null;
  /** `suspended`: the platform suspended the hub's business (ADR 0025). */
  mode: 'up' | 'reject' | 'error' | 'suspended' = 'up';
  requests = 0;
  /** Every push request received, in order. */
  pushes: SyncPushRequest[] = [];
  /** Operation ids the cloud has applied (to answer DUPLICATE). */
  readonly applied = new Set<string>();
  /** Override the answer for an operation; default APPLIED (or DUPLICATE). */
  answer: (op: PushOperation) => Partial<SyncOperationResult> | null = () => null;
  /** The change feed; seq numbers are the array index + 1. */
  readonly changes: ChangeEntry[] = [];
  /** Website orders the cloud serves at `/sync/orders/:id` (the ORDER topic). */
  readonly orders = new Map<string, SyncOrder>();
  /** Administrators' decisions served at `/sync/resolutions/:operationId` (ADR 0014). */
  readonly resolutions = new Map<string, SyncResolution>();
  readonly credential = 'device-id.secret-value';
  private server: Server | null = null;
  url = '';

  addChange(topic: ChangeEntry['topic'] = 'CONFIG', entityId: string | null = null): void {
    this.changes.push({
      seq: String(this.changes.length + 1),
      topic,
      entityId,
      createdAt: new Date().toISOString(),
    });
  }

  /** The cloud created or changed a website order: serve it and announce it on the feed. */
  publishOrder(order: SyncOrder): void {
    this.orders.set(order.id, order);
    this.addChange('ORDER', order.id);
  }

  /** An administrator settled a refused operation: serve the decision and announce it. */
  publishResolution(decision: SyncResolution): void {
    this.resolutions.set(decision.operationId, decision);
    this.addChange('RESOLUTION', decision.operationId);
  }

  /** Operations of every push, flattened. */
  get pushed(): PushOperation[] {
    return this.pushes.flatMap((p) => p.operations);
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.requests += 1;
      const url = new URL(req.url ?? '/', 'http://cloud');
      const json = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (this.mode === 'reject' || req.headers.authorization !== `Device ${this.credential}`) {
        return void json(401, { code: 'UNAUTHENTICATED' });
      }
      if (this.mode === 'error') return void json(500, { code: 'INTERNAL_ERROR' });
      if (this.mode === 'suspended') return void json(403, { code: 'TENANT_SUSPENDED' });
      const orderPath = /^\/api\/v1\/sync\/orders\/([^/]+)$/.exec(url.pathname);
      if (orderPath) {
        const order = this.orders.get(decodeURIComponent(orderPath[1] ?? ''));
        if (order) json(200, order);
        else json(404, { code: 'ORDER_NOT_FOUND' });
        return;
      }
      const resolutionPath = /^\/api\/v1\/sync\/resolutions\/([^/]+)$/.exec(url.pathname);
      if (resolutionPath) {
        const decision = this.resolutions.get(decodeURIComponent(resolutionPath[1] ?? ''));
        if (decision) json(200, decision);
        else json(404, { code: 'SYNC_ISSUE_NOT_FOUND' });
        return;
      }
      switch (url.pathname) {
        case '/api/v1/sync/snapshot': {
          const etag = `"${this.snapshot?.version ?? ''}"`;
          if (req.headers['if-none-match'] === etag) return void res.writeHead(304).end();
          res.writeHead(200, { 'content-type': 'application/json', etag });
          return void res.end(JSON.stringify(this.snapshot));
        }
        case '/api/v1/sync/pull': {
          const cursor = url.searchParams.get('cursor');
          if (cursor === null) {
            return void json(200, {
              changes: [],
              cursor: String(this.changes.length),
              hasMore: false,
            });
          }
          const changes = this.changes.slice(Number(cursor));
          return void json(200, {
            changes,
            cursor: changes.at(-1)?.seq ?? cursor,
            hasMore: false,
          });
        }
        case '/api/v1/sync/push': {
          let body = '';
          req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
          req.on('end', () => {
            const request = JSON.parse(body) as SyncPushRequest;
            this.pushes.push(request);
            const results = request.operations.map((op) => {
              const custom = this.answer(op);
              if (custom) {
                return { operationId: op.operationId, code: null, message: null, ...custom };
              }
              const status = this.applied.has(op.operationId) ? 'DUPLICATE' : 'APPLIED';
              this.applied.add(op.operationId);
              return { operationId: op.operationId, status, code: null, message: null };
            });
            void json(200, { results });
          });
          return;
        }
        default:
          return void json(404, { code: 'NOT_FOUND' });
      }
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
  engine: SyncEngineService;
  dataDir: string;
  close: () => Promise<void>;
}

/** Starts a hub on a temporary data directory. Its background sync loops are off unless asked. */
export async function startHub(
  dataDir = mkdtempSync(join(tmpdir(), 'pos-hub-')),
  env: Record<string, string> = {},
): Promise<TestHub> {
  const config = loadHubConfig({
    ...process.env,
    NODE_ENV: 'test',
    HUB_DATA_DIR: dataDir,
    HUB_SNAPSHOT_INTERVAL_SECONDS: '0',
    HUB_CLOUD_TIMEOUT_MS: '2000',
    HUB_CORS_ORIGINS: 'http://localhost:5174',
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    HUB_SYNC_ENABLED: 'false',
    HUB_PULL_WAIT_SECONDS: '0',
    HUB_SYNC_RETRY_BASE_MS: '20',
    HUB_SYNC_RETRY_MAX_MS: '200',
    // Kiosk card payments without a provider account of their own (ADR 0024).
    DEV_PAYMENT_PROVIDERS: 'mock-terminal',
    ...env,
  });
  const app = await createHub(config);
  return {
    app,
    state: app.get(HubStateService),
    snapshots: app.get(SnapshotSyncService),
    engine: app.get(SyncEngineService),
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
    tenantId: cloud.snapshot.tenantId,
    locationId: cloud.snapshot.locationId,
    pairedAt: new Date().toISOString(),
  });
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
