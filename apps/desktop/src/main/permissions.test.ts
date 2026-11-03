import { describe, expect, it } from 'vitest';
import { allowPermission, isSpaceMouse } from './permissions';

describe('renderer permissions (ADR-0087 amendment 2026-10-18)', () => {
  it('allows writing the clipboard, for the Copy buttons', () => {
    expect(allowPermission('clipboard-sanitized-write')).toBe(true);
  });

  it('denies everything else, reading the clipboard included', () => {
    for (const permission of ['clipboard-read', 'media', 'geolocation', 'notifications', 'usb'])
      expect(allowPermission(permission)).toBe(false);
  });
});

describe('HID devices (ADR-0114)', () => {
  it('allows 3D mice, from 3Dconnexion and the older Logitech-made ones', () => {
    expect(isSpaceMouse({ vendorId: 0x256f, productId: 0xc635 })).toBe(true); // SpaceMouse Compact
    expect(isSpaceMouse({ vendorId: 0x046d, productId: 0xc626 })).toBe(true); // SpaceNavigator
  });

  it('refuses any other HID device', () => {
    expect(isSpaceMouse({ vendorId: 0x046d, productId: 0xc52b })).toBe(false); // a Logitech receiver
    expect(isSpaceMouse({ vendorId: 0x1050, productId: 0x0407 })).toBe(false); // a security key
  });
});
