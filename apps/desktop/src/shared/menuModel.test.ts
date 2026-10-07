import { describe, expect, it } from 'vitest';
import { isElectronAccelerator, isMenuModel } from './menuModel';

describe('isMenuModel (P6-01 slice 2, finding 2)', () => {
  it('accepts a well-formed model and rejects malformed ones', () => {
    expect(
      isMenuModel([
        {
          label: 'File',
          items: [
            { label: 'Open…', id: 'open', accelerator: 'CmdOrCtrl+O' },
            { separator: true },
            { role: 'minimize', label: 'Minimize', enabled: true },
          ],
        },
      ]),
    ).toBe(true);

    expect(isMenuModel(undefined)).toBe(false);
    expect(isMenuModel('nope')).toBe(false);
    expect(isMenuModel([{ label: 'File' }])).toBe(false);
    expect(isMenuModel([{ label: 1, items: [] }])).toBe(false);
    expect(isMenuModel([{ label: 'File', items: 'x' }])).toBe(false);
    expect(isMenuModel([{ label: 'File', items: [{}] }])).toBe(false);
    // A renderer cannot smuggle a non-string accelerator to Electron.
    expect(isMenuModel([{ label: 'File', items: [{ label: 'A', accelerator: 123 }] }])).toBe(false);
    expect(
      isMenuModel([{ label: 'File', items: [{ label: 'A', accelerator: 'CmdOrCtrl+Nope' }] }]),
    ).toBe(false);
    // The string boolean and non-string id are refused.
    expect(isMenuModel([{ label: 'File', items: [{ label: 'A', enabled: 'no' }] }])).toBe(false);
    expect(isMenuModel([{ label: 'File', items: [{ label: 'A', id: 7 }] }])).toBe(false);
  });

  it('knows Electron accelerators', () => {
    for (const value of ['CmdOrCtrl+O', 'Shift+2', 'Delete', 'F6', 'CmdOrCtrl+Shift+S']) {
      expect(isElectronAccelerator(value)).toBe(true);
    }
    for (const value of ['', 'CmdOrCtrl+', 'CmdOrCtrl+NoSuchKey', 'Hyper+K']) {
      expect(isElectronAccelerator(value)).toBe(false);
    }
  });
});
