import { describe, expect, it } from 'vitest';
import { type SecureTokenBackend, createPersistentTokenStore } from './secure-token';

function fakeBackend(initial: string | null = null) {
  const writes: (string | null)[] = [];
  let stored = initial;
  const backend: SecureTokenBackend = {
    read: () => Promise.resolve(stored),
    write: (token) => {
      writes.push(token);
      stored = token;
      return Promise.resolve();
    },
  };
  return { backend, writes, stored: () => stored };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the till’s refresh token store', () => {
  it('restores the token kept in secure storage after a restart', async () => {
    const { backend } = fakeBackend('rt-from-keychain');
    const store = createPersistentTokenStore(backend);
    expect(store.get()).toBeNull();
    await store.hydrate();
    expect(store.get()).toBe('rt-from-keychain');
  });

  it('writes every rotation and the sign-out through, in order', async () => {
    const fake = fakeBackend();
    const store = createPersistentTokenStore(fake.backend);
    store.set('rt-1');
    store.set('rt-2');
    store.set(null);
    expect(store.get()).toBeNull();
    await settle();
    expect(fake.writes).toEqual(['rt-1', 'rt-2', null]);
    expect(fake.stored()).toBeNull();
  });

  it('keeps working in memory when secure storage fails', async () => {
    const store = createPersistentTokenStore({
      read: () => Promise.reject(new Error('locked keychain')),
      write: () => Promise.reject(new Error('locked keychain')),
    });
    await store.hydrate();
    expect(store.get()).toBeNull();
    store.set('rt-1');
    await settle();
    expect(store.get()).toBe('rt-1');
  });

  it('stays in memory only in a browser', async () => {
    const store = createPersistentTokenStore(null);
    await store.hydrate();
    store.set('rt-1');
    expect(store.get()).toBe('rt-1');
  });
});
