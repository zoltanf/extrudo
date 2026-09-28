import {
  ANGLE,
  CommandError,
  type Dim,
  type DocumentStore,
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureId,
  formatQuantity,
  LENGTH,
  lineEnds,
  ORIGIN_PLANES,
  type OriginPlaneId,
  radiusOf,
  readSketch,
  type SelectionItem,
  type SessionStore,
  type SketchData,
  type SketchEntity,
  type SketchEntityId,
  setSketchConstruction,
  UNITS,
} from '@extrudo/core';
import { Crosshair, Trash2 } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { useStore } from 'zustand';
import { keysFor } from '../commands/keymap';
import { Button, ConfirmDialog, ToolIcon, Tooltip } from '../design-system';
import { ExpressionInput } from '../parameters/ExpressionInput';
import type { ViewportStore } from '../viewport/store';
import { useHostState } from './hostState';
import { profileIdsIn, sketchProfiles } from './profiles';
import type { ToolHost } from './tools/host';

/**
 * The column of floating panels on the right of the viewport, below the
 * ViewCube (UI spec §2, §4): the Create Sketch prompt or the sketch palette.
 * It scrolls when they don't fit.
 */
export function PanelColumn({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute top-[148px] right-3 bottom-3 z-10 flex w-60 flex-col gap-2 overflow-y-auto">
      {children}
    </div>
  );
}

/** A floating panel, glass like the nav bar. */
function FloatingPanel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section
      aria-label={label}
      className="pointer-events-auto flex shrink-0 flex-col gap-2 rounded-dialog border border-line p-3 shadow-raised backdrop-blur-[6px]"
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
  /** Default "Create Sketch"; Redefine Plane (P2-11) names its own. */
  title?: string;
  hint?: string;
  onPick(plane: OriginPlaneId): void;
  onCancel(): void;
}

/**
 * Create Sketch, waiting for a plane: pick one in the viewport or here.
 * Hovering a button highlights its plane in the viewport.
 */
