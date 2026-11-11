import { useEffect, useMemo, useRef, useState } from 'react';
import { keysFor } from '../commands/keymap';
import {
  clash,
  conflictsFor,
  isReserved,
  type KeyConflict,
  type KeymapEntry,
  type KeymapMode,
  keymapStore,
  useKeymap,
} from '../commands/keymapStore';
import { eventKeys, shortcutLabel } from '../commands/shortcuts';
import { Button, TextInput } from '../design-system';
import type { Preferences } from '../platform';
import type { AppCommand } from '../shell/commands';
import { EDIT_MODES, MODES } from '../shell/modes';

export interface KeyboardPageProps {
  preferences: Preferences;
  /** The commands each mode offers (`buildCommands` for that mode); absent on the home screen. */
  commands?: Readonly<Record<KeymapMode, readonly AppCommand[]>> | undefined;
  /** A command to start recording for when the page opens ("Change shortcut…"). */
  record?: string | undefined;
}

/** Keymap commands that aren't in `buildCommands`: the shell binds them itself. */
const SHELL_COMMANDS: readonly { id: string; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'searchAtPointer', label: 'Search at the pointer' },
  { id: 'help', label: 'Help' },
];

type Filter = 'all' | KeymapMode | 'changed';
const FILTERS: readonly (readonly [Filter, string])[] = [
  ['all', 'All'],
  ...EDIT_MODES.map((mode) => [mode, MODES[mode].label] as const),
  ['changed', 'Changed'],
];

interface Row extends KeymapEntry {
  group: string;
}

/** Every command either mode offers, once, with the modes it is offered in. */
function rowsOf(commands: Readonly<Record<KeymapMode, readonly AppCommand[]>>): Row[] {
  const rows = new Map<string, Row & { modes: Set<KeymapMode> }>();
  for (const mode of EDIT_MODES) {
    for (const command of commands[mode]) {
      const found = rows.get(command.id);
      if (found) found.modes.add(mode);
      else {
        rows.set(command.id, {
          id: command.id,
          label: command.label,
          group: command.group,
          keys: [],
          modes: new Set([mode]),
        });
      }
    }
  }
  for (const { id, label } of SHELL_COMMANDS) {
    if (!rows.has(id)) {
      rows.set(id, { id, label, group: 'General', keys: [], modes: new Set(EDIT_MODES) });
    }
  }
  return [...rows.values()];
}

/** "Change shortcut…": the command's first key is replaced, or a key added when it has none. */
const changing = (id: string): Recording => ({ id, index: keysFor(id).length > 0 ? 0 : -1 });

