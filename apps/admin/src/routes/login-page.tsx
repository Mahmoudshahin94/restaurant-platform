import { zodResolver } from '@hookform/resolvers/zod';
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
import { LanguageSwitcher } from '../components/language-switcher';
import { api } from '../lib/api';
import { tKey, useErrorText } from '../lib/errors';
import { useSession } from '../stores/session';

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
  const location = useLocation();
  const { status, setSession } = useSession();
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
      const session = await api.auth.login({ ...values, client: 'web' });
      setSession(session.accessToken, session.user);
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
          <CardTitle>{t('auth:signIn.title')}</CardTitle>
          <CardDescription>{t('auth:signIn.subtitle')}</CardDescription>
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
      <LanguageSwitcher />
    </div>
  );
}
