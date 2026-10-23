import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type AppConfig, loadConfig } from '@pos/server';
import { z } from 'zod';

const hubEnvSchema = z.object({
  HUB_PORT: z.coerce.number().int().positive().default(4000),
  HUB_HOST: z.string().default('0.0.0.0'),
  /** Where the hub keeps its SQLite database and its signing key. Back this directory up. */
  HUB_DATA_DIR: z.string().default('.hub-data'),
  /** Browser origins of LAN clients using cookie sessions (KDS). */
  HUB_CORS_ORIGINS: z.string().default(''),
  /**
   * Safety-net refresh of the location snapshot; configuration changes normally arrive through the
   * change feed within seconds. 0 = never.
   */
  HUB_SNAPSHOT_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(1800),
  HUB_CLOUD_TIMEOUT_MS: z.coerce.number().int().min(500).default(10_000),
  /** Run the sync engine (push the outbox, follow the change feed). Off only in tests. */
  HUB_SYNC_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Long-poll wait of the change feed. */
  HUB_PULL_WAIT_SECONDS: z.coerce.number().int().min(0).max(30).default(25),
  /** Backoff while the cloud is unreachable: full jitter between these bounds. */
  HUB_SYNC_RETRY_BASE_MS: z.coerce.number().int().min(10).default(2000),
  HUB_SYNC_RETRY_MAX_MS: z.coerce.number().int().min(100).default(60_000),
  /** Completed outbox rows keep their payload this long, then only the row itself is kept. */
  HUB_OUTBOX_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  /** Optional fixed signing key; otherwise one is generated on first start and kept in the data dir. */
  HUB_JWT_SECRET: z.string().min(32).optional(),
});

export interface HubConfig {
  dataDir: string;
  databaseFile: string;
  snapshotIntervalSeconds: number;
  cloudTimeoutMs: number;
  sync: {
    enabled: boolean;
    pullWaitSeconds: number;
    retryBaseMs: number;
    retryMaxMs: number;
    retentionDays: number;
  };
}

export const HUB_CONFIG = Symbol('HUB_CONFIG');

/** The hub's own signing key: tokens it issues are valid only on this hub. */
function signingKey(dataDir: string): string {
  const file = resolve(dataDir, 'jwt-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const key = randomBytes(48).toString('base64url');
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}

/**
 * Hub configuration. Shared server settings (token lifetimes, rate limits, log level) use the same
 * variables as the cloud API; hub-specific ones are prefixed `HUB_` so both can run from one
 * development `.env`.
 */
export function loadHubConfig(env: NodeJS.ProcessEnv = process.env): {
  app: AppConfig;
  hub: HubConfig;
} {
  const parsed = hubEnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid hub configuration: ${problems}`);
  }
  const hubEnv = parsed.data;
  const dataDir = resolve(hubEnv.HUB_DATA_DIR);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const databaseFile = resolve(dataDir, 'hub.db');
  const app = loadConfig({
    ...env,
    API_PORT: String(hubEnv.HUB_PORT),
    API_HOST: hubEnv.HUB_HOST,
    // One connection: SQLite then runs interactive transactions strictly one at a time.
    DATABASE_URL: `file:${databaseFile}?connection_limit=1&socket_timeout=20`,
    JWT_ACCESS_SECRET: hubEnv.HUB_JWT_SECRET ?? signingKey(dataDir),
    CORS_ORIGINS: hubEnv.HUB_CORS_ORIGINS,
    // The tenant's logos and favicons, copied from the snapshot (ADR 0019).
    FILE_STORAGE_DIR: resolve(dataDir, 'files'),
  });
  return {
    app,
    hub: {
      dataDir,
      databaseFile,
      snapshotIntervalSeconds: hubEnv.HUB_SNAPSHOT_INTERVAL_SECONDS,
      cloudTimeoutMs: hubEnv.HUB_CLOUD_TIMEOUT_MS,
      sync: {
        enabled: hubEnv.HUB_SYNC_ENABLED,
        pullWaitSeconds: hubEnv.HUB_PULL_WAIT_SECONDS,
        retryBaseMs: hubEnv.HUB_SYNC_RETRY_BASE_MS,
        retryMaxMs: hubEnv.HUB_SYNC_RETRY_MAX_MS,
        retentionDays: hubEnv.HUB_OUTBOX_RETENTION_DAYS,
      },
    },
  };
}
