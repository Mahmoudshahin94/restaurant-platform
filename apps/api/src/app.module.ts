import { type DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthGuard } from './common/auth/auth.guard';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { RequestContextInterceptor } from './common/context/request-context.interceptor';
import { ConfigModule } from './config/config.module';
import type { AppConfig } from './config/env';
import { HealthController } from './health/health.controller';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { LocationsModule } from './modules/locations/locations.module';
import { FloorModule } from './modules/floor/floor.module';
import { MenuModule } from './modules/menu/menu.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { PricingConfigModule } from './modules/pricing-config/pricing-config.module';
import { RestaurantsModule } from './modules/restaurants/restaurants.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        PrismaModule,
        AuditModule,
        AuthModule,
        RestaurantsModule,
        LocationsModule,
        MenuModule,
        PricingConfigModule,
        FloorModule,
        OrdersModule,
        PaymentsModule,
        ShiftsModule,
        ReportsModule,
      ],
      controllers: [HealthController],
      providers: [
        // Order matters: authenticate first, then authorize.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
      ],
    };
  }
}
