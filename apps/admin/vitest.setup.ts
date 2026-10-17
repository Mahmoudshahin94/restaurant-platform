import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library cannot unmount between tests by itself.
afterEach(() => {
  cleanup();
});

// jsdom has no ResizeObserver; Radix checkboxes measure themselves with it.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
