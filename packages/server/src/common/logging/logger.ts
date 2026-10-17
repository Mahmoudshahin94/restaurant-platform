import type { LoggerService } from '@nestjs/common';
import { pino, type Logger } from 'pino';
import type { AppConfig } from '../../config/env';
import { RequestContext } from '../context/request-context';

/**
 * Paths that must never reach the logs: credentials, tokens, cookies, PINs and anything that
 * could carry payment data.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.pin',
  '*.pinHash',
  '*.refreshToken',
  '*.accessToken',
  '*.token',
  '*.secret',
  '*.cardNumber',
  '*.cvv',
];

export function createRootLogger(config: AppConfig, service = 'api'): Logger {
  return pino({
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(config.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
      : {}),
  });
}

/** Adapts pino to Nest's LoggerService and enriches every line with the request context. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  private ctx(context?: unknown): Record<string, unknown> {
    const store = RequestContext.get();
    return {
      ...(typeof context === 'string' ? { context } : {}),
      ...(store
        ? {
            requestId: store.requestId,
            userId: store.userId,
            restaurantId: store.restaurantId,
            locationId: store.locationId,
          }
        : {}),
    };
  }

  log(message: unknown, context?: unknown): void {
    this.logger.info(this.ctx(context), String(message));
  }
  error(message: unknown, stack?: unknown, context?: unknown): void {
    this.logger.error({ ...this.ctx(context), stack }, String(message));
  }
  warn(message: unknown, context?: unknown): void {
    this.logger.warn(this.ctx(context), String(message));
  }
  debug(message: unknown, context?: unknown): void {
    this.logger.debug(this.ctx(context), String(message));
  }
  verbose(message: unknown, context?: unknown): void {
    this.logger.trace(this.ctx(context), String(message));
  }
}
