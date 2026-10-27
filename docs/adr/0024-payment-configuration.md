# ADR 0024: Payment providers are per-tenant accounts; their secrets are sealed and never leave the cloud

- Status: Accepted (2026-10-27)

## Context

Until now the payment provider was a property of the installation, not of the business:

- A static registry held one adapter per method type (cash, external card, an online adapter that
  always refused). [ADR 0009](0009-payment-providers-and-raster-receipts.md) chose the
  `PaymentProvider` interface so that a gateway would be "a new provider", but there was nowhere to
  say whose gateway it was.
- The website's online card adapter was chosen by the process environment
  (`ONLINE_PAYMENT_PROVIDER=mock`, [ADR 0013](0013-online-ordering.md)), and the kiosk's card reader
  by the hub's (`PAYMENT_TERMINAL_PROVIDER`, [ADR 0022](0022-self-service-kiosk.md)). Every tenant
  of an installation therefore took cards the same way, and none had credentials of its own.

MADAR serves many businesses from one cloud ([ADR 0017](0017-tenant-root-and-isolation.md)). Each
signs its own contract with an acquirer, holds its own API keys, may test before going live, may
take cards at one branch and not another, or may take cash only. Its keys are the most sensitive
data the platform holds for it: a leaked secret key moves the business's money.

## Decision

### Provider accounts: which provider takes a method, per tenant and location

`PaymentProviderAccount` (tenant, optional location, method, provider key, mode, status, public
configuration):

- **Method** (`PaymentProviderMethod`): `CASH` and `CARD` (the till's tenders, card approved on a
  standalone terminal), `ONLINE` (website card checkout) and `TERMINAL` (a kiosk's integrated card
  reader). A terminal's payments are recorded as `CARD` tenders, as in ADR 0022
  (`TENDER_TYPE_OF`).
- **Provider key**: a key of the provider catalog (below), fixed once the account exists, because
  its payments name it. To switch providers the administrator disables the account and adds
  another.
- **Mode** `TEST` or `LIVE`, from the modes the provider supports. Test adapters support `TEST`
  only.
- **Status** `ACTIVE` or `DISABLED`. A disabled account takes no new payments but still voids and
  refunds its own charges. Accounts are never deleted.
- **Public configuration**: what a provider needs that is not a secret (a merchant descriptor, a
  reader's label), validated by the provider's strict schema. It is shown to administrators and
  sent to the hubs.
- Stored as text checked by the database, like the website's domains. **One ACTIVE account per
  tenant, method and scope** (the whole tenant, or one location) is a partial unique index.

Resolution uses the configuration layers ([configuration.md](../configuration.md),
`resolveLayered`): `resolvePaymentProviders` (`@pos/domain`) takes the **platform** default of each
method, then the tenant's ACTIVE account, then the location's. A disabled account inherits. The
result names the layer, so the admin shows "business-wide" or "this location" for each method at
each location.

The platform layer is:

- the built-in `cash` and `external-card` providers for `CASH` and `CARD`, which need no account
  (they are not configurable);
- `DEV_PAYMENT_PROVIDERS` for `ONLINE` and `TERMINAL`: a list of test adapters (`mock-online`,
  `mock-terminal`) that take their method for every tenant **without an account of its own**, so a
  development machine and the older test suites keep working. Refused in production.
- Otherwise nothing: **a cash-only tenant simply has no ONLINE account.** Its website offers no
  card, and a card checkout sent anyway is refused with `409 ONLINE_PAYMENT_UNAVAILABLE`
  (translated: "pay at pickup or on delivery") before anything is charged. A kiosk without a
  terminal provider is refused as before (`PAYMENT_FAILED`, `PROVIDER_NOT_CONFIGURED`): pay at the
  counter.

Tenders link to accounts: `payment_methods.provider_account_id`. Website and kiosk payments are
recorded under the tender linked to the account that took them (else the first tender of the
type), so a business can report "kiosk card" apart from "card at the till". Adding an account for
a method the business has no tender for creates one, linked to it (a cash-only coffee shop that
adds an online provider gets an "Online card" tender).

**Payments record the account** (`payments.provider_account_id`), beside the provider key
(`provider`). Voids and refunds go back through that account (`forPayment`), even after it was
disabled or the tenant chose another provider, so a refund never reaches another merchant account.
The hub pushes the column with its payments; the cloud checks that the account is one of the hub's
tenant's.

### The provider catalog replaces the registry and the environment switches

`PROVIDER_CATALOG` (`@pos/server`) maps each key to its definition and its adapter. The definition
(`PAYMENT_PROVIDER_DEFINITIONS`, `@pos/validation`, shared with the admin) says:

- the method it takes and the modes it supports;
- where it runs: `cloud`, `hub` or `anywhere`. **An adapter that needs secrets runs in the cloud
  only**, because secrets never reach a hub (a catalog unit test enforces it);
- whether it is built in, or a development adapter (`devOnly`: refused in production, missing from
  the production catalog the admin sees);
- a strict zod schema for its public configuration and one for its secrets, plus the fields the
  admin's form renders.

Today's catalog: `cash`, `external-card` (built in), `mock-online` (online, cloud, TEST, optional
`secretKey` matching `sk_test_…`) and `mock-terminal` (kiosk reader, hub, TEST). A real gateway is
one definition and one adapter; nothing else changes.

`PaymentProviderFactory` (`@pos/server`):

