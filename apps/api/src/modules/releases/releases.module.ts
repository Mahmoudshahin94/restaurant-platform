import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ClientVersionGuard } from './client-version.guard';
import { ReleasePolicyService } from './release-policy.service';

/**
 * The cloud's version rules (ADR 0026): which hubs and apps it still serves. Global, because the
 * hub's `DeviceGuard` and the platform's releases pages read the same policy.
 */
@Global()
@Module({
  providers: [ReleasePolicyService, { provide: APP_GUARD, useClass: ClientVersionGuard }],
  exports: [ReleasePolicyService],
})
export class ReleasesModule {}
