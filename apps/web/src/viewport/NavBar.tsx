import { defaultViewName, type NamedView, type ViewId } from '@extrudo/core';
import {
  Box,
  ChevronDown,
  Cone,
  Grid3x3,
  Hand,
  Maximize,
  Mouse,
  MousePointer2,
  Orbit,
  Video,
  ZoomIn,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  Button,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuSeparator,
  Popover,
  TextInput,
} from '../design-system';
import { FILTER_KINDS, isFiltered } from '../selection/filter';
import { namedViewSaveStore } from './namedViewSave';
import { NAV_PRESETS, type NavAction } from './navigation';
import { VISUAL_STYLES, type ViewportStore } from './store';

const TOOLS: readonly { value: NavAction; label: string; hint: string; icon: ReactNode }[] = [
  {
    value: 'orbit',
    label: 'Orbit',
    hint: 'Drag with the left button to orbit. Esc to stop.',
    icon: <Orbit size={16} strokeWidth={1.75} />,
  },
  {
    value: 'pan',
    label: 'Pan',
    hint: 'Drag with the left button to pan. Esc to stop.',
    icon: <Hand size={16} strokeWidth={1.75} />,
  },
  {
    value: 'zoom',
    label: 'Zoom',
    hint: 'Drag up or down with the left button to zoom. Esc to stop.',
    icon: <ZoomIn size={16} strokeWidth={1.75} />,
  },
];

export interface NavBarProps {
  store: ViewportStore;
  /** A command owns the pointer (a sketch tool, the plane pick): Select isn't active. */
  commandRunning?: boolean;
  /** Select pressed while a command runs: stop it. */
  onStopCommand?(): void;
  /**
   * The document's named views and what their menu items do (ADR-0008's
   * amendment, 2026-10-10). Absent nowhere today; the shell always passes it.
   */
  namedViews?: NamedViewEntries;
}

/** The saved views and the actions the nav bar's menu offers on them. */
export interface NamedViewEntries {
  /** The document's views, in the order saved. */
  views: readonly NamedView[];
  /** Restores a view: an animated camera move, view state, not undoable. */
  restore(id: ViewId): void;
  /** Saves the live camera under `name`; `false` when the name is refused. */
  save(name: string): boolean;
}

/**
 * The floating nav bar (UI spec §2, bottom centre): the pointer modes
 * (Select, then the navigation tools), fit, projection, visual style, grid,
 * mouse preset. Glass pill: `raised` at 85 % with a 6 px backdrop blur
 * (docs/05-brand.md §5).
 */
