import { type PipeTransform } from '@nestjs/common';
import { DomainError } from '@pos/domain';
import type { z } from 'zod';

/**
 * Validates and transforms a request part with a schema from @pos/validation, the single source
 * of API contracts. Usage: `@Body(new ZodValidationPipe(createLocationSchema)) body: ...`.
 */
export class ZodValidationPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw new DomainError('VALIDATION_FAILED', 'Request validation failed', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
