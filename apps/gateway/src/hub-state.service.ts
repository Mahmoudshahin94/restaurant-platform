import { Injectable } from '@nestjs/common';
import { PrismaService } from '@pos/server';
import { asHubTx } from './database/hub-database';

export interface Pairing {
  cloudUrl: string;
  deviceId: string;
  /** `<deviceId>.<secret>`; never logged or returned by the API. */
  credential: string;
  tenantId: string;
  locationId: string;
  pairedAt: string;
}

export interface SnapshotState {
  version: string;
  generatedAt: string;
  appliedAt: string;
}

export interface CloudLink {
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  lastAttemptAt: string | null;
  lastError: string | null;
  /** The cloud refused the hub's credential: nothing syncs until the hub is paired again. */
  credentialRejected: boolean;
  /**
   * The cloud no longer serves this hub's version (ADR 0026): nothing syncs until it is updated,
   * with the oldest version the cloud serves when it said.
   */
  upgradeRequired: { minimumVersion: string | null } | null;
}

interface StateShape {
  pairing: Pairing;
  snapshot: SnapshotState;
  /** Last change-feed sequence the hub handled (docs/sync.md). */
  cursor: string;
}

/** Durable key/value state of the hub (`hub_state`), cached in memory after first read. */
@Injectable()
export class HubStateService {
  private readonly cache = new Map<keyof StateShape, unknown>();
  /** Volatile: reachability of the cloud as last observed by this process. */
  cloud: CloudLink = {
    status: 'UNKNOWN',
    lastAttemptAt: null,
    lastError: null,
    credentialRejected: false,
    upgradeRequired: null,
  };

  constructor(private readonly prisma: PrismaService) {}

  async get<K extends keyof StateShape>(key: K): Promise<StateShape[K] | null> {
    if (this.cache.has(key)) return this.cache.get(key) as StateShape[K];
    const row = await asHubTx(this.prisma).hubState.findUnique({ where: { key } });
    const value = (row?.value ?? null) as StateShape[K] | null;
    if (value !== null) this.cache.set(key, value);
    return value;
  }

  async set<K extends keyof StateShape>(key: K, value: StateShape[K], tx?: unknown): Promise<void> {
    const db = asHubTx(tx ?? this.prisma);
    const json = value as unknown as object;
    await db.hubState.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
    this.cache.set(key, value);
  }

  /** Forget cached values (another process, e.g. the pairing CLI, may have written them). */
  invalidate(): void {
    this.cache.clear();
  }

  markCloud(status: 'ONLINE' | 'OFFLINE', error: string | null = null): void {
    this.cloud = {
      status,
      lastAttemptAt: new Date().toISOString(),
      lastError: error,
      credentialRejected: false,
      upgradeRequired: null,
    };
  }

  markUpgradeRequired(minimumVersion: string | null, message: string): void {
    this.cloud = {
      status: 'OFFLINE',
      lastAttemptAt: new Date().toISOString(),
      lastError: message,
      credentialRejected: false,
      upgradeRequired: { minimumVersion },
    };
  }

  markCredentialRejected(message: string): void {
    this.cloud = {
      status: 'ONLINE',
      lastAttemptAt: new Date().toISOString(),
      lastError: message,
      credentialRejected: true,
      upgradeRequired: null,
    };
  }
}
