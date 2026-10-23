# Configuration

MADAR serves every tenant from one codebase. What differs between tenants (modules, branding,
theme, currency, languages, payment providers, devices) is **configuration**, never a fork, a
branch or an `if (businessType === …)` in a component. See the
[migration plan](madar/migration-plan.md).

## Precedence

Configuration is resolved in layers, from the least to the most specific. A more specific layer
overrides a less specific one, setting by setting:

```
Platform defaults          MADAR's defaults for every tenant
  ↓
Business-type defaults     what a RESTAURANT, SUPERMARKET, CLOTHING store… starts with
  ↓
Tenant configuration       the tenant's own choices
  ↓
Location configuration     one branch or store differing from the tenant
  ↓
Device configuration       one terminal, screen or kiosk differing from its location
```

- A layer that says nothing about a setting inherits it from the layer above. "Unset" is
  different from "off".
- **Platform entitlements cap the result.** For modules, the platform operator decides what a
  tenant may use (its subscription), and whether tenant administrators may change a module at all.
  A tenant, location or device cannot enable a module the tenant is not entitled to.
- The business type contributes **defaults only**. After provisioning, behaviour depends on the
  resolved capabilities (`isEnabled(Feature.KDS)`), never on the type.
- Resolution is one pure function in `@pos/domain` (`resolveLayered`), shared by the cloud, the
  location hub (offline) and the apps. Each resolved value carries the layer it came from, so the
  admin can show "inherited from: business type".

## What exists today

| Setting                                       | Layers today                                            | Phase |
| --------------------------------------------- | ------------------------------------------------------- | ----- |
| Business type, status, legal name             | tenant (type and status set by the platform)            | M1 ✅ |
| Default and supported locales                 | tenant                                                  | M1 ✅ |
| Currency                                      | tenant (fixed at provisioning, ADR 0002)                | M1 ✅ |
| Time zone, tax mode, cash rounding, KDS times | tenant time zone; location settings                     | ✅    |
| Modules (POS, KDS, TABLES, BARCODE, …)        | platform → business type → tenant → location → device   | M2    |
| Branding and theme                            | platform → tenant (→ per surface) → device (theme mode) | M3    |
| Currency display (symbol, format locale)      | platform → tenant                                       | M4    |
| Website sections and domains                  | tenant                                                  | M7    |
| Payment providers                             | tenant → location                                       | M8    |
| Release channel                               | platform → tenant                                       | M10   |

Each phase's ADR records the exact settings it adds and the layers they accept.
