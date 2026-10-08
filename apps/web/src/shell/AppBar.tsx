import { type DocumentStore, renameDocument } from '@extrudo/core';
import {
  CircleHelp,
  GraduationCap,
  History,
  PanelsTopLeft,
  Redo2,
  Search,
  Settings,
  Undo2,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
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
import { ThemeMenu } from './ThemeMenu';

/** The design's file actions (the Home tab's commands, ADR-0079); the project page implements them. */
export interface FileActions {
  newDesign(): void;
  home(): void;
  exportFile(): void;
  importFile(): void;
  /** Opens the model's export (STL, 3MF, STEP; P2-12). */
  exportModel?(): void;
  /** Picks a STEP, mesh or OpenSCAD file and opens the Import dialog (P4-06, P5-04). */
  importModel?(): void;
  /** Downloads the design as TypeScript that makes it again (P5-05). */
  exportScript?(): void;
  /** Opens the Versions dialog at its description field (P2-14). */
  saveVersion?(): void;
  /** Opens the Versions dialog (P2-14). */
  versionHistory?(): void;
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
  /** Opens command search: the Ctrl+K palette, or the S toolbox at the pointer (P1-14). */
  onSearch(kind: 'palette' | 'toolbox'): void;
  /** Starts the tutorial (P3-12). */
  onTutorial(): void;
}

/** A command's first key as it reads here ("Ctrl+K"). */
const keyLabel = (id: string) => {
  const keys = keysFor(id)[0];
  return keys && shortcutLabel(keys);
};

/** A thin divider between the bar's clusters. */
const Separator = () => <div className="mx-1.5 h-5 w-px shrink-0 bg-line" aria-hidden="true" />;

/**
 * The top bar (UI spec §2, ADR-0079): the logo, the toolbar's tabs, undo, redo
 * and command search, then the design's name, its versions and save state, and
 * settings, help and theme. The File menu it once had is the Home tab.
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
        <IconButton
          label="Search commands"
          shortcut={keyLabel('commandPalette')}
          hint={`Find and run any command by name. ${keyLabel('toolbox')} opens the toolbox at the pointer.`}
          onClick={() => onSearch('palette')}
        >
          <Search size={18} strokeWidth={1.75} />
        </IconButton>
        <Separator />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        <ProjectName store={store} name={name} />
        {file.versionHistory && (
          <IconButton
            label="Version history"
            hint="Saved versions of this design: save one, restore one, or open one as a copy."
            onClick={file.versionHistory}
          >
            <History size={16} strokeWidth={1.75} />
          </IconButton>
        )}
        <SaveStatus autosave={autosave} />
        <div className="w-1 shrink-0" aria-hidden="true" />
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Settings" hint="Arrives with P1." disabled>
          <Settings size={18} strokeWidth={1.75} />
        </IconButton>
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
            shortcut={keyLabel('commandPalette')}
            onSelect={() => onSearch('palette')}
          >
            Search commands…
          </MenuItem>
          <MenuItem
            icon={<PanelsTopLeft size={14} />}
            shortcut={keyLabel('toolbox')}
            onSelect={() => onSearch('toolbox')}
          >
            Toolbox…
          </MenuItem>
          <MenuSeparator />
          {/* Five steps that build a box (P3-12). */}
          <MenuItem icon={<GraduationCap size={14} />} onSelect={onTutorial}>
            Tutorial
          </MenuItem>
        </Menu>
        <ThemeMenu theme={theme} onThemeChange={onThemeChange} />
      </div>
    </header>
  );
}

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
          className="min-w-0 max-w-64 truncate rounded-input px-1.5 py-0.5 font-semibold hover:bg-accent-soft"
          aria-label={`Project name: ${name}. Rename`}
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
function SaveStatus({ autosave }: { autosave: Autosaver }) {
  const { status, error, savedAt } = useStore(autosave);
  const badge = 'inline-flex items-center gap-1.5 rounded-input px-1.5 py-0.5 text-sm';
  if (status === 'error') {
    return (
      <Tooltip label="Couldn't save" hint={`${error ?? 'Unknown error.'} Click to try again.`}>
        <button
          type="button"
          onClick={() => void autosave.retry()}
          className={`${badge} text-error hover:bg-error/10`}
        >
          <span className="size-1.5 rounded-full bg-error" aria-hidden="true" />
          <span role="status" aria-label="Save status">
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
  return (
    <Tooltip label={view.text} hint={view.hint}>
      <span className={`${badge} shrink-0 text-muted`} tabIndex={-1}>
        <span className={`size-1.5 rounded-full ${view.dot}`} aria-hidden="true" />
        {/* A narrow window keeps the dot; the word stays for screen readers (ADR-0079). */}
        <span role="status" aria-label="Save status" className="max-lg:sr-only">
          {view.text}
        </span>
      </span>
    </Tooltip>
  );
}
