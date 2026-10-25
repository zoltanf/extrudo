import { type DocumentStore, renameDocument } from '@extrudo/core';
import { History, Redo2, Search, Undo2 } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { AgentIndicator } from '../agent/AgentIndicator';
import { useKeysFor } from '../commands/keymapStore';
import { shortcutLabel } from '../commands/shortcuts';
import {
  Button,
  IconButton,
  LogoMark,
  Popover,
  TextInput,
  type ThemeChoice,
  Tooltip,
  Wordmark,
} from '../design-system';
import type { AgentBridge } from '../platform';
import type { PlatformUpdates } from '../platform/updates';
import type { Autosaver } from '../project/autosave';
import { HOME_HREF } from '../routes';
import type { DisplayAccess } from '../settings/displaySettings';
import { AppMenu, type HelpTool } from './AppMenu';
import type { DocsPage } from './docsLinks';
import { DOT_WIDTH, HISTORY_WIDTH, TITLE_GAP, type TitleFit, titleFit } from './titleFit';

/** The design's file actions (the Home tab's commands, ADR-0079); the project page implements them. */
export interface FileActions {
  newDesign(): void;
  home(): void;
  exportFile(): void;
  importFile(): void;
  /** Opens an `.f3d` file Import Model picked as a new design (ADR-0083 §4). */
  importF3d?(file: File): void;
  /** Opens the model's export (STL, 3MF, STEP; P2-12). */
  exportModel?(): void;
  /** Picks a STEP, mesh or OpenSCAD file and opens the Import dialog (P4-06, P5-04); an `.f3d` goes to `importF3d`. */
  importModel?(): void;
  /** Downloads the design as TypeScript that makes it again (P5-05). */
  exportScript?(): void;
  /** Opens the Versions dialog at its description field (P2-14). */
  saveVersion?(): void;
  /** Opens the Versions dialog (P2-14). */
  versionHistory?(): void;
  /** Desktop only (ADR-0075, 2026-10-09): the native Open… dialog; the file opens as a linked design. */
  openFile?(): void;
  /**
   * Desktop only (P6-01 slice 2): "Save As…" writes the design to a path the
   * user chooses and links the project to it. The web's Home tab leaves it out;
   * the native menu offers it when `platform.files.saveAs` exists.
   */
  saveAs?(): void;
  /**
   * Writes this design into the linked folder as `<name>.extrudo` and links
   * the two (P4-09, ADR-0065 §3). Present only where a folder is linked and
   * this project isn't linked yet.
   */
  saveToLinkedFolder?(): void;
  /** Opens a new design with the tutorial running (P3-12), for a design that isn't empty. */
  startTutorial?(): void;
  /** Opens Settings › Plugins: install, enable, remove (P6-03 slice 2, ADR-0090 §2). */
  plugins?(): void;
}

export interface AppBarProps {
  store: DocumentStore;
  autosave: Autosaver;
  file: FileActions;
  /** The toolbar's tabs (`ToolbarTabs`), drawn after the logo (ADR-0079). */
  tabs: ReactNode;
  theme: ThemeChoice;
  onThemeChange(theme: ThemeChoice): void;
  /**
   * Opens the search (P1-14, R3-05): dropped from the Search button's bottom-right corner
   * `at`, or centred when absent (the app menu).
   */
  onSearch(at?: { x: number; y: number }): void;
  /** The view's display settings: the app menu's General and Mouse controls read and write them. */
  display: DisplayAccess;
  /** Starts the tutorial (P3-12). */
  onTutorial(): void;
  /** Opens a docs page (P6-06 S9): the app menu's Learn items, through the platform. */
  onDocs(page: DocsPage): void;
  /** The panel's "Help for <tool>": asked when it opens (ADR-0090 §1). */
  helpTool(): HelpTool | undefined;
  /** The strip's Check now (desktop only, ADR-0075's 2026-10-09 amendment); absent on the web. */
  onCheckUpdates?(): void;
  /** About Extrudo. */
  onAbout(): void;
  /** Report a bug (ADR-0092). */
  onReportBug?: (() => void) | undefined;
  /** The build's version and the update state, in the panel's strip. */
  version: string;
  updates?: PlatformUpdates | undefined;
  /** Settings › General › Radial right-click menu: the same state as the command that toggles it. */
  markingRadial: boolean;
  onMarkingRadial(radial: boolean): void;
  /** Opens the Settings dialog (ADR-0082). */
  onSettings(): void;
  /** The strip's GitHub (Source on GitHub). */
  onSource(): void;
  /** The app menu's Quit (desktop only); absent on the web. */
  onQuit?: (() => void) | undefined;
  /** The app menu's Close design (the web's stand-in for Quit). */
  onCloseDesign?: (() => void) | undefined;
  /** The desktop MCP server: the "Agent connected" badge (P6-08); absent on the web. */
  agent?: AgentBridge | undefined;
}

