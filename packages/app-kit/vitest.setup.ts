import '@testing-library/jest-dom/vitest';

// Recent Node versions expose a global `localStorage` of their own that is not usable without a
// backing file, and it shadows jsdom's. Tests that keep device preferences get an in-memory one.
if (typeof (window.localStorage as Partial<Storage> | undefined)?.clear !== 'function') {
  const items = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}
