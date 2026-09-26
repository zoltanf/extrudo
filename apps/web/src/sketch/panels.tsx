import { ORIGIN_PLANES, type OriginPlaneId, type SessionStore } from '@extrudo/core';
import { Crosshair } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';
import { Button, ToolIcon, Tooltip } from '../design-system';
import type { ViewportStore } from '../viewport/store';
import type { ToolHost } from './tools/host';

/**
 * The floating panels on the right of the viewport (UI spec §2, §4): the
 * Create Sketch prompt and the sketch palette. Glass like the nav bar,
 * below the ViewCube.
 */
function FloatingPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="absolute top-[148px] right-3 z-10 flex w-60 flex-col gap-2 rounded-dialog border border-line p-3 shadow-raised backdrop-blur-[6px]"
      style={{ background: 'color-mix(in srgb, var(--x-raised) 90%, transparent)' }}
    >
      {children}
    </section>
  );
}

function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-base font-semibold">
      <ToolIcon name="create-sketch" category="sketch" size={18} />
      {children}
    </h2>
  );
}

export interface PlanePromptProps {
  session: SessionStore;
  onPick(plane: OriginPlaneId): void;
  onCancel(): void;
}

/**
 * Create Sketch, waiting for a plane: pick one in the viewport or here.
 * Hovering a button highlights its plane in the viewport.
 */
export function PlanePrompt({ session, onPick, onCancel }: PlanePromptProps) {
  const hover = useStore(session, (s) => (s.hover?.kind === 'plane' ? s.hover.id : undefined));
  const leave = (id: OriginPlaneId) => {
    const current = session.getState().hover;
    if (current?.kind === 'plane' && current.id === id) session.getState().setHover(undefined);
  };
  return (
    <FloatingPanel label="Create Sketch">
      <PanelTitle>Create Sketch</PanelTitle>
      <p className="text-sm text-muted" id="plane-prompt-hint">
        Pick a plane in the view, or choose one here. Flat faces arrive with P2-09.
      </p>
      <fieldset
        className="m-0 grid grid-cols-3 gap-1 border-0 p-0"
        aria-label="Origin planes"
        aria-describedby="plane-prompt-hint"
      >
        {ORIGIN_PLANES.map((plane) => (
          <Button
            key={plane.id}
            className={`px-0 ${hover === plane.id ? 'border-accent bg-accent-soft' : ''}`}
            onClick={() => onPick(plane.id)}
            onPointerEnter={() => session.getState().setHover({ kind: 'plane', id: plane.id })}
            onPointerLeave={() => leave(plane.id)}
            onFocus={() => session.getState().setHover({ kind: 'plane', id: plane.id })}
            onBlur={() => leave(plane.id)}
          >
            {plane.label.replace(' plane', '')}
          </Button>
        ))}
      </fieldset>
      <Button variant="ghost" className="self-end" onClick={onCancel}>
        Cancel <kbd className="font-mono text-xs text-muted">Esc</kbd>
      </Button>
    </FloatingPanel>
  );
}

export interface SketchPaletteProps {
  name: string;
  viewport: ViewportStore;
  /** The drawing-tool host, which holds the construction toggle. */
  host: ToolHost | undefined;
  onLookAt(): void;
  onFinish(): void;
}

/** Options that arrive with later tasks, listed so the palette shows its real layout. */
const LATER: readonly { label: string; comesWith: string }[] = [
  { label: 'Show constraints', comesWith: 'P1-06' },
  { label: 'Show dimensions', comesWith: 'P1-07' },
  { label: 'Show profiles', comesWith: 'P1-11' },
  { label: 'Slice', comesWith: 'P2' },
];

/** The sketch palette (UI spec §4): sketch options, the DOF counter and Finish Sketch. */
export function SketchPalette({ name, viewport, host, onLookAt, onFinish }: SketchPaletteProps) {
  const grid = useStore(viewport, (s) => s.grid);
  const points = useStore(viewport, (s) => s.sketchPoints);
  const snap = useStore(viewport, (s) => s.snap);
  return (
    <FloatingPanel label="Sketch palette">
      <PanelTitle>
        <span className="min-w-0 truncate">{name}</span>
      </PanelTitle>
      <ul className="flex flex-col text-base">
        <li>
          <PaletteButton icon={<Crosshair size={14} />} onClick={onLookAt}>
            Look at
          </PaletteButton>
        </li>
        {host && (
          <li>
            <ConstructionToggle host={host} />
          </li>
        )}
        <li>
          <PaletteToggle checked={grid} onChange={(v) => viewport.getState().setGrid(v)}>
            Sketch grid
          </PaletteToggle>
        </li>
        <li>
          <PaletteToggle checked={points} onChange={(v) => viewport.getState().setSketchPoints(v)}>
            Show points
          </PaletteToggle>
        </li>
        <li>
          <PaletteToggle checked={snap} onChange={(v) => viewport.getState().setSnap(v)}>
            Snap to grid
          </PaletteToggle>
        </li>
        {LATER.map((option) => (
          <li key={option.label}>
            <Tooltip label={option.label} hint={`Arrives with ${option.comesWith}.`} side="left">
              <label className="flex h-7 items-center gap-2 px-1 text-muted">
                <input type="checkbox" disabled className="accent-(--x-accent)" />
                {option.label}
              </label>
            </Tooltip>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">Degrees of freedom arrive with the solver (P1-08).</p>
      <Button
        className="border-success/60 font-semibold text-ink hover:bg-success/10"
        onClick={onFinish}
      >
        <ToolIcon name="finish-sketch" category="sketch" size={18} color="var(--x-success)" />
        Finish Sketch
      </Button>
    </FloatingPanel>
  );
}

function PaletteButton({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-full items-center gap-2 rounded-input px-1 text-left hover:bg-accent-soft"
    >
      <span className="grid w-[13px] place-items-center text-muted">{icon}</span>
      {children}
    </button>
  );
}

/** New curves become construction geometry (FR-SK-04); `X` flips it too. */
function ConstructionToggle({ host }: { host: ToolHost }) {
  const construction = useStore(host.state, (s) => s.construction);
  return (
    <PaletteToggle
      checked={construction}
      onChange={(v) => {
        if (v !== host.state.getState().construction) host.toggleConstruction();
      }}
    >
      Construction
      <kbd className="ml-auto font-mono text-xs text-muted">X</kbd>
    </PaletteToggle>
  );
}

function PaletteToggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange(checked: boolean): void;
  children: ReactNode;
}) {
  return (
    <label className="flex h-7 cursor-pointer items-center gap-2 rounded-input px-1 hover:bg-accent-soft">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-(--x-accent)"
      />
      {children}
    </label>
  );
}
