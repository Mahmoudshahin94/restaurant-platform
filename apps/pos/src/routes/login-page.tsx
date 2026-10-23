import { zodResolver } from '@hookform/resolvers/zod';
import {
  LanguageSwitcher,
  PlatformFooter,
  TenantLogo,
  ThemeSwitcher,
  tKey,
  useErrorText,
  useHubSignInBranding,
} from '@pos/app-kit';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, cn } from '@pos/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { PinSignIn } from '../components/pin-sign-in';
import { useHubStatus } from '../lib/queries';
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
  const [error, setError] = useState<string | null>(null);
  // Behind a location hub staff sign in with a PIN; email stays available for managers.
  const hub = useHubStatus();
  const [mode, setMode] = useState<'pin' | 'email' | null>(null);
  const method = mode ?? (hub.data ? 'pin' : 'email');
  // The location's business, from its hub (ADR 0019); MADAR's look without one.
  useHubSignInBranding(api, Boolean(hub.data));
  const form = useForm<LoginForm>({
    resolver: zodResolver(loginForm),
    defaultValues: { email: '', password: '' },
  });
  const fieldError = (message?: string) => (message ? tKey(t, message) : undefined);

  if (status === 'authenticated') return <Navigate to="/order" replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await session.signIn(values.email, values.password);
      void navigate('/order', { replace: true });
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
        <CardContent className="grid gap-4">
          {hub.data?.cloud === 'OFFLINE' ? <Alert>{t('auth:hub.offline')}</Alert> : null}
          {hub.data ? (
            <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {(['pin', 'email'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={method === m}
                  className={cn(
                    'h-11 rounded-md text-base font-medium',
                    method === m ? 'bg-card shadow-sm' : 'text-muted-foreground',
                  )}
                  onClick={() => {
                    setMode(m);
                  }}
                >
                  {m === 'pin' ? t('auth:pin.tab') : t('auth:pin.emailTab')}
                </button>
              ))}
            </div>
          ) : null}
          {method === 'pin' ? (
            <PinSignIn
              onSignIn={async (code, pin) => {
                await session.signInWithPin(code, pin);
                void navigate('/order', { replace: true });
              }}
            />
          ) : (
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
              <Button type="submit" size="touch" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting
                  ? t('auth:signIn.submitting')
                  : t('auth:signIn.submit')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <LanguageSwitcher className="h-12 w-auto" onLocaleChange={setLocale} />
        <ThemeSwitcher className="h-12 w-auto" />
      </div>
      <PlatformFooter app="pos" />
    </div>
  );
}
