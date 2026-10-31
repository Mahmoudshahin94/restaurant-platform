import { zodResolver } from '@hookform/resolvers/zod';
import {
  LanguageSwitcher,
  PlatformFooter,
  TenantLogo,
  ThemeSwitcher,
  tKey,
  useErrorText,
  useHubSignInBranding,
  useHubSignInLocales,
  useLocaleSelection,
} from '@pos/app-kit';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@pos/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { api, session, useSession } from '../lib/session';
import { usePreferences } from '../stores/preferences';

const loginForm = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'common:validation.required')
    .pipe(z.email('common:validation.invalid')),
  password: z.string().min(1, 'common:validation.required'),
});
type LoginForm = z.infer<typeof loginForm>;

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const errorText = useErrorText();
  const navigate = useNavigate();
  const status = useSession((s) => s.status);
  const setLocale = usePreferences((s) => s.setLocale);
  const storedLocale = usePreferences((s) => s.locale);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginForm),
    defaultValues: { email: '', password: '' },
  });
  const fieldError = (message?: string) => (message ? tKey(t, message) : undefined);
  // The kitchen's business, from the location hub (ADR 0019); MADAR's look elsewhere.
  useHubSignInBranding(api, true);
  // …and its languages (ADR 0020): only those are offered; without a choice, its default.
  const locales = useHubSignInLocales(api, true);
  useLocaleSelection(locales, { stored: storedLocale });

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await session.signIn(values.email, values.password);
      void navigate('/', { replace: true });
    } catch (e) {
      setError(errorText(e));
    }
  });

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="items-center text-center">
          <TenantLogo className="mb-2" />
          <CardTitle className="text-2xl">{t('auth:signIn.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-5" noValidate onSubmit={(e) => void onSubmit(e)}>
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <Field
              label={t('auth:signIn.email')}
              error={fieldError(form.formState.errors.email?.message)}
            >
              <Input
                type="email"
                dir="ltr"
                className="h-14 text-lg"
                autoComplete="username"
                {...form.register('email')}
              />
            </Field>
            <Field
              label={t('auth:signIn.password')}
              error={fieldError(form.formState.errors.password?.message)}
            >
              <Input
                type="password"
                dir="ltr"
                className="h-14 text-lg"
                autoComplete="current-password"
                {...form.register('password')}
              />
            </Field>
            <Button type="submit" size="xl" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('auth:signIn.submitting') : t('auth:signIn.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <LanguageSwitcher
          className="h-12 w-auto"
          locales={locales?.supported}
          onLocaleChange={setLocale}
        />
        <ThemeSwitcher className="h-12 w-auto" />
      </div>
      <PlatformFooter app="kds" />
    </div>
  );
}
