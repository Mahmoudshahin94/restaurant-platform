import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createServerApp } from '@pos/server';
import type { loadHubConfig } from './config';
import { HubModule } from './hub.module';

/** Builds the location hub. Shared by `main.ts` and the tests. */
export function createHub(
  config: ReturnType<typeof loadHubConfig>,
): Promise<NestFastifyApplication> {
  return createServerApp(HubModule.forRoot(config), config.app, { serviceName: 'hub' });
}
