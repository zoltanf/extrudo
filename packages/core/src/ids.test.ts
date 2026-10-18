import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId, randomUuid } from './ids';

// Core compiles without DOM types, so reach the platform's crypto through a cast.
const platform = (
  globalThis as unknown as {
    crypto: { getRandomValues(a: Uint8Array): Uint8Array };
  }
).crypto;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('ids', () => {
  it('newId returns distinct UUID v4 strings', () => {
    const a = newId();
    expect(a).toMatch(UUID_V4);
    expect(newId()).not.toBe(a);
  });

  it('falls back to getRandomValues where crypto.randomUUID is missing (#57)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: platform.getRandomValues.bind(platform),
    });
    const ids = Array.from({ length: 100 }, () => randomUuid());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(100);
    expect(newId()).toMatch(UUID_V4);
  });

  it('forces the version and variant bits', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: <T extends Uint8Array>(a: T) => a.fill(0xff),
    });
    expect(randomUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
});
