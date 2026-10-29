/**
 * The MADAR version this build is (ADR 0026), stamped from the root package.json by
 * `pnpm version:set` (tools/release/set-version.mjs): never edit it by hand. The servers answer it
 * on `/health`, every app shows it and reports it in `x-madar-client-version`.
 */
export const MADAR_VERSION = '1.0.0';

/** The header every client (apps, hubs, terminals) reports its MADAR version in. */
export const CLIENT_VERSION_HEADER = 'x-madar-client-version';
