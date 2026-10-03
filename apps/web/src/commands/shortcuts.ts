/**
 * Keyboard shortcuts (architecture §8). Which keys run which command is
 * declared once, in `keymap.ts`; this module matches key events against
 * them. Context keys (Esc, Enter) are registered here directly.
 */
import { useEffect } from 'react';

export interface Shortcut {
  /** `Mod` is Ctrl, or ⌘ on macOS: "Mod+Z", "Mod+Shift+Z", "F6", "E". */
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
  return mac ? keys.replace('Mod+', '⌘').replace('Shift+', '⇧') : keys.replace('Mod', 'Ctrl');
}

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

/** Registers shortcuts on the window while the component is mounted. */
export function useShortcuts(shortcuts: readonly Shortcut[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const keys = eventKeys(event);
      const match = shortcuts.find((s) => s.keys === keys);
      if (!match || (!match.inFields && ownsKeys(event.target))) return;
      event.preventDefault();
      match.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}
