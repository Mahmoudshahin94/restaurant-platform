import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PlatformErrorEvent } from '@pos/database';
import {
  APP_CONFIG,
  type AppConfig,
  type ErrorEventSink,
  ErrorSampler,
  PrismaService,
  type ServerErrorEvent,
  loggableError,
} from '@pos/server';
import type { PlatformErrorEventDto } from '@pos/validation';

export function toErrorEventDto(row: PlatformErrorEvent): PlatformErrorEventDto {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    service: row.service,
    status: row.status,
    code: row.code,
    method: row.method,
    route: row.route,
    message: row.message,
    suppressed: row.suppressed,
    tenantId: row.subjectTenantId,
    locationId: row.locationId,
    requestId: row.requestId,
  };
}

/**
 * The cloud's error-event sink (ADR 0025): every 5xx answer the exception filter hands over is
 * stored as a `PlatformErrorEvent` for the health board, at most `PLATFORM_ERROR_SAMPLE_PER_MINUTE`
 * per route and code each minute (the next stored one counts what was dropped). Writing happens
 * in the background and never fails the answer.
 */
@Injectable()
export class PlatformErrorEventsService implements ErrorEventSink {
  private readonly logger = new Logger(PlatformErrorEventsService.name);
  private readonly sampler: ErrorSampler;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.sampler = new ErrorSampler(config.PLATFORM_ERROR_SAMPLE_PER_MINUTE);
  }

  record(event: ServerErrorEvent): void {
    const { keep, suppressed } = this.sampler.admit(`${event.route} ${event.code}`);
    if (!keep) return;
    void this.prisma.platformErrorEvent
      .create({
        data: {
          service: 'api',
          status: event.status,
          code: event.code,
          method: event.method,
          route: event.route,
          message: event.message,
          suppressed,
          subjectTenantId: event.tenantId,
          locationId: event.locationId,
          requestId: event.requestId,
        },
      })
      .catch((error: unknown) => {
        this.logger.warn(`Could not store an error event: ${loggableError(error).message}`);
      });
  }

  async recent(options: {
    tenantId?: string;
    limit: number;
    since?: Date;
  }): Promise<PlatformErrorEventDto[]> {
    const rows = await this.prisma.platformErrorEvent.findMany({
      where: {
        ...(options.tenantId ? { subjectTenantId: options.tenantId } : {}),
        ...(options.since ? { createdAt: { gte: options.since } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.limit,
    });
    return rows.map(toErrorEventDto);
  }
}
