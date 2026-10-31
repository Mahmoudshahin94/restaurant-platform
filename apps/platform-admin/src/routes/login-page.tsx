import { zodResolver } from '@hookform/resolvers/zod';
import { PlatformFooter, ThemeSwitcher, tKey, useErrorText } from '@pos/app-kit';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from '@pos/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { z } from 'zod';
import { BrandLogo } from '../components/brand-logo';
import { LanguageSwitcher } from '../components/language-switcher';
import { session, useSession } from '../lib/api';

const loginForm = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'common:validation.required')
    .pipe(z.email('common:validation.invalid')),
  password: z.string().min(1, 'common:validation.required'),
});
type LoginForm = z.infer<typeof loginForm>;

/** Operators only: business staff are refused here, and platform tokens anywhere else. */
export function LoginPage() {
  const { t } = useTranslation(['platform', 'auth', 'common']);
  const errorText = useErrorText();
  const navigate = useNavigate();
  const location = useLocation();
  const status = useSession((s) => s.status);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginForm),
    defaultValues: { email: '', password: '' },
  });
  const fieldError = (message?: string) => (message ? tKey(t, message) : undefined);

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await session.signIn(values.email, values.password);
      const from = (location.state as { from?: string } | null)?.from;
      void navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (e) {
      setError(errorText(e));
    }
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <BrandLogo className="h-8" />
          <CardTitle>{t('platform:signIn.title')}</CardTitle>
          <CardDescription>{t('platform:signIn.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" noValidate onSubmit={(e) => void onSubmit(e)}>
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <Field
              label={t('auth:signIn.email')}
              error={fieldError(form.formState.errors.email?.message)}
            >
              <Input type="email" dir="ltr" autoComplete="username" {...form.register('email')} />
            </Field>
            <Field
              label={t('auth:signIn.password')}
              error={fieldError(form.formState.errors.password?.message)}
            >
              <Input
                type="password"
                dir="ltr"
                autoComplete="current-password"
                {...form.register('password')}
              />
            </Field>
            <Button type="submit" size="lg" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t('auth:signIn.submitting') : t('auth:signIn.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <LanguageSwitcher />
        <ThemeSwitcher />
      </div>
      <PlatformFooter app="platform" />
    </div>
  );
}
