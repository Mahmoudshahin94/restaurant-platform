import { Module } from '@nestjs/common';
import { MenuModule } from '../menu/menu.module';
import { PaymentsModule } from '../payments/payments.module';
import { WebsiteModule } from '../website/website.module';
import {
  OnlineOrderingSettingsController,
  SiteController,
  WebOrdersController,
} from './online-ordering.controllers';
import { OnlinePaymentsService } from './online-payments.service';
import { OnlineStatusService } from './online-status.service';
import { SiteLocations } from './site-locations';
import { StorefrontService } from './storefront.service';
import { WebOrdersService } from './web-orders.service';

/**
 * Online ordering (Phase 7, ADR 0013), on the tenant's own website (ADR 0023). **Cloud only**: website orders are created in the cloud and
 * reach the hub through the change feed, so the hub never loads this module (it also uses the
 * cloud-only `web_order_counters` table).
 */
@Module({
  imports: [MenuModule, PaymentsModule, WebsiteModule],
  controllers: [SiteController, WebOrdersController, OnlineOrderingSettingsController],
  providers: [
    OnlineStatusService,
    OnlinePaymentsService,
    SiteLocations,
    StorefrontService,
    WebOrdersService,
  ],
  exports: [OnlinePaymentsService, WebOrdersService, OnlineStatusService],
})
export class OnlineOrderingModule {}