/** Where a recording is: which command, which key it replaces, and what it has heard. */
interface Recording {
  id: string;
  /** The key being replaced, or -1 for a new one. */
  index: number;
  /** The first combination of a chord, waiting for Enter or a second one. */
  first?: string;
  error?: string;
  /** A key that another command in the same mode uses, waiting for Replace or Cancel. */
  conflict?: { keys: string; with: KeyConflict[] };
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

function Keys({ keys }: { keys: string }) {
  return (
    <span className="inline-flex gap-1">
      {keys.split(' ').map((part, i) => (
        <kbd
          // biome-ignore lint/suspicious/noArrayIndexKey: a chord's parts can repeat ("G G")
          key={i}
          className="rounded-[4px] border border-line bg-panel px-1.5 font-mono text-xs"
        >
          {shortcutLabel(part)}
        </kbd>
      ))}
    </span>
  );
}

/**
 * Settings › Keyboard (ADR-0082's 2026-10-18 amendment): every command's keys, and a recorder
 * that changes them. A change is written at once (the `keymap.overrides` preference), with a
 * Reset per command and for the page.
 *
 * Test hooks: rows `[data-keymap-row="<id>"]` (with `data-keymap-changed` when overridden), the
 * recording row also `[data-keymap-recording]`; buttons "<label>: <key>", "Add key to <label>",
 * "Reset <label>", "Reset all keys"; the filters are buttons with `aria-pressed`.
 */
export function KeyboardPage({ preferences, commands, record }: KeyboardPageProps) {
  const store = keymapStore(preferences);
  const overrides = useKeymap(preferences);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [recording, setRecording] = useState<Recording | undefined>(
    record ? changing(record) : undefined,
  );
  const [note, setNote] = useState<{ id: string; text: string } | undefined>();

  const rows = useMemo(() => {
    if (!commands) return [];
    // `overrides` stands for `keysFor`'s state: a change lists the new keys.
    void overrides;
    return rowsOf(commands).map((row) => ({ ...row, keys: keysFor(row.id) }));
  }, [commands, overrides]);

  useEffect(() => {
    if (record) setRecording(changing(record));
  }, [record]);

  const save = (id: string, index: number, keys: string) => {
    const current = keysFor(id);
    const next = index >= 0 ? current.map((k, i) => (i === index ? keys : k)) : [...current, keys];
    store.set(id, [...new Set(next)]);
  };

  const commit = (state: Recording, keys: string) => {
    if (isReserved(keys)) {
      setRecording({
        id: state.id,
        index: state.index,
        error: `${shortcutLabel(keys)} can't be used.`,
      });
      return;
    }
    const { blocking, shared } = conflictsFor(state.id, keys, rows);
    if (blocking.length > 0) {
      setRecording({ id: state.id, index: state.index, conflict: { keys, with: blocking } });
      return;
    }
    save(state.id, state.index, keys);
    setRecording(undefined);
    setNote(
      shared.length > 0
        ? {
            id: state.id,
            text: `Also ${shared.map((c) => c.label).join(', ')} in the other mode; they're never offered together.`,
          }
        : undefined,
    );
  };

  const replace = () => {
    const state = recording;
    const conflict = state?.conflict;
    if (!state || !conflict) return;
    const changes: Record<string, readonly string[]> = {};
    for (const other of conflict.with) {
      changes[other.id] = keysFor(other.id).filter((k) => !clash(conflict.keys, k));
    }
    const current = keysFor(state.id);
    const next =
      state.index >= 0
        ? current.map((k, i) => (i === state.index ? conflict.keys : k))
        : [...current, conflict.keys];
    changes[state.id] = [...new Set(next)];
    store.setMany(changes);
    setRecording(undefined);
  };

  const remove = (id: string, index: number) => {
    store.set(
      id,
      keysFor(id).filter((_, i) => i !== index),
    );
    setRecording(undefined);
  };

  // The recorder: the next key goes to the row, not to the app, the dialog or a field.
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const listening = recording !== undefined && recording.conflict === undefined;
  useEffect(() => {
    if (!listening) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const state = recordingRef.current;
      if (!state || MODIFIERS.has(event.key) || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      const combo = eventKeys(event);
      if (combo === 'Escape') {
        setRecording(undefined);
        return;
      }
      if (state.first === undefined) {
        if (isReserved(combo)) {
          setRecording({ ...state, error: `${shortcutLabel(combo)} can't be used.` });
          return;
        }
        setRecording({ id: state.id, index: state.index, first: combo });
        return;
      }
      commitRef.current(state, combo === 'Enter' ? state.first : `${state.first} ${combo}`);
    };
    const onBlur = () => setRecording(undefined);
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('blur', onBlur);
    };
  }, [listening]);

