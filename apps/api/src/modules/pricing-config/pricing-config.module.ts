import { Module } from '@nestjs/common';
import { DiscountsController, TaxesController } from './pricing-config.controllers';
import { PricingConfigService } from './pricing-config.service';

/** Pricing configuration: taxes and predefined discounts. */
@Module({
  controllers: [TaxesController, DiscountsController],
  providers: [PricingConfigService],
})
export class PricingConfigModule {}
