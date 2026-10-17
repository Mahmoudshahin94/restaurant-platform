# ADR 0001: The location hub owns the restaurant's local database

- Status: Accepted (2026-10-17)

## Context

The specification requires both "the POS must use a local SQLite database" and a local gateway
that connects POS, KDS and printers. A restaurant may run several POS terminals. If each
terminal had its own SQLite as source of truth, shared state (tables, open orders, order
numbering, item availability) would diverge across terminals. Reconciling it would require
peer-to-peer replication inside the restaurant on top of cloud sync.

## Decision

One **location hub** process (`apps/gateway`, Node/TypeScript) per restaurant site owns the
location's SQLite database, the sync outbox and the LAN WebSocket server. POS terminals (Tauri)
and KDS screens are clients of the hub on the LAN. On a single-terminal site the hub runs as a
Tauri sidecar on the POS machine, so "the POS has a local SQLite" holds physically.

The hub reuses `@pos/domain`, so business rules are not duplicated. Its own code is transport
and persistence only.

## Consequences

- Every terminal sees one consistent state, and there is one sync path to the cloud.
- The kitchen keeps working without the Internet: POS → hub → KDS never touches the cloud.
- On multi-terminal sites the hub machine is a single point of failure. Mitigations: run it on
  a dedicated small PC or the main POS with UPS power. A standby hub with replication is future
  work.
- Terminals need LAN connectivity to the hub, which is acceptable inside one restaurant.
