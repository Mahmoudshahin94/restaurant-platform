import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@pos/domain';
import type { FastifyRequest } from 'fastify';
import { AccessService } from '../../modules/auth/access.service';
import { TokenService } from '../../modules/auth/token.service';
import { IS_PUBLIC_KEY } from './decorators';

/** Global guard: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new DomainError('UNAUTHENTICATED', 'Missing bearer token');
    }
    const claims = await this.tokens.verifyAccessToken(header.slice('Bearer '.length).trim());
    request.principal = await this.access.loadPrincipal(claims.userId, claims.restaurantId);
    return true;
  }
}