/** A command's first key as it reads here ("Ctrl+K"); `keys` from `useKeysFor` (live). */
const keyLabel = (keys: readonly string[]) => keys[0] && shortcutLabel(keys[0]);

/** A thin divider between the bar's clusters. */
const Separator = () => <div className="mx-1.5 h-5 w-px shrink-0 bg-line" aria-hidden="true" />;

/**
 * The top bar (UI spec §2, ADR-0079): the logo, the toolbar's tabs, search, undo,
 * redo (UI review 3, R3-05), the design's name and save state centred
 * between them and the right-hand buttons: version history and the app menu
 * (`AppMenu`, ADR-0090). The File menu it once had is the Home tab.
 */
export function AppBar({
  store,
  autosave,
  file,
  tabs,
  theme,
  onThemeChange,
  onSearch,
  onTutorial,
  onDocs,
  helpTool,
  onCheckUpdates,
  version,
  updates,
  onAbout,
  onReportBug,
  markingRadial,
  onMarkingRadial,
  display,
  onSettings,
  onSource,
  onQuit,
  onCloseDesign,
  agent,
}: AppBarProps) {
  const keysFor = useKeysFor();
  const name = useStore(store, (s) => s.doc.name);
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useStore(store);

  return (
    <header className="flex h-10 items-stretch gap-1 border-b border-line bg-bg px-2">
      <Tooltip label="All designs">
        <a
          href={HOME_HREF}
          data-topbar-logo=""
          className="flex shrink-0 items-center gap-2 self-center rounded-control px-1 py-0.5 hover:bg-accent-soft"
        >
          <LogoMark size={20} title="Extrudo" />
          {/* Narrow windows keep the mark only, so the tabs fit (ADR-0079). */}
          <Wordmark className="text-[16px] max-lg:hidden" />
        </a>
      </Tooltip>
      <div className="w-1.5 shrink-0" aria-hidden="true" />
      {tabs}
      <div className="flex shrink-0 items-center">
        <Separator />
        <IconButton
          label="Undo"
          shortcut={keyLabel(keysFor('undo'))}
          hint={undoLabel ? `Undo “${undoLabel}”.` : 'Nothing to undo.'}
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 size={18} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Redo"
          shortcut={keyLabel(keysFor('redo'))}
          hint={redoLabel ? `Redo “${redoLabel}”.` : 'Nothing to redo.'}
          disabled={!canRedo}
          onClick={redo}
        >
          <Redo2 size={18} strokeWidth={1.75} />
        </IconButton>
      </div>

      <TitleGroup
        store={store}
        name={name}
        autosave={autosave}
        onVersionHistory={file.versionHistory}
      />

      <div className="flex shrink-0 items-center gap-1">
        <AgentIndicator agent={agent} />
        <SearchButton onSearch={onSearch} />
        <AppMenu
          display={display}
          theme={theme}
          onThemeChange={onThemeChange}
          markingRadial={markingRadial}
          onMarkingRadial={onMarkingRadial}
          onSettings={onSettings}
          onSearch={() => onSearch()}
          onAbout={onAbout}
          onReportBug={onReportBug}
          onTutorial={onTutorial}
          onDocs={onDocs}
          helpTool={helpTool}
          version={version}
          updates={updates}
          onCheckUpdates={onCheckUpdates}
          onSource={onSource}
          onQuit={onQuit}
          onCloseDesign={onCloseDesign}
        />
      </div>
    </header>
  );
}

