import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type { TerminalDeviceType } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';

export const DEVICE_ROUTE_KEY = 'auth:deviceRoute';

/**
 * A terminal paired with the location hub, authenticated by its device credential
 * (`Authorization: Device <id>.<secret>`, ADR 0022). Its whole authority is the device routes of
 * its type, at its own location: it is never a staff member.
 */
export interface AuthenticatedTerminal {
  id: string;
  tenantId: string;
  locationId: string;
  type: TerminalDeviceType;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    terminal?: AuthenticatedTerminal;
  }
}

/**
 * Marks a route (or controller) as served to terminal devices of these types, and to nobody else:
 * the auth guard accepts only their device credential there (a staff token is refused), and a
 * device credential is refused on every other route. The route's `:locationId`, if any, must be
 * the device's own location. The route inventory lists them as `device` routes.
 */
export const DeviceRoute = (...types: TerminalDeviceType[]) => SetMetadata(DEVICE_ROUTE_KEY, types);

/** The authenticated terminal of a device route. */
export const CurrentTerminal = createParamDecorator<undefined, AuthenticatedTerminal>(
  (_data: undefined, ctx: ExecutionContext) => {
    const terminal = ctx.switchToHttp().getRequest<FastifyRequest>().terminal;
    if (!terminal) throw new DomainError('UNAUTHENTICATED', 'Device authentication required');
    return terminal;
  },
);