export function NavBar({ store, commandRunning = false, onStopCommand, namedViews }: NavBarProps) {
  const { tool, projection, visualStyle, grid, preset, selectionFilter } = useStore(
    store,
    useShallow(({ tool, projection, visualStyle, grid, preset, selectionFilter }) => ({
      tool,
      projection,
      visualStyle,
      grid,
      preset,
      selectionFilter,
    })),
  );
  const filtered = isFiltered(selectionFilter);
  const s = store.getState();
  const views = namedViews?.views ?? NO_VIEWS;
  const saveOpen = useStore(namedViewSaveStore, (st) => st.open);
  const closeSave = namedViewSaveStore.getState().close;
  // The popover lives here even when a command opened it; leaving it open
  // across documents would show it where nobody asked for it.
  useEffect(() => () => namedViewSaveStore.getState().close(), []);

  return (
    <nav
      aria-label="View navigation"
      className="absolute bottom-3 flex -translate-x-1/2 items-center transition-[left] duration-(--x-normal) ease-ui gap-0.5 rounded-full border border-line px-2 py-1 backdrop-blur-[6px]"
      style={{
        // Centred in the part of the view the browser doesn't cover.
        left: 'calc(50% + var(--x-browser-inset, 0px) / 2)',
        background: 'color-mix(in srgb, var(--x-raised) 85%, transparent)',
      }}
    >
      {/* Select is the pointer's default mode: active whenever no tool or command runs. */}
      <IconButton
        label="Select"
        hint="Click to select, drag for a box. Stops the running tool. Esc does too."
        pressed={tool === undefined && !commandRunning}
        onClick={() => {
          s.setTool(undefined);
          if (commandRunning) onStopCommand?.();
        }}
      >
        <MousePointer2 size={16} strokeWidth={1.75} />
      </IconButton>
      {/* The selection filter lives with Select (UI spec §3.2, P2-03); a dot says it filters. */}
      <Menu
        label="Selection filter"
        align="center"
        trigger={
          <IconButton
            label="Selection filter"
            hint="What clicks and boxes select in the model."
            className="relative -ml-1 w-4!"
            data-filtered={filtered || undefined}
          >
            <ChevronDown size={12} strokeWidth={2} />
            {filtered && (
              <span className="absolute top-1 right-0 size-1.5 rounded-full bg-accent" />
            )}
          </IconButton>
        }
      >
        <MenuLabel>Select</MenuLabel>
        {FILTER_KINDS.map((kind) => (
          <MenuCheckboxItem
            key={kind.value}
            checked={selectionFilter[kind.value]}
            onChange={(on) => s.setSelectionFilter(kind.value, on)}
          >
            {kind.label}
          </MenuCheckboxItem>
        ))}
        <MenuSeparator />
        <MenuItem disabled={!filtered} onSelect={s.resetSelectionFilter}>
          Select everything
        </MenuItem>
      </Menu>
      {TOOLS.map((t) => (
        <IconButton
          key={t.value}
          label={t.label}
          hint={t.hint}
          pressed={tool === t.value}
          onClick={() => s.setTool(tool === t.value ? undefined : t.value)}
        >
          {t.icon}
        </IconButton>
      ))}
      <div className="mx-1 h-4 w-px bg-line" />
      <IconButton label="Fit" shortcut="F6" hint="Fit the whole model in the view." onClick={s.fit}>
        <Maximize size={16} strokeWidth={1.75} />
      </IconButton>
      <div className="mx-1 h-4 w-px bg-line" />
      <IconButton
        label="Orthographic"
        hint="Parallel projection, without perspective."
        pressed={projection === 'orthographic'}
        onClick={() =>
          s.setProjection(projection === 'orthographic' ? 'perspective' : 'orthographic')
        }
      >
        <Cone size={16} strokeWidth={1.75} />
      </IconButton>
      <Menu
        label="Visual style"
        align="center"
        trigger={
          <IconButton label="Visual style" hint="Shaded, edges, hidden edges or wireframe.">
            <Box size={16} strokeWidth={1.75} />
          </IconButton>
        }
      >
        <MenuLabel>Visual style</MenuLabel>
        <MenuRadioGroup value={visualStyle} onChange={s.setVisualStyle} options={VISUAL_STYLES} />
      </Menu>
      <IconButton
        label="Grid"
        hint="Show the grid on the XY plane."
        pressed={grid}
        onClick={() => s.setGrid(!grid)}
      >
        <Grid3x3 size={16} strokeWidth={1.75} />
      </IconButton>
      <div className="mx-1 h-4 w-px bg-line" />
      <Menu
        label="Mouse controls"
        align="center"
        trigger={
          <IconButton label="Mouse controls" hint="Orbit, pan and zoom like the CAD tool you know.">
            <Mouse size={16} strokeWidth={1.75} />
          </IconButton>
        }
      >
        <MenuLabel>Mouse controls</MenuLabel>
        <MenuRadioGroup value={preset} onChange={s.setPreset} options={NAV_PRESETS} />
        <p className="max-w-60 px-2 pt-1 pb-1.5 text-sm text-muted">
          {NAV_PRESETS.find((p) => p.value === preset)?.summary}. The wheel zooms towards the
          cursor.
        </p>
      </Menu>
      {/* Named views (ADR-0008's amendment): the saved views to restore, then
          the save prompt on a popover anchored on this button. The popover's
          anchor wraps the menu's trigger, since both live on one button. The
          debug pages have no document, so their button stays as it was. */}
      {namedViews ? (
        <Popover
          anchorOnly
          open={saveOpen}
          onOpenChange={(open) => {
            if (!open) closeSave();
          }}
          side="top"
          align="center"
          label="Save current view"
          trigger={
            <span className="inline-flex">
              <Menu
                label="Named views"
                align="center"
                onCloseAutoFocus={(event) => {
                  // The save popover keeps the focus: it is opening right now.
                  if (namedViewSaveStore.getState().open) event.preventDefault();
                }}
                trigger={
                  <IconButton
                    label="Named views"
                    hint="Restore a saved view, or save the camera now."
                  >
                    <Video size={16} strokeWidth={1.75} />
                  </IconButton>
                }
              >
                {views.length === 0 && (
                  <p className="px-2 pt-1.5 pb-1 text-sm text-muted">No named views yet.</p>
                )}
                {views.map((view) => (
                  <MenuItem key={view.id} onSelect={() => namedViews.restore(view.id)}>
                    {view.name}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuItem onSelect={() => namedViewSaveStore.getState().show()}>
                  Save Current View…
                </MenuItem>
              </Menu>
            </span>
          }
        >
          <SaveViewForm views={views} onSave={namedViews.save} onClose={closeSave} />
        </Popover>
      ) : (
        <IconButton label="Named views" hint="Saving and recalling views comes later." disabled>
          <Video size={16} strokeWidth={1.75} />
        </IconButton>
      )}
    </nav>
  );
}

const NO_VIEWS: readonly NamedView[] = [];

/** The save prompt: a name prefilled with the next "View<n>", and Save/Cancel. */
function SaveViewForm({
  views,
  onSave,
  onClose,
}: {
  views: readonly NamedView[];
  onSave(name: string): boolean;
  onClose(): void;
}) {
  const [name, setName] = useState(() => defaultViewName(views));
  const input = useRef<HTMLInputElement>(null);
  const save = () => {
    if (onSave(name)) onClose();
  };
  return (
    <form
      className="flex w-56 flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <TextInput
        ref={input}
        aria-label="Name"
        value={name}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          // Keys typed into the name aren't shortcuts.
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit">
          Save
        </Button>
      </div>
    </form>
  );
}
