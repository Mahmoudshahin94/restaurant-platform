# ADR 0008: The POS uses the cloud API until the location hub exists

- Status: Accepted (2026-10-17), to be superseded in Phase 5

## Context

Order entry (Phase 2) is built before the location hub and offline mode (Phases 5–6). The POS
still has to create real orders now, without baking cloud dependence into its UI.

## Decision

- The POS calls the cloud API through `@pos/api-client`, with the same contracts the hub will
  serve. In Phase 5 the base URL points to the hub on the LAN, and the screens do not change.
- Orders are created with a **client-generated UUIDv7 id** that is also the idempotency key. A
  terminal can safely retry after timeouts or crashes today, and the hub's sync engine will reuse
  the same guarantee.
- The in-progress cart is persisted on the terminal (it is a draft, not business data) so a reload
  does not lose an order being entered.
- Staff sign in with email and password, keeping the refresh token in memory. PIN login (verified
  by the hub) and OS-keychain storage arrive with Phase 5.

## Consequences

Until Phase 5 the POS needs connectivity to the cloud to place orders. This is accepted for this
phase only; the specification's offline requirements are delivered by Phases 5–6.
