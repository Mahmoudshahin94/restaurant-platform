import type { LoggerService } from '@nestjs/common';
import { type DestinationStream, pino, type Logger } from 'pino';
import type { AppConfig } from '../../config/env';
import { RequestContext } from '../context/request-context';

/**
 * Paths that must never reach the logs: credentials, tokens, cookies, PINs and anything that
 * could carry payment data.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-tracking-token"]',
  '*.trackingToken',
  '*.cardToken',
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
  '*.credential',
  '*.credentialHash',
  // Payment provider secrets (ADR 0024): the set an administrator types, and sealed bytes.
  'secrets',
  'secretKey',
  '*.secrets',
  '*.secretKey',
  '*.apiKey',
  '*.privateKey',
  '*.webhookSecret',
  '*.wrappedKey',
  '*.ciphertext',
  // One level deeper, for objects logged under a key (e.g. `{ body: { password } }`).
  '*.*.password',
  '*.*.pin',
  '*.*.refreshToken',
  '*.*.accessToken',
  '*.*.token',
  '*.*.secret',
  '*.*.cardNumber',
  '*.*.cvv',
  '*.*.credential',
  '*.*.secrets',
  '*.*.secretKey',
  '*.*.apiKey',
  '*.*.privateKey',
  '*.*.webhookSecret',
];

/**
 * What may be logged of an unexpected error. Prisma's messages can quote the arguments of the
 * failed query (a password hash, a customer's phone), so for its errors only the kind, the code
 * and the stack frames are kept; other errors keep their message.
 */
export function loggableError(error: unknown): { message: string; stack?: string } {
  if (!(error instanceof Error)) return { message: 'Non-error thrown' };
  if (!error.name.startsWith('PrismaClient')) {
    return { message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  }
  const code = (error as { code?: unknown }).code;
  const frames = (error.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line));
  return {
    message: typeof code === 'string' ? `${error.name} ${code}` : error.name,
    stack: frames.join('\n'),
  };
}

export function createRootLogger(
  config: AppConfig,
  service = 'api',
  stream?: DestinationStream,
): Logger {
  const options = {
    redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  // A test reading the log gets every line, redacted exactly as in production.
  if (stream) return pino({ ...options, level: 'trace' }, stream);
  return pino({
    ...options,
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
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
            deviceId: store.deviceId,
            tenantId: store.tenantId,
            locationId: store.locationId,
            orderId: store.orderId,
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
