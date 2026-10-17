import { useCurrentLocale, useErrorText, useMoneyFormat, usePermissionChecks } from '@pos/app-kit';
import { formatTime, pickLocalized } from '@pos/i18n';
import { WebRejectReason } from '@pos/shared-types';
import type { Order } from '@pos/validation';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  cn,
} from '@pos/ui';
import { useQuery } from '@tanstack/react-query';
import { Bike, Globe, ShoppingBag, Timer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocationId, useLocations, useOrderMutation } from '../lib/queries';
import { api, useSession } from '../lib/session';

type RejectCode = (typeof WebRejectReason)[keyof typeof WebRejectReason];
const REJECT_CODES = Object.values(WebRejectReason);

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}

const mmss = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Website orders waiting for this location's decision (oldest first). */
function usePendingWebOrders(locationId: string) {
  return useQuery({
    queryKey: ['orders', locationId, 'web-pending'],
    queryFn: () => api.orders.list(locationId, { status: ['PLACED'], limit: 50 }),
    select: (orders) =>
      orders
        .filter((o) => o.channel === 'WEBSITE')
        .sort((a, b) => (a.placedAt ?? '').localeCompare(b.placedAt ?? '')),
    // Realtime `order.*` events refresh it at once; polling is the fallback.
    refetchInterval: 15_000,
  });
}

