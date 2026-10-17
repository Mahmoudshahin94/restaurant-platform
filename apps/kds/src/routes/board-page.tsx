import { useErrorText } from '@pos/app-kit';
import { Alert, EmptyState, Spinner } from '@pos/ui';
import type { KitchenTicket } from '@pos/validation';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TicketCard } from '../components/ticket-card';
import {
  type BoardView,
  type TicketAction,
  isStale,
  useKitchenSettings,
  useTicketAction,
  useTickets,
} from '../lib/queries';
import { useNow } from '../lib/time';
import { usePreferences } from '../stores/preferences';

const FRESH_MS = 10_000;

/** Ticket ids that appeared after the board first loaded, for a short arrival highlight. */
function useFreshTickets(tickets: KitchenTicket[] | undefined): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    if (!tickets) return;
    if (!seen.current) {
      seen.current = new Set(tickets.map((t) => t.id));
      return;
    }
    const arrived = tickets.filter((t) => !seen.current?.has(t.id));
    if (arrived.length === 0) return;
    for (const t of arrived) seen.current.add(t.id);
    setFresh((prev) => new Map([...prev, ...arrived.map((t) => [t.id, Date.now()] as const)]));
  }, [tickets]);
  const now = useNow(2000);
  return new Set([...fresh].filter(([, at]) => now - at < FRESH_MS).map(([id]) => id));
}

export function BoardPage({ view }: { view: BoardView }) {
  const { t } = useTranslation(['kds', 'common']);
  const errorText = useErrorText();
  const tickets = useTickets(view);
  const settings = useKitchenSettings();
  const stationIds = usePreferences((s) => s.stationIds);
  const action = useTicketAction();
  const now = useNow(1000);
  const fresh = useFreshTickets(view === 'active' ? tickets.data : undefined);
  const [error, setError] = useState<string | null>(null);

  const run = async (ticket: KitchenTicket, next: TicketAction) => {
    setError(null);
    try {
      await action.mutateAsync({ ticket, action: next });
    } catch (e) {
      // Another screen got there first: the refreshed board already shows the outcome.
      if (!isStale(e)) setError(errorText(e));
    }
  };

  if (tickets.isPending || settings.isPending) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label={t('common:states.loading')} />
      </div>
    );
  }
  if (tickets.isError || settings.isError) {
    return <Alert variant="destructive">{errorText(tickets.error ?? settings.error)}</Alert>;
  }
  const thresholds = {
    warnMinutes: settings.data.warnMinutes,
    lateMinutes: settings.data.lateMinutes,
  };

  return (
    <div className="grid gap-4">
      {error ? (
        <Alert variant="destructive" className="text-lg">
          {error}
        </Alert>
      ) : null}
      {tickets.data.length === 0 ? (
        <EmptyState title={view === 'active' ? t('kds:empty') : t('kds:emptyCompleted')} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] items-start gap-4">
          {tickets.data.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              now={now}
              thresholds={thresholds}
              showStation={stationIds.length !== 1}
              fresh={fresh.has(ticket.id)}
              busy={action.isPending && action.variables.ticket.id === ticket.id}
              onAction={(next) => void run(ticket, next)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
