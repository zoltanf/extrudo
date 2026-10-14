import { type DocumentStore, renameDocument } from '@extrudo/core';
import {
  BookOpen,
  CircleHelp,
  Code,
  GraduationCap,
  History,
  ListChecks,
  Redo2,
  RefreshCw,
  Search,
  Shapes,
  Undo2,
  Wrench,
} from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { keysFor } from '../commands/keymap';
import { shortcutLabel } from '../commands/shortcuts';
import {
  Button,
  IconButton,
  LogoMark,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  TextInput,
  type ThemeChoice,
  Tooltip,
  Wordmark,
} from '../design-system';
import type { Autosaver } from '../project/autosave';
import { HOME_HREF } from '../routes';
import type { DisplayAccess } from '../settings/displaySettings';
import { AppMenu } from './AppMenu';
import type { DocsPage } from './docsLinks';
import { TITLE_GAP, type TitleFit, titleFit } from './titleFit';

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
  /** Opens the Plugins dialog: install, enable, remove (P6-03 slice 2, ADR-0077 §6). */
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
   * Opens the search (P1-14, R3-05): dropped from the Search button's bottom-left corner
   * `at`, or centred when absent (the Help menu).
   */
  onSearch(at?: { x: number; y: number }): void;
  /** The view's display settings: the app menu's General and Mouse controls read and write them. */
  display: DisplayAccess;
  /** Opens "Customize Marking Menu…". */
  onCustomizeMarking(): void;
  /** Starts the tutorial (P3-12). */
  onTutorial(): void;
  /** Opens a docs page (P6-06 S9): the Help menu's items, through the platform. */
  onDocs(page: DocsPage): void;
  /** Runs the `help` command: the page of the tool last hovered, else the guide. */
  onHelp(): void;
  /** Help › Check for Updates… (desktop only, ADR-0075's 2026-10-09 amendment); absent on the web. */
  onCheckUpdates?(): void;
  /** Settings › General › Radial right-click menu: the same state as the command that toggles it. */
  markingRadial: boolean;
  onMarkingRadial(radial: boolean): void;
  /** Opens the Settings dialog (ADR-0082). */
  onSettings(): void;
  /** Help › Source on GitHub. */
  onSource(): void;
  /** The app menu's Quit (desktop only); absent on the web. */
  onQuit?: (() => void) | undefined;
  /** The app menu's Close design (the web's stand-in for Quit). */
  onCloseDesign?: (() => void) | undefined;
}

/** A command's first key as it reads here ("Ctrl+K"). */
const keyLabel = (id: string) => {
  const keys = keysFor(id)[0];
  return keys && shortcutLabel(keys);
};

/** A thin divider between the bar's clusters. */
const Separator = () => <div className="mx-1.5 h-5 w-px shrink-0 bg-line" aria-hidden="true" />;

