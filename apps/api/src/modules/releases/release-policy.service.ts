import { Injectable } from '@nestjs/common';
import { type ReleaseFacts, type SupportedMinimums, supportedMinimums } from '@pos/domain';
import { PrismaService } from '@pos/server';
import { MADAR_VERSION } from '@pos/shared-types';

/** Releases are re-read at most this often; publishing on this instance re-reads them at once. */
const CACHE_MS = 15_000;

/**
 * The cloud's version rules (ADR 0026): the published releases, read briefly cached because every
 * hub request and every app request asks, and the oldest hub and app this cloud serves.
 */
@Injectable()
export class ReleasePolicyService {
  private cache: { at: number; releases: Promise<ReleaseFacts[]> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Published releases (any channel). */
  releases(): Promise<ReleaseFacts[]> {
    const now = Date.now();
    if (!this.cache || now - this.cache.at > CACHE_MS) {
      const releases = this.prisma.release.findMany({
        where: { publishedAt: { lte: new Date(now) } },
        select: {
          version: true,
          channel: true,
          minSupportedHubVersion: true,
          minSupportedClientVersion: true,
        },
      });
      // A failed read is not kept: the next request tries again.
      releases.catch(() => {
        this.cache = null;
      });
      this.cache = { at: now, releases };
    }
    return this.cache.releases;
  }

  /** The oldest hub and app the cloud serves, from the releases up to the version it runs. */
  async minimums(): Promise<SupportedMinimums> {
    return supportedMinimums(await this.releases(), MADAR_VERSION);
  }

  /** After a release was published or changed. */
  invalidate(): void {
    this.cache = null;
  }
}
