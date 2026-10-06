import { useEffect, useId, useMemo, useState } from 'react';
import {
  type MarkingOverrides,
  MODEL_SLOTS,
  type ResolvedSlot,
  resolveSlots,
  SKETCH_SLOTS,
} from '../commands/marking';
import { searchCommands } from '../commands/search';
import { FloatingDialog } from '../design-system';
import {
  RING_INNER,
  RING_OUTER,
  SLOT_COUNT,
  slotCenter,
  wedgePath,
} from '../design-system/marking';
import type { AppCommand } from './commands';

type Mode = 'model' | 'sketch';

const MODES: readonly { mode: Mode; label: string }[] = [
  { mode: 'model', label: 'Model' },
  { mode: 'sketch', label: 'Sketch' },
];
const TABLES = { model: MODEL_SLOTS, sketch: SKETCH_SLOTS } as const;
/** The wedge buttons sit on the ring's label radius. */
const BUTTON = { width: 92, height: 44 };
const RADIUS = (RING_INNER + RING_OUTER) / 2;

export interface CustomizeMarkingMenuProps {
  open: boolean;
  onClose(): void;
  overrides: MarkingOverrides;
  /** The commands each mode offers (`buildCommands` for that mode). */
  commands: Readonly<Record<Mode, readonly AppCommand[]>>;
  /** Assigns a command to a wedge, or `null` for the table's own. Written at once. */
  assign(mode: Mode, index: number, command: string | null): void;
  /** Gives every wedge of the mode its table's command back. */
  resetAll(mode: Mode): void;
}

/**
 * Customize Marking Menu (P4-12, ADR-0042's amendment): a ring for each mode
 * with the current command of every wedge. Click a wedge, search the commands
 * the mode offers, pick one: the preference changes at once, there is no OK.
 */
export function CustomizeMarkingMenu(props: CustomizeMarkingMenuProps) {
  return (
    <FloatingDialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose();
      }}
      title="Customize Marking Menu"
      width={600}
      maxHeight={640}
      dim
    >
      {props.open && <Body {...props} />}
    </FloatingDialog>
  );
}

