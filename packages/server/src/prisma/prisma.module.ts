import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
  type Provider,
  type Type,
} from '@nestjs/common';
import { type WithoutTenant, scopeToTenant } from '../common/tenancy/scoped-prisma';
import { ChangeRecorder, NoopChangeRecorder } from './change-recorder';
import { PostgresDialect, SqlDialect, SqliteDialect } from './dialect';
import { PrismaService } from './prisma.service';

@Injectable()
class PrismaLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export interface DatabaseOptions {
  /** Provides `PrismaService`: a factory returning the app's Prisma client. */
  client: Omit<Extract<Provider, { useFactory: unknown }>, 'provide'>;
  dialect: 'postgres' | 'sqlite';
  /** Where changes leaving this node are captured (default: nowhere, i.e. the cloud). */
  changeRecorder?: Type<ChangeRecorder>;
}

@Global()
@Module({})
export class PrismaModule {
  static forRoot(options: DatabaseOptions, withoutTenant: WithoutTenant): DynamicModule {
    const { useFactory, inject } = options.client;
    return {
      module: PrismaModule,
      providers: [
        {
          // Every service receives the tenant-scoped client (ADR 0017).
          provide: PrismaService,
          useFactory: async (...deps: unknown[]) =>
            scopeToTenant((await useFactory(...deps)) as object, withoutTenant),
          ...(inject ? { inject } : {}),
        },
        {
          provide: SqlDialect,
          useClass: options.dialect === 'sqlite' ? SqliteDialect : PostgresDialect,
        },
        { provide: ChangeRecorder, useClass: options.changeRecorder ?? NoopChangeRecorder },
        PrismaLifecycle,
      ],
      exports: [PrismaService, SqlDialect, ChangeRecorder],
    };
  }
}
