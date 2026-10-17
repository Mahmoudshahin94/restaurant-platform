import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC emits the decorator metadata NestJS dependency injection needs (esbuild does not).
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['src/**/*.test.ts'] },
});
