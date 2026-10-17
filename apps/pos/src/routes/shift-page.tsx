import { isApiError } from '@pos/api-client';
import {
  QueryState,
  useCurrentLocale,
  useErrorText,
  useMoneyFormat,
  usePermissionChecks,
} from '@pos/app-kit';
import { newId, parseDecimalToMinor } from '@pos/domain';
import { formatDateTime, pickLocalized } from '@pos/i18n';
import type { Shift } from '@pos/validation';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  NativeSelect,
  Spinner,
} from '@pos/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCashRegisters,
  useCurrentShift,
  useDailySummary,
  useLocationId,
  useLocations,
  useOrderMutation,
} from '../lib/queries';
import { api, useSession } from '../lib/session';
import { usePreferences } from '../stores/preferences';

function toMinor(value: string, currency: string): number | null {
  try {
    return value.trim() ? parseDecimalToMinor(value, currency) : null;
  } catch {
    return null;
  }
}

function OpenShiftForm({ locationId, currency }: { locationId: string; currency: string }) {
  const { t } = useTranslation(['payments', 'common']);
  const locale = useCurrentLocale();
  const errorText = useErrorText();
  const registers = useCashRegisters(locationId);
  const setShiftId = usePreferences((s) => s.setShiftId);
  const [registerId, setRegisterId] = useState('');
  const [float, setFloat] = useState('');
  const [shiftId] = useState(newId);
  const [error, setError] = useState<string | null>(null);
  const open = useOrderMutation(() =>
    api.shifts.open(locationId, {
      id: shiftId,
      cashRegisterId: registerId,
      openingFloat: toMinor(float, currency) ?? 0,
    }),
  );

  useEffect(() => {
    if (!registerId && registers.data?.[0]) setRegisterId(registers.data[0].id);
  }, [registers.data, registerId]);

  const selected = registers.data?.find((r) => r.id === registerId);
  // Wait for the drawers: whether one already has an open shift decides what to show.
  if (registers.isPending || !selected) {
    return (
      <div className="flex justify-center p-12">
        <Spinner label={t('common:states.loading')} />
      </div>
    );
  }
  const submit = async () => {
    setError(null);
    try {
      const shift = await open.mutateAsync(undefined);
      setShiftId(shift.id);
    } catch (e) {
      setError(
        isApiError(e) && e.code === 'SHIFT_ALREADY_OPEN'
          ? t('payments:shift.alreadyOpen')
          : errorText(e),
      );
    }
  };

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <CardTitle className="text-2xl">{t('payments:shift.none')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label={t('payments:shift.register')}>
          <NativeSelect
            className="h-12 text-base"
            value={registerId}
            onChange={(e) => {
              setRegisterId(e.target.value);
            }}
          >
            {(registers.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {pickLocalized(r, 'name', locale)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {selected.openShiftId ? (
          <Alert
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setShiftId(selected.openShiftId);
                }}
              >
                {t('payments:shift.useOpen')}
              </Button>
            }
          >
            {t('payments:shift.alreadyOpen')}
          </Alert>
        ) : (
          <>
            <Field label={`${t('payments:shift.openingFloat')} (${currency})`}>
              <Input
                inputMode="decimal"
                dir="ltr"
                className="h-12 text-lg"
                value={float}
                onChange={(e) => {
                  setFloat(e.target.value);
                }}
              />
            </Field>
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <Button
              size="touch"
              disabled={!registerId || toMinor(float, currency) === null || open.isPending}
              onClick={() => void submit()}
            >
              {t('payments:shift.open')}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CashMovementDialog({
  shift,
  type,
  currency,
  onDone,
}: {
  shift: Shift;
  type: 'PAY_IN' | 'PAY_OUT';
  currency: string;
  onDone: () => void;
}) {
  const { t } = useTranslation(['payments', 'common']);
  const errorText = useErrorText();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [id] = useState(newId);
  const [error, setError] = useState<string | null>(null);
  const minor = toMinor(amount, currency);
  const save = useOrderMutation(() =>
    api.shifts.cashMovement(shift.locationId, shift.id, {
      id,
      type,
      amount: minor ?? 0,
      reason: reason.trim(),
    }),
  );
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>
          {type === 'PAY_IN' ? t('payments:shift.payIn') : t('payments:shift.payOut')}
        </DialogTitle>
      </DialogHeader>
      <Field label={`${t('payments:amount')} (${currency})`}>
        <Input
          inputMode="decimal"
          dir="ltr"
          className="h-12 text-lg"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
          }}
        />
      </Field>
      <Field label={t('payments:shift.movementReason')}>
        <Input
          className="h-12"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
          }}
        />
      </Field>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <DialogFooter>
        <Button
          size="touch"
          disabled={!minor || !reason.trim() || save.isPending}
          onClick={() =>
            void save.mutateAsync(undefined).then(onDone, (e: unknown) => {
              setError(errorText(e));
            })
          }
        >
          {t('common:actions.save')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function CloseShiftDialog({
  shift,
  currency,
  onClosed,
}: {
  shift: Shift;
  currency: string;
  onClosed: (closed: Shift) => void;
}) {
  const { t } = useTranslation(['payments', 'common']);
  const errorText = useErrorText();
  const { format } = useMoneyFormat(currency);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const countedMinor = toMinor(counted, currency);
  const difference = countedMinor === null ? null : countedMinor - shift.summary.cash.expectedCash;
  const close = useOrderMutation(() =>
    api.shifts.close(shift.locationId, shift.id, {
      countedCash: countedMinor ?? 0,
      notes: notes.trim() || null,
    }),
  );
  return (
    <DialogContent closeLabel={t('common:actions.close')}>
      <DialogHeader>
        <DialogTitle>{t('payments:shift.close')}</DialogTitle>
      </DialogHeader>
      <p className="text-lg">
        {t('payments:shift.expectedCash')}:{' '}
        <strong>{format(shift.summary.cash.expectedCash)}</strong>
      </p>
      <Field label={`${t('payments:shift.countedCash')} (${currency})`}>
        <Input
          inputMode="decimal"
          dir="ltr"
          className="h-12 text-lg"
          value={counted}
          onChange={(e) => {
            setCounted(e.target.value);
          }}
        />
      </Field>
      {difference !== null ? (
        <p className="text-lg" data-testid="cash-difference">
          {t('payments:shift.difference')}: <strong>{format(difference)}</strong> ·{' '}
          {difference === 0
            ? t('payments:shift.balanced')
            : difference > 0
              ? t('payments:shift.over')
              : t('payments:shift.short')}
        </p>
      ) : null}
      <Field label={t('payments:shift.notes')}>
        <Input
          className="h-12"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
          }}
        />
      </Field>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <DialogFooter>
        <Button
          size="touch"
          variant="destructive"
          disabled={countedMinor === null || close.isPending}
          onClick={() =>
            void close.mutateAsync(undefined).then(onClosed, (e: unknown) => {
              setError(errorText(e));
            })
          }
        >
          {t('payments:shift.close')}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function DailySummaryCard({ locationId }: { locationId: string }) {
  const { t } = useTranslation(['payments', 'orders']);
  const locale = useCurrentLocale();
  const summary = useDailySummary(locationId);
  const { format } = useMoneyFormat(summary.data?.currencyCode ?? null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('payments:daily.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState query={summary}>
          {(s) => (
            <div className="grid gap-4 md:grid-cols-3">
              <dl className="grid grid-cols-2 gap-1">
                <dt>{t('payments:daily.orders')}</dt>
                <dd className="text-end font-semibold">{s.orders.count}</dd>
                <dt>{t('payments:daily.completed')}</dt>
                <dd className="text-end">{s.orders.completed}</dd>
                <dt>{t('payments:daily.open')}</dt>
                <dd className="text-end">{s.orders.open}</dd>
                <dt>{t('payments:daily.cancelled')}</dt>
                <dd className="text-end">{s.orders.cancelled}</dd>
              </dl>
              <dl className="grid grid-cols-2 gap-1">
                <dt>{t('payments:daily.sales')}</dt>
                <dd className="text-end font-semibold">{format(s.sales.total)}</dd>
                {s.byChannel.map((c) => (
                  <div key={c.channel} className="contents">
                    <dt>{t(`orders:channel.${c.channel}`)}</dt>
                    <dd className="text-end">{format(c.total)}</dd>
                  </div>
                ))}
              </dl>
              <dl className="grid grid-cols-2 gap-1">
                <dt>{t('payments:daily.netCollected')}</dt>
                <dd className="text-end font-semibold" data-testid="net-collected">
                  {format(s.netCollected)}
                </dd>
                {s.payments.map((p) => (
                  <div key={p.paymentMethodId} className="contents">
                    <dt>{pickLocalized(p, 'name', locale)}</dt>
                    <dd className="text-end">{format(p.net)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </QueryState>
      </CardContent>
    </Card>
  );
}

/** Opening, monitoring and closing the drawer shift, plus today's summary. */
export function ShiftPage() {
  const { t } = useTranslation(['payments', 'common']);
  const locale = useCurrentLocale();
  const locationId = useLocationId();
  const location = useLocations().data?.find((l) => l.id === locationId);
  const currency = useCashCurrency();
  const { format } = useMoneyFormat(currency);
  const { shift, query, shiftId } = useCurrentShift(locationId);
  const setShiftId = usePreferences((s) => s.setShiftId);
  const user = useSession((s) => s.user);
  const { canAt } = usePermissionChecks(user);
  const [dialog, setDialog] = useState<'PAY_IN' | 'PAY_OUT' | 'CLOSE' | null>(null);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);

  // A shift closed elsewhere is no longer this terminal's shift.
  useEffect(() => {
    if (query.data && query.data.status !== 'OPEN') setShiftId(null);
  }, [query.data, setShiftId]);

  if (!currency || !location) return <Spinner label={t('common:states.loading')} />;

  return (
    <div className="grid h-full content-start gap-4 overflow-y-auto">
      {closedMessage ? <Alert>{closedMessage}</Alert> : null}
      {!shift || !shiftId ? (
        <OpenShiftForm locationId={locationId} currency={currency} />
      ) : (
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl">
                {t('payments:shift.title')} ·{' '}
                {pickLocalized(
                  { nameEn: shift.cashRegisterNameEn, nameAr: shift.cashRegisterNameAr },
                  'name',
                  locale,
                )}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('payments:shift.openedBy', {
                  name: shift.openedByName,
                  time: formatDateTime(shift.openedAt, location.timezone, locale),
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canAt(locationId, 'cash.manage') ? (
                <>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      setDialog('PAY_IN');
                    }}
                  >
                    {t('payments:shift.payIn')}
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => {
                      setDialog('PAY_OUT');
                    }}
                  >
                    {t('payments:shift.payOut')}
                  </Button>
                </>
              ) : null}
              <Button
                variant="destructive"
                size="lg"
                onClick={() => {
                  setDialog('CLOSE');
                }}
              >
                {t('payments:shift.close')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <dl className="grid grid-cols-2 gap-2 text-lg">
              <dt>{t('payments:shift.openingFloat')}</dt>
              <dd className="text-end">{format(shift.summary.cash.openingFloat)}</dd>
              <dt>{t('payments:shift.cashSales')}</dt>
              <dd className="text-end">{format(shift.summary.cash.cashSales)}</dd>
              <dt>{t('payments:shift.cashRefunds')}</dt>
              <dd className="text-end">{format(-shift.summary.cash.cashRefunds)}</dd>
              <dt>{t('payments:shift.payIns')}</dt>
              <dd className="text-end">{format(shift.summary.cash.payIns)}</dd>
              <dt>{t('payments:shift.payOuts')}</dt>
              <dd className="text-end">{format(-shift.summary.cash.payOuts)}</dd>
              <dt className="font-bold">{t('payments:shift.expectedCash')}</dt>
              <dd className="text-end text-xl font-bold" data-testid="expected-cash">
                {format(shift.summary.cash.expectedCash)}
              </dd>
            </dl>
            <div>
              <h3 className="mb-2 font-semibold">{t('payments:shift.byMethod')}</h3>
              <dl className="grid grid-cols-2 gap-2">
                {shift.summary.byMethod.map((m) => (
                  <div key={m.paymentMethodId} className="contents">
                    <dt>{pickLocalized(m, 'name', locale)}</dt>
                    <dd className="text-end">{format(m.net)}</dd>
                  </div>
                ))}
                <dt className="text-muted-foreground">{t('payments:shift.orders')}</dt>
                <dd className="text-end text-muted-foreground">{shift.summary.orderCount}</dd>
              </dl>
            </div>
          </CardContent>
          <Dialog
            open={dialog !== null}
            onOpenChange={(o) => {
              if (!o) setDialog(null);
            }}
          >
            {dialog === 'PAY_IN' || dialog === 'PAY_OUT' ? (
              <CashMovementDialog
                shift={shift}
                type={dialog}
                currency={currency}
                onDone={() => {
                  setDialog(null);
                }}
              />
            ) : null}
            {dialog === 'CLOSE' ? (
              <CloseShiftDialog
                shift={shift}
                currency={currency}
                onClosed={(closed) => {
                  setDialog(null);
                  setShiftId(null);
                  setClosedMessage(
                    t('payments:shift.closed', { difference: format(closed.cashDifference ?? 0) }),
                  );
                }}
              />
            ) : null}
          </Dialog>
        </Card>
      )}
      <DailySummaryCard locationId={locationId} />
    </div>
  );
}

/** The restaurant currency (from the restaurant settings). */
function useCashCurrency(): string | null {
  const summary = useDailySummary(useLocationId());
  return summary.data?.currencyCode ?? null;
}
