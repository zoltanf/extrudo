import {
  Box,
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
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { IconButton, Menu, MenuLabel, MenuRadioGroup } from '../design-system';
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
}

/**
 * The floating nav bar (UI spec §2, bottom centre): the pointer modes
 * (Select, then the navigation tools), fit, projection, visual style, grid,
 * mouse preset. Glass pill: `raised` at 85 % with a 6 px backdrop blur
 * (docs/05-brand.md §5).
 */
export function NavBar({ store, commandRunning = false, onStopCommand }: NavBarProps) {
  const { tool, projection, visualStyle, grid, preset } = useStore(
    store,
    useShallow(({ tool, projection, visualStyle, grid, preset }) => ({
      tool,
      projection,
      visualStyle,
      grid,
      preset,
    })),
  );
  const s = store.getState();

  return (
    <nav
      aria-label="View navigation"
      className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line px-2 py-1 backdrop-blur-[6px]"
      style={{ background: 'color-mix(in srgb, var(--x-raised) 85%, transparent)' }}
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
      <IconButton label="Named views" hint="Saving and recalling views comes later." disabled>
        <Video size={16} strokeWidth={1.75} />
      </IconButton>
    </nav>
  );
}
