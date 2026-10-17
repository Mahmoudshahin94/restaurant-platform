import { useCurrentLocale } from '@pos/app-kit';
import { type TicketUrgency, ticketUrgency } from '@pos/domain';
import { pickLocalized } from '@pos/i18n';
import type { KitchenTicketStatus, OrderChannel } from '@pos/shared-types';
import { Button, cn } from '@pos/ui';
import type { KitchenTicket } from '@pos/validation';
import {
  AlarmClock,
  Bike,
  Check,
  CheckCircle2,
  CircleDot,
  Flame,
  Globe,
  type LucideIcon,
  MessageSquareText,
  OctagonX,
  Pencil,
  Phone,
  ShoppingBag,
  TriangleAlert,
  Undo2,
  Utensils,
  Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TicketAction } from '../lib/queries';
import { formatElapsed } from '../lib/time';

const CHANNEL_ICON: Record<OrderChannel, LucideIcon> = {
  DINE_IN: Utensils,
  TAKEAWAY: ShoppingBag,
  DELIVERY: Bike,
  PHONE: Phone,
  WEBSITE: Globe,
};

/** Each status has its own icon and words; colour only reinforces them. */
const STATUS: Record<KitchenTicketStatus, { icon: LucideIcon; header: string }> = {
  NEW: { icon: CircleDot, header: 'bg-primary/20' },
  PREPARING: { icon: Flame, header: 'bg-warning/25' },
  READY: { icon: CheckCircle2, header: 'bg-success/30' },
  COMPLETED: { icon: Check, header: 'bg-muted' },
  CANCELLED: { icon: OctagonX, header: 'bg-destructive/30' },
};

const URGENCY_BORDER: Record<TicketUrgency, string> = {
  ok: 'border-border',
  warn: 'border-warning',
  late: 'border-destructive ring-2 ring-destructive',
};

export interface TicketCardProps {
  ticket: KitchenTicket;
  now: number;
  thresholds: { warnMinutes: number; lateMinutes: number };
  /** Expo view: name the station on each ticket. */
  showStation: boolean;
  /** Arrived since the screen loaded: pulse once to draw the eye. */
  fresh?: boolean;
  busy?: boolean;
  onAction: (action: TicketAction) => void;
}

export function TicketCard({
  ticket,
  now,
  thresholds,
  showStation,
  fresh = false,
  busy = false,
  onAction,
}: TicketCardProps) {
  const { t } = useTranslation(['kds', 'orders']);
  const locale = useCurrentLocale();
  const live =
    ticket.status === 'NEW' || ticket.status === 'PREPARING' || ticket.status === 'READY';
  const cancelled = ticket.status === 'CANCELLED';
  const age = now - Date.parse(ticket.createdAt);
  const urgency = live ? ticketUrgency(age, thresholds) : 'ok';
  const ChannelIcon = CHANNEL_ICON[ticket.channel];
  const StatusIcon = STATUS[ticket.status].icon;
  const time = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
          new Date(iso),
        )
      : '';

  return (
    <article
      aria-label={ticket.orderNumber}
      data-status={ticket.status}
      className={cn(
        'flex flex-col overflow-hidden rounded-xl border-4 bg-card text-card-foreground shadow-sm',
        URGENCY_BORDER[urgency],
        cancelled && 'ticket-stripes',
        fresh && 'ticket-arrive',
      )}
    >
      <header className={cn('grid gap-1 px-4 py-3', STATUS[ticket.status].header)}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="ltr-nums text-3xl leading-none font-bold">{ticket.orderNumber}</h2>
          {live ? (
            <div className="grid justify-items-end">
              <span className="ltr-nums text-3xl leading-none font-semibold">
                {formatElapsed(age)}
              </span>
            </div>
          ) : (
            <span className="text-base text-muted-foreground">
              {ticket.status === 'COMPLETED'
                ? t('kds:ticket.bumpedAt', { time: time(ticket.completedAt) })
                : t('kds:ticket.received', { time: time(ticket.createdAt) })}
            </span>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <ChannelIcon aria-hidden className="size-5" />
            {t(`orders:channel.${ticket.channel}`)}
          </span>
          {ticket.tableLabel ? (
            <span className="font-semibold">
              {t('kds:ticket.table', { label: ticket.tableLabel })}
            </span>
          ) : null}
          {ticket.customerName ? <span>{ticket.customerName}</span> : null}
          {ticket.guestCount ? (
            <span className="text-muted-foreground">
              {t('kds:ticket.guests', { count: ticket.guestCount })}
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-background/70 px-2 py-0.5 text-base font-semibold">
            <StatusIcon aria-hidden className="size-5" />
            {cancelled ? t('kds:ticket.cancelled') : t(`kds:status.${ticket.status}`)}
          </span>
          {ticket.priority === 'RUSH' ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-destructive px-2 py-0.5 text-base font-bold text-destructive-foreground uppercase">
              <Zap aria-hidden className="size-4" />
              {t('kds:ticket.rush')}
            </span>
          ) : null}
          {ticket.revision > 1 && live ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-foreground/40 px-2 py-0.5 text-base font-semibold">
              <Pencil aria-hidden className="size-4" />
              {t('kds:ticket.updated')}
            </span>
          ) : null}
          {urgency !== 'ok' ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-base font-semibold',
                urgency === 'late'
                  ? 'bg-destructive text-destructive-foreground'
                  : 'bg-warning text-warning-foreground',
              )}
            >
              {urgency === 'late' ? (
                <TriangleAlert aria-hidden className="size-4" />
              ) : (
                <AlarmClock aria-hidden className="size-4" />
              )}
              {t(`kds:urgency.${urgency}`)}
            </span>
          ) : null}
          {showStation ? (
            <span className="ms-auto text-base font-medium text-muted-foreground">
              {pickLocalized(ticket, 'stationName', locale)}
            </span>
          ) : null}
        </div>
      </header>

      <ul className="grid flex-1 content-start divide-y divide-border">
        {ticket.items.map((item) => {
          const name = pickLocalized(item, 'name', locale);
          const variant = pickLocalized(item, 'variantName', locale);
          const done = item.doneAt !== null;
          const body = (
            <>
              <span className="ltr-nums min-w-10 text-2xl font-bold">{item.quantity}×</span>
              <span className="grid flex-1 gap-0.5 text-start">
                <span
                  className={cn('text-2xl leading-tight font-semibold', done && 'line-through')}
                >
                  {name}
                  {variant ? <span className="font-normal"> · {variant}</span> : null}
                </span>
                {item.modifiers.map((m, index) => (
                  <span key={index} className={cn('text-lg', done && 'line-through')}>
                    + {pickLocalized(m, 'name', locale)}
                  </span>
                ))}
                {item.notes ? (
                  <span className="inline-flex items-start gap-1.5 text-lg font-semibold italic">
                    <MessageSquareText aria-hidden className="mt-1 size-5 shrink-0" />
                    {item.notes}
                  </span>
                ) : null}
              </span>
              {done ? <Check aria-hidden className="size-7 shrink-0" /> : null}
            </>
          );
          return (
            <li key={item.id}>
              {live ? (
                <button
                  type="button"
                  aria-pressed={done}
                  aria-label={t(done ? 'kds:actions.itemUndone' : 'kds:actions.itemDone', { name })}
                  disabled={busy}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    done && 'text-muted-foreground',
                  )}
                  onClick={() => {
                    onAction({ kind: 'itemDone', itemId: item.id, done: !done });
                  }}
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-3 px-4 py-3">{body}</div>
              )}
            </li>
          );
        })}
      </ul>

      {ticket.orderNotes ? (
        <p className="mx-4 mb-3 flex items-start gap-2 rounded-md border-2 border-dashed border-foreground/40 px-3 py-2 text-lg font-semibold">
          <MessageSquareText aria-hidden className="mt-1 size-5 shrink-0" />
          <span>
            <span className="sr-only">{t('kds:ticket.note')}: </span>
            {ticket.orderNotes}
          </span>
        </p>
      ) : null}

      <TicketActions ticket={ticket} busy={busy} onAction={onAction} />
    </article>
  );
}

