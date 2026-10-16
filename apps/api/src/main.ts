import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './bootstrap';
import { loadConfig } from './config/env';

async function main(): Promise<void> {
  // Local development reads the repo-root .env; deployments inject real environment variables.
  const envFile = resolve(__dirname, '../../../.env');
  if (process.env.NODE_ENV !== 'production' && existsSync(envFile)) process.loadEnvFile(envFile);

  const config = loadConfig();
  const app = await createApp(config);
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
}

void main();
