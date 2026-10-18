import type { ReactNode } from 'react';
import { DEFAULT_KEYMAP } from '../commands/keymap';
import { shortcutLabel } from '../commands/shortcuts';
import type { AppCommand } from './commands';

/**
 * The second keys of a chord in progress (ADR-0023, amendment 2026-10-18): a small panel above
 * the view navigation, built from the offered commands whose keys start with the prefix, in
 * keymap (tile) order.
 */
export function ChordHint({
  prefix,
  commands,
}: {
  prefix: string;
  commands: readonly AppCommand[];
}) {
  const rows = commands
    .flatMap((c) =>
      c.unavailable
        ? []
        : c.keys
            .filter((k) => k.startsWith(`${prefix} `))
            .map((k) => ({ id: c.id, label: c.label, second: k.slice(prefix.length + 1) })),
    )
    .sort((a, b) => keymapIndex(a.id) - keymapIndex(b.id));
  if (rows.length === 0) return null;
  return (
    <div
      role="status"
      aria-label="Chord keys"
      data-chord-hint
      className="pointer-events-none absolute bottom-16 z-10 -translate-x-1/2 rounded-lg border border-line px-3 py-2 text-xs text-ink backdrop-blur-[6px]"
      style={{
        left: 'calc(50% + var(--x-browser-inset, 0px) / 2)',
        background: 'color-mix(in srgb, var(--x-raised) 90%, transparent)',
      }}
    >
      <p className="mb-1 text-muted">
        <Kbd>{shortcutLabel(prefix)} …</Kbd>
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-2">
            <Kbd>{shortcutLabel(row.second)}</Kbd>
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const keymapIndex = (id: string) => Object.keys(DEFAULT_KEYMAP).indexOf(id);

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="font-mono text-xs text-muted">{children}</kbd>;
}
