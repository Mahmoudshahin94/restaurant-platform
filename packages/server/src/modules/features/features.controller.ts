import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import type { Feature, FeatureSetting } from '@pos/shared-types';
import {
  featureSchema,
  featureScopeQuerySchema,
  idSchema,
  setFeatureOverrideSchema,
} from '@pos/validation';
import type { z } from 'zod';
import { RequirePermissions } from '../../common/auth/decorators';
import { ManagedInCloud } from '../../common/auth/managed-in-cloud';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { FeatureSettingsService } from './feature-settings.service';

const id = new ZodValidationPipe(idSchema);

/** The admin's Modules page: what each module resolves to, and the tenant's overrides. */
@ManagedInCloud()
@Controller('tenants/:tenantId/features')
export class FeaturesController {
  constructor(private readonly settings: FeatureSettingsService) {}

  @RequirePermissions(['settings.manage'])
  @Get()
  list(
    @Param('tenantId', id) tenantId: string,
    @Query(new ZodValidationPipe(featureScopeQuerySchema))
    query: z.output<typeof featureScopeQuerySchema>,
  ): Promise<FeatureSetting[]> {
    return this.settings.list(tenantId, query);
  }

  /** Switches a module for the scope in the body; `enabled: null` inherits again. */
  @RequirePermissions(['settings.manage'])
  @Put(':feature')
  set(
    @Param('tenantId', id) tenantId: string,
    @Param('feature', new ZodValidationPipe(featureSchema)) feature: Feature,
    @Body(new ZodValidationPipe(setFeatureOverrideSchema))
    body: z.output<typeof setFeatureOverrideSchema>,
  ): Promise<FeatureSetting[]> {
    return this.settings.set(tenantId, feature, body);
  }
}