/**
 * The top bar (UI spec §2, ADR-0079): the logo, the toolbar's tabs, search, undo,
 * redo (UI review 3, R3-05), the design's name and save state centred
 * between them and the right-hand buttons: version history, the app menu
 * (`AppMenu`) and help. The File menu it once had is the Home tab.
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
  onHelp,
  onCheckUpdates,
  markingRadial,
  onMarkingRadial,
  display,
  onCustomizeMarking,
  onSettings,
  onSource,
  onQuit,
  onCloseDesign,
}: AppBarProps) {
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
        <SearchButton onSearch={onSearch} />
        <IconButton
          label="Undo"
          shortcut={keyLabel('undo')}
          hint={undoLabel ? `Undo “${undoLabel}”.` : 'Nothing to undo.'}
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 size={18} strokeWidth={1.75} />
        </IconButton>
        <IconButton
          label="Redo"
          shortcut={keyLabel('redo')}
          hint={redoLabel ? `Redo “${redoLabel}”.` : 'Nothing to redo.'}
          disabled={!canRedo}
          onClick={redo}
        >
          <Redo2 size={18} strokeWidth={1.75} />
        </IconButton>
      </div>

      <TitleGroup store={store} name={name} autosave={autosave} />

      <div className="flex shrink-0 items-center gap-1">
        {file.versionHistory && (
          <IconButton
            label="Version history"
            hint="Saved versions of this design: save one, restore one, or open one as a copy."
            onClick={file.versionHistory}
          >
            <History size={18} strokeWidth={1.75} />
          </IconButton>
        )}
        <AppMenu
          display={display}
          theme={theme}
          onThemeChange={onThemeChange}
          onCustomizeMarking={onCustomizeMarking}
          markingRadial={markingRadial}
          onMarkingRadial={onMarkingRadial}
          onSettings={onSettings}
          onPlugins={file.plugins}
          onQuit={onQuit}
          onCloseDesign={onCloseDesign}
        />
        <Menu
          label="Help"
          align="end"
          trigger={
            <IconButton label="Help">
              <CircleHelp size={18} strokeWidth={1.75} />
            </IconButton>
          }
        >
          <MenuLabel>Help</MenuLabel>
          <MenuItem
            icon={<Search size={14} />}
            shortcut={keyLabel('search')}
            onSelect={() => onSearch()}
          >
            Search…
          </MenuItem>
          <MenuSeparator />
          {/* Five steps that build a box (P3-12). */}
          <MenuItem icon={<GraduationCap size={14} />} onSelect={onTutorial}>
            Tutorial
          </MenuItem>
          {/* The docs on the landing site (P6-06 S9, ADR-0080 §5). F1 is the
              help command's key ("Help for This Tool"): the hovered tool's page, else the guide. */}
          <MenuSeparator />
          <MenuItem icon={<BookOpen size={14} />} onSelect={() => onDocs('guide')}>
            User Guide
          </MenuItem>
          <MenuItem icon={<CircleHelp size={14} />} shortcut={keyLabel('help')} onSelect={onHelp}>
            Help for This Tool
          </MenuItem>
          <MenuItem icon={<ListChecks size={14} />} onSelect={() => onDocs('tutorials')}>
            Tutorials
          </MenuItem>
          <MenuItem icon={<Shapes size={14} />} onSelect={() => onDocs('examples')}>
            Examples
          </MenuItem>
          <MenuItem icon={<Wrench size={14} />} onSelect={() => onDocs('tools')}>
            Tool Reference
          </MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Code size={14} />} onSelect={onSource}>
            Source on GitHub
          </MenuItem>
          {onCheckUpdates && (
            <>
              <MenuSeparator />
              <MenuItem icon={<RefreshCw size={14} />} onSelect={onCheckUpdates}>
                Check for Updates…
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </header>
  );
}

/**
 * The search drops from its button over a dimmed page (R3-05); Ctrl+K opens it
 * centred and S at the pointer. Its tooltip names Ctrl+K.
 */
function SearchButton({ onSearch }: Pick<AppBarProps, 'onSearch'>) {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} className="inline-flex">
      <IconButton
        label="Search"
        shortcut={keyLabel('search')}
        hint="Your pinned commands, and every command by name. S opens it at the pointer."
        onClick={() => {
          const r = ref.current?.getBoundingClientRect();
          onSearch(r && { x: r.left, y: r.bottom });
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
}: {
  store: DocumentStore;
  name: string;
  autosave: Autosaver;
}) {
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
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // The probes change size with the name and the status word.
    if (nameProbe.current) observer.observe(nameProbe.current);
    if (statusProbe.current) observer.observe(statusProbe.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={area} className="relative flex min-w-0 flex-1 items-center justify-center">
      <div
        className="flex min-w-0 max-w-full items-center"
        style={{ gap: TITLE_GAP }}
        data-title-fit={fit}
        data-title-group=""
      >
        <ProjectName store={store} name={name} />
        <SaveStatus autosave={autosave} compact={fit !== 'full'} />
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
          <SaveStatus autosave={autosave} probe />
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
}: {
  autosave: Autosaver;
  /** Only the dot is drawn; the word stays for screen readers and the tooltip. */
  compact?: boolean;
  /** The full-width copy the title measures: no tooltip, no role. */
  probe?: boolean;
}) {
  const { status, error, savedAt } = useStore(autosave);
  const badge = 'inline-flex items-center gap-1.5 rounded-input px-1.5 py-0.5 text-sm';
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
  if (probe) {
    return (
      <span className={`${badge} text-muted`}>
        <span className="size-1.5 rounded-full" />
        <span>{view.text}</span>
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
