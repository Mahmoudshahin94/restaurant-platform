import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService, RealtimeBus } from '@pos/server';
import { locationSnapshotSchema } from '@pos/validation';
import { HUB_CONFIG, type HubConfig } from '../config';
import { asHubTx } from '../database/hub-database';
import { HubStateService } from '../hub-state.service';
import { applySnapshot } from './apply-snapshot';

export type SnapshotOutcome = 'applied' | 'unchanged' | 'offline' | 'rejected' | 'not-paired';

/**
 * Keeps the hub's copy of the location configuration current: pulls the snapshot from the cloud
 * at start-up and then periodically. Without the cloud the hub keeps serving its last copy; the
 * POS and KDS never notice. The sync engine calls it whenever the change feed reports a
 * configuration change; the timer is only a safety net (ADR 0012).
 */
@Injectable()
export class SnapshotSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SnapshotSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<SnapshotOutcome> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: HubStateService,
    private readonly bus: RealtimeBus,
    @Inject(HUB_CONFIG) private readonly config: HubConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.snapshotIntervalSeconds === 0) return;
    void this.syncNow();
    this.timer = setInterval(() => void this.syncNow(), this.config.snapshotIntervalSeconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Single-flight: concurrent callers share one pull. */
  syncNow(): Promise<SnapshotOutcome> {
    this.running ??= this.pull().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async pull(): Promise<SnapshotOutcome> {
    this.state.invalidate();
    const pairing = await this.state.get('pairing');
    if (!pairing) return 'not-paired';
    const current = await this.state.get('snapshot');

    let response: Response;
    try {
      response = await fetch(`${pairing.cloudUrl}/api/v1/sync/snapshot`, {
        headers: {
          authorization: `Device ${pairing.credential}`,
          'x-client-source': 'HUB',
          ...(current ? { 'if-none-match': `"${current.version}"` } : {}),
        },
        signal: AbortSignal.timeout(this.config.cloudTimeoutMs),
      });
    } catch (error) {
      this.state.markCloud('OFFLINE', error instanceof Error ? error.message : String(error));
      return 'offline';
    }

    if (response.status === 304) {
      this.state.markCloud('ONLINE');
      return 'unchanged';
    }
    if (response.status === 401 || response.status === 403) {
      // The device was disabled or re-paired in the cloud: keep serving, but say so loudly.
      this.state.markCredentialRejected('The cloud rejected this hub’s credential (re-pair it)');
      this.logger.error('Cloud rejected the hub credential');
      return 'rejected';
    }
    if (!response.ok) {
      this.state.markCloud('OFFLINE', `Cloud answered ${String(response.status)}`);
      return 'offline';
    }

    const snapshot = locationSnapshotSchema.parse(await response.json());
    if (snapshot.locationId !== pairing.locationId) {
      this.state.markCloud('ONLINE', 'Snapshot for another location');
      return 'rejected';
    }
    await this.prisma.$transaction(
      async (tx) => {
        await applySnapshot(asHubTx(tx), snapshot);
        await this.state.set(
          'snapshot',
          {
            version: snapshot.version,
            generatedAt: snapshot.generatedAt,
            appliedAt: new Date().toISOString(),
          },
          tx,
        );
      },
      { timeout: 60_000 },
    );
    this.state.markCloud('ONLINE');
    this.bus.publish([
      this.bus.event(
        'menu.updated',
        { tenantId: pairing.tenantId, locationId: pairing.locationId },
        { locationId: pairing.locationId, version: snapshot.version },
      ),
    ]);
    this.logger.log(`Applied location snapshot ${snapshot.version}`);
    return 'applied';
  }
}
