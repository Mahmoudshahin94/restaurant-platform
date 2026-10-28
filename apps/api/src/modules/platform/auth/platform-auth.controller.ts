import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import {
  APP_CONFIG,
  type AppConfig,
  CurrentPlatformUser,
  type PlatformActor,
  Public,
  RequirePlatformPermissions,
  ZodValidationPipe,
  clearRefreshCookie,
  readCookie,
  setRefreshCookie,
} from '@pos/server';
import {
  type PlatformTokenResponse,
  type PlatformUserDto,
  platformLoginSchema,
} from '@pos/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { PlatformAuthService, type PlatformSession } from './platform-auth.service';
import { PlatformGuard } from './platform.guard';

/** The platform's refresh cookie: its own name and path, never sent to a staff route. */
export const PLATFORM_REFRESH_COOKIE = 'madar_prt';
export const PLATFORM_REFRESH_COOKIE_PATH = '/api/v1/platform/auth';

/**
 * Sign-in to the platform admin (ADR 0025). Browser only: the refresh token is an httpOnly,
 * SameSite=strict cookie scoped to `/api/v1/platform/auth`, read only with an allowed `Origin`.
 * There is no sign-up: the first owner comes from `pnpm platform:create-owner`.
 */
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(platformLoginSchema)) body: z.output<typeof platformLoginSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PlatformTokenResponse> {
    return this.deliver(await this.auth.login(body.email, body.password), reply);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<PlatformTokenResponse> {
    const token = this.cookieToken(request);
    if (!token) throw new DomainError('UNAUTHENTICATED', 'No refresh token');
    return this.deliver(await this.auth.refresh(token), reply);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.auth.logout(this.cookieToken(request));
    clearRefreshCookie(reply, PLATFORM_REFRESH_COOKIE, PLATFORM_REFRESH_COOKIE_PATH);
  }

  @RequirePlatformPermissions([])
  @UseGuards(PlatformGuard)
  @Get('me')
  me(@CurrentPlatformUser() user: PlatformActor): Promise<PlatformUserDto> {
    return this.auth.me(user.id);
  }

  /** The cookie, with the same CSRF defence as the staff refresh: an allowed Origin. */
  private cookieToken(request: FastifyRequest): string | undefined {
    const token = readCookie(request, PLATFORM_REFRESH_COOKIE);
    if (!token) return undefined;
    const origin = request.headers.origin;
    if (!origin || !this.config.CORS_ORIGINS.includes(origin)) {
      throw new DomainError('CSRF_REJECTED', 'Origin not allowed for cookie authentication');
    }
    return token;
  }

  private deliver(session: PlatformSession, reply: FastifyReply): PlatformTokenResponse {
    setRefreshCookie(reply, {
      name: PLATFORM_REFRESH_COOKIE,
      value: session.refreshToken,
      path: PLATFORM_REFRESH_COOKIE_PATH,
      maxAgeSeconds: 24 * 60 * 60,
      secure: this.config.NODE_ENV === 'production',
    });
    return session.response;
  }
}
