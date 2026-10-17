import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHub } from './bootstrap';
import { loadHubConfig } from './config';

async function main(): Promise<void> {
  // Local development reads the repo-root .env; installations set real environment variables.
  const envFile = resolve(__dirname, '../../../.env');
  if (process.env.NODE_ENV !== 'production' && existsSync(envFile)) process.loadEnvFile(envFile);

  const config = loadHubConfig();
  const hub = await createHub(config);
  await hub.listen({ port: config.app.API_PORT, host: config.app.API_HOST });
}

void main();
