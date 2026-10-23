import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { TenantFilesController } from '../files/tenant-files.controller';
import { TenantFilesService } from '../files/tenant-files.service';
import { LocalDiskTenantFileStorage, TENANT_FILE_STORAGE } from '../files/tenant-file-storage';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

/**
 * Branding and tenant files (ADR 0019): global, so the tenant context, the storefront and the hub
 * resolve branding the same way. Files live on the local disk (`FILE_STORAGE_DIR`) until an
 * object-store adapter is configured.
 */
@Global()
@Module({
  controllers: [BrandingController, TenantFilesController],
  providers: [
    {
      provide: TENANT_FILE_STORAGE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new LocalDiskTenantFileStorage(config.FILE_STORAGE_DIR),
    },
    TenantFilesService,
    BrandingService,
  ],
  exports: [TENANT_FILE_STORAGE, TenantFilesService, BrandingService],
})
export class BrandingModule {}
