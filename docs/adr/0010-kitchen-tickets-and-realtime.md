# ADR 0010: Kitchen tickets per station, derived order status, realtime socket

- Status: Accepted (2026-10-17)

## Context

Phase 4 adds the kitchen display. The specification asks for tickets per station (an order must
not be forced into one queue), products that belong to several stations, the order statuses
NEW → PREPARING → READY → COMPLETED on the KDS, and real-time updates over WebSocket. The local
hub that will carry LAN traffic arrives in Phase 5, so the kitchen talks to the cloud API until
then (as the POS does, ADR 0008).

## Decision

- **When an order reaches the kitchen:** when it becomes `CONFIRMED`. Orders entered at the POS
  are created as `CONFIRMED` (staff entering an order is the acceptance); `PLACED` remains the
  state of orders waiting to be accepted (website orders, Phase 7).
- **One ticket per order and station.** A line goes to every station its product is assigned to
  (snapshot taken when the order was priced); lines without a station are not sent. Ticket items
  are snapshots of the order lines, like order items are snapshots of the menu.
- **Order status follows the tickets** (ADR 0005): the first ticket started moves the order to
  `PREPARING`, all live tickets ready moves it to `READY`, un-readying a ticket moves it back.
  These are system transitions; staff cannot set them. Every ticket change locks the order row,
  so concurrent stations derive the order status exactly once.
- **Edits before the kitchen starts** rewrite NEW tickets in place (with a `revision` the screen
  shows as "Updated"), open tickets for new stations and cancel tickets whose items are gone.
  Once any station starts, the order is `PREPARING` and cannot be edited.
- **Handover stays at the POS.** Bumping a ticket (`COMPLETED`) clears it from the screen but does
  not complete the order; completing the order at the POS (paid) bumps its ready tickets. A
  confirmed order with tickets still in the kitchen cannot be completed (`KITCHEN_PENDING`).
- **Cancellations need acknowledgement.** A cancelled ticket stays on the screen, striped and
  labelled "Cancelled — stop", until the kitchen dismisses it.
- **Screens use optimistic concurrency** (`version`): a stale action is answered with
  `STALE_VERSION`, and the KDS treats it as "someone else got there first" and refreshes.
- **Realtime:** a WebSocket at `/api/v1/realtime`. The access token goes in the first message
  (not the URL); the server checks tenant, location and permission, and closes the socket when
  the token expires. Events are published after commit and only notify; screens re-fetch, keep a
  slow polling fallback, and de-duplicate by event id. Delivery is in-process for now.

## Consequences

- The kitchen and POS see each other's changes within a second, with no extra infrastructure.
- Until Phase 5 the kitchen depends on the cloud, which the specification ultimately forbids for
  locally created orders; the hub will serve the same API and event contract on the LAN.
- Running several API instances needs a shared event channel behind `RealtimeBus`.
- Kitchen printers for stations without a screen are left to the hub's printer service.
