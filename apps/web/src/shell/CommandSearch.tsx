import { Keyboard, Pin, PinOff, Search } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type SearchResult, searchCommands } from '../commands/search';
import { shortcutLabel } from '../commands/shortcuts';
import { FloatingDialog } from '../design-system';
import type { AppCommand } from './commands';
import { canTogglePin, PIN_LIMIT, PINS_FULL, shownPins } from './searchPins';

/** A point on the page, in px. */
type Point = { x: number; y: number };

/**
 * How the search was opened (UI review 3, R3-05): centred over a dimmed page
 * (Ctrl+K, the Help menu), at the pointer with the page left clear (S), or
 * dropped from the top bar's Search button over a dimmed page. `at` is the
 * pointer, or the button's bottom-right corner.
 */
export type SearchOpen =
  | { from: 'centre' }
  | { from: 'pointer'; at: Point }
  | { from: 'button'; at: Point };

export interface CommandSearchProps {
  open: SearchOpen | undefined;
  commands: readonly AppCommand[];
  /** Command IDs, most recent first. */
  recent: readonly string[];
  /** The pinned command IDs, in order (the `toolbox.pins` preference). */
  pinned: readonly string[];
  onTogglePin(id: string): void;
  /** A row's key button: Settings › Keyboard recording that command's key. */
  onChangeShortcut?: ((id: string) => void) | undefined;
  /** Runs a command the user picked; the search has closed by then. */
  onRun(command: AppCommand): void;
  onClose(): void;
}

const RECENT = 5;
const WIDTH = 480;
const MAX_HEIGHT = 440;
/** The dialog opens with the pointer this far inside its top-left corner. */
const POINTER_INSET = 24;
/** The gap between the Search button and the dialog dropped from it. */
const BUTTON_GAP = 4;

/** Where the dialog's top-left corner goes; top centre when undefined. */
function placement(open: SearchOpen | undefined): Point | undefined {
  if (open?.from === 'pointer')
    return { x: open.at.x - POINTER_INSET, y: open.at.y - POINTER_INSET };
  if (open?.from === 'button') return { x: open.at.x - WIDTH, y: open.at.y + BUTTON_GAP };
  return undefined;
}

/**
 * Search (P1-14, UI spec §5; one dialog since the owner's UI review 3,
 * R3-05): the pinned commands as tiles, at most ten in two rows of five,
 * over the grouped list of every command offered here. Type to filter
 * (fuzzy); arrows move, Enter runs, Shift+Enter pins or unpins, Esc closes.
 */
