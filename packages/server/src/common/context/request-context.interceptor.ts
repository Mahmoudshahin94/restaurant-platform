import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { ActionSource, type TerminalDeviceType } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { RequestContext, type RequestContextStore, requestMemo } from './request-context';

/**
 * Sources a client may claim; `HUB` only a paired hub (device credential), `KIOSK` only a paired
 * kiosk (its device credential, ADR 0022), `SYSTEM` nobody.
 */
const CLIENT_SOURCES = new Set<string>([
  ActionSource.POS,
  ActionSource.KDS,
  ActionSource.WEBSITE,
  ActionSource.ADMIN,
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Set by the cloud's device guard on hub-authenticated routes (`/sync/*`), or by the auth guard
 * for a terminal on the hub's device routes (`request.terminal`).
 */
interface DeviceScope {
  id: string;
  tenantId: string;
  locationId: string;
}
const deviceOf = (request: FastifyRequest): DeviceScope | undefined =>
  (request as FastifyRequest & { device?: DeviceScope }).device ?? request.terminal;

/** What a terminal's actions are recorded as: its own kind (a customer display, its till's). */
const TERMINAL_SOURCES: Record<TerminalDeviceType, ActionSource> = {
  KIOSK: ActionSource.KIOSK,
  POS: ActionSource.POS,
  KDS: ActionSource.KDS,
  CUSTOMER_DISPLAY: ActionSource.POS,
};

function sourceOf(request: FastifyRequest): ActionSource {
  // Set by the cloud's PlatformGuard only, so it cannot be claimed (ADR 0025).
  if (request.platformUser) return ActionSource.PLATFORM;
  if (request.terminal) return TERMINAL_SOURCES[request.terminal.type];
  const header = request.headers['x-client-source'];
  if (header === ActionSource.HUB && deviceOf(request)) return ActionSource.HUB;
  return typeof header === 'string' && CLIENT_SOURCES.has(header)
    ? (header as ActionSource)
    : 'ADMIN';
}

/** The order a request is about (`:orderId` route parameter), for log correlation. */
function orderIdOf(request: FastifyRequest): string | undefined {
  const { orderId } = (request.params ?? {}) as { orderId?: unknown };
  return typeof orderId === 'string' && UUID.test(orderId) ? orderId.toLowerCase() : undefined;
}

/**
 * Runs the handler inside an AsyncLocalStorage scope holding the request id, actor, tenant and
 * order, and enriches the request logger with the same fields (including the request-completed
 * line Fastify writes afterwards).
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const device = deviceOf(request);
    const tenantId = request.scope?.tenantId ?? device?.tenantId;
    const locationId = request.scope?.locationId ?? device?.locationId;
    const orderId = orderIdOf(request);
    const store: RequestContextStore = {
      requestId: request.id,
      source: sourceOf(request),
      ...(request.principal ? { userId: request.principal.userId } : {}),
      ...(request.platformUser ? { platformUserId: request.platformUser.id } : {}),
      ...(device ? { deviceId: device.id } : {}),
      ...(tenantId ? { tenantId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(orderId ? { orderId } : {}),
      memo: requestMemo(request),
      ...(request.requiredFeatures ? { requiredFeatures: request.requiredFeatures } : {}),
    };
    request.log = request.log.child({
      userId: store.userId,
      platformUserId: store.platformUserId,
      deviceId: store.deviceId,
      tenantId: store.tenantId,
      locationId: store.locationId,
      orderId: store.orderId,
    });
    return new Observable((subscriber) =>
      RequestContext.run(store, () => next.handle().subscribe(subscriber)),
    );
  }
}
