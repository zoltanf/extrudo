import { describe, expect, it, vi } from 'vitest';
import { offlineSupported, registerServiceWorker, type ServiceWorkerHost } from './serviceWorker';
import type { RegistrationLike } from './updates';

const registration = {
  waiting: null,
  installing: null,
  addEventListener: () => {},
  update: () => Promise.resolve(),
} satisfies RegistrationLike;

function host(overrides: Partial<ServiceWorkerHost> = {}): ServiceWorkerHost {
  return {
    production: true,
    protocol: 'https:',
    container: {
      register: vi.fn().mockResolvedValue(registration),
      controller: null,
      addEventListener: () => {},
    },
    onLoad: (run) => run(),
    updates: { watch: vi.fn() },
    ...overrides,
  };
}

describe('offline support', () => {
  it('registers ./sw.js in a production web build', () => {
    const h = host();
    expect(registerServiceWorker(h)).toBe(true);
    expect(h.container?.register).toHaveBeenCalledWith('./sw.js');
  });

  it('stays off in dev, on file:// and without service workers', () => {
    for (const h of [
      host({ production: false }),
      host({ protocol: 'file:' }),
      host({ container: undefined }),
    ]) {
      expect(offlineSupported(h)).toBe(false);
      expect(registerServiceWorker(h)).toBe(false);
    }
  });

  it('waits for the page to load', () => {
    let load = () => {};
    const h = host({ onLoad: (run) => (load = run) });
    registerServiceWorker(h);
    expect(h.container?.register).not.toHaveBeenCalled();
    load();
    expect(h.container?.register).toHaveBeenCalled();
  });

  it('watches the registration for updates once it exists', async () => {
    const h = host();
    registerServiceWorker(h);
    await vi.waitFor(() => expect(h.updates?.watch).toHaveBeenCalledTimes(1));
    expect(h.updates?.watch).toHaveBeenCalledWith(registration, h.container);
  });

  it('survives a registration that fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = host({
      container: {
        register: vi.fn().mockRejectedValue(new Error('no')),
        controller: null,
        addEventListener: () => {},
      },
    });
    registerServiceWorker(h);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(h.updates?.watch).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
