import { Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PermissionCatalogInitializer } from './permission-catalog.initializer';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AccessService, TokenService, PermissionCatalogInitializer],
  exports: [AccessService, TokenService],
})
export class AuthModule {}
