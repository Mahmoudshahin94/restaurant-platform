import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the screens talk to the location hub (apps/gateway), as in a restaurant.
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    // `ws: true` forwards the realtime socket (/api/v1/realtime) as well.
    proxy: { '/api': { target: API_TARGET, changeOrigin: false, ws: true } },
  },
  build: {
    target: 'es2022',
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
