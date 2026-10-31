import { Global, Module } from '@nestjs/common';
import { ACCOUNT_DIRECTORY } from '@pos/server';
import { CloudAccountDirectory } from './cloud-account-directory';
import { MembersController } from './members.controller';
import { OrganizationGuard, OrganizationScopeInterceptor } from './organization.guard';
import { OrganizationService } from './organization.service';

/**
 * Organizations (E1): the members' pages and the service that owns linked users. Global because
 * it also provides the account directory to the shared auth module (an account's brands across
 * every tenant, and its organizations, for sign-in and the switcher).
 */
@Global()
@Module({
  controllers: [MembersController],
  providers: [
    { provide: ACCOUNT_DIRECTORY, useClass: CloudAccountDirectory },
    OrganizationService,
    OrganizationGuard,
    OrganizationScopeInterceptor,
  ],
  exports: [ACCOUNT_DIRECTORY, OrganizationService],
})
export class OrganizationsModule {}