export function CommandSearch(props: CommandSearchProps) {
  const { open, onClose } = props;
  const ran = useRef(false);
  const at = placement(open);
  return (
    <FloatingDialog
      open={open !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Search"
      {...(at && { at })}
      width={WIDTH}
      maxHeight={MAX_HEIGHT}
      dim={open?.from !== 'pointer'}
      keepFocus={() => {
        // A command that opened a dialog keeps its focus; otherwise focus goes back.
        const keep = ran.current;
        ran.current = false;
        return keep;
      }}
    >
      {open && (
        <SearchBody
          {...props}
          onRun={(command) => {
            ran.current = true;
            props.onRun(command);
          }}
        />
      )}
    </FloatingDialog>
  );
}

interface Section {
  title?: string;
  results: SearchResult<AppCommand>[];
}

function SearchBody({
  commands,
  recent,
  pinned,
  onTogglePin,
  onChangeShortcut,
  onRun,
}: CommandSearchProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // Set when a pin was refused because the pins are full; cleared by the next toggle.
  const [full, setFull] = useState(false);
  const id = useId();

  const sections = useMemo<Section[]>(() => {
    if (query.trim()) return [{ results: searchCommands(commands, query, recent) }];
    const byId = new Map(commands.map((c) => [c.id, c]));
    const recentItems = recent
      .map((r) => byId.get(r))
      .filter((c): c is AppCommand => c !== undefined && !c.unavailable)
      .slice(0, RECENT);
    const groups = new Map<string, AppCommand[]>();
    for (const c of commands) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
    return [
      ...(recentItems.length > 0
        ? [{ title: 'Recent', results: recentItems.map((item) => ({ item, positions: [] })) }]
        : []),
      ...[...groups].map(([title, items]) => ({
        title,
        results: items.map((item) => ({ item, positions: [] })),
      })),
    ];
  }, [commands, query, recent]);
  const flat = useMemo(() => sections.flatMap((s) => s.results.map((r) => r.item)), [sections]);
  const current = Math.min(active, flat.length - 1);
  const optionId = (i: number) => `${id}-option-${i}`;

  // A new query starts at the top; the active row stays in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the query changes
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (current >= 0)
      document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' });
  });

  const run = (command: AppCommand | undefined) => {
    if (command && !command.unavailable) onRun(command);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const move = (to: number) => {
      event.preventDefault();
      if (flat.length > 0) setActive((to + flat.length) % flat.length);
    };
    if (event.key === 'ArrowDown') move(current + 1);
    else if (event.key === 'ArrowUp') move(current - 1);
    else if (event.key === 'PageDown') move(Math.min(flat.length - 1, current + 8));
    else if (event.key === 'PageUp') move(Math.max(0, current - 8));
    else if (event.key === 'Enter') {
      event.preventDefault();
      const command = flat[current];
      if (event.shiftKey) {
        if (command) togglePin(command.id);
      } else run(command);
    }
  };

  const pins = shownPins(pinned, commands);
  const pinsFull = pins.length >= PIN_LIMIT;
  const togglePin = (commandId: string) => {
    const allowed = canTogglePin(commandId, pinned, pins.length);
    setFull(!allowed);
    if (allowed) onTogglePin(commandId);
  };
  let index = -1;

  return (
    <>
      <div className="flex items-center gap-2 border-b border-line px-3">
        <Search size={16} strokeWidth={1.75} className="shrink-0 text-muted" />
        <input
          // biome-ignore lint/a11y/noAutofocus: the search opens for typing
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          aria-label="Search commands"
          placeholder="Search commands"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
        />
      </div>
      <section aria-label="Pinned" className="border-b border-line px-2 py-2">
        {pins.length > 0 ? (
          <div className="grid grid-cols-5 gap-0.5">
            {pins.map((command) => (
              <button
                key={command.id}
                type="button"
                aria-label={command.label}
                aria-disabled={command.unavailable ? true : undefined}
                title={
                  command.unavailable ? `${command.label}. ${command.unavailable}` : command.label
                }
                onClick={() => (command.unavailable ? command.run() : onRun(command))}
                className={`flex min-w-0 flex-col items-center gap-1 rounded-control px-1 py-1.5 text-[11px] text-muted hover:bg-accent-soft hover:text-ink ${command.unavailable ? 'opacity-55' : ''}`}
              >
                <span className="grid size-5 place-items-center text-ink">{command.icon}</span>
                <span className="w-full truncate text-center">
                  {command.short ?? command.label}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="px-1 text-sm text-muted">
            Pin a command to keep it here: Shift+Enter, or its pin.
          </p>
        )}
        {/* An eleventh pin is refused with a reason, read out where it was asked for. */}
        <p role="status" className="px-1 text-xs text-muted">
          {full ? PINS_FULL : ''}
        </p>
      </section>
      <div
        id={`${id}-list`}
        role="listbox"
        aria-label="Commands"
        // No horizontal scroll bar at any width (R3-05): a row's parts truncate instead.
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-1"
      >
        {flat.length === 0 && <p className="px-2 py-3 text-sm text-muted">No command matches.</p>}
        {sections.map((section) => (
          // biome-ignore lint/a11y/useSemanticElements: options are grouped inside a listbox
          <div key={section.title ?? 'results'} role="group" aria-label={section.title}>
            {section.title && (
              <div
                aria-hidden="true"
                className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-[0.08em] text-muted uppercase"
              >
                {section.title}
              </div>
            )}
            {section.results.map(({ item, positions }) => {
              index += 1;
              const i = index;
              return (
                <Option
                  key={`${section.title ?? ''}:${item.id}`}
                  id={optionId(i)}
                  command={item}
                  positions={positions}
                  active={i === current}
                  pinned={pinned.includes(item.id)}
                  pinsFull={pinsFull}
                  showGroup={!section.title}
                  onHover={() => setActive(i)}
                  onRun={() => run(item)}
                  onTogglePin={() => togglePin(item.id)}
                  onChangeShortcut={onChangeShortcut && (() => onChangeShortcut(item.id))}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div
        aria-hidden="true"
        className="flex gap-3 border-t border-line px-3 py-1.5 text-[11px] text-muted"
      >
        <span>
          <Kbd>↵</Kbd> Run
        </span>
        <span>
          <Kbd>⇧↵</Kbd> Pin
        </span>
        <span>
          <Kbd>Esc</Kbd> Close
        </span>
      </div>
    </>
  );
}

function Option({
  id,
  command,
  positions,
  active,
  pinned,
  pinsFull,
  showGroup,
  onHover,
  onRun,
  onTogglePin,
  onChangeShortcut,
}: {
  id: string;
  command: AppCommand;
  positions: number[];
  active: boolean;
  pinned: boolean;
  /** Ten commands are pinned: this one's pin is refused unless it is one of them. */
  pinsFull: boolean;
  showGroup: boolean;
  onHover(): void;
  onRun(): void;
  onTogglePin(): void;
  onChangeShortcut?: (() => void) | undefined;
}) {
  const keys = command.keys[0];
  const PinIcon = pinned ? PinOff : Pin;
  const refused = pinsFull && !pinned;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the search field drives the keyboard
    <div
      id={id}
      role="option"
      tabIndex={-1}
      aria-selected={active}
      aria-disabled={command.unavailable ? true : undefined}
      onMouseMove={active ? undefined : onHover}
      onClick={onRun}
      className={`group flex h-9 min-w-0 cursor-default items-center gap-2.5 rounded-input px-2 text-sm ${active ? 'bg-accent-soft' : ''} ${command.unavailable ? 'text-muted' : ''}`}
    >
      <span
        className={`grid w-4 shrink-0 place-items-center ${command.unavailable ? 'opacity-55' : ''}`}
      >
        {command.icon}
      </span>
      <span className="min-w-0 truncate">
        <Highlight text={command.label} positions={positions} />
      </span>
      {command.unavailable && (
        <span
          title={command.unavailable}
          className="min-w-0 flex-1 basis-0 truncate text-xs text-muted"
        >
          {command.unavailable}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {showGroup && <span className="text-xs text-muted">{command.group}</span>}
        {keys && <Kbd>{shortcutLabel(keys)}</Kbd>}
        {onChangeShortcut && (
          // A pointer shortcut like the pin; Settings › Keyboard is the way in for the keyboard.
          <span
            aria-hidden="true"
            data-change-shortcut=""
            title="Change shortcut"
            onClick={(event) => {
              event.stopPropagation();
              onChangeShortcut();
            }}
            className={`grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink ${active ? '' : 'invisible group-hover:visible'}`}
          >
            <Keyboard size={13} strokeWidth={1.75} />
          </span>
        )}
        {/* Pointer shortcut for Shift+Enter, so not a separate stop for assistive tech. */}
        <span
          aria-hidden="true"
          data-pin={pinned ? 'pinned' : refused ? 'full' : 'free'}
          title={pinned ? 'Unpin' : refused ? PINS_FULL : 'Pin to the top'}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          className={`grid size-6 place-items-center rounded-control text-muted ${refused ? 'cursor-not-allowed opacity-40' : 'hover:bg-accent-soft hover:text-ink'} ${pinned || active ? '' : 'invisible group-hover:visible'}`}
        >
          <PinIcon size={13} strokeWidth={1.75} />
        </span>
      </span>
    </div>
  );
}

function Highlight({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return text;
  const hit = new Set(positions);
  const parts: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const on = hit.has(i);
    let j = i;
    while (j < text.length && hit.has(j) === on) j++;
    const piece = text.slice(i, j);
    parts.push(
      on ? (
        <mark key={i} className="bg-transparent font-semibold text-accent">
          {piece}
        </mark>
      ) : (
        piece
      ),
    );
    i = j;
  }
  return parts;
}

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="font-mono text-xs text-muted">{children}</kbd>;
}
