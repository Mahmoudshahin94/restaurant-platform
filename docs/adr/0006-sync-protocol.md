# ADR 0006: Outbox, idempotent push, cursor pull, ownership-based conflicts

- Status: Accepted (2026-10-17), implemented in Phases 5–6

## Decision

The transactional outbox on the hub; idempotent push keyed by `operationId` and enforced by a
primary key in the cloud; pull through a bigserial change-log cursor; conflicts resolved by
explicit data ownership and entity versions, never by timestamps. See `docs/sync.md` for the
protocol.

## Rejected alternatives

- **Last-write-wins by timestamp:** clocks on restaurant hardware drift, and it silently loses
  data.
- **CRDTs:** unnecessary for data with clear single owners, and hard to audit for financial
  records.
