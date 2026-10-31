import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import {
  type AuthUser,
  type TokenResponse,
  loginRequestSchema,
  pinLoginRequestSchema,
  refreshRequestSchema,
} from '@pos/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import {
  CurrentPrincipal,
  type Principal,
  Public,
  RequirePermissions,
} from '../../common/auth/decorators';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { SERVER_MODE, type ServerMode } from '../../common/auth/managed-in-cloud';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { AccessService } from './access.service';
import { AuthService, type IssuedSession } from './auth.service';

export const REFRESH_COOKIE = 'pos_rt';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SERVER_MODE) private readonly mode: ServerMode,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: z.output<typeof loginRequestSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenResponse> {
    const session = await this.auth.login(body.email, body.password, body.tenantId);
    return this.deliver(session, body.client, reply);
  }

  /** Employee code + PIN. Only on the location hub (LAN); the cloud answers 404. */
  @Public()
  @Post('pin')
  @HttpCode(200)
  async pinLogin(
    @Body(new ZodValidationPipe(pinLoginRequestSchema))
    body: z.output<typeof pinLoginRequestSchema>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenResponse> {
    if (this.mode !== 'hub') throw new DomainError('NOT_FOUND', 'Not available');
    const session = await this.auth.pinLogin(body.employeeCode, body.pin);
    return this.deliver(session, body.client, reply);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: z.output<typeof refreshRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TokenResponse> {
    if (body.refreshToken) {
      return this.deliver(await this.auth.refresh(body.refreshToken), 'native', reply);
    }
    const cookieToken = this.cookieToken(request);
    if (!cookieToken) throw new DomainError('UNAUTHENTICATED', 'No refresh token');
    return this.deliver(await this.auth.refresh(cookieToken), 'web', reply);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: z.output<typeof refreshRequestSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = body.refreshToken ?? this.cookieToken(request);
    await this.auth.logout(token);
    void reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  @RequirePermissions([])
  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Promise<AuthUser> {
    return this.access.loadAuthUser(principal.userId);
  }

  /**
   * Reads the refresh cookie. Cookie-authenticated requests are CSRF-protected: besides
   * SameSite=strict, the Origin header must be one of the configured browser origins.
   */
  private cookieToken(request: FastifyRequest): string | undefined {
    const token = request.cookies[REFRESH_COOKIE];
    if (!token) return undefined;
    const origin = request.headers.origin;
    if (!origin || !this.config.CORS_ORIGINS.includes(origin)) {
      throw new DomainError('CSRF_REJECTED', 'Origin not allowed for cookie authentication');
    }
    return token;
  }

  private deliver(
    session: IssuedSession,
    client: 'web' | 'native',
    reply: FastifyReply,
  ): TokenResponse {
    if (client === 'native') return { ...session.response, refreshToken: session.refreshToken };
    void reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: this.config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60,
    });
    return session.response;
  }
}