  // The row being recorded scrolls into view (it may be far down when "Change shortcut…" opened it).
  const recordingId = recording?.id;
  const conflicting = recording?.conflict !== undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a Replace/Cancel line grows the row: show it too
  useEffect(() => {
    if (!recordingId) return;
    document
      .querySelector(`[data-keymap-row="${CSS.escape(recordingId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [recordingId, conflicting]);

  if (!commands) {
    return <p className="text-sm text-muted">Open a design to change the keys of its commands.</p>;
  }

  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => {
    if (filter === 'changed' && !(row.id in overrides)) return false;
    if (filter !== 'all' && filter !== 'changed' && !row.modes.has(filter)) return false;
    if (!needle) return true;
    return (
      row.label.toLowerCase().includes(needle) ||
      row.group.toLowerCase().includes(needle) ||
      row.keys.some((k) => shortcutLabel(k).toLowerCase() === needle)
    );
  });
  const groups = new Map<string, typeof shown>();
  for (const row of shown) groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
  const changedCount = Object.keys(overrides).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <TextInput
          aria-label="Search commands"
          placeholder="Search commands or keys"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="flex-1"
        />
        <Button variant="secondary" onClick={() => store.resetAll()} disabled={changedCount === 0}>
          Reset all keys
        </Button>
      </div>
      <fieldset className="m-0 flex flex-wrap gap-1 border-0 p-0">
        <legend className="sr-only">Show</legend>
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className="rounded-control border border-line px-2.5 py-0.5 text-xs text-muted aria-pressed:border-accent aria-pressed:text-ink"
          >
            {value === 'changed' && changedCount > 0 ? `${label} (${changedCount})` : label}
          </button>
        ))}
      </fieldset>
      <p className="text-xs text-muted">
        Click a key to change it. Press the new key, then Enter; or two keys in a row for a chord
        such as K then H. Esc cancels.
      </p>
      <div
        data-keymap-list=""
        className="h-[380px] overflow-y-auto rounded-control border border-line px-2 pb-2"
      >
        {shown.length === 0 && <p className="pt-2 text-sm text-muted">No command matches.</p>}
        {[...groups].map(([group, list]) => (
          <section key={group} aria-label={group}>
            <h4 className="mt-3 mb-1 border-b border-line pb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {group}
            </h4>
            {list.map((row) => (
              <KeyRow
                key={row.id}
                row={row}
                changed={row.id in overrides}
                recording={recording?.id === row.id ? recording : undefined}
                note={note?.id === row.id ? note.text : undefined}
                onRecord={(index) => {
                  setNote(undefined);
                  setRecording({ id: row.id, index });
                }}
                onCancel={() => setRecording(undefined)}
                onRemove={(index) => remove(row.id, index)}
                onReplace={replace}
                onReset={() => store.reset(row.id)}
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

function KeyRow({
  row,
  changed,
  recording,
  note,
  onRecord,
  onCancel,
  onRemove,
  onReplace,
  onReset,
}: {
  row: Row;
  changed: boolean;
  recording: Recording | undefined;
  note: string | undefined;
  onRecord(index: number): void;
  onCancel(): void;
  onRemove(index: number): void;
  onReplace(): void;
  onReset(): void;
}) {
  return (
    <div
      data-keymap-row={row.id}
      data-keymap-changed={changed || undefined}
      data-keymap-recording={recording ? '' : undefined}
      className={`rounded-control px-2 py-1.5 ${recording ? 'bg-accent-soft' : ''}`}
    >
      <div className="flex min-h-7 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          {row.label}
          {changed && <span className="ml-2 text-xs text-accent">changed</span>}
        </span>
        {recording && !recording.conflict ? (
          <span className="flex items-center gap-2 text-xs" role="status">
            {recording.first ? (
              <>
                <Keys keys={recording.first} />
                <span className="text-muted">Enter keeps it, or press a second key</span>
              </>
            ) : (
              <span className="text-accent">Press a key…</span>
            )}
            {recording.index >= 0 && (
              <button
                type="button"
                className="rounded-control px-1.5 text-muted underline hover:text-ink"
                onClick={() => onRemove(recording.index)}
              >
                Remove key
              </button>
            )}
            <button
              type="button"
              className="rounded-control px-1.5 text-muted underline hover:text-ink"
              onClick={onCancel}
            >
              Cancel
            </button>
          </span>
        ) : (
          <span className="flex items-center gap-1">
            {row.keys.map((keys, index) => (
              <button
                key={keys}
                type="button"
                aria-label={`${row.label}: ${shortcutLabel(keys)}`}
                title="Change this key"
                onClick={() => onRecord(index)}
                className="rounded-control p-0.5 hover:bg-accent-soft"
              >
                <Keys keys={keys} />
              </button>
            ))}
            <button
              type="button"
              aria-label={`Add key to ${row.label}`}
              onClick={() => onRecord(-1)}
              className="rounded-control px-1.5 text-xs text-muted hover:bg-accent-soft hover:text-ink"
            >
              {row.keys.length === 0 ? 'Add key' : '+'}
            </button>
            {changed && (
              <button
                type="button"
                aria-label={`Reset ${row.label}`}
                onClick={onReset}
                className="rounded-control px-1.5 text-xs text-muted underline hover:text-ink"
              >
                Reset
              </button>
            )}
          </span>
        )}
      </div>
      {recording?.error && <p className="text-xs text-error">{recording.error}</p>}
      {recording?.conflict && (
        <div className="flex flex-wrap items-center gap-2 text-xs" role="alert">
          <span>
            <Keys keys={recording.conflict.keys} /> is{' '}
            {recording.conflict.with.map((c) => c.label).join(', ')} here.
          </span>
          <Button variant="secondary" onClick={onReplace}>
            Replace
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}
