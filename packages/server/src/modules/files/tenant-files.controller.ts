import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import type { TenantFileKind } from '@pos/shared-types';
import { type TenantFileDto, idSchema, uploadTenantFileQuerySchema } from '@pos/validation';
import type { FastifyReply } from 'fastify';
import { RequirePermissions } from '../../common/auth/decorators';
import { ManagedInCloud } from '../../common/auth/managed-in-cloud';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { sendTenantFile } from './file-response';
import { TenantFilesService } from './tenant-files.service';

const id = new ZodValidationPipe(idSchema);

/**
 * The tenant's files (ADR 0019). Uploads are the image bytes as the request body, with their
 * type as `Content-Type`; the admin uploads in the cloud. Any member of the tenant may read a
 * file, on the cloud and on the hub (which has the files its branding refers to).
 */
@ManagedInCloud()
@Controller('tenants/:tenantId/files')
export class TenantFilesController {
  constructor(private readonly files: TenantFilesService) {}

  @RequirePermissions(['settings.manage'])
  @Post()
  upload(
    @Param('tenantId', id) tenantId: string,
    @Query(new ZodValidationPipe(uploadTenantFileQuerySchema)) query: { kind: TenantFileKind },
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<TenantFileDto> {
    return this.files.upload(tenantId, query.kind, contentType, body);
  }

  @RequirePermissions(['settings.manage'])
  @Get()
  list(@Param('tenantId', id) tenantId: string): Promise<TenantFileDto[]> {
    return this.files.list(tenantId);
  }

  @RequirePermissions([])
  @Get(':fileId/content')
  async content(
    @Param('tenantId', id) tenantId: string,
    @Param('fileId', id) fileId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const { file, bytes } = await this.files.content(tenantId, fileId);
    return sendTenantFile(reply, file, bytes, 'private');
  }
}
