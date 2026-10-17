import { isApiError } from '@pos/api-client';
import { useTranslation } from 'react-i18next';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

type UntypedT = (key: string) => string;

/**
 * Translates a key computed at runtime (form validation messages, API error codes). Static keys
 * should call `t` directly so TypeScript checks them; this is the one sanctioned escape hatch.
 */
export function tKey(t: (...args: never[]) => unknown, key: string): string {
  return (t as unknown as UntypedT)(key);
}

/** Localized, user-facing text for any thrown value. Never shows server internals. */
export function useErrorText(): (error: unknown) => string {
  const { t } = useTranslation();
  return (error) => tKey(t, `errors:${isApiError(error) ? error.code : 'INTERNAL_ERROR'}`);
}

/**
 * Maps server-side VALIDATION_FAILED issues onto form fields so the user sees them in place.
 * Returns true when at least one issue was attached to a field.
 */
export function applyServerValidation<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  if (!isApiError(error) || error.code !== 'VALIDATION_FAILED') return false;
  const issues = error.details.issues;
  if (!Array.isArray(issues)) return false;
  let applied = false;
  for (const issue of issues as { path?: unknown }[]) {
    const field = Array.isArray(issue.path) ? issue.path.join('.') : '';
    if ((fields as readonly string[]).includes(field)) {
      setError(field as Path<T>, { message: 'common:validation.invalid' });
      applied = true;
    }
  }
  return applied;
}
