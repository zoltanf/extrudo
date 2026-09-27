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

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/** Registers shortcuts on the window while the component is mounted. */
export function useShortcuts(shortcuts: readonly Shortcut[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const keys = eventKeys(event);
      const match = shortcuts.find((s) => s.keys === keys);
      if (!match || (!match.inFields && isEditable(event.target))) return;
      event.preventDefault();
      match.run();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts]);
}
