import { Pin, PinOff, Search } from 'lucide-react';
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

/** Which search is open: the Ctrl+K palette, or the S toolbox at the pointer. */
export type SearchOpen = { kind: 'palette' } | { kind: 'toolbox'; at: { x: number; y: number } };

export interface CommandSearchProps {
  open: SearchOpen | undefined;
  commands: readonly AppCommand[];
  /** Command IDs, most recent first. */
  recent: readonly string[];
  /** The toolbox's pinned command IDs, in order. */
  pinned: readonly string[];
  onTogglePin(id: string): void;
  /** Runs a command the user picked; the search has closed by then. */
  onRun(command: AppCommand): void;
  onClose(): void;
}

const RECENT = 5;

/**
 * Command search (P1-14, UI spec §3.3): the Ctrl+K palette at the top of the
 * window and the S toolbox at the pointer, with the toolbox's pinned
 * commands above the search. Type to filter (fuzzy); arrows move, Enter
 * runs, Shift+Enter pins or unpins, Esc closes.
 */
export function CommandSearch(props: CommandSearchProps) {
  const { open, onClose } = props;
  const ran = useRef(false);
  const toolbox = open?.kind === 'toolbox';
  return (
    <FloatingDialog
      open={open !== undefined}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={toolbox ? 'Toolbox' : 'Command palette'}
      {...(open?.kind === 'toolbox' && { at: { x: open.at.x - 24, y: open.at.y - 24 } })}
      width={toolbox ? 360 : 560}
      maxHeight={toolbox ? 440 : 480}
      dim={!toolbox}
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
          toolbox={toolbox}
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
  onRun,
  toolbox,
}: CommandSearchProps & { toolbox: boolean }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
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
        if (command) onTogglePin(command.id);
      } else run(command);
    }
  };

  const pins = pinned
    .map((p) => commands.find((c) => c.id === p))
    .filter((c): c is AppCommand => c !== undefined);
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
          aria-label={toolbox ? 'Search tools' : 'Search commands'}
          placeholder={toolbox ? 'Search tools' : 'Search commands'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-muted"
        />
      </div>
      {toolbox && (
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
        </section>
      )}
      <div
        id={`${id}-list`}
        role="listbox"
        aria-label={toolbox ? 'Tools' : 'Commands'}
        className="min-h-0 flex-1 overflow-y-auto p-1"
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
                  showGroup={!section.title}
                  onHover={() => setActive(i)}
                  onRun={() => run(item)}
                  onTogglePin={() => onTogglePin(item.id)}
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
  showGroup,
  onHover,
  onRun,
  onTogglePin,
}: {
  id: string;
  command: AppCommand;
  positions: number[];
  active: boolean;
  pinned: boolean;
  showGroup: boolean;
  onHover(): void;
  onRun(): void;
  onTogglePin(): void;
}) {
  const keys = command.keys[0];
  const PinIcon = pinned ? PinOff : Pin;
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
      className={`group flex h-9 cursor-default items-center gap-2.5 rounded-input px-2 text-sm ${active ? 'bg-accent-soft' : ''} ${command.unavailable ? 'text-muted' : ''}`}
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
        <span className="shrink-0 text-xs text-muted">{command.unavailable}</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {showGroup && <span className="text-xs text-muted">{command.group}</span>}
        {keys && <Kbd>{shortcutLabel(keys)}</Kbd>}
        {/* Pointer shortcut for Shift+Enter, so not a separate stop for assistive tech. */}
        <span
          aria-hidden="true"
          title={pinned ? 'Unpin from the toolbox' : 'Pin to the toolbox'}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          className={`grid size-6 place-items-center rounded-control text-muted hover:bg-accent-soft hover:text-ink ${pinned || active ? '' : 'invisible group-hover:visible'}`}
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
