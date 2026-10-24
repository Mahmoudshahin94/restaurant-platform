# Tenant websites behind Caddy (example)

[`Caddyfile`](Caddyfile) is a production-shaped example of how MADAR serves every tenant's website
([ADR 0023](../../docs/adr/0023-multi-tenant-website.md)). It is not used in development, where
Vite serves the website on `<slug>.localhost:5175` and proxies `/api` to the API.

- **One origin per site.** The website's static build and the API are served under the same host
  name, so the website calls `/api/v1/...` on its own origin. No per-domain CORS entries exist.
- **The host is the tenant.** Caddy forwards the original `Host`; the API's `HostTenantGuard`
  resolves it among verified domains. With `TRUST_PROXY=1` the API also accepts the
  `X-Forwarded-Host` Caddy sets, and only from this proxy.
- **Certificates on demand, for verified names only.** `on_demand_tls { ask … }` asks
  `GET /internal/domains/check?domain=<name>` before requesting a certificate: `200` for a
  VERIFIED domain (MADAR's own `<slug>.madar.app` included), `404` otherwise. `/internal/*` is
  answered `404` to the internet.
- **Wildcard alternative.** MADAR's own sub-domains can use one wildcard certificate
  (`*.madar.app`, DNS challenge) instead of on-demand certificates; custom domains still need
  on-demand TLS.

Tenants point their own domain at the proxy (a `CNAME` to the platform's address or an `A`
record) and prove ownership with the `_madar-verify.<domain>` TXT record shown on the admin's
Domains page.
