import { isApiError } from '@pos/api-client';
import { useErrorText } from '@pos/app-kit';
import { Alert, Button, Field, Input, cn } from '@pos/ui';
import { Delete } from 'lucide-react';
import { type SyntheticEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/**
 * Employee code + PIN with a large on-screen keypad (touch tills have no keyboard). The keypad
 * types into whichever field is active; a physical keyboard works too.
 */
export function PinSignIn({
  onSignIn,
}: {
  onSignIn: (code: string, pin: string) => Promise<void>;
}) {
  const { t } = useTranslation('auth');
  const errorText = useErrorText();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState<'code' | 'pin'>('code');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  const type = (key: string) => {
    if (active === 'code') setCode((c) => (c + key).slice(0, 20));
    else setPin((p) => (p + key).slice(0, 8));
  };
  const backspace = () => {
    if (active === 'code') setCode((c) => c.slice(0, -1));
    else setPin((p) => p.slice(0, -1));
  };
  const clear = () => {
    if (active === 'code') setCode('');
    else setPin('');
  };

  const submit = async (event?: SyntheticEvent) => {
    event?.preventDefault();
    if (!code || pin.length < 4 || pending) return;
    setError(null);
    setPending(true);
    try {
      await onSignIn(code.trim(), pin);
    } catch (e) {
      setError(isApiError(e) && e.code === 'INVALID_CREDENTIALS' ? t('pin.invalid') : errorText(e));
      setPin('');
      setActive('pin');
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="grid gap-4" noValidate onSubmit={(e) => void submit(e)}>
      <p className="text-sm text-muted-foreground">{t('pin.hint')}</p>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('pin.code')}>
          <Input
            dir="ltr"
            inputMode="numeric"
            autoComplete="username"
            className={cn(
              'h-14 text-center text-2xl tracking-widest',
              active === 'code' && 'ring-2 ring-ring',
            )}
            value={code}
            onFocus={() => {
              setActive('code');
            }}
            onChange={(e) => {
              setCode(e.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 20));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setActive('pin');
                pinRef.current?.focus();
              }
            }}
          />
        </Field>
        <Field label={t('pin.pin')}>
          <Input
            ref={pinRef}
            type="password"
            dir="ltr"
            inputMode="numeric"
            autoComplete="current-password"
            className={cn(
              'h-14 text-center text-2xl tracking-[0.5em]',
              active === 'pin' && 'ring-2 ring-ring',
            )}
            value={pin}
            onFocus={() => {
              setActive('pin');
            }}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
            }}
          />
        </Field>
      </div>
      <div role="group" aria-label={t('pin.keypad')} className="grid grid-cols-3 gap-2" dir="ltr">
        {DIGITS.map((digit) => (
          <Button
            key={digit}
            type="button"
            variant="outline"
            className="h-16 text-2xl font-semibold"
            aria-label={t('pin.digit', { digit })}
            onClick={() => {
              type(digit);
            }}
          >
            {digit}
          </Button>
        ))}
        <Button type="button" variant="ghost" className="h-16 text-base" onClick={clear}>
          {t('pin.clear')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-16 text-2xl font-semibold"
          aria-label={t('pin.digit', { digit: '0' })}
          onClick={() => {
            type('0');
          }}
        >
          0
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-16"
          aria-label={t('pin.back')}
          onClick={backspace}
        >
          <Delete aria-hidden className="size-6" />
        </Button>
      </div>
      <Button type="submit" size="xl" disabled={pending || !code || pin.length < 4}>
        {pending ? t('signIn.submitting') : t('pin.submit')}
      </Button>
    </form>
  );
}