/**
 * The search drops from its button over a dimmed page (R3-05); Ctrl+K opens it
 * centred and S at the pointer. Its tooltip names Ctrl+K.
 */
function SearchButton({ onSearch }: Pick<AppBarProps, 'onSearch'>) {
  const keysFor = useKeysFor();
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} className="inline-flex">
      <IconButton
        label="Search"
        shortcut={keyLabel(keysFor('search'))}
        hint="Your pinned commands, and every command by name. S opens it at the pointer."
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          onSearch(r && { x: r.right, y: r.bottom });
        }}
      >
        <Search size={18} strokeWidth={1.75} />
      </IconButton>
    </span>
  );
}

/**
 * The name, a dot and the save state, centred between the cluster and the right-hand
 * buttons. When they don't fit, the word goes first (the dot stays), then the name is
 * cut short. Natural widths come from a hidden copy, so the rule needs no layout loop.
 */
function TitleGroup({
  store,
  name,
  autosave,
  onVersionHistory,
}: {
  store: DocumentStore;
  name: string;
  autosave: Autosaver;
  /** Opens Version history: the save state is its button (owner, 2026-10-24). */
  onVersionHistory: (() => void) | undefined;
}) {
  const history = onVersionHistory ? HISTORY_WIDTH : 0;
  const area = useRef<HTMLDivElement>(null);
  const nameProbe = useRef<HTMLSpanElement>(null);
  const statusProbe = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<TitleFit>('full');
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () =>
      setFit(
        titleFit(
          el.clientWidth,
          nameProbe.current?.offsetWidth ?? 0,
          statusProbe.current?.offsetWidth ?? 0,
          DOT_WIDTH + history,
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // The probes change size with the name and the status word.
    if (nameProbe.current) observer.observe(nameProbe.current);
    if (statusProbe.current) observer.observe(statusProbe.current);
    return () => observer.disconnect();
  }, [history]);
  return (
    <div ref={area} className="relative flex min-w-0 flex-1 items-center justify-center">
      <div
        className="flex min-w-0 max-w-full items-center"
        style={{ gap: TITLE_GAP }}
        data-title-fit={fit}
        data-title-group=""
      >
        <ProjectName store={store} name={name} />
        <SaveStatus
          autosave={autosave}
          compact={fit !== 'full'}
          onVersionHistory={onVersionHistory}
        />
      </div>
      {/* Natural widths, never seen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 h-0 overflow-hidden whitespace-nowrap"
      >
        <span ref={nameProbe} className={`${NAME_CLASS} inline-block truncate`}>
          {name}
        </span>
        <span ref={statusProbe} className="inline-block">
          <SaveStatus autosave={autosave} onVersionHistory={onVersionHistory} probe />
        </span>
      </div>
    </div>
  );
}

const NAME_CLASS = 'max-w-64 px-1.5 py-0.5 font-semibold';

/** The project name; click to rename (one undoable command). */
function ProjectName({ store, name }: { store: DocumentStore; name: string }) {
  const [draft, setDraft] = useState(name);
  const [open, setOpen] = useState(false);
  const commit = () => {
    if (draft.trim() && draft !== name) store.getState().dispatch(renameDocument({ name: draft }));
    setOpen(false);
  };
  return (
    <Popover
      label="Rename project"
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(name);
        setOpen(next);
      }}
      trigger={
        <button
          type="button"
          className={`${NAME_CLASS} min-w-0 truncate rounded-input hover:bg-accent-soft`}
          aria-label={`Project name: ${name}. Rename`}
          title={name}
        >
          {name}
        </button>
      }
    >
      <form
        className="flex w-64 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <TextInput
          aria-label="Project name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <Button type="submit" variant="primary">
          Rename
        </Button>
      </form>
    </Popover>
  );
}

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** The save state (FR-PRJ-03): never colour alone, always a word too. */
function SaveStatus({
  autosave,
  compact = false,
  probe = false,
  onVersionHistory,
}: {
  autosave: Autosaver;
  /** Makes the whole badge, with a history glyph after the word, open Version history. */
  onVersionHistory?: (() => void) | undefined;
  /** Only the dot is drawn; the word stays for screen readers and the tooltip. */
  compact?: boolean;
  /** The full-width copy the title measures: no tooltip, no role. */
  probe?: boolean;
}) {
  const { status, error, savedAt } = useStore(autosave);
  const badge = 'inline-flex h-8 items-center gap-1.5 rounded-input px-2 text-sm';
  if (status === 'error') {
    if (probe) {
      return (
        <span className={badge}>
          <span className="size-1.5 rounded-full" />
          <span>Couldn't save</span>
        </span>
      );
    }
    return (
      <Tooltip label="Couldn't save" hint={`${error ?? 'Unknown error.'} Click to try again.`}>
        <button
          type="button"
          onClick={() => void autosave.retry()}
          className={`${badge} text-error hover:bg-error/10`}
        >
          <span className="size-1.5 rounded-full bg-error" aria-hidden="true" />
          <span role="status" aria-label="Save status" className={compact ? 'sr-only' : ''}>
            Couldn't save
          </span>
        </button>
      </Tooltip>
    );
  }
  const view = {
    saved: {
      text: 'Saved',
      dot: 'bg-success',
      hint: savedAt ? `Saved in this browser at ${time(savedAt)}.` : 'Saved in this browser.',
    },
    saving: { text: 'Saving…', dot: 'bg-accent animate-pulse', hint: 'Saving in this browser.' },
    unsaved: { text: 'Edited', dot: 'bg-muted', hint: 'Saves automatically in a moment.' },
  }[status];
  const glyph = onVersionHistory && <History size={14} strokeWidth={2} aria-hidden="true" />;
  if (probe) {
    return (
      <span className={`${badge} text-muted`}>
        <span className="size-1.5 rounded-full" />
        <span>{view.text}</span>
        {glyph}
      </span>
    );
  }
  if (onVersionHistory) {
    // One target: a button under the whole badge, so the status keeps its own role.
    return (
      <span className={`${badge} relative shrink-0 text-muted`}>
        <Tooltip label="Version history" hint={`${view.hint} Click for saved versions.`}>
          <button
            type="button"
            aria-label="Version history"
            onClick={onVersionHistory}
            className="absolute inset-0 rounded-input hover:bg-accent-soft"
          />
        </Tooltip>
        <span
          className={`pointer-events-none relative size-1.5 rounded-full ${view.dot}`}
          aria-hidden="true"
        />
        <span
          role="status"
          aria-label="Save status"
          className={`pointer-events-none relative ${compact ? 'sr-only' : ''}`}
        >
          {view.text}
        </span>
        <span className="pointer-events-none relative">{glyph}</span>
      </span>
    );
  }
  return (
    <Tooltip label={view.text} hint={view.hint}>
      <span className={`${badge} shrink-0 text-muted`} tabIndex={-1}>
        <span className={`size-1.5 rounded-full ${view.dot}`} aria-hidden="true" />
        {/* Narrow: the dot stays, the word stays for screen readers (ADR-0079, round 2). */}
        <span role="status" aria-label="Save status" className={compact ? 'sr-only' : ''}>
          {view.text}
        </span>
      </span>
    </Tooltip>
  );
}