export function PlanePrompt({
  session,
  title = 'Create Sketch',
  hint = 'Pick a plane or a flat face in the view, or choose a plane here.',
  onPick,
  onCancel,
}: PlanePromptProps) {
  const hover = useStore(session, (s) => (s.hover?.kind === 'plane' ? s.hover.id : undefined));
  const leave = (id: OriginPlaneId) => {
    const current = session.getState().hover;
    if (current?.kind === 'plane' && current.id === id) session.getState().setHover(undefined);
  };
  return (
    <PanelColumn>
      <FloatingPanel label={title}>
        <PanelTitle>{title}</PanelTitle>
        <p className="text-sm text-muted" id="plane-prompt-hint">
          {hint}
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
    </PanelColumn>
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
  { label: 'Slice', comesWith: 'P2' },
];

/** The sketch palette (UI spec §4): sketch options, the DOF counter and Finish Sketch. */
export function SketchPalette({ name, viewport, host, onLookAt, onFinish }: SketchPaletteProps) {
  const grid = useStore(viewport, (s) => s.grid);
  const points = useStore(viewport, (s) => s.sketchPoints);
  const constraints = useStore(viewport, (s) => s.sketchConstraints);
  const dimensions = useStore(viewport, (s) => s.sketchDimensions);
  const profiles = useStore(viewport, (s) => s.sketchProfiles);
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
          <PaletteToggle
            checked={constraints}
            onChange={(v) => viewport.getState().setSketchConstraints(v)}
          >
            Show constraints
          </PaletteToggle>
        </li>
        <li>
          <PaletteToggle
            checked={dimensions}
            onChange={(v) => viewport.getState().setSketchDimensions(v)}
          >
            Show dimensions
          </PaletteToggle>
        </li>
        <li>
          <PaletteToggle
            checked={profiles}
            onChange={(v) => viewport.getState().setSketchProfiles(v)}
          >
            Show profiles
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
      <DofCounter host={host} />
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

/**
 * How constrained the open sketch is (UI spec §4, FR-SK-09): degrees of
 * freedom left, fully constrained, or over-constrained.
 */
function DofCounter({ host }: { host: ToolHost | undefined }) {
  const status = useHostState(host, (s) => s.status);
  const [text, tone, state] = !status
    ? ['Solving…', 'text-muted', 'pending']
    : Object.keys(status.entities).length === 0
      ? ['Nothing to constrain yet', 'text-muted', 'empty']
      : status.over.length > 0
        ? ['Over-constrained: the red geometry has a constraint too many', 'text-error', 'over']
        : status.dof === 0
          ? ['Fully constrained ✓', 'text-success', 'full']
          : [`${status.dof} DOF left`, 'text-sketch', 'under'];
  return (
    <p
      className={`text-sm ${tone}`}
      aria-live="polite"
      data-dof={status?.dof}
      data-constraint-state={state}
    >
      {text}
    </p>
  );
}

const TYPE_NAMES: Record<SketchEntity['type'], [string, string]> = {
  point: ['Point', 'points'],
  line: ['Line', 'lines'],
  circle: ['Circle', 'circles'],
  arc: ['Arc', 'arcs'],
  ellipse: ['Ellipse', 'ellipses'],
  spline: ['Spline', 'splines'],
};

const STATUS_TEXT = {
  free: ['Can still move', 'text-sketch'],
  fixed: ['Fully constrained', 'text-success'],
  conflict: ['Over-constrained', 'text-error'],
} as const;

export interface SelectionPanelProps {
  store: DocumentStore;
  session: SessionStore;
  host: ToolHost | undefined;
  onDelete(): void;
  /** Shows a short message: an edit that was refused or didn't reach its value. */
  notify(tone: 'info' | 'error', text: string): void;
}

/**
 * The properties of the selected sketch geometry (P1-09, UI spec §4): what
 * it is and how constrained, a point's coordinates and a circle's or arc's
 * radius (typed values move it as the solver allows), a line's length and
 * angle, the construction flag and Delete. Shows nothing without a selection.
 * It floats in the view's bottom-left corner, clear of the palette.
 */
export function SelectionPanel({ store, session, host, onDelete, notify }: SelectionPanelProps) {
  const selection = useStore(session, (s) => s.selection);
  const sketchId = useStore(session, (s) => s.activeSketchId);
  const doc = useStore(store, (s) => s.doc);
  const status = useHostState(host, (s) => s.status);
  const evaluation = useMemo(() => evaluateParameters(doc), [doc]);
  const feature = doc.features.find((f) => f.id === sketchId);
  const data = feature ? readSketch(feature)?.data : undefined;
  if (!data || !sketchId) return null;
  const ids = selection
    .filter((s) => s.kind === 'sketchEntity' && s.id in data.entities)
    .map((s) => s.id as SketchEntityId);
  if (ids.length === 0) {
    return <ProfileReadout data={data} sketchId={sketchId} selection={selection} doc={doc} />;
  }
  const { settings } = doc;
  const single = ids.length === 1 ? (ids[0] as SketchEntityId) : undefined;
  const entity = single && data.entities[single];
  const curves = ids.filter((id) => data.entities[id]?.type !== 'point');
  const construction =
    curves.length > 0 &&
    curves.every((id) => (data.entities[id] as { construction?: boolean }).construction);

  const title = entity ? TYPE_NAMES[entity.type][0] : `${ids.length} selected`;
  const counts = new Map<string, number>();
  for (const id of ids) {
    const type = data.entities[id]?.type;
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const breakdown = [...counts]
    .map(([type, n]) => {
      const [one, many] = TYPE_NAMES[type as SketchEntity['type']];
      return `${n} ${n === 1 ? one.toLowerCase() : many}`;
    })
    .join(', ');
  const state = single ? status?.entities[single] : undefined;

  const length = (mm: number) => formatQuantity(mm, LENGTH, settings);
  const shown = (mm: number) => {
    const factor = UNITS[settings.units]?.factor ?? 1;
    return String(Number((mm / factor).toFixed(settings.precision)) + 0);
  };
  const field = (label: string, mm: number, commit: (value: number) => void) => (
    <div className="grid grid-cols-[52px_minmax(0,1fr)] items-start gap-2" key={label}>
      <span className="pt-1 text-sm text-muted">{label}</span>
      <ExpressionInput
        label={label}
        value={shown(mm)}
        evaluate={(expr) => evaluation.evaluate(expr, 'length')}
        format={(r) => formatQuantity(r.value, r.dim, settings)}
        onCommit={(expr) => {
          const result = evaluation.evaluate(expr, 'length');
          if (result.ok) commit(result.value);
        }}
      />
    </div>
  );
  const readout = (label: string, text: string) => (
    <div className="flex justify-between gap-2 text-sm" key={label}>
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums">{text}</span>
    </div>
  );

  const rows: ReactNode[] = [];
  if (entity?.type === 'point' && single) {
    const move = (x: number, y: number) => {
      if (host && !host.moveTo(single, x, y)) {
        notify('info', "The point's constraints hold it; it moved as near as they allow.");
      }
    };
    rows.push(field('X', entity.x, (x) => move(x, entity.y)));
    rows.push(field('Y', entity.y, (y) => move(entity.x, y)));
  } else if ((entity?.type === 'circle' || entity?.type === 'arc') && single) {
    const r = radiusOf(data, single);
    if (r !== undefined) {
      rows.push(
        field('Radius', r, (value) => {
          try {
            host?.setRadius(single, value);
          } catch (error) {
            if (!(error instanceof CommandError)) throw error;
            notify('error', error.message);
          }
        }),
      );
    }
  } else if (entity?.type === 'line' && single) {
    const ends = lineEnds(data, single);
    if (ends) {
      const [a, b] = ends;
      const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      rows.push(readout('Length', length(Math.hypot(b[0] - a[0], b[1] - a[1]))));
      rows.push(readout('Angle', formatQuantity(angle, ANGLE, settings)));
    }
  } else if (entity?.type === 'spline') {
    rows.push(readout('Fit points', String(entity.points.length)));
  }

  return (
    <div className="absolute bottom-3 left-3 z-10 w-60">
      <FloatingPanel label="Selection">
        <h2 className="flex items-baseline justify-between gap-2 text-base font-semibold">
          <span data-selection-title>{title}</span>
          {!entity && <span className="truncate text-sm font-normal text-muted">{breakdown}</span>}
        </h2>
        {state && (
          <p className={`text-sm ${STATUS_TEXT[state][1]}`} data-entity-status={state}>
            {STATUS_TEXT[state][0]}
          </p>
        )}
        {rows.length > 0 && <div className="flex flex-col gap-1">{rows}</div>}
        {curves.length > 0 && (
          <PaletteToggle
            checked={construction}
            onChange={(v) =>
              store
                .getState()
                .dispatch(
                  setSketchConstruction({ feature: sketchId, entities: curves, construction: v }),
                )
            }
          >
            Construction
          </PaletteToggle>
        )}
        <Button variant="ghost" className="self-end" onClick={onDelete}>
          <Trash2 size={14} />
          Delete <kbd className="font-mono text-xs text-muted">Del</kbd>
        </Button>
      </FloatingPanel>
    </div>
  );
}

/** The selected profiles' area (P1-11): profiles can't be edited or deleted, only picked. */
function ProfileReadout({
  data,
  sketchId,
  selection,
  doc,
}: {
  data: SketchData;
  sketchId: FeatureId;
  selection: readonly SelectionItem[];
  doc: ExtrudoDocument;
}) {
  const ids = new Set(profileIdsIn(selection, sketchId));
  const picked = sketchProfiles(data).filter((p) => ids.has(p.id));
  if (picked.length === 0) return null;
  const area = picked.reduce((sum, p) => sum + p.area, 0);
  const holes = picked.reduce((n, p) => n + p.holes.length, 0);
  const row = (label: string, text: string) => (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums">{text}</span>
    </div>
  );
  return (
    <div className="absolute bottom-3 left-3 z-10 w-60">
      <FloatingPanel label="Selection">
        <h2 className="text-base font-semibold">
          <span data-selection-title>
            {picked.length === 1 ? 'Profile' : `${picked.length} profiles`}
          </span>
        </h2>
        <div className="flex flex-col gap-1">
          {row('Area', formatQuantity(area, AREA, doc.settings))}
          {holes > 0 && row('Holes', String(holes))}
        </div>
      </FloatingPanel>
    </div>
  );
}

const AREA: Dim = { length: 2, angle: 0 };

export interface OverConstrainedDialogProps {
  host: ToolHost | undefined;
}

/**
 * A new dimension would over-constrain the sketch (P1-08): add it as a
 * driven dimension, which only measures, or don't add it.
 */
export function OverConstrainedDialog({ host }: OverConstrainedDialogProps) {
  const pending = useHostState(host, (s) => s.overConstrained);
  return (
    <ConfirmDialog
      open={pending !== undefined}
      onOpenChange={(open) => {
        if (!open && host?.state.getState().overConstrained) host.resolveOverConstrained(false);
      }}
      title="Over-constrained"
      description={`This ${pending?.label.toLowerCase() ?? 'dimension'} would over-constrain the sketch: its constraints and dimensions already fix it. Add it as a driven dimension? It will show the value without changing anything.`}
      confirm="Add as driven"
      onConfirm={() => host?.resolveOverConstrained(true)}
    />
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

/** New curves become construction geometry (FR-SK-04); its key (`X`) flips it too. */
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
      <kbd className="ml-auto font-mono text-xs text-muted">{keysFor('construction')[0]}</kbd>
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