- `forTenant(tenantId, method, locationId)` resolves the layers, checks that the provider may run
  here (mode of the server, production), opens the account's secrets (cloud only, for this call),
  validates configuration and secrets against the definition again, and builds the adapter.
  Plaintext secrets live only in that adapter's memory, for the call.
- `forPayment(payment)` builds the adapter that took a recorded payment.
- `available(...)` answers whether the website should offer card checkout at a location.

It is wired into POS charges and refunds (cloud and hub), kiosk terminal payments (hub), website
card checkout, the acceptance-timeout and rejection voids, and the admin's online refunds.
`ONLINE_PAYMENT_PROVIDER`, `PAYMENT_TERMINAL_PROVIDER`, the registry, the unconfigured adapters and
the `PAYMENT_TERMINAL` token are gone. A till refuses an ONLINE tender outright (online card
payments are the website's).

### SecretBox: envelope encryption bound to the tenant and the account

`PaymentProviderSecret` is `/// @cloud-only`: one row per account with `key_version`,
`wrapped_key`, `ciphertext` and `fingerprint`. The hub schema, its migrations and the snapshot do
not have it.

`SecretBox` (`@pos/server`) seals an account's secrets (field → value):

1. A fresh 256-bit data key per seal encrypts the secrets' canonical JSON with AES-256-GCM (random
   96-bit nonce; nonce ‖ tag ‖ ciphertext).
2. The `KeyProvider` wraps the data key with the current master key, also AES-256-GCM.
3. Both layers authenticate the additional data `madar.payment-secret.v1|<layer>|<tenantId>|<accountId>`.
   **A ciphertext copied to another account or tenant fails to open** (the GCM tag), as does any
   altered byte; a database administrator cannot move a business's keys to another business.
4. The fingerprint is the first 12 hex digits of the SHA-256 of the canonical JSON: it tells an
   administrator which secret set is stored (they can compute it from their key) without revealing
   it. It stays the same through rotation.

`KeyProvider` is the boundary to the master key: `wrapKey`, `unwrapKey`, `currentVersion`. The
first implementation reads `PAYMENT_SECRETS_KEY`, a keyring of `<version>:<base64 32 bytes>`
entries, the highest version current. A cloud KMS (which wraps and unwraps without handing out the
master key) is the next implementation behind the same interface.

- **Production refuses to start without `PAYMENT_SECRETS_KEY`** (the cloud only: the hub holds no
  key and never opens a secret). In development and tests a version-1 key is derived from
  `JWT_ACCESS_SECRET` when it is unset, like the tracking-token key.
- **Rotation:** add `2:<new key>` (keeping `1:`), restart, run
  `pnpm --filter @pos/api payment-secrets:rotate`. It re-encrypts every secret sealed with an older
  version (a fresh data key, the same fingerprint and "last changed" time) tenant by tenant, and
  reports any it could not open. Then `1:` can be removed. Until then old versions still open.
- A secret that does not open (moved, altered, its key gone) refuses the payment with
  `PAYMENT_FAILED` (`PROVIDER_SECRET_UNREADABLE`); the log names the account only.

### Secrets are write-only

- The API takes secrets on `POST` and `PATCH /tenants/:tid/payment-providers[/:id]` and never
  returns them: every answer carries `secret: { hasSecret, fingerprint, updatedAt }`. A `PATCH`
  without `secrets` keeps them; with them it replaces the whole set. Validation errors name the
  field and the rule, never the value.
- **Logs:** the redaction paths cover `secrets`, `secretKey`, `apiKey`, `privateKey`,
  `webhookSecret`, `wrappedKey` and `ciphertext`, at the top level and one and two levels down.
- **Audit:** `redactForAudit` redacts keys containing `secret`, `passphrase`, `api_key`,
  `private_key`, `signing_key`, `access_key`, `webhook_key`, `ciphertext` or `wrapped_key`. The
  audit entries `payment_provider.created`/`updated` hold the method, provider, mode, status,
  public configuration and fingerprints, never secrets.
- **Snapshot and hub:** accounts ride the snapshot (format 7, selected column by column, with no
  secret column to select); secrets never do. Orders the hub fetches carry the account id only.

### The admin

Settings → **Payment providers** (`settings.manage` tenant-wide, so only the business's
administrators; EN/AR, RTL): the accounts with method, provider, scope, a **test-mode badge**,
the secret's status (stored, fingerprint, last change) and enabled state; a dialog to add or edit
one (method, provider, whole business or one location, mode, public fields, secret fields as
masked `new-password` inputs that start empty and say "stored — leave empty to keep", enabled);
and what is in effect at each location with the layer that decided it. The payment methods page
links a tender to an account ("Processed by").

## Consequences

- A business's providers, modes and keys are its own, per location, without restarting anything.
  A new acquirer is a catalog entry.
- The hub takes kiosk and till payments offline from its snapshot of the accounts. A provider that
  needs secrets cannot run on a hub by construction; an integrated terminal SDK needing
  credentials will need a device-side or hub-side key design of its own (not built).
- The master key is now critical infrastructure: losing every version of it loses every stored
  secret (administrators re-enter them); leaking it with a database dump leaks them. Key custody
  is in [release.md](../release.md). The environment keyring is a stepping stone to a KMS.
- The mock adapters keep their state in process memory, shared by every configured instance, so
  voids find their charges; a real gateway keeps it on its side.
- Real gateways should authorize at checkout and capture on acceptance (ADR 0013's note still
  holds), and run their calls outside database transactions.
- Account changes are configuration: they reach the hubs through the change feed. Secrets changing
  alone also bump the account's `updated_at`, so caches and hubs see a new version.
