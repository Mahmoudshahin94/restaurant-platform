import { Global, Injectable, Module } from '@nestjs/common';
import { type AccountDirectory, ACCOUNT_DIRECTORY, PrismaService } from '@pos/server';
import type { AuthBrand, AuthOrganization } from '@pos/validation';

/**
 * The hub's account directory: its database holds the one tenant it is paired with (ADR 0017) and
 * no organizations, so an account has at most that brand here and is a member of nothing.
 */
@Injectable()
export class HubAccountDirectory implements AccountDirectory {
  constructor(private readonly prisma: PrismaService) {}

  async brandsFor(accountId: string): Promise<AuthBrand[]> {
    const users = await this.prisma.user.findMany({
      where: { accountId, isActive: true, tenant: { status: { not: 'SUSPENDED' } } },
      orderBy: { createdAt: 'asc' },
      select: {
        tenant: {
          select: {
            id: true,
            nameEn: true,
            nameAr: true,
            organizationId: true,
            branding: { select: { logoFileId: true } },
          },
        },
      },
    });
    return users.map(({ tenant }) => ({
      id: tenant.id,
      nameEn: tenant.nameEn,
      nameAr: tenant.nameAr,
      logoFileId: tenant.branding?.logoFileId ?? null,
      organizationId: tenant.organizationId,
    }));
  }

  organizationsFor(): Promise<AuthOrganization[]> {
    return Promise.resolve([]);
  }
}

/** Provides the account directory to the shared auth module (Global: it is consumed there). */
@Global()
@Module({
  providers: [{ provide: ACCOUNT_DIRECTORY, useClass: HubAccountDirectory }],
  exports: [ACCOUNT_DIRECTORY],
})
export class HubAccountDirectoryModule {}
