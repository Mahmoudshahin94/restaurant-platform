import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient, hashSecret } from '@pos/database';
import { PlatformRole } from '@pos/shared-types';
import { z } from 'zod';

/** A platform password: long, because it opens every tenant. */
export const PLATFORM_PASSWORD_MIN = 12;

const inputSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(120),
  role: z.enum([
    PlatformRole.OWNER,
    PlatformRole.OPERATOR,
    PlatformRole.SUPPORT,
    PlatformRole.VIEWER,
  ]),
  locale: z.enum(['en', 'ar']),
  password: z.string().min(PLATFORM_PASSWORD_MIN).max(256),
});

/**
 * Creates a platform user (ADR 0025): the first owner, and until the platform has a user screen,
 * any other operator. There is no sign-up. The password comes from the environment
 * (`PLATFORM_USER_PASSWORD`), never the command line, so it stays out of the shell history.
 *
 *   PLATFORM_USER_PASSWORD=… pnpm platform:create-owner -- --email ops@madar.app --name "Ops"
 *   … --role OPERATOR --locale ar
 */
async function main(): Promise<void> {
  const envFile = resolve(__dirname, '../../../.env');
  if (process.env.NODE_ENV !== 'production' && existsSync(envFile)) process.loadEnvFile(envFile);
  const { values } = parseArgs({
    // `pnpm platform:create-owner -- --email …` passes the `--` on.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string', default: PlatformRole.OWNER },
      locale: { type: 'string', default: 'en' },
    },
  });
  const parsed = inputSchema.safeParse({ ...values, password: process.env.PLATFORM_USER_PASSWORD });
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    console.error(
      `Usage: PLATFORM_USER_PASSWORD=<at least ${PLATFORM_PASSWORD_MIN} characters> ` +
        'platform:create-owner -- --email <e-mail> --name <name> [--role OWNER|OPERATOR|SUPPORT|VIEWER] [--locale en|ar]\n' +
        problems.join('\n'),
    );
    process.exitCode = 1;
    return;
  }
  const input = parsed.data;
  const prisma = new PrismaClient();
  try {
    if (await prisma.platformUser.findUnique({ where: { email: input.email } })) {
      console.error(`A platform user with the e-mail ${input.email} already exists.`);
      process.exitCode = 1;
      return;
    }
    const user = await prisma.platformUser.create({
      data: {
        email: input.email,
        displayName: input.name,
        role: input.role,
        preferredLocale: input.locale,
        passwordHash: await hashSecret(input.password),
      },
    });
    await prisma.platformAuditLog.create({
      data: {
        actorId: null,
        action: 'platform_user.created',
        entityType: 'PlatformUser',
        entityId: user.id,
        metadata: { email: user.email, role: user.role, via: 'cli' },
      },
    });
    console.log(`Platform ${user.role.toLowerCase()} ${user.email} created (${user.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
