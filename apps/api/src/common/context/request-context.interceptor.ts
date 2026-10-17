import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { ActionSource } from '@pos/shared-types';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { RequestContext, type RequestContextStore } from './request-context';

const SOURCES = new Set<string>(Object.values(ActionSource));

function sourceOf(request: FastifyRequest): ActionSource {
  const header = request.headers['x-client-source'];
  return typeof header === 'string' && SOURCES.has(header) ? (header as ActionSource) : 'ADMIN';
}

/**
 * Runs the handler inside an AsyncLocalStorage scope holding the request id, actor and tenant,
 * and enriches the request logger with the same fields.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const store: RequestContextStore = {
      requestId: request.id,
      source: sourceOf(request),
      ...(request.principal ? { userId: request.principal.userId } : {}),
      ...(request.scope?.restaurantId ? { restaurantId: request.scope.restaurantId } : {}),
      ...(request.scope?.locationId ? { locationId: request.scope.locationId } : {}),
    };
    request.log = request.log.child({
      userId: store.userId,
      restaurantId: store.restaurantId,
      locationId: store.locationId,
    });
    return new Observable((subscriber) =>
      RequestContext.run(store, () => next.handle().subscribe(subscriber)),
    );
  }
}
