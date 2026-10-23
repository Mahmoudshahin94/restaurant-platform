import type { TenantFileDto } from '@pos/validation';
import type { FastifyReply } from 'fastify';

/**
 * Sends a tenant file's bytes as an inert image: its verified type, never sniffed by the browser,
 * nothing it could run. Files are immutable, so caches may keep them. A public file (a logo shown
 * on the customer website) may be embedded by other origins.
 */
export function sendTenantFile(
  reply: FastifyReply,
  file: TenantFileDto,
  bytes: Buffer,
  access: 'private' | 'public',
): Buffer {
  void reply
    .header('content-type', file.contentType)
    .header('content-length', String(bytes.length))
    .header('x-content-type-options', 'nosniff')
    .header('content-security-policy', "default-src 'none'; sandbox")
    .header('content-disposition', 'inline')
    .header('etag', `"${file.sha256}"`)
    .header(
      'cache-control',
      access === 'public' ? 'public, max-age=86400' : 'private, max-age=31536000, immutable',
    );
  if (access === 'public') void reply.header('cross-origin-resource-policy', 'cross-origin');
  return bytes;
}
