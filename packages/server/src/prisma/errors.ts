/**
 * Prisma "known request" errors, recognised by shape rather than `instanceof`: the cloud
 * (PostgreSQL) and hub (SQLite) clients are separate generated packages with separate error
 * classes, and services must handle both the same way.
 */
export interface PrismaKnownError {
  name: 'PrismaClientKnownRequestError';
  code: string;
  meta?: Record<string, unknown>;
}

export function isPrismaKnownError(error: unknown, code?: string): error is PrismaKnownError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return (
    candidate.name === 'PrismaClientKnownRequestError' &&
    typeof candidate.code === 'string' &&
    (code === undefined || candidate.code === code)
  );
}

/** A unique constraint was violated (Prisma P2002), e.g. two requests racing on the same id. */
export const isUniqueViolation = (error: unknown): boolean => isPrismaKnownError(error, 'P2002');
