import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService, RequirePermissions, ZodValidationPipe } from '@pos/server';
import { type SyncIssue, idSchema } from '@pos/validation';

/** Operations the cloud refused from a location's hub, newest first, for administrators. */
@Controller('locations/:locationId/sync')
export class SyncIssuesController {
  constructor(private readonly prisma: PrismaService) {}

  @RequirePermissions(['sync.view'])
  @Get('issues')
  async issues(
    @Param('locationId', new ZodValidationPipe(idSchema)) locationId: string,
  ): Promise<SyncIssue[]> {
    const rows = await this.prisma.processedOperation.findMany({
      where: { locationId, status: { in: ['CONFLICT', 'REJECTED'] } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({
      operationId: r.operationId,
      deviceId: r.deviceId,
      entityType: r.entityType,
      entityId: r.entityId,
      operationType: r.operationType,
      entityVersion: r.entityVersion,
      status: r.status === 'CONFLICT' ? 'CONFLICT' : 'REJECTED',
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      attempts: r.attempts,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}
