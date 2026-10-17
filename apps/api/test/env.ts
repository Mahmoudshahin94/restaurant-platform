import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { type AppConfig, loadConfig } from '@pos/server';

const ROOT_ENV = resolve(__dirname, '../../../.env');

/** Test configuration: the repo .env, pointed at TEST_DATABASE_URL, with generous rate limits. */
export function testConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
  const testDb = process.env.TEST_DATABASE_URL;
  if (!testDb) throw new Error('TEST_DATABASE_URL is required for integration tests');
  return loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: testDb,
    CORS_ORIGINS: 'http://localhost:5173',
    RATE_LIMIT_PER_MINUTE: '100000',
    AUTH_RATE_LIMIT_PER_MINUTE: '100000',
    ...overrides,
  });
}
