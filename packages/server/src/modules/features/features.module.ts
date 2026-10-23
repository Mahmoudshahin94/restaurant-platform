import { Global, Module } from '@nestjs/common';
import { FeatureService } from './feature.service';
import { FeatureSettingsService } from './feature-settings.service';
import { FeaturesController } from './features.controller';

/** Modules (ADR 0018): global, so any service can ask whether a module is on. */
@Global()
@Module({
  controllers: [FeaturesController],
  providers: [FeatureService, FeatureSettingsService],
  exports: [FeatureService],
})
export class FeaturesModule {}