function Body({ overrides, commands, assign, resetAll }: CustomizeMarkingMenuProps) {
  const [mode, setMode] = useState<Mode>('model');
  const [picking, setPicking] = useState<number>();
  const resolved = useMemo(
    () => resolveSlots(TABLES[mode], commands[mode], overrides[mode]),
    [mode, commands, overrides],
  );
  const customised = (overrides[mode] ?? []).some((c) => typeof c === 'string' && c !== '');
  return (
    <section aria-label="Customize Marking Menu" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <div role="tablist" aria-label="Mode" className="flex gap-1">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              role="tab"
              aria-selected={mode === m.mode}
              onClick={() => {
                setMode(m.mode);
                setPicking(undefined);
              }}
              className={`h-8 rounded-control px-3 text-sm ${mode === m.mode ? 'bg-accent-soft text-ink' : 'text-muted hover:text-ink'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          disabled={!customised}
          onClick={() => {
            resetAll(mode);
            setPicking(undefined);
          }}
          className="h-8 rounded-control px-3 text-sm text-muted enabled:hover:text-ink disabled:opacity-50"
        >
          Reset all
        </button>
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-y-auto p-3">
        <Ring
          mode={mode}
          slots={resolved}
          overrides={overrides[mode]}
          picking={picking}
          onPick={setPicking}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {picking === undefined ? (
            <p className="text-sm text-muted">
              Pick a wedge, then the command it should run. Right-click in the view to see the ring.
            </p>
          ) : (
            <CommandList
              key={`${mode}:${picking}`}
              commands={commands[mode]}
              wedge={resolved[picking]?.label ?? ''}
              customised={typeof overrides[mode]?.[picking] === 'string'}
              onChoose={(command) => {
                assign(mode, picking, command);
                setPicking(undefined);
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function Ring({
  mode,
  slots,
  overrides,
  picking,
  onPick,
}: {
  mode: Mode;
  slots: readonly ResolvedSlot[];
  overrides: readonly (string | null)[] | undefined;
  picking: number | undefined;
  onPick(index: number): void;
}) {
  const size = RING_OUTER * 2;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true" className="absolute inset-0">
        {Array.from({ length: SLOT_COUNT }, (_, i) => (
          <path
            // biome-ignore lint/suspicious/noArrayIndexKey: the wedges are positions
            key={i}
            d={wedgePath(i)}
            className={i === picking ? 'fill-accent-soft stroke-accent' : 'fill-raised stroke-line'}
          />
        ))}
      </svg>
      {slots.map((slot, i) => {
        const c = slotCenter(i, RADIUS);
        const own = typeof overrides?.[i] === 'string';
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: the wedges are positions
            key={`${mode}:${i}`}
            type="button"
            data-slot-button={`${mode}:${i}`}
            data-slot-command={slot.spec.command}
            data-slot-custom={own || undefined}
            aria-pressed={i === picking}
            aria-label={`Wedge ${i + 1}: ${slot.label}`}
            title={slot.hint ?? slot.spec.command}
            onClick={() => onPick(i)}
            style={{
              left: RING_OUTER + c.x - BUTTON.width / 2,
              top: RING_OUTER + c.y - BUTTON.height / 2,
              width: BUTTON.width,
              height: BUTTON.height,
            }}
            className={`absolute flex flex-col items-center justify-center gap-0.5 rounded-control text-[11px] leading-tight hover:bg-accent-soft ${slot.disabled ? 'text-muted' : 'text-ink'} ${own ? 'font-semibold' : ''}`}
          >
            <span className="grid size-4 place-items-center">{slot.command?.icon}</span>
            <span className="w-full truncate text-center">{slot.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function CommandList({
  commands,
  wedge,
  customised,
  onChoose,
}: {
  commands: readonly AppCommand[];
  wedge: string;
  customised: boolean;
  onChoose(command: string | null): void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const id = useId();
  // "Reset wedge" is the first row while the wedge has an assignment; `null` stands for it.
  const rows = useMemo<{ id: string | null; command?: AppCommand; positions: number[] }[]>(
    () => [
      ...(customised && !query.trim() ? [{ id: null, positions: [] }] : []),
      ...searchCommands(commands, query).map((r) => ({
        id: r.item.id,
        command: r.item,
        positions: r.positions,
      })),
    ],
    [commands, query, customised],
  );
  const current = Math.min(active, rows.length - 1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query starts at the top
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    document.getElementById(`${id}-${current}`)?.scrollIntoView({ block: 'nearest' });
  });
  return (
    <>
      <input
        // biome-ignore lint/a11y/noAutofocus: the list opens for typing
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={current >= 0 ? `${id}-${current}` : undefined}
        aria-label="Search commands"
        placeholder={`Command for ${wedge}`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            if (rows.length > 0) setActive((current + step + rows.length) % rows.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            const row = rows[current];
            if (row) onChoose(row.id);
          }
        }}
        className="h-9 rounded-input border border-line bg-transparent px-2 text-sm text-ink outline-none placeholder:text-muted"
      />
      <div
        id={`${id}-list`}
        role="listbox"
        aria-label="Commands"
        className="mt-1 max-h-[420px] min-h-0 flex-1 overflow-y-auto"
      >
        {rows.length === 0 && <p className="px-2 py-3 text-sm text-muted">No command matches.</p>}
        {rows.map((row, i) => (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the search field drives the keyboard
          <div
            key={row.id ?? 'reset'}
            id={`${id}-${i}`}
            role="option"
            tabIndex={-1}
            aria-selected={i === current}
            data-reset={row.id === null || undefined}
            onMouseMove={i === current ? undefined : () => setActive(i)}
            onClick={() => onChoose(row.id)}
            className={`flex h-8 cursor-default items-center gap-2 rounded-input px-2 text-sm ${i === current ? 'bg-accent-soft' : ''}`}
          >
            <span className="grid w-4 shrink-0 place-items-center">{row.command?.icon}</span>
            <span className="min-w-0 flex-1 truncate">
              {row.command ? row.command.label : 'Reset wedge'}
            </span>
            {row.command && <span className="text-xs text-muted">{row.command.group}</span>}
          </div>
        ))}
      </div>
    </>
  );
}
