import { type DocumentStore, renameDocument } from '@extrudo/core';
import {
  CircleHelp,
  FilePlus2,
  FolderOpen,
  Import,
  Menu as MenuIcon,
  Redo2,
  Save,
  Settings,
  SlidersHorizontal,
  SunMoon,
  Undo2,
  Upload,
} from 'lucide-react';
import { useState } from 'react';
import { useStore } from 'zustand';
import { shortcutLabel } from '../commands/shortcuts';
import {
  Button,
  IconButton,
  LogoMark,
  Menu,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuSeparator,
  Popover,
  TextInput,
  type ThemeChoice,
  Tooltip,
  Wordmark,
} from '../design-system';

const STORAGE_HINT = 'Arrives with project storage (P0-08).';

export interface AppBarProps {
  store: DocumentStore;
  theme: ThemeChoice;
  onThemeChange(theme: ThemeChoice): void;
}

/** App bar (UI spec §2): file menu, undo/redo, project name and save state, settings, theme. */
export function AppBar({ store, theme, onThemeChange }: AppBarProps) {
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
        <MenuItem disabled icon={<FilePlus2 size={14} />}>
          New
        </MenuItem>
        <MenuItem disabled icon={<FolderOpen size={14} />}>
          Open…
        </MenuItem>
        <MenuItem disabled icon={<Save size={14} />} shortcut={shortcutLabel('Mod+S')}>
          Save version
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled icon={<Upload size={14} />}>
          Export…
        </MenuItem>
        <MenuItem disabled icon={<Import size={14} />}>
          Import…
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled icon={<SlidersHorizontal size={14} />}>
          Project settings…
        </MenuItem>
      </Menu>

      <div className="mx-1 h-5 w-px bg-line" />
      <IconButton
        label="Undo"
        shortcut={shortcutLabel('Mod+Z')}
        hint={undoLabel ? `Undo “${undoLabel}”.` : 'Nothing to undo.'}
        disabled={!canUndo}
        onClick={undo}
      >
        <Undo2 size={18} strokeWidth={1.75} />
      </IconButton>
      <IconButton
        label="Redo"
        shortcut={shortcutLabel('Mod+Y')}
        hint={redoLabel ? `Redo “${redoLabel}”.` : 'Nothing to redo.'}
        disabled={!canRedo}
        onClick={redo}
      >
        <Redo2 size={18} strokeWidth={1.75} />
      </IconButton>

      <div className="flex flex-1 items-center justify-center gap-2.5">
        <LogoMark size={22} title="Extrudo" />
        <Wordmark className="text-[17px]" />
        <span className="text-muted">/</span>
        <ProjectName store={store} name={name} />
        <Tooltip label="Not saved yet" hint={STORAGE_HINT}>
          <span className="inline-flex items-center gap-1.5 text-sm text-muted" tabIndex={-1}>
            <span className="size-1.5 rounded-full bg-muted" aria-hidden="true" />
            Not saved
          </span>
        </Tooltip>
      </div>

      <IconButton label="Settings" hint="Arrives with P1." disabled>
        <Settings size={18} strokeWidth={1.75} />
      </IconButton>
      <IconButton label="Help" hint="Arrives with onboarding (P3-12)." disabled>
        <CircleHelp size={18} strokeWidth={1.75} />
      </IconButton>
      <Menu
        label="Theme"
        align="end"
        trigger={
          <IconButton label="Theme" hint="Dark, light, or follow the system.">
            <SunMoon size={18} strokeWidth={1.75} />
          </IconButton>
        }
      >
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup
          value={theme}
          onChange={onThemeChange}
          options={[
            { value: 'dark', label: 'Dark (Slate)' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'Same as system' },
          ]}
        />
      </Menu>
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
