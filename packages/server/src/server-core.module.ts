import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard } from './common/auth/auth.guard';
import { ManagedInCloudGuard, type ServerMode } from './common/auth/managed-in-cloud';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { FeatureGuard } from './common/auth/require-feature';
import { RequestContextInterceptor } from './common/context/request-context.interceptor';
import { ConfigModule } from './config/config.module';
import type { AppConfig } from './config/env';
import { HealthController } from './health/health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { FeaturesModule } from './modules/features/features.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { type DatabaseOptions, PrismaModule } from './prisma/prisma.module';

export interface ServerCoreOptions {
  config: AppConfig;
  mode: ServerMode;
  /** The database client and its SQL dialect (PostgreSQL in the cloud, SQLite on the hub). */
  database: DatabaseOptions;
}

/**
 * Infrastructure every server deployment needs: configuration, database, audit, authentication,
 * deny-by-default authorization, modules, request context, realtime and health checks. Feature modules
 * (orders, payments, kitchen, …) are added by each app.
 */
@Module({})
export class ServerCoreModule {
  static forRoot(options: ServerCoreOptions): DynamicModule {
    return {
      module: ServerCoreModule,
      imports: [
        ConfigModule.forRoot(options.config, options.mode),
        // The cloud holds every tenant: a tenant query without a tenant in scope is refused. The
        // hub's database holds only its own tenant (ADR 0017).
        PrismaModule.forRoot(options.database, options.mode === 'hub' ? 'allow' : 'refuse'),
        AuditModule,
        AuthModule,
        FeaturesModule,
        RealtimeModule,
      ],
      controllers: [HealthController],
      providers: [
        // Order matters: authenticate first, then authorize, then check the route's modules.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_GUARD, useClass: FeatureGuard },
        { provide: APP_GUARD, useClass: ManagedInCloudGuard },
        { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
      ],
    };
  }
}
