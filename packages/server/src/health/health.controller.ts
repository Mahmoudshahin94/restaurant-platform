import { Controller, Get, HttpCode } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import { Public } from '../common/auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

/** Liveness (`/health`) and readiness (`/ready`, checks the database). Not versioned. */
@Public()
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  @HttpCode(200)
  health(): { status: 'ok' } {
    return { status: 'ok' };
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
