import { describe, expect, it } from 'vitest';
import { eventKeys, matchChord, ownsKeys, type Shortcut, shortcutLabel } from './shortcuts';

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

  it('reads each part of a chord', () => {
    expect(shortcutLabel('K H', false)).toBe('K H');
    expect(shortcutLabel('Mod+K Mod+S', false)).toBe('Ctrl+K Ctrl+S');
    expect(shortcutLabel('Mod+K Mod+S', true)).toBe('⌘K ⌘S');
  });
});

describe('ownsKeys', () => {
  /** An element-shaped target: the web app's tests have no DOM. */
  const element = (tagName: string, extra: Record<string, unknown> = {}) =>
    ({ tagName, ...extra }) as unknown as EventTarget;

  it('leaves a text field, a textarea, a select and editable text their keys', () => {
    expect(ownsKeys(element('INPUT', { type: 'text' }))).toBe(true);
    expect(ownsKeys(element('input', { type: 'text' }))).toBe(true);
    // An `<input>` with no type is a text field.
    expect(ownsKeys(element('INPUT'))).toBe(true);
    expect(ownsKeys(element('INPUT', { type: 'number' }))).toBe(true);
    expect(ownsKeys(element('INPUT', { type: 'search' }))).toBe(true);
    expect(ownsKeys(element('TEXTAREA'))).toBe(true);
    expect(ownsKeys(element('SELECT'))).toBe(true);
    expect(ownsKeys(element('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('gives the keys back for the inputs that hold no text (P4-07)', () => {
    // After a slider drag the slider keeps the focus, so Ctrl+Z must still undo.
    expect(ownsKeys(element('INPUT', { type: 'range' }))).toBe(false);
    for (const type of ['checkbox', 'radio', 'button', 'color']) {
      expect(ownsKeys(element('INPUT', { type }))).toBe(false);
    }
  });

  it('is false for anything that is not a field', () => {
    expect(ownsKeys(null)).toBe(false);
    expect(ownsKeys({} as EventTarget)).toBe(false);
    expect(ownsKeys(element('DIV'))).toBe(false);
    expect(ownsKeys(element('BUTTON'))).toBe(false);
  });
});

describe('matchChord', () => {
  const h = { keys: 'K H', run: () => {} };
  const v = { keys: 'K V', run: () => {} };
  const l = { keys: 'L', run: () => {} };
  const all: Shortcut[] = [h, v, l];

  it('runs a single key as before', () => {
    expect(matchChord(undefined, 'L', all)).toEqual({ kind: 'run', shortcut: l });
  });
  it('takes the first key of a chord as pending', () => {
    expect(matchChord(undefined, 'K', all)).toEqual({ kind: 'pending', prefix: 'K' });
  });
  it('runs the chord on its second key', () => {
    expect(matchChord('K', 'H', all)).toEqual({ kind: 'run', shortcut: h });
  });
  it('cancels on Escape and on a key that is no chord', () => {
    expect(matchChord('K', 'Escape', all)).toEqual({ kind: 'cancel' });
    expect(matchChord('K', 'L', all)).toEqual({ kind: 'cancel' });
    expect(matchChord('K', 'Shift+H', all)).toEqual({ kind: 'cancel' });
  });
  it('has no pending state when no chord is offered', () => {
    expect(matchChord(undefined, 'K', [l])).toEqual({ kind: 'none' });
  });
  it('leaves other keys alone', () => {
    expect(matchChord(undefined, 'Z', all)).toEqual({ kind: 'none' });
  });
});
