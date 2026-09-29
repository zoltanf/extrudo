import { type DocumentStore, renameDocument } from '@extrudo/core';
import {
  CircleHelp,
  FileDown,
  FilePlus2,
  History,
  House,
  Import,
  Menu as MenuIcon,
  PanelsTopLeft,
  Redo2,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Undo2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
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

/** What the File menu does; the project page implements it. */
export interface FileActions {
  newDesign(): void;
  home(): void;
  exportFile(): void;
  importFile(): void;
  /** Opens the model's export (STL, 3MF, STEP; P2-12). */
  exportModel?(): void;
  /** Opens the Versions dialog at its description field (P2-14). */
  saveVersion?(): void;
  /** Opens the Versions dialog (P2-14). */
  versionHistory?(): void;
}

export interface AppBarProps {
  store: DocumentStore;
  autosave: Autosaver;
  file: FileActions;
  theme: ThemeChoice;
  onThemeChange(theme: ThemeChoice): void;
  /** Opens command search: the Ctrl+K palette, or the S toolbox at the pointer (P1-14). */
  onSearch(kind: 'palette' | 'toolbox'): void;
}

/** A command's first key as it reads here ("Ctrl+K"). */
const keyLabel = (id: string) => {
  const keys = keysFor(id)[0];
  return keys && shortcutLabel(keys);
};

/**
 * App bar (UI spec §2): file menu, undo/redo, command search, project name
 * and save state, settings, help, theme.
 */
export function AppBar({ store, autosave, file, theme, onThemeChange, onSearch }: AppBarProps) {
  const name = useStore(store, (s) => s.doc.name);
  const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } = useStore(store);

  return (
    <header className="flex h-11 items-center gap-1 border-b border-line bg-bg px-2">
      <Menu
        label="File"
        trigger={
          <Button variant="ghost" className="gap-1 px-2" aria-label="File menu">
            <MenuIcon size={16} strokeWidth={1.75} />
            File
          </Button>
        }
      >
        <MenuLabel>Project</MenuLabel>
        <MenuItem icon={<FilePlus2 size={14} />} onSelect={file.newDesign}>
          New design
        </MenuItem>
        <MenuItem icon={<House size={14} />} onSelect={file.home}>
          All designs
        </MenuItem>
        {/* Autosave keeps the design; a version keeps a state of it to come back to (P2-14). */}
        <MenuItem
          disabled={!file.saveVersion}
          icon={<Save size={14} />}
          shortcut={keyLabel('saveVersion')}
          onSelect={file.saveVersion}
        >
          Save version…
        </MenuItem>
        {file.versionHistory && (
          <MenuItem icon={<History size={14} />} onSelect={file.versionHistory}>
            Version history…
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<Upload size={14} />} onSelect={file.exportFile}>
          Export .extrudo
        </MenuItem>
        {file.exportModel && (
          <MenuItem icon={<FileDown size={14} />} onSelect={file.exportModel}>
            Export 3MF, STL or STEP…
          </MenuItem>
        )}
        <MenuItem icon={<Import size={14} />} onSelect={file.importFile}>
          Import .extrudo…
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled icon={<SlidersHorizontal size={14} />}>
          Project settings…
        </MenuItem>
      </Menu>

      <div className="mx-1 h-5 w-px bg-line" />
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

      <div className="flex flex-1 items-center justify-center gap-2.5">
        <Tooltip label="All designs">
          <a
            href={HOME_HREF}
            className="flex items-center gap-2.5 rounded-control px-1 py-0.5 hover:bg-accent-soft"
          >
            <LogoMark size={22} title="Extrudo" />
            <Wordmark className="text-[17px]" />
          </a>
        </Tooltip>
        <span className="text-muted">/</span>
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
      </div>

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
        {/* The tutorial and tool demos arrive with P3-12 and FR-UX-04. */}
        <MenuItem disabled icon={<CircleHelp size={14} />}>
          Getting started
        </MenuItem>
      </Menu>
      <ThemeMenu theme={theme} onThemeChange={onThemeChange} />
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
          className="rounded-input px-1.5 py-0.5 font-semibold hover:bg-accent-soft"
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
      <span className={`${badge} text-muted`} tabIndex={-1}>
        <span className={`size-1.5 rounded-full ${view.dot}`} aria-hidden="true" />
        <span role="status" aria-label="Save status">
          {view.text}
        </span>
      </span>
    </Tooltip>
  );
}
