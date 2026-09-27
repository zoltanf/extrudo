import { describe, expect, it } from 'vitest';
import { eventKeys, shortcutLabel } from './shortcuts';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  }) as KeyboardEvent;

describe('eventKeys', () => {
  it.each<[KeyboardEvent, boolean, string]>([
    [key('z', { ctrlKey: true }), false, 'Mod+Z'],
    [key('z', { metaKey: true }), true, 'Mod+Z'],
    [key('z', { ctrlKey: true }), true, 'Z'],
    [key('Z', { ctrlKey: true, shiftKey: true }), false, 'Mod+Shift+Z'],
    [key('e'), false, 'E'],
    [key('F6'), false, 'F6'],
    [key('Escape'), false, 'Escape'],
    [key('k', { ctrlKey: true, altKey: true }), false, 'Mod+Alt+K'],
    [key('@', { shiftKey: true, code: 'Digit2' }), false, 'Shift+2'],
    [key('2', { shiftKey: true, code: 'Digit2' }), false, 'Shift+2'],
    [key('7', { code: 'Numpad7' }), false, '7'],
  ])('%#: %s', (event, mac, expected) => {
    expect(eventKeys(event, mac)).toBe(expected);
  });
});

describe('shortcutLabel', () => {
  it('reads as Ctrl on Windows and Linux, ⌘ on macOS', () => {
    expect(shortcutLabel('Mod+Z', false)).toBe('Ctrl+Z');
    expect(shortcutLabel('Mod+Shift+Z', true)).toBe('⌘⇧Z');
    expect(shortcutLabel('E', true)).toBe('E');
  });
});
