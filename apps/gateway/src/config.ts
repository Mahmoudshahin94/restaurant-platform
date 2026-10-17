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
  /** How often to refresh the location snapshot from the cloud while online; 0 = never. */
  HUB_SNAPSHOT_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(300),
  HUB_CLOUD_TIMEOUT_MS: z.coerce.number().int().min(500).default(10_000),
  /** Optional fixed signing key; otherwise one is generated on first start and kept in the data dir. */
  HUB_JWT_SECRET: z.string().min(32).optional(),
});

export interface HubConfig {
  dataDir: string;
  databaseFile: string;
  snapshotIntervalSeconds: number;
  cloudTimeoutMs: number;
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
  });
  return {
    app,
    hub: {
      dataDir,
      databaseFile,
      snapshotIntervalSeconds: hubEnv.HUB_SNAPSHOT_INTERVAL_SECONDS,
      cloudTimeoutMs: hubEnv.HUB_CLOUD_TIMEOUT_MS,
    },
  };
}
