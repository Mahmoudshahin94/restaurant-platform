# ADR 0004: Relational localized columns for menu content

- Status: Accepted (2026-10-17)

## Decision

Categories, products, variants, modifier groups and modifiers store `nameEn`, `nameAr`, and
`descriptionEn` / `descriptionAr` where applicable, as plain columns, not JSON translation
blobs.

## Consequences

- Values are queryable, sortable and constraint-checked, and reports can select a language
  directly.
- Adding a third language requires a migration. This is accepted, given that the product targets
  English and Arabic.
- UI strings (not menu data) live in i18next resource files; see `docs/i18n.md`.
