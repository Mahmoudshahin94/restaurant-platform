import { z } from 'zod';
import { idSchema } from './common';

/**
 * Realtime socket protocol (`/api/v1/realtime`). The token travels in the first message, never
 * in the URL, so it does not end up in access logs.
 */
export const realtimeClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    token: z.string().min(1).max(4096),
    locationId: idSchema,
  }),
  z.object({ type: z.literal('ping') }),
]);
export type RealtimeClientMessage = z.infer<typeof realtimeClientMessageSchema>;

/** Close codes the server uses; clients reconnect unless the code says not to. */
export const REALTIME_CLOSE = {
  /** Token expired or the session ended: refresh, then reconnect. */
  UNAUTHENTICATED: 4401,
  /** Not allowed at this location: do not retry. */
  FORBIDDEN: 4403,
  /** Malformed message or no auth in time. */
  PROTOCOL: 4400,
} as const;
