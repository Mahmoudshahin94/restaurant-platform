import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  // The generated Prisma client must be resolved at runtime, never bundled.
  external: ['@prisma/client', '.prisma/client'],
});
