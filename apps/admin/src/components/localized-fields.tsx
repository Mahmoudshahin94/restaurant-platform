import { Field, Input, Textarea } from '@pos/ui';
import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { tKey } from '@pos/app-kit';

interface LocalizedFieldsProps<T extends FieldValues> {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  /** Field name prefix, e.g. "" for top level or "variants.0." for array rows. */
  prefix?: string;
  withDescription?: boolean;
}

/**
 * English + Arabic inputs side by side. Each input declares its own `lang`/`dir`, so Arabic is
 * typed right-to-left even in the English UI and vice versa.
 */
export function LocalizedFields<T extends FieldValues>({
  register,
  errors,
  prefix = '',
  withDescription = false,
}: LocalizedFieldsProps<T>) {
  const { t } = useTranslation(['menu', 'common']);
  const name = (field: string) => `${prefix}${field}` as Path<T>;
  const errorOf = (field: string): string | undefined => {
    const message = (errors as Record<string, { message?: string } | undefined>)[field]?.message;
    return message ? tKey(t, message) : undefined;
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('menu:fields.nameEn')} error={errorOf('nameEn')}>
        <Input lang="en" dir="ltr" autoComplete="off" {...register(name('nameEn'))} />
      </Field>
      <Field label={t('menu:fields.nameAr')} error={errorOf('nameAr')}>
        <Input lang="ar" dir="rtl" autoComplete="off" {...register(name('nameAr'))} />
      </Field>
      {withDescription ? (
        <>
          <Field label={t('menu:fields.descriptionEn')} hint={t('common:states.optional')}>
            <Textarea lang="en" dir="ltr" rows={2} {...register(name('descriptionEn'))} />
          </Field>
          <Field label={t('menu:fields.descriptionAr')} hint={t('common:states.optional')}>
            <Textarea lang="ar" dir="rtl" rows={2} {...register(name('descriptionAr'))} />
          </Field>
        </>
      ) : null}
    </div>
  );
}
