import { type DynamicModule, Global, Module } from '@nestjs/common';
import { SERVER_MODE, type ServerMode } from '../common/auth/managed-in-cloud';
import { APP_CONFIG, type AppConfig } from './env';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig, mode: ServerMode): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: SERVER_MODE, useValue: mode },
      ],
      exports: [APP_CONFIG, SERVER_MODE],
    };
  }
}
