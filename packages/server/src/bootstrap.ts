import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { DynamicModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { PinoNestLogger, createRootLogger } from './common/logging/logger';
import { RealtimeGateway } from './modules/realtime/realtime.gateway';
import type { AppConfig } from './config/env';

export const API_PREFIX = 'api/v1';
const AUTH_RATE_LIMITED_ROUTES = new Set([
  `/${API_PREFIX}/auth/login`,
  `/${API_PREFIX}/auth/refresh`,
  `/${API_PREFIX}/auth/pin`,
]);
const WEB_ORDER_ROUTE = `/${API_PREFIX}/orders`;
const TRACKING_ROUTE = `/${API_PREFIX}/orders/track`;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

type RateBudget = 'auth' | 'web-order' | 'tracking' | 'all';

/** Credential and public customer endpoints get their own, smaller budgets per client IP. */
function budgetOf(request: FastifyRequest): RateBudget {
  const route = request.routeOptions.url ?? '';
  if (AUTH_RATE_LIMITED_ROUTES.has(route)) return 'auth';
  if (route === WEB_ORDER_ROUTE && request.method === 'POST') return 'web-order';
  if (route === TRACKING_ROUTE) return 'tracking';
  return 'all';
}

export interface ServerAppOptions {
  /** `service` field on every log line (`api`, `hub`). */
  serviceName: string;
}

/**
 * Builds a fully configured HTTP application around a root module: the cloud API and the location
 * hub share the same transport, security, logging and error handling.
 */
export async function createServerApp(
  rootModule: DynamicModule,
  config: AppConfig,
  options: ServerAppOptions,
): Promise<NestFastifyApplication> {
  const logger = createRootLogger(config, options.serviceName);
  const adapter = new FastifyAdapter({
    loggerInstance: logger,
    bodyLimit: 1024 * 1024,
    // Honour a caller-supplied correlation id (e.g. from the location hub), otherwise mint one.
    genReqId: (req: IncomingMessage) => {
      const header = req.headers['x-request-id'];
      return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
    },
  });

  const app = await NestFactory.create<NestFastifyApplication>(rootModule, adapter, {
    logger: new PinoNestLogger(logger),
  });

  app.setGlobalPrefix(API_PREFIX, { exclude: ['health', 'ready'] });
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, {
    timeWindow: '1 minute',
    max: (request) => {
      switch (budgetOf(request)) {
        case 'auth':
          return config.AUTH_RATE_LIMIT_PER_MINUTE;
        case 'web-order':
          return config.WEB_ORDER_RATE_LIMIT_PER_MINUTE;
        case 'tracking':
          return config.TRACKING_RATE_LIMIT_PER_MINUTE;
        default:
          return config.RATE_LIMIT_PER_MINUTE;
      }
    },
    keyGenerator: (request) => `${budgetOf(request)}:${request.ip}`,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      details: { retryAfterMs: context.ttl },
    }),
  });

  const fastify = app.getHttpAdapter().getInstance();
  await app.get(RealtimeGateway).register(fastify, `/${API_PREFIX}/realtime`);
  fastify.addHook('onSend', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });
  // Errors raised in Fastify hooks/plugins (e.g. rate limiting) are routed by Nest's Fastify
  // error handler into AllExceptionsFilter, so they get the same envelope as handler errors.

  await app.init();
  await fastify.ready();
  return app;
}
