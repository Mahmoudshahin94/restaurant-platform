import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // Singletons (React, i18next, query cache, stores) must come from the app, never be bundled.
  external: [
    /^react/,
    /^@tanstack\//,
    /^i18next/,
    /^react-i18next/,
    /^zustand/,
    /^zod/,
    /^react-hook-form/,
    /^@pos\//,
  ],
});