function TicketActions({
  ticket,
  busy,
  onAction,
}: Pick<TicketCardProps, 'ticket' | 'busy' | 'onAction'>) {
  const { t } = useTranslation('kds');
  const go = (to: 'PREPARING' | 'READY' | 'COMPLETED') => {
    onAction({ kind: 'transition', to });
  };
  const big = 'h-16 flex-1 text-xl font-semibold';
  const live =
    ticket.status === 'NEW' || ticket.status === 'PREPARING' || ticket.status === 'READY';

  return (
    <footer className="flex flex-wrap gap-2 border-t border-border p-3">
      {ticket.status === 'NEW' ? (
        <>
          <Button
            className={big}
            disabled={busy}
            onClick={() => {
              go('PREPARING');
            }}
          >
            <Flame aria-hidden />
            {t('actions.start')}
          </Button>
          <Button
            variant="outline"
            className="h-16 text-lg"
            disabled={busy}
            onClick={() => {
              go('READY');
            }}
          >
            {t('actions.ready')}
          </Button>
        </>
      ) : null}
      {ticket.status === 'PREPARING' ? (
        <Button
          className={cn(big, 'bg-success text-success-foreground hover:bg-success/90')}
          disabled={busy}
          onClick={() => {
            go('READY');
          }}
        >
          <CheckCircle2 aria-hidden />
          {t('actions.ready')}
        </Button>
      ) : null}
      {ticket.status === 'READY' ? (
        <>
          <Button
            className={big}
            disabled={busy}
            onClick={() => {
              go('COMPLETED');
            }}
          >
            <Check aria-hidden />
            {t('actions.bump')}
          </Button>
          <Button
            variant="outline"
            className="h-16 text-lg"
            disabled={busy}
            onClick={() => {
              go('PREPARING');
            }}
          >
            <Undo2 aria-hidden className="rtl:-scale-x-100" />
            {t('actions.notReady')}
          </Button>
        </>
      ) : null}
      {ticket.status === 'COMPLETED' ? (
        <Button
          variant="outline"
          className={big}
          disabled={busy}
          onClick={() => {
            go('READY');
          }}
        >
          <Undo2 aria-hidden className="rtl:-scale-x-100" />
          {t('actions.recall')}
        </Button>
      ) : null}
      {ticket.status === 'CANCELLED' ? (
        <Button
          variant="destructive"
          className={big}
          disabled={busy}
          onClick={() => {
            onAction({ kind: 'dismiss' });
          }}
        >
          <OctagonX aria-hidden />
          {t('actions.dismiss')}
        </Button>
      ) : null}
      {live ? (
        <Button
          variant="ghost"
          className="h-16 text-base"
          aria-pressed={ticket.priority === 'RUSH'}
          disabled={busy}
          onClick={() => {
            onAction({
              kind: 'priority',
              priority: ticket.priority === 'RUSH' ? 'NORMAL' : 'RUSH',
            });
          }}
        >
          <Zap aria-hidden />
          {ticket.priority === 'RUSH' ? t('actions.normal') : t('actions.rush')}
        </Button>
      ) : null}
    </footer>
  );
}
