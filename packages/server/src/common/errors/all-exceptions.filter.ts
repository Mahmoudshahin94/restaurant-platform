import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { isDomainError } from '@pos/domain';
import type { ApiErrorBody } from '@pos/shared-types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HTTP_STATUS_BY_ERROR_CODE, errorCodeForHttpStatus } from './http-status';
import { isPrismaKnownError } from '../../prisma/errors';
import { loggableError } from '../logging/logger';
import { type ErrorEventSink, redactErrorMessage } from './error-events';

interface Mapped {
  status: number;
  body: Omit<ApiErrorBody, 'requestId'>;
}

function hasStatusCode(error: unknown): error is { statusCode: number; message?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  );
}

/**
 * Converts every thrown value into the uniform `{ code, message, details, requestId }` envelope.
 * Unexpected errors are logged with their stack and returned as an opaque INTERNAL_ERROR. Every
 * 5xx answer also goes to the error-event sink, when the application has one (the platform's
 * health board, ADR 0025).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  constructor(private readonly sink?: ErrorEventSink) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const mapped = this.map(exception);

    if (mapped.status >= 500) {
      const { message, stack } = loggableError(exception);
      this.logger.error(message, stack);
      this.report(request, mapped, exception, message);
    }

    const body: ApiErrorBody = { ...mapped.body, requestId: request.id };
    void reply.status(mapped.status).send(body);
  }

  private report(
    request: FastifyRequest,
    mapped: Mapped,
    exception: unknown,
    message: string,
  ): void {
    if (!this.sink) return;
    try {
      const device = (request as FastifyRequest & { device?: { tenantId: string } }).device;
      const scope = request.scope;
      const name = exception instanceof Error ? exception.name : 'Error';
      this.sink.record({
        status: mapped.status,
        code: mapped.body.code,
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        message: redactErrorMessage(`${name}: ${message}`),
        tenantId: scope?.tenantId ?? device?.tenantId ?? request.terminal?.tenantId ?? null,
        locationId: scope?.locationId ?? null,
        requestId: request.id,
      });
    } catch (error) {
      this.logger.warn(`Could not record an error event: ${loggableError(error).message}`);
    }
  }

  private map(exception: unknown): Mapped {
    if (isDomainError(exception)) {
      return {
        status: HTTP_STATUS_BY_ERROR_CODE[exception.code],
        body: { code: exception.code, message: exception.message, details: exception.details },
      };
    }

    if (isPrismaKnownError(exception)) {
      if (exception.code === 'P2002') {
        return {
          status: 409,
          body: {
            code: 'CONFLICT',
            message: 'A record with the same unique value already exists',
            details: { target: exception.meta?.target ?? null },
          },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: 404,
          body: { code: 'NOT_FOUND', message: 'Record not found', details: {} },
        };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: {
          code: errorCodeForHttpStatus(status),
          message: status >= 500 ? 'Internal error' : exception.message,
          details: {},
        },
      };
    }

    // Fastify / plugin errors (body parsing, rate limiting, payload too large, ...).
    if (hasStatusCode(exception) && exception.statusCode >= 400 && exception.statusCode < 500) {
      return {
        status: exception.statusCode,
        body: {
          code: errorCodeForHttpStatus(exception.statusCode),
          message: exception.message ?? 'Request rejected',
          details: {},
        },
      };
    }

    return {
      status: 500,
      body: { code: 'INTERNAL_ERROR', message: 'Internal error', details: {} },
    };
  }
}
