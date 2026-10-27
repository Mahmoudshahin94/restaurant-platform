import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type AppConfig, type ServerAppOptions, createServerApp } from '@pos/server';
import { AppModule } from './app.module';

/** Builds the cloud API. Shared by `main.ts` and the integration tests. */
export function createApp(
  config: AppConfig,
  options: Pick<ServerAppOptions, 'logStream'> = {},
): Promise<NestFastifyApplication> {
  return createServerApp(AppModule.forRoot(config), config, { serviceName: 'api', ...options });
}
