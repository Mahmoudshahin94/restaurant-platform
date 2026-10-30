import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  PrismaService,
  RealtimeBus,
  TENANT_FILE_STORAGE,
  type TenantFileStorage,
} from '@pos/server';
import { locationSnapshotSchema } from '@pos/validation';
import { HUB_CONFIG, type HubConfig } from '../config';
import { asHubTx } from '../database/hub-database';
import { HubStateService, type Pairing } from '../hub-state.service';
import { applySnapshot, belongsToTenant, storeSnapshotFiles } from './apply-snapshot';
import { fetchProductPictures } from './product-pictures';
import { hubHeaders, tenantRefusalOf, upgradeRefusalOf } from '../sync/cloud-client';

export type SnapshotOutcome =
  'applied' | 'unchanged' | 'offline' | 'rejected' | 'not-paired' | 'upgrade-required';

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
    @Inject(TENANT_FILE_STORAGE) private readonly storage: TenantFileStorage,
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
          ...hubHeaders(pairing.credential),
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
      // Pictures a previous pull could not fetch are tried again.
      void this.pictures(pairing, current?.version ?? null);
      return 'unchanged';
    }
    const upgrade = await upgradeRefusalOf(response);
    if (upgrade) {
      // The cloud no longer serves this version (ADR 0026): keep serving from the last snapshot,
      // which this version understands, until the hub is updated.
      this.state.markUpgradeRequired(upgrade.minimumVersion, upgrade.message);
      this.logger.error(upgrade.message);
      return 'upgrade-required';
    }
    const refusal = await tenantRefusalOf(response);
    if (refusal) {
      // The platform suspended the business (ADR 0025): keep serving from the last snapshot.
      this.state.markCloud('OFFLINE', `The platform refused this business (${refusal})`);
      return 'offline';
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
    if (
      snapshot.locationId !== pairing.locationId ||
      !belongsToTenant(snapshot, pairing.tenantId)
    ) {
      this.state.markCloud('ONLINE', 'Snapshot for another tenant or location');
      return 'rejected';
    }
    if (!(await storeSnapshotFiles(this.storage, snapshot))) {
      this.state.markCloud('ONLINE', 'Snapshot file does not match its checksum');
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
    void this.pictures(pairing, snapshot.version);
    return 'applied';
  }

  /**
   * Fetches the product pictures the menu names and the hub lacks (ADR 0027), after the snapshot
   * so a slow download never holds the menu back; screens reload their menu when some arrived.
   */
  private async pictures(pairing: Pairing, version: string | null): Promise<void> {
    try {
      const stored = await fetchProductPictures(
        asHubTx(this.prisma),
        this.storage,
        pairing,
        this.config.cloudTimeoutMs,
      );
      if (stored === 0) return;
      this.logger.log(`Stored ${String(stored)} product picture(s)`);
      this.bus.publish([
        this.bus.event(
          'menu.updated',
          { tenantId: pairing.tenantId, locationId: pairing.locationId },
          { locationId: pairing.locationId, version: version ?? 'pictures' },
        ),
      ]);
    } catch (error) {
      this.logger.warn(`Product pictures not fetched: ${String(error)}`);
    }
  }
}
