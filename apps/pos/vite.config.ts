import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

// Tauri expects a fixed dev port and serves the built `dist` folder in production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // `ws: true` forwards the realtime socket (/api/v1/realtime) as well.
    proxy: { '/api': { target: API_TARGET, changeOrigin: false, ws: true } },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
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
