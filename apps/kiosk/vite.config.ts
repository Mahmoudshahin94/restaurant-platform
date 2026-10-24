import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import { brandIndexHtml } from '@pos/shared-types';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The kiosk is a LAN client of its location hub (apps/gateway), like the KDS (ADR 0022).
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The page title and favicon come from PLATFORM_BRAND (ADR 0019).
    { name: 'platform-brand', transformIndexHtml: (html) => brandIndexHtml(html, 'kiosk') },
  ],
  // Reported to the hub with every request (`x-madar-client-version`).
  define: { 'import.meta.env.VITE_KIOSK_VERSION': JSON.stringify(version) },
  server: {
    port: 5176,
    strictPort: true,
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          data: ['@tanstack/react-query', 'zustand', 'zod'],
          i18n: ['i18next', 'react-i18next'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
