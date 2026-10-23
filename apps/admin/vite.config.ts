import tailwindcss from '@tailwindcss/vite';
import { brandIndexHtml } from '@pos/shared-types';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The page title and favicon come from PLATFORM_BRAND (ADR 0019).
    { name: 'platform-brand', transformIndexHtml: (html) => brandIndexHtml(html, 'admin') },
  ],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin API in development, so the refresh cookie (SameSite=strict) just works.
    proxy: { '/api': { target: API_TARGET, changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          data: [
            '@tanstack/react-query',
            'zustand',
            'zod',
            'react-hook-form',
            '@hookform/resolvers',
          ],
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
