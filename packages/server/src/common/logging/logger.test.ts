import { Writable } from 'node:stream';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { pino } from 'pino';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { RequestContext, type RequestContextStore } from '../context/request-context';
import { RequestContextInterceptor } from '../context/request-context.interceptor';
import { LOG_REDACT_PATHS, loggableError } from './logger';

function capture(): { logger: pino.Logger; text: () => string } {
  const lines: string[] = [];
  const logger = pino(
    { redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' } },
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    }),
  );
  return { logger, text: () => lines.join('') };
}

describe('log redaction', () => {
  it('censors credentials, tokens and card data, also one level down', () => {
    const { logger, text } = capture();
    logger.info({
      req: { headers: { authorization: 'Bearer eyJhbGciOi.secret', cookie: 'pos_rt=abc123def' } },
      body: { password: 'Hunter2-password', pin: '4321', refreshToken: 'rt-secret-value' },
      device: { credential: 'dev-credential-value' },
      payment: { cardNumber: '4111111111111111', cvv: '987' },
      user: { passwordHash: '$argon2id$v=19$hash' },
      nested: { request: { token: 'nested-token-value', password: 'nested-password' } },
    });
    const line = text();
    for (const secret of [
      'eyJhbGciOi.secret',
      'abc123def',
      'Hunter2-password',
      '4321',
      'rt-secret-value',
      'dev-credential-value',
      '4111111111111111',
      '987',
      '$argon2id$v=19$hash',
      'nested-token-value',
      'nested-password',
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('[REDACTED]');
  });

  it('keeps only the kind, code and frames of Prisma errors', () => {
    const error = Object.assign(
      new Error('Invalid `prisma.user.create()` invocation: { passwordHash: "leaked-hash" }'),
      { name: 'PrismaClientValidationError' },
    );
    const logged = loggableError(error);
    expect(logged.message).toBe('PrismaClientValidationError');
    expect(JSON.stringify(logged)).not.toContain('leaked-hash');
    const known = Object.assign(new Error('Unique constraint failed on data { pin: "1234" }'), {
      name: 'PrismaClientKnownRequestError',
      code: 'P2002',
    });
    expect(loggableError(known).message).toBe('PrismaClientKnownRequestError P2002');
    expect(loggableError(new Error('plain')).message).toBe('plain');
    expect(loggableError('a string').message).toBe('Non-error thrown');
  });
});

describe('request context', () => {
  const ORDER = '0199d0a1-2b3c-7d4e-8f90-123456789abc';
  const LOCATION = '0199d0a1-2b3c-7d4e-8f90-aaaaaaaaaaaa';
  const RESTAURANT = '0199d0a1-2b3c-7d4e-8f90-bbbbbbbbbbbb';

  async function run(request: Record<string, unknown>): Promise<{
    store: RequestContextStore | undefined;
    fields: Record<string, unknown>;
  }> {
    let fields: Record<string, unknown> = {};
    const log = { child: (bindings: Record<string, unknown>) => ((fields = bindings), log) };
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ id: 'req-1', headers: {}, log, ...request }) }),
    } as unknown as ExecutionContext;
    let store: RequestContextStore | undefined;
    const next: CallHandler = { handle: () => ((store = RequestContext.get()), of(null)) };
    await lastValueFrom(new RequestContextInterceptor().intercept(context, next));
    return { store, fields };
  }

  it('carries the request, user, tenant and order into logs and audit context', async () => {
    const { store, fields } = await run({
      principal: { userId: 'user-1' },
      scope: { restaurantId: RESTAURANT, locationId: LOCATION },
      params: { locationId: LOCATION, orderId: ORDER.toUpperCase() },
      headers: { 'x-client-source': 'POS' },
    });
    expect(store).toMatchObject({
      requestId: 'req-1',
      source: 'POS',
      userId: 'user-1',
      restaurantId: RESTAURANT,
      locationId: LOCATION,
      orderId: ORDER,
    });
    expect(fields).toMatchObject({
      userId: 'user-1',
      restaurantId: RESTAURANT,
      locationId: LOCATION,
      orderId: ORDER,
    });
  });

  it('takes the tenant from a hub’s device credential, which alone may claim HUB', async () => {
    const device = { id: 'device-1', restaurantId: RESTAURANT, locationId: LOCATION };
    const hub = await run({ device, headers: { 'x-client-source': 'HUB' } });
    expect(hub.store).toMatchObject({ source: 'HUB', deviceId: 'device-1', locationId: LOCATION });
    const staff = await run({ headers: { 'x-client-source': 'HUB' } });
    expect(staff.store?.source).toBe('ADMIN');
    const system = await run({ headers: { 'x-client-source': 'SYSTEM' } });
    expect(system.store?.source).toBe('ADMIN');
    const notAnId = await run({ params: { orderId: 'not-an-id' } });
    expect(notAnId.store?.orderId).toBeUndefined();
  });
});