export function WebOrderDetails({
  order,
  now,
  timeZone,
}: {
  order: Order;
  now: number;
  timeZone: string;
}) {
  const { t } = useTranslation(['pos', 'orders']);
  const locale = useCurrentLocale();
  const { format } = useMoneyFormat(order.currencyCode);
  const left = order.acceptBy ? new Date(order.acceptBy).getTime() - now : null;
  const address = order.deliveryAddress
    ? [order.deliveryAddress.line1, order.deliveryAddress.line2, order.deliveryAddress.city]
        .filter(Boolean)
        .join(locale === 'ar' ? '، ' : ', ')
    : '';
  const paidOnline = order.payments.some((p) => p.methodType === 'ONLINE' && p.type === 'CHARGE');
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1 text-sm">
          {order.fulfillmentType === 'DELIVERY' ? (
            <Bike aria-hidden className="size-4" />
          ) : (
            <ShoppingBag aria-hidden className="size-4" />
          )}
          {order.fulfillmentType === 'DELIVERY' ? t('pos:web.delivery') : t('pos:web.pickup')}
        </Badge>
        <Badge variant={paidOnline ? 'success' : 'outline'} className="text-sm">
          {paidOnline
            ? t('pos:web.paidOnline')
            : order.fulfillmentType === 'DELIVERY'
              ? t('pos:web.cashOnDelivery')
              : t('pos:web.payAtPickup')}
        </Badge>
        {left !== null ? (
          <span
            className={cn(
              'ms-auto flex items-center gap-1 font-semibold',
              left < 120_000 && 'text-destructive',
            )}
            data-testid="accept-countdown"
          >
            <Timer aria-hidden className="size-4" />
            {left > 0 ? (
              t('pos:web.acceptWithin', { time: mmss(left) })
            ) : (
              <span>{t('pos:web.expired')}</span>
            )}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-medium">{t('pos:web.customer')}</dt>
        <dd>
          {order.customerName}
          {order.customerPhone ? (
            <bdi className="ltr-nums ms-2 text-muted-foreground">{order.customerPhone}</bdi>
          ) : null}
        </dd>
        {order.placedAt ? (
          <>
            <dt className="font-medium">{t('orders:fields.placedAt')}</dt>
            <dd className="ltr-nums">{formatTime(order.placedAt, timeZone, locale)}</dd>
          </>
        ) : null}
        {order.fulfillmentType === 'DELIVERY' ? (
          <>
            <dt className="font-medium">{t('pos:web.delivery')}</dt>
            <dd>
              {t('pos:web.deliverTo', { address })}
              {order.deliveryAddress?.notes ? (
                <span className="block text-muted-foreground">{order.deliveryAddress.notes}</span>
              ) : null}
            </dd>
          </>
        ) : null}
        {order.notes ? (
          <>
            <dt className="font-medium">{t('pos:web.notes')}</dt>
            <dd>{order.notes}</dd>
          </>
        ) : null}
      </dl>
      <ul className="divide-y rounded-md border">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3 px-3 py-2">
            <span>
              <bdi dir="ltr" className="ltr-nums me-1 font-semibold">
                {item.quantity}×
              </bdi>
              {pickLocalized(item, 'name', locale)}
              {item.variantNameEn ? (
                <span className="text-muted-foreground">
                  {' '}
                  · {pickLocalized(item, 'variantName', locale)}
                </span>
              ) : null}
              {item.modifiers.length > 0 ? (
                <span className="block text-sm text-muted-foreground">
                  {item.modifiers
                    .map((m) => pickLocalized(m, 'name', locale))
                    .join(locale === 'ar' ? '، ' : ', ')}
                </span>
              ) : null}
              {item.notes ? <span className="block text-sm italic">{item.notes}</span> : null}
            </span>
            <span className="ltr-nums shrink-0">{format(item.total)}</span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between text-lg font-semibold">
        <span>{t('orders:totals.total')}</span>
        <span className="ltr-nums">{format(order.total)}</span>
      </p>
    </div>
  );
}

function RejectForm({
  order,
  pending,
  onReject,
  onBack,
}: {
  order: Order;
  pending: boolean;
  onReject: (reason: string) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation(['pos', 'common']);
  const [code, setCode] = useState<RejectCode>(WebRejectReason.TOO_BUSY);
  const [note, setNote] = useState('');
  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('pos:web.rejectTitle', { number: order.orderNumber })}</DialogTitle>
        <DialogDescription>{t('pos:web.rejectHint')}</DialogDescription>
      </DialogHeader>
      <fieldset className="grid gap-2">
        <legend className="mb-1 font-medium">{t('pos:web.reasonLabel')}</legend>
        {REJECT_CODES.map((value) => (
          <label
            key={value}
            className={cn(
              'flex min-h-12 items-center gap-3 rounded-lg border-2 px-3',
              code === value ? 'border-primary bg-primary/10' : 'border-border',
            )}
          >
            <input
              type="radio"
              name="reject-reason"
              value={value}
              checked={code === value}
              onChange={() => {
                setCode(value);
              }}
            />
            {t(`pos:web.reason.${value}`)}
          </label>
        ))}
        {code === WebRejectReason.OTHER ? (
          <label className="grid gap-1.5">
            <span className="text-sm">{t('pos:web.otherNote')}</span>
            <Textarea
              rows={2}
              maxLength={300}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </label>
        ) : null}
      </fieldset>
      <DialogFooter>
        <Button variant="outline" size="lg" onClick={onBack}>
          {t('common:actions.back')}
        </Button>
        <Button
          variant="destructive"
          size="lg"
          disabled={pending || (code === WebRejectReason.OTHER && !note.trim())}
          onClick={() => {
            // Preset reasons travel as their code (customers see them translated); free text
            // stays with the staff (customers see a general message).
            onReject(code === WebRejectReason.OTHER ? note.trim() : code);
          }}
        >
          {t('pos:web.confirmReject')}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Incoming website orders (ADR 0013): a banner while any wait for a decision, and a dialog that
 * opens by itself for each new one, to accept (the order goes to the kitchen and the hub takes it
 * over from the cloud) or reject with a reason (the order is cancelled, online payments voided).
 */
export function WebOrdersPrompt() {
  const { t } = useTranslation(['pos', 'common']);
  const locationId = useLocationId();
  const errorText = useErrorText();
  const user = useSession((s) => s.user);
  const permissions = usePermissionChecks(user);
  const pending = usePendingWebOrders(locationId);
  const timeZone = useLocations().data?.find((l) => l.id === locationId)?.timezone ?? 'UTC';
  const now = useNow(1000);
  const [openId, setOpenId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const seen = useRef(new Set<string>());

  const orders = useMemo(() => pending.data ?? [], [pending.data]);
  const current = orders.find((o) => o.id === openId) ?? null;

  // A new website order opens the dialog by itself (once); "Later" leaves the banner.
  useEffect(() => {
    const fresh = orders.find((o) => !seen.current.has(o.id));
    for (const o of orders) seen.current.add(o.id);
    if (fresh && openId === null) setOpenId(fresh.id);
  }, [orders, openId]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => {
      setNotice(null);
    }, 6000);
    return () => {
      clearTimeout(id);
    };
  }, [notice]);

  const decide = useOrderMutation(
    (input: { order: Order; to: 'CONFIRMED' | 'CANCELLED'; reason: string | null }) =>
      api.orders.transition(locationId, input.order.id, {
        to: input.to,
        reason: input.reason,
        version: input.order.version,
      }),
  );
  const close = () => {
    setOpenId(null);
    setRejecting(false);
    decide.reset();
  };
  const run = (order: Order, to: 'CONFIRMED' | 'CANCELLED', reason: string | null = null) => {
    decide.mutate(
      { order, to, reason },
      {
        onSuccess: () => {
          setNotice(
            t(to === 'CONFIRMED' ? 'pos:web.accepted' : 'pos:web.rejected', {
              number: order.orderNumber,
            }),
          );
          close();
        },
      },
    );
  };
  const canAccept = permissions.canAt(locationId, 'orders.update');
  const canReject = permissions.canAt(locationId, 'orders.cancel');
  const expired = (o: Order) => o.acceptBy !== null && new Date(o.acceptBy).getTime() <= now;

  return (
    <>
      {orders.length > 0 ? (
        <div
          role="status"
          className="mb-3 flex items-center gap-3 rounded-lg border-2 border-warning bg-warning/15 px-4 py-2"
          data-testid="web-orders-banner"
        >
          <Globe aria-hidden className="size-5" />
          <span className="font-semibold">{t('pos:web.banner', { count: orders.length })}</span>
          <Button
            className="ms-auto"
            onClick={() => {
              setOpenId(orders[0]?.id ?? null);
            }}
          >
            {t('pos:web.review')}
          </Button>
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="mb-3 rounded-lg bg-success px-4 py-2 font-semibold text-success-foreground"
        >
          {notice}
        </div>
      ) : null}
      <Dialog
        open={current !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        {current ? (
          <DialogContent closeLabel={t('common:actions.close')} className="max-w-2xl">
            {rejecting ? (
              <RejectForm
                order={current}
                pending={decide.isPending}
                onBack={() => {
                  setRejecting(false);
                }}
                onReject={(reason) => {
                  run(current, 'CANCELLED', reason);
                }}
              />
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle className="text-2xl">
                    {t('pos:web.title', { number: current.orderNumber })}
                  </DialogTitle>
                </DialogHeader>
                <WebOrderDetails order={current} now={now} timeZone={timeZone} />
                {!canReject ? (
                  <p className="text-sm text-muted-foreground">{t('pos:web.noCancelPermission')}</p>
                ) : null}
                <DialogFooter>
                  <Button variant="ghost" size="lg" onClick={close}>
                    {t('pos:web.later')}
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    disabled={!canReject || decide.isPending}
                    onClick={() => {
                      setRejecting(true);
                    }}
                  >
                    {t('pos:web.reject')}
                  </Button>
                  <Button
                    size="lg"
                    disabled={!canAccept || decide.isPending || expired(current)}
                    onClick={() => {
                      run(current, 'CONFIRMED');
                    }}
                  >
                    {t('pos:web.accept')}
                  </Button>
                </DialogFooter>
              </>
            )}
            {decide.isError ? (
              <Alert variant="destructive" title={t('common:states.error')}>
                {errorText(decide.error)}
              </Alert>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}
