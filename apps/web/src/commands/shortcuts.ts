/**
 * Keyboard shortcuts (architecture §8). Which keys run which command is
 * declared once, in `keymap.ts`; this module matches key events against
 * them. Context keys (Esc, Enter) are registered here directly.
 */
import { useEffect, useRef, useState } from 'react';

export interface Shortcut {
  /**
   * `Mod` is Ctrl, or ⌘ on macOS: "Mod+Z", "Mod+Shift+Z", "F6", "E". A chord is two
   * combos separated by one space: "K H" (ADR-0023, amendment 2026-10-18).
   */
  keys: string;
  run(): void;
  /** Also fire while typing in a text field. Off by default, so fields keep their own undo. */
  inFields?: boolean;
}

const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');

/** The key combination of an event, in the same form as `Shortcut.keys`. */
export function eventKeys(event: KeyboardEvent, mac = isMac()): string {
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  // Digits by their key position: Shift+2 is "@" on a US layout and "2" on a French one.
  const digit = /^Digit\d$/.test(event.code ?? '') ? event.code.slice(5) : undefined;
  const key = digit ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  parts.push(key);
  return parts.join('+');
}

/** How a shortcut reads in a tooltip on this platform: "Ctrl+Z" or "⌘Z". */
export function shortcutLabel(keys: string, mac = isMac()): string {
  const one = (combo: string) =>
    mac ? combo.replace('Mod+', '⌘').replace('Shift+', '⇧') : combo.replace('Mod', 'Ctrl');
  return keys.split(' ').map(one).join(' ');
}

/** What a key does to a chord in progress (`pending` is the first combo, once typed). */
export type ChordResult =
  | { kind: 'run'; shortcut: Shortcut }
  | { kind: 'pending'; prefix: string }
  | { kind: 'cancel' }
  | { kind: 'none' };

/** Whether any offered chord starts with this combo. */
export function hasChord(shortcuts: readonly Shortcut[], prefix: string): boolean {
  return shortcuts.some((s) => s.keys.startsWith(`${prefix} `));
}

/**
 * Matches one key combo against the shortcuts, with the chord in progress, if any.
 * Without one: a single-combo shortcut runs, else the first combo of a chord is `pending`.
 * With one: the second combo runs the chord; anything else cancels it (Escape too).
 */
export function matchChord(
  pending: string | undefined,
  keys: string,
  shortcuts: readonly Shortcut[],
): ChordResult {
  if (pending !== undefined) {
    const shortcut = shortcuts.find((s) => s.keys === `${pending} ${keys}`);
    return shortcut ? { kind: 'run', shortcut } : { kind: 'cancel' };
  }
  const shortcut = shortcuts.find((s) => s.keys === keys);
  if (shortcut) return { kind: 'run', shortcut };
  return hasChord(shortcuts, keys) ? { kind: 'pending', prefix: keys } : { kind: 'none' };
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/** A text field: shortcuts leave its keys alone, and the browser's menu (copy, paste) stays. */
export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Input types with no text to undo: after one of them, Ctrl+Z is the app's (P4-07). */
const KEYS_THE_APP_OWNS = new Set(['range', 'checkbox', 'radio', 'button', 'color']);

/**
 * Whether the target owns the keys typed into it, which is what lets a shortcut
 * skip it: a text field, a `<textarea>`, a `<select>` (its arrows choose) and
 * anything editable keep their own undo and their browser menu.
 *
 * The inputs that hold no text don't (P4-07): after a slider drag — which leaves
 * the slider focused — Ctrl+Z belongs to the app again, so it undoes the drag.
 * Reads `tagName`/`type` rather than `instanceof`, so a unit test can pass an
 * element-shaped object (the web app's tests have no DOM).
 */
export function ownsKeys(target: EventTarget | null): boolean {
  const element = target as (Element & { isContentEditable?: boolean }) | null;
  if (!element || typeof element.tagName !== 'string') return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    // An `<input>` without a type is a text field.
    const type = ((element as HTMLInputElement).type || 'text').toLowerCase();
    return !KEYS_THE_APP_OWNS.has(type);
  }
  return false;
}

/**
 * Registers shortcuts on the window while the component is mounted. Returns the first
 * combo of a chord in progress ("K"), for a hint to show, or `undefined`.
 */
export function useShortcuts(shortcuts: readonly Shortcut[]): string | undefined {
  const [pending, setPending] = useState<string | undefined>(undefined);
  const pendingRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const set = (prefix: string | undefined) => {
      pendingRef.current = prefix;
      setPending(prefix);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (pendingRef.current !== undefined && MODIFIER_KEYS.has(event.key)) return;
      const keys = eventKeys(event);
      const result = matchChord(pendingRef.current, keys, shortcuts);
      if (result.kind === 'none') return;
      if (result.kind === 'cancel') {
        set(undefined);
        // A key that goes to a field after the chord began is the field's.
        if (ownsKeys(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (result.kind === 'pending') {
        if (ownsKeys(event.target)) return;
        event.preventDefault();
        set(result.prefix);
        return;
      }
      const { shortcut } = result;
      if (!shortcut.inFields && ownsKeys(event.target)) return;
      event.preventDefault();
      set(undefined);
      shortcut.run();
    };
    const end = () => {
      if (pendingRef.current !== undefined) set(undefined);
    };
    // The chord ends when the shortcuts no longer offer it (leaving the sketch).
    if (pendingRef.current !== undefined && !hasChord(shortcuts, pendingRef.current)) end();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', end);
    window.addEventListener('pointerdown', end, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', end);
      window.removeEventListener('pointerdown', end, true);
    };
  }, [shortcuts]);
  return pending;
}
