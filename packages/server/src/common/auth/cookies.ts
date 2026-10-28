import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Refresh cookies for apps outside this package (the cloud's platform sign-in, ADR 0025), which
 * do not see the `@fastify/cookie` typings: httpOnly, SameSite=strict, scoped to `path`.
 */
export function readCookie(request: FastifyRequest, name: string): string | undefined {
  return request.cookies[name];
}

export function setRefreshCookie(
  reply: FastifyReply,
  options: { name: string; value: string; path: string; maxAgeSeconds: number; secure: boolean },
): void {
  void reply.setCookie(options.name, options.value, {
    httpOnly: true,
    secure: options.secure,
    sameSite: 'strict',
    path: options.path,
    maxAge: options.maxAgeSeconds,
  });
}

export function clearRefreshCookie(reply: FastifyReply, name: string, path: string): void {
  void reply.clearCookie(name, { path });
}
