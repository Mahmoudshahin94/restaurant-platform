import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type AppConfig, createServerApp } from '@pos/server';
import { AppModule } from './app.module';

/** Builds the cloud API. Shared by `main.ts` and the integration tests. */
export function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  return createServerApp(AppModule.forRoot(config), config, { serviceName: 'api' });
}
