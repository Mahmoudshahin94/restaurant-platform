import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MenuModule } from '../menu/menu.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { TenantsModule } from '../tenants/tenants.module';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';

/**
 * The self-service kiosk's routes (ADR 0022). **Hub only**: a kiosk is a LAN client of its
 * location hub, authenticated by the credential the hub issued, so it keeps working offline.
 */
@Module({
  imports: [AuthModule, MenuModule, OrdersModule, PaymentsModule, TenantsModule],
  controllers: [KioskController],
  providers: [KioskService],
})
export class KioskModule {}
