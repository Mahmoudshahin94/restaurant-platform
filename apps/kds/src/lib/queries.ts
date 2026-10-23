import { isApiError } from '@pos/api-client';
import type { KitchenTicket, TransitionTicketRequest } from '@pos/validation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePreferences } from '../stores/preferences';
import { api, useSession } from './session';

export type BoardView = 'active' | 'completed';

export function useTenantId(): string {
  const user = useSession((s) => s.user);
  if (!user) throw new Error('Not signed in');
  return user.tenantId;
}

export function useLocationId(): string {
  const locationId = usePreferences((s) => s.locationId);
  if (!locationId) throw new Error('No location selected');
  return locationId;
}

export function useLocations() {
  const tid = useTenantId();
  return useQuery({
    queryKey: ['locations', tid],
    queryFn: () => api.locations.list(tid),
    staleTime: 5 * 60_000,
  });
}

export function useKitchenSettings() {
  const locationId = useLocationId();
  return useQuery({
    queryKey: ['kitchen-settings', locationId],
    queryFn: () => api.kitchen.settings(locationId),
    staleTime: 5 * 60_000,
  });
}

export const ticketsKey = (locationId: string) => ['kitchen-tickets', locationId] as const;

/**
 * Tickets for this screen. Realtime events trigger an immediate refetch; the interval is only a
 * safety net for a missed event or a socket that is reconnecting.
 */
export function useTickets(view: BoardView) {
  const locationId = useLocationId();
  const stationIds = usePreferences((s) => s.stationIds);
  return useQuery({
    queryKey: [...ticketsKey(locationId), view, stationIds],
    queryFn: () => api.kitchen.tickets(locationId, { view, stationIds }),
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
}

export type TicketAction =
  | { kind: 'transition'; to: TransitionTicketRequest['to'] }
  | { kind: 'priority'; priority: KitchenTicket['priority'] }
  | { kind: 'dismiss' }
  | { kind: 'itemDone'; itemId: string; done: boolean };

/**
 * One mutation for every ticket button. A stale version (another screen acted first) is not an
 * error for the cook: the board simply refreshes to the latest state.
 */
export function useTicketAction() {
  const locationId = useLocationId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ ticket, action }: { ticket: KitchenTicket; action: TicketAction }) => {
      switch (action.kind) {
        case 'transition':
          return api.kitchen.transition(locationId, ticket.id, {
            to: action.to,
            version: ticket.version,
          });
        case 'priority':
          return api.kitchen.priority(locationId, ticket.id, {
            priority: action.priority,
            version: ticket.version,
          });
        case 'dismiss':
          return api.kitchen.dismiss(locationId, ticket.id, { version: ticket.version });
        case 'itemDone':
          return api.kitchen.itemDone(locationId, ticket.id, action.itemId, { done: action.done });
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: ticketsKey(locationId) }),
  });
}

export const isStale = (error: unknown): boolean =>
  isApiError(error) && error.details.reason === 'STALE_VERSION';
