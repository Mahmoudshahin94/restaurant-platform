import { Controller, Get, HttpCode } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import { MADAR_VERSION } from '@pos/shared-types';
import { Public } from '../common/auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Liveness (`/health`, with the MADAR version this server runs, ADR 0026) and readiness (`/ready`,
 * checks the database). Not under the versioned API prefix.
 */
@Public()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok'; version: string } {
    return { status: 'ok', version: MADAR_VERSION };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ready'; database: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new DomainError('SERVICE_UNAVAILABLE', 'Database unavailable');
    }
    return { status: 'ready', database: 'ok' };
  }
}
