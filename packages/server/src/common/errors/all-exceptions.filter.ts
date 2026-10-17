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
 * Unexpected errors are logged with their stack and returned as an opaque INTERNAL_ERROR.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const mapped = this.map(exception);

    if (mapped.status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : 'Non-error thrown',
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ApiErrorBody = { ...mapped.body, requestId: request.id };
    void reply.status(mapped.status).send(body);
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
