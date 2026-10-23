import { Inject, Injectable } from '@nestjs/common';
import type { Location } from '@pos/database';
import { type OnlineOrderingStatus, onlineOrderingStatus, parseOpeningHours } from '@pos/domain';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * What customers see for a location right now: the tenant's setting and hours, and whether
 * its hub is talking to the cloud (the latest `lastSeenAt` of its active hub devices).
 */
@Injectable()
export class OnlineStatusService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async hubLastSeenAt(locationId: string): Promise<Date | null> {
    const seen = await this.prisma.device.aggregate({
      where: { locationId, type: 'GATEWAY', status: 'ACTIVE' },
      _max: { lastSeenAt: true },
    });
    return seen._max.lastSeenAt;
  }

  async statusOf(location: Location, now = new Date()): Promise<OnlineOrderingStatus> {
    return onlineOrderingStatus({
      setting: location.onlineOrderingState,
      isActive: location.isActive,
      openingHours: parseOpeningHours(location.openingHours),
      timeZone: location.timezone,
      hubLastSeenAt: await this.hubLastSeenAt(location.id),
      hubStaleAfterMs: this.config.HUB_HEARTBEAT_STALE_SECONDS * 1000,
      now,
    });
  }
}
