import { z } from 'zod';

/** `scheme://host[:port]`: http(s) for browsers, plus the Tauri shells' custom schemes. */
const ORIGIN = /^(https?|tauri):\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

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
    /**
     * Browser origins allowed to call the API with credentials (comma-separated). Each must be a
     * bare origin (`scheme://host[:port]`); `*` and paths are refused, so a typo cannot open the
     * API to every site.
     */
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      )
      .pipe(z.array(z.string().regex(ORIGIN, 'CORS_ORIGINS entries must be bare origins'))),
    /**
     * Number of reverse proxies in front of the server whose `X-Forwarded-For` is trusted (0 =
     * none). Rate limits are per client IP, so behind a load balancer this must be set or every
     * client shares one budget.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
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
    /**
     * Integrated card terminals of self-service kiosks (ADR 0022): `none` (kiosk customers pay at
     * the counter) or `mock`, the documented test adapter that approves every charge (refused in
     * production). A vendor's terminal SDK becomes another value.
     */
    PAYMENT_TERMINAL_PROVIDER: z.enum(['none', 'mock']).default('none'),
    /**
     * Where tenant files (logos, favicons, ADR 0019) are kept by the local-disk storage. Keys
     * below it are `tenants/<tenantId>/…`. An object store replaces it in production.
     */
    FILE_STORAGE_DIR: z.string().min(1).default('.data/files'),
    /** Key of the order tracking tokens; derived from JWT_ACCESS_SECRET when unset. */
    TRACKING_TOKEN_SECRET: z.string().min(32).optional(),
    // --- Tenant websites (cloud only, ADR 0023) ---
    /**
     * MADAR's web domain: every tenant's website answers on `<slug>.<PLATFORM_WEB_DOMAIN>`
     * (`madar.app` in production, `localhost` in development, where browsers resolve
     * `*.localhost` to this machine).
     */
    PLATFORM_WEB_DOMAIN: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/, 'PLATFORM_WEB_DOMAIN must be a bare domain')
      .default('localhost'),
    /**
     * Development only: the tenant (by slug) a website request gets when its host is bare
     * `localhost`/`127.0.0.1`, which names no tenant. Refused in production. Never applies to a
     * domain someone added: an unknown or unverified domain stays not found.
     */
    DEV_DEFAULT_TENANT_SLUG: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    /**
     * How custom domains are verified: `dns` looks the TXT record up; `mock`, the documented
     * test adapter, finds every record published (refused in production).
     */
    DOMAIN_VERIFIER: z.enum(['dns', 'mock']).default('dns'),
    /**
     * How a tenant's website is reached from a browser, `{domain}` standing for its domain: the
     * admin opens previews and links domains with it (`https://{domain}` behind the proxy; the
     * Vite server's port in development).
     */
    WEBSITE_URL: z
      .string()
      .regex(/^https?:\/\/\{domain\}(:\d{1,5})?$/, 'WEBSITE_URL must be http(s)://{domain}[:port]')
      .default('http://{domain}:5175'),
    /** Key of the website preview tokens; derived from JWT_ACCESS_SECRET when unset. */
    WEBSITE_PREVIEW_SECRET: z.string().min(32).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.ONLINE_PAYMENT_PROVIDER !== 'mock', {
    path: ['ONLINE_PAYMENT_PROVIDER'],
    message: 'The mock payment provider cannot run in production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.PAYMENT_TERMINAL_PROVIDER !== 'mock', {
    path: ['PAYMENT_TERMINAL_PROVIDER'],
    message: 'The mock card terminal cannot run in production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.DOMAIN_VERIFIER !== 'mock', {
    path: ['DOMAIN_VERIFIER'],
    message: 'The mock domain verifier cannot run in production',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.DEV_DEFAULT_TENANT_SLUG === undefined, {
    path: ['DEV_DEFAULT_TENANT_SLUG'],
    message: 'A default website tenant is for development only',
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.PLATFORM_WEB_DOMAIN !== 'localhost', {
    path: ['PLATFORM_WEB_DOMAIN'],
    message: "Set PLATFORM_WEB_DOMAIN to MADAR's web domain in production",
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.WEBSITE_URL.startsWith('https://'), {
    path: ['WEBSITE_URL'],
    message: 'Websites are served over HTTPS in production',
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
