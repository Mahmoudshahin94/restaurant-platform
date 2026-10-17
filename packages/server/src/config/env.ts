import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    API_HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url(),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /**
     * A refresh token presented again within this many seconds of its rotation is treated as a
     * benign race (two tabs, a double-fired effect) rather than theft: the request fails without
     * revoking the session. Later reuse revokes the whole token family.
     */
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(600),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    // --- Online ordering (cloud only, ADR 0013) ---
    /** Website orders a client IP may place per minute. */
    WEB_ORDER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
    /** Order status checks a client IP may make per minute (tracking page polls every few seconds). */
    TRACKING_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
    /** A location's hub silent for longer than this makes online ordering OFFLINE. */
    HUB_HEARTBEAT_STALE_SECONDS: z.coerce.number().int().min(30).default(180),
    /** How often unaccepted website orders past their deadline are cancelled; 0 = never. */
    WEB_ORDER_TIMEOUT_SWEEP_SECONDS: z.coerce.number().int().min(0).default(15),
    /**
     * Online card payments: `none` (no gateway: customers pay at pickup or on delivery) or `mock`,
     * the documented test adapter (refused in production).
     */
    ONLINE_PAYMENT_PROVIDER: z.enum(['none', 'mock']).default('none'),
    /** Key of the order tracking tokens; derived from JWT_ACCESS_SECRET when unset. */
    TRACKING_TOKEN_SECRET: z.string().min(32).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.ONLINE_PAYMENT_PROVIDER !== 'mock', {
    path: ['ONLINE_PAYMENT_PROVIDER'],
    message: 'The mock payment provider cannot run in production',
  });

export type AppConfig = z.infer<typeof envSchema>;

/** Validates the environment once at start-up; the process refuses to boot on bad config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${problems}`);
  }
  return result.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
