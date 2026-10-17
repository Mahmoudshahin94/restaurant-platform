import type { Prisma, PrismaClient } from '@pos/database';

/**
 * The database client, as an injection token. The cloud API provides a PostgreSQL Prisma client;
 * the location hub provides its SQLite client, generated from the same models (a contract test in
 * `@pos/database` keeps the two structurally identical). Services are written once against this
 * type and never import a concrete client.
 */
// Class + interface merge: a DI token whose instances have the full client API. The class is
// never instantiated; each app provides the instance.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class, @typescript-eslint/no-unsafe-declaration-merging
export abstract class PrismaService {}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type
export interface PrismaService extends PrismaClient {}

/** A Prisma client usable both directly and inside `$transaction(async (tx) => ...)`. */
export type PrismaTx = Prisma.TransactionClient;
