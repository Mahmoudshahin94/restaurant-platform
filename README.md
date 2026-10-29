# MADAR · Powered by JudyTech

A multi-tenant, offline-first commerce platform: one codebase serving many independent businesses
(restaurants, coffee shops, supermarkets, clothing and other stores). It includes a Tauri desktop
POS, a kitchen display, a customer ordering website, an admin portal, a NestJS cloud API and a
location hub at every site. Arabic and English with full RTL.

- Architecture: [docs/architecture.md](docs/architecture.md) · MADAR expansion plan: [docs/madar/migration-plan.md](docs/madar/migration-plan.md)
- Domain model / ERD: [docs/domain-model.md](docs/domain-model.md) · Configuration precedence: [docs/configuration.md](docs/configuration.md)
- Sync protocol: [docs/sync.md](docs/sync.md)
- API: [docs/api.md](docs/api.md) · Events: [docs/events.md](docs/events.md)
- i18n / RTL rules: [docs/i18n.md](docs/i18n.md)
- Testing and the critical E2E flows: [docs/testing.md](docs/testing.md) · Releases and versions: [docs/release.md](docs/release.md) · [CHANGELOG.md](CHANGELOG.md)
- Decisions: [docs/adr/](docs/adr/)
- **Getting started: [docs/dev-setup.md](docs/dev-setup.md)**

```bash
pnpm install && pnpm build && pnpm test
```
