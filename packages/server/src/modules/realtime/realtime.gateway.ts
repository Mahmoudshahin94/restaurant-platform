import websocket from '@fastify/websocket';
import { Injectable, Logger } from '@nestjs/common';
import { DomainError, canAccessLocation, isDomainError, resolvePermissions } from '@pos/domain';
import type { RealtimeEvent } from '@pos/shared-types';
import { REALTIME_CLOSE, realtimeClientMessageSchema } from '@pos/validation';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../auth/access.service';
import { loggableError } from '../../common/logging/logger';
import { TokenService } from '../auth/token.service';
import { RealtimeBus } from './realtime.bus';

const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const MAX_MESSAGE_BYTES = 16 * 1024;

type ServerMessage =
  | { type: 'ready'; locationId: string }
  | { type: 'event'; event: RealtimeEvent }
  | { type: 'pong' };

/**
 * Realtime socket for POS and kitchen screens: `GET /api/v1/realtime` (WebSocket).
 *
 * The client authenticates with its access token in the first message (never in the URL, so it
 * stays out of logs) and subscribes to one location. Because nothing relies on cookies, a page on
 * another origin cannot ride on a user's session (no cross-site WebSocket hijacking), so the
 * Origin header is not used for authorization. The socket closes when the token expires; the
 * client refreshes and reconnects. Events only notify — clients re-fetch what they show.
 */
@Injectable()
export class RealtimeGateway {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
    private readonly bus: RealtimeBus,
  ) {}

  async register(fastify: FastifyInstance, path: string): Promise<void> {
    await fastify.register(websocket, { options: { maxPayload: MAX_MESSAGE_BYTES } });
    await fastify.register((scope, _opts, done) => {
      scope.get(path, { websocket: true }, (socket) => {
        this.handle(socket);
      });
      done();
    });
  }

  private handle(socket: WebSocket): void {
    let unsubscribe: (() => void) | null = null;
    let expiry: NodeJS.Timeout | null = null;
    let alive = true;
    const send = (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };
    const authTimer = setTimeout(() => {
      socket.close(REALTIME_CLOSE.PROTOCOL, 'Authentication timeout');
    }, AUTH_TIMEOUT_MS);
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_MS);
    socket.on('pong', () => {
      alive = true;
    });

    const cleanup = () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      if (expiry) clearTimeout(expiry);
      unsubscribe?.();
      unsubscribe = null;
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);

    socket.on('message', (raw: Buffer, isBinary: boolean) => {
      const parsed = isBinary ? null : this.parse(raw.toString('utf8'));
      if (!parsed) {
        socket.close(REALTIME_CLOSE.PROTOCOL, 'Malformed message');
        return;
      }
      if (parsed.type === 'ping') {
        send({ type: 'pong' });
        return;
      }
      if (unsubscribe) {
        socket.close(REALTIME_CLOSE.PROTOCOL, 'Already authenticated');
        return;
      }
      void this.authenticate(parsed.token, parsed.locationId)
        .then((expiresAt) => {
          if (socket.readyState !== socket.OPEN) return;
          clearTimeout(authTimer);
          unsubscribe = this.bus.subscribe(parsed.locationId, (event) => {
            send({ type: 'event', event });
          });
          expiry = setTimeout(
            () => {
              socket.close(REALTIME_CLOSE.UNAUTHENTICATED, 'Token expired');
            },
            Math.max(0, expiresAt - Date.now()),
          );
          send({ type: 'ready', locationId: parsed.locationId });
        })
        .catch((error: unknown) => {
          const forbidden =
            isDomainError(error) &&
            (error.code === 'LOCATION_NOT_FOUND' || error.code === 'INSUFFICIENT_PERMISSION');
          if (!isDomainError(error)) {
            const { message, stack } = loggableError(error);
            this.logger.error(message, stack);
          }
          socket.close(
            forbidden ? REALTIME_CLOSE.FORBIDDEN : REALTIME_CLOSE.UNAUTHENTICATED,
            forbidden ? 'Forbidden' : 'Unauthenticated',
          );
        });
    });
  }

  private parse(text: string) {
    try {
      const result = realtimeClientMessageSchema.safeParse(JSON.parse(text));
      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  /** Same rules as the HTTP guards: valid token, the location's tenant, and a viewing permission. */
  private async authenticate(token: string, locationId: string): Promise<number> {
    const claims = await this.tokens.verifyAccessToken(token);
    const principal = await this.access.loadPrincipal(claims.userId, claims.restaurantId);
    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: { restaurantId: true },
    });
    if (
      location?.restaurantId !== principal.restaurantId ||
      !canAccessLocation(principal.assignments, locationId)
    ) {
      throw new DomainError('LOCATION_NOT_FOUND', 'Location not found');
    }
    const granted = resolvePermissions(principal.assignments, locationId);
    if (!granted.has('kitchen.view') && !granted.has('orders.view')) {
      throw new DomainError('INSUFFICIENT_PERMISSION', 'Missing required permissions');
    }
    return claims.expiresAt;
  }
}
