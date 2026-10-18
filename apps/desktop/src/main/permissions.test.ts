import { describe, expect, it } from 'vitest';
import { allowPermission } from './permissions';

describe('renderer permissions (ADR-0087 amendment 2026-10-18)', () => {
  it('allows writing the clipboard, for the Copy buttons', () => {
    expect(allowPermission('clipboard-sanitized-write')).toBe(true);
  });

  it('denies everything else, reading the clipboard included', () => {
    for (const permission of ['clipboard-read', 'media', 'geolocation', 'notifications', 'usb'])
      expect(allowPermission(permission)).toBe(false);
  });
});
