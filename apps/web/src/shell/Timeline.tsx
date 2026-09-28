import {
  createModelStore,
  type DocumentStore,
  type Feature,
  type FeatureId,
  type FeatureStatus,
  type ModelState,
  type ModelStore,
  type SessionStore,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import {
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  Fragment,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { ContextMenu, IconButton, Popover, ToolIcon, Tooltip } from '../design-system';
import { selectionSummary } from '../selection/items';
import { formatRenderStats } from '../viewport/renderMeter';
import type { ViewportStore } from '../viewport/store';
import { FeatureMenuItems, RenameField } from './FeatureMenu';
import type { FeatureActions } from './featureActions';
import { toolForFeature } from './tools';

export interface TimelineProps {
  store: DocumentStore;
  collapsed: boolean;
  onToggle(): void;
  /** Name of the sketch being edited. The marker can't move meanwhile (it could roll the sketch back). */
  activeSketch?: string;
  /** Edit, rename, suppress, delete and hover (P1-12). */
  actions: FeatureActions;
  /** The viewport, whose frame rate and frame time the status bar shows. */
  viewport?: ViewportStore;
  /** The kernel's results: a status per feature (chips) and the recompute state (status bar). */
  model?: ModelStore<BodyMesh>;
  /** The session, whose selection the status bar sums up ("2 faces", P2-03). */
  session?: SessionStore;
  /**
   * The feature an open dialog edits (P2-11): the view shows the model as it
   * was before it, so the timeline shows the marker after it, dims what
   * comes later, and holds the marker and the chips still.
   */
  editing?: FeatureId;
}

/** A chip being dragged to a new place (FR-TL-04). */
interface ChipDrag {
  id: FeatureId;
  /** Where it would go: its index afterwards, and whether it lands active (left of the marker). */
  index: number;
  active: boolean;
  /** The drop indicator's x in the list's scroll coordinates, px. */
  x: number;
  /** Why the drop would be refused. */
  problem: string | undefined;
}

/** Where a dragged marker would go: the gap's index and x in the list's scroll coordinates. */
interface MarkerDrag {
  index: number;
  x: number;
}

/** How far the pointer moves before a press on a chip becomes a drag, px. */
const DRAG_THRESHOLD = 4;

/**
 * Timeline and status bar (UI spec §2). Chips follow the document's features;
 * the playback buttons, dragging the marker and its arrow keys move the
 * rollback marker (FR-TL-02), each one undoable step. A chip opens its
 * sketch or dialog on double-click, highlights its geometry on hover, has a
 * right-click menu (P1-12, P2-11) and moves when dragged (FR-TL-04,
 * refused with a message when it would break a reference). An active
 * feature the kernel couldn't compute shows ✕ (or ⚠ for a warning) and says
 * why in its tooltip (P2-01); its menu offers to fix lost references.
 */
export function Timeline({
  store,
  collapsed,
  onToggle,
  activeSketch,
  actions,
  viewport,
  model,
  session,
  editing,
}: TimelineProps) {
  const doc = useStore(store, (s) => s.doc);
  const statuses = useStore(model ?? NO_MODEL, (s) => s.features);
  const errors = doc.features.filter(
    (f, i) => i < doc.timelineMarker && !f.suppressed && statuses[f.id]?.status === 'error',
  ).length;
  const marker = doc.timelineMarker;
  const count = doc.features.length;
  const editIndex = editing ? doc.features.findIndex((f) => f.id === editing) : -1;
  const locked = activeSketch !== undefined || editIndex >= 0;
  const move = (index: number) => actions.rollTo(index);
  const list = useRef<HTMLOListElement>(null);
  // Where the marker is drawn while it is dragged, and a chip being dragged.
  const [markerDrag, setMarkerDrag] = useState<MarkerDrag>();
  const [chipDrag, setChipDrag] = useState<ChipDrag>();
  // The marker stays put while dragged (it holds the pointer); a ghost shows where it goes.
  const shown = editIndex >= 0 ? editIndex + 1 : marker;

  return (
    <section
      aria-label="Timeline"
      className="flex min-h-9 items-center gap-2 border-t border-line bg-panel px-2 py-1"
    >
      {!collapsed && (
        <>
          <fieldset className="m-0 flex border-0 p-0" aria-label="Playback">
            <IconButton
              label="Roll back to start"
              disabled={locked || marker === 0}
              onClick={() => move(0)}
            >
              <ChevronFirst size={16} />
            </IconButton>
            <IconButton
              label="Step back"
              disabled={locked || marker === 0}
              onClick={() => move(marker - 1)}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton
              label="Step forward"
              disabled={locked || marker === count}
              onClick={() => move(marker + 1)}
            >
              <ChevronRight size={16} />
            </IconButton>
            <IconButton
              label="Roll forward to end"
              disabled={locked || marker === count}
              onClick={() => move(count)}
            >
              <ChevronLast size={16} />
            </IconButton>
          </fieldset>
          {/* px-1 leaves room for the marker's triangle, which is wider than its bar: at the
              ends it stuck out and a scrollbar showed with room to spare. */}
          <ol
            ref={list}
            aria-label="Features"
            data-dragging={chipDrag ? 'chip' : markerDrag !== undefined ? 'marker' : undefined}
            className="relative flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 py-1"
          >
            {doc.features.map((feature, index) => (
              <Fragment key={feature.id}>
                {index === shown && (
                  <Marker
                    list={list}
                    features={doc.features}
                    index={shown}
                    editing={editIndex >= 0 ? doc.features[editIndex]?.name : undefined}
                    locked={locked}
                    onDrag={setMarkerDrag}
                    onMove={move}
                  />
                )}
                <Chip
                  feature={feature}
                  index={index}
                  marker={marker}
                  count={count}
                  status={index < marker && !feature.suppressed ? statuses[feature.id] : undefined}
                  rolledBack={index >= (markerDrag?.index ?? marker)}
                  dimmed={editIndex >= 0 && index > editIndex}
                  editable={actions.canEdit(feature, index, marker)}
                  actions={actions}
                  list={list}
                  locked={locked}
                  dragging={chipDrag?.id === feature.id}
                  onDrag={setChipDrag}
                />
              </Fragment>
            ))}
            {shown === count && count > 0 && (
              <Marker
                list={list}
                features={doc.features}
                index={shown}
                editing={editIndex >= 0 ? doc.features[editIndex]?.name : undefined}
                locked={locked}
                onDrag={setMarkerDrag}
                onMove={move}
              />
            )}
            {chipDrag && <DropIndicator drag={chipDrag} />}
            {markerDrag && markerDrag.index !== marker && (
              <li
                aria-hidden="true"
                data-marker-ghost={markerDrag.index}
                className="pointer-events-none absolute top-1 bottom-1 w-[3px] -translate-x-1/2 rounded-sm bg-accent opacity-70"
                style={{ left: markerDrag.x }}
              />
            )}
          </ol>
        </>
      )}
      <span className="flex-1" />
      {session && <SelectionState session={session} />}
      <output className="font-mono text-[11px] whitespace-nowrap text-muted" aria-label="Status">
        {activeSketch ? `Editing ${activeSketch} · ` : ''}
        {count} {count === 1 ? 'feature' : 'features'} · {doc.settings.units}
        {errors > 0 && ` · ${errors} ${errors === 1 ? 'error' : 'errors'}`}
      </output>
      {model && <KernelState model={model} />}
      {viewport && <RenderRate viewport={viewport} />}
      <IconButton label={collapsed ? 'Show timeline' : 'Hide timeline'} onClick={onToggle}>
        {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </IconButton>
    </section>
  );
}

function Chip({
  feature,
  index,
  marker,
  count,
  status,
  rolledBack,
  dimmed,
  editable,
  actions,
  list,
  locked,
  dragging,
  onDrag,
}: {
  feature: Feature;
  index: number;
  marker: number;
  count: number;
  /** The kernel's verdict; only for active features. */
  status: FeatureStatus | undefined;
  rolledBack: boolean;
  /** After the feature a dialog edits: drawn like a rolled-back one (not named so). */
  dimmed: boolean;
  editable: boolean;
  actions: FeatureActions;
  list: RefObject<HTMLOListElement | null>;
  /** A sketch or a feature's dialog is open: chips don't move. */
  locked: boolean;
  dragging: boolean;
  onDrag(drag: ChipDrag | undefined): void;
}) {
  const [renaming, setRenaming] = useState(false);
  // The press that may become a drag, then the drag's latest drop.
  const press = useRef<{ x: number; y: number; drag?: ChipDrag }>(undefined);
  const dropAt = (x: number): ChipDrag | undefined => {
    const el = list.current;
    if (!el) return undefined;
    const items = timelineItems(el).filter((item) => item.dataset.featureId !== feature.id);
    const before = items.filter((item) => centreOf(item) < x);
    const target = before.filter((item) => item.dataset.timelineItem === 'chip').length;
    const active = !before.some((item) => item.dataset.timelineItem === 'marker');
    const unchanged = target === index && active === index < marker;
    const edge = before.at(-1)?.getBoundingClientRect().right;
    const next = items[before.length]?.getBoundingClientRect().left;
    const at = edge !== undefined ? edge + 3 : (next ?? 0) - 3;
    return {
      id: feature.id,
      index: target,
      active,
      x: at - el.getBoundingClientRect().left + el.scrollLeft,
      problem: unchanged ? undefined : actions.moveProblem(feature.id, target),
    };
  };
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || locked || renaming) return;
    press.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.drag && Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return;
    if (!p.drag) event.currentTarget.setPointerCapture(event.pointerId);
    p.drag = dropAt(event.clientX);
    onDrag(p.drag);
  };
  const endDrag = (drop: boolean) => {
    const drag = press.current?.drag;
    press.current = undefined;
    if (!drag) return;
    onDrag(undefined);
    if (!drop || (drag.index === index && drag.active === index < marker)) return;
    actions.move(drag.id, drag.index, drag.active);
  };
  // Esc puts a dragged chip back.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') endDrag(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  const tool = toolForFeature(feature.type);
  const problem =
    status && status.status !== 'ok'
      ? { status: status.status, message: status.message }
      : undefined;
  const states = [
    rolledBack && 'rolled back',
    feature.suppressed && 'suppressed',
    problem?.status,
  ].filter(Boolean);
  const hint = [tool.label, ...states].join(' · ');
  const chip = (
    <button
      type="button"
      aria-label={`${feature.name}${states.length > 0 ? ` (${states.join(', ')})` : ''}`}
      onDoubleClick={editable ? () => actions.edit(feature.id) : undefined}
      onPointerEnter={() => actions.hover(feature.id)}
      onPointerLeave={() => actions.hover(undefined)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      data-timeline-item="chip"
      data-feature-id={feature.id}
      data-feature-status={problem?.status}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          setRenaming(true);
        }
      }}
      className={`relative grid size-[30px] shrink-0 touch-none place-items-center rounded-control border ${feature.suppressed ? 'border-dashed' : ''} ${dragging ? 'cursor-grabbing ring-2 ring-accent' : ''}`}
      style={{
        background: feature.suppressed
          ? 'transparent'
          : `color-mix(in srgb, var(--x-cat-${tool.category}) 16%, var(--x-bg))`,
        borderColor: problem
          ? `var(--x-${problem.status})`
          : `color-mix(in srgb, var(--x-cat-${tool.category}) 38%, transparent)`,
        opacity: rolledBack || dimmed ? 0.38 : feature.suppressed ? 0.6 : 1,
      }}
    >
      <ToolIcon name={tool.icon} category={tool.category} size={18} />
      {problem && <StatusGlyph status={problem.status} />}
    </button>
  );
  return (
    <li>
      <Popover
        anchorOnly
        open={renaming}
        onOpenChange={setRenaming}
        side="top"
        label={`Rename ${feature.name}`}
        trigger={
          // The popover sits on the chip; a plain element takes its anchor ref.
          <span className="block">
            <ContextMenu
              label={`${feature.name} menu`}
              trigger={
                <Tooltip
                  label={feature.name}
                  side="top"
                  hint={problem?.message ? `${hint}: ${problem.message}` : hint}
                >
                  {chip}
                </Tooltip>
              }
            >
              <FeatureMenuItems
                feature={feature}
                editable={editable}
                actions={actions}
                onRename={() => setRenaming(true)}
                position={{ index, marker, count }}
              />
            </ContextMenu>
          </span>
        }
      >
        <RenameField
          name={feature.name}
          label="Name"
          className="w-48"
          onCommit={(name) => actions.rename(feature.id, name)}
          onDone={() => setRenaming(false)}
        />
      </Popover>
    </li>
  );
}

/** ✕ or ⚠ on a chip's corner: the status colour always comes with a glyph (UI spec §1). */
function StatusGlyph({ status }: { status: 'warning' | 'error' }) {
  const Icon = status === 'error' ? X : TriangleAlert;
  return (
    <span
      aria-hidden="true"
      className="absolute -top-1 -right-1 grid size-3.5 place-items-center rounded-full text-bg"
      style={{ background: `var(--x-${status})` }}
    >
      <Icon size={10} strokeWidth={3} />
    </span>
  );
}

const NO_MODEL = createModelStore<BodyMesh>();

/** The selection summary (UI spec §2): "2 faces", "1 edge"; nothing while nothing is selected. */
function SelectionState({ session }: { session: SessionStore }) {
  const summary = useStore(session, (s) => selectionSummary(s.selection));
  if (!summary) return null;
  return (
    <output
      aria-label="Selection"
      className="font-mono text-[11px] whitespace-nowrap text-ink tabular-nums"
    >
      {summary} ·
    </output>
  );
}

/** What the kernel is doing: starting, computing, or how long the last recompute took. */
function KernelState({ model }: { model: ModelStore<BodyMesh> }) {
  const status = useStore(model, (s) => s.status);
  const stats = useStore(model, (s) => s.stats);
  const error = useStore(model, (s) => s.error);
  return (
    <Tooltip label="Kernel" hint={kernelHint(status, error)}>
      <output
        aria-label="Kernel"
        data-model-status={status}
        data-kernel-state
        className={`-ml-1 font-mono text-[11px] whitespace-nowrap tabular-nums ${status === 'failed' ? 'text-error' : 'text-muted'}`}
      >
        · {kernelText(status, stats)}
      </output>
    </Tooltip>
  );
}

function kernelText(status: ModelState<unknown>['status'], stats: ModelState<unknown>['stats']) {
  if (status === 'idle') return 'kernel starting';
  if (status === 'computing') return 'computing…';
  if (status === 'failed') return 'kernel stopped';
  if (!stats) return 'computed';
  return `computed in ${stats.ms < 10 ? stats.ms.toFixed(1) : Math.round(stats.ms)} ms`;
}

function kernelHint(status: ModelState<unknown>['status'], error: string | undefined) {
  if (status === 'failed') return error ?? 'The geometry kernel stopped.';
  return 'The geometry kernel recomputes the timeline after each change, reusing what the change left alone.';
}

/** The timeline's items (chips and the marker) in order. */
function timelineItems(list: HTMLElement): HTMLElement[] {
  return [...list.querySelectorAll<HTMLElement>('[data-timeline-item]')];
}

function centreOf(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return r.left + r.width / 2;
}

/**
 * The rollback marker (FR-TL-02, UI spec §2): a slider over the gaps
 * between chips. Drag it (it follows the pointer; the model rolls when it
 * is let go, one undo step), or focus it and use the arrow keys, Home and
 * End. While a dialog edits a feature it sits after that feature, dashed.
 */
function Marker({
  list,
  features,
  index,
  editing,
  locked,
  onDrag,
  onMove,
}: {
  list: RefObject<HTMLOListElement | null>;
  features: readonly Feature[];
  /** The gap it is drawn in. */
  index: number;
  /** The name of the feature a dialog edits, if any. */
  editing: string | undefined;
  locked: boolean;
  onDrag(drag: MarkerDrag | undefined): void;
  onMove(index: number): void;
}) {
  const drag = useRef<{ from: number; at: number }>(undefined);
  const count = features.length;
  const gapAt = (x: number): MarkerDrag => {
    const el = list.current;
    if (!el) return { index, x: 0 };
    const chips = timelineItems(el).filter((item) => item.dataset.timelineItem === 'chip');
    const at = chips.filter((item) => centreOf(item) < x).length;
    const left = chips[at - 1]?.getBoundingClientRect().right;
    const right = chips[at]?.getBoundingClientRect().left;
    const px =
      left !== undefined && right !== undefined
        ? (left + right) / 2
        : left !== undefined
          ? left + 4
          : (right ?? 0) - 4;
    return { index: at, x: px - el.getBoundingClientRect().left + el.scrollLeft };
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || locked) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    drag.current = { from: index, at: index };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const gap = gapAt(event.clientX);
    if (gap.index === d.at) return;
    d.at = gap.index;
    onDrag(gap);
  };
  const end = (drop: boolean) => {
    const d = drag.current;
    drag.current = undefined;
    if (!d) return;
    onDrag(undefined);
    if (drop && d.at !== d.from) onMove(d.at);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const to =
      event.key === 'ArrowLeft' || event.key === 'ArrowDown'
        ? index - 1
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? index + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? count
              : event.key === 'Escape' && drag.current
                ? -2
                : undefined;
    if (to === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (to === -2) return end(false);
    if (to >= 0 && to <= count && to !== index) onMove(to);
  };
  const before = features[index - 1]?.name;
  const text = editing
    ? `Editing ${editing}`
    : before
      ? `After ${before}${index === count ? ', at the end' : ''}`
      : 'At the start';
  return (
    <li
      data-timeline-item="marker"
      data-editing={editing ? 'true' : undefined}
      className={`relative mx-0.5 h-8 w-[3px] shrink-0 rounded-sm before:absolute before:-top-1 before:-left-1 before:border-[5.5px] before:border-transparent before:border-t-accent ${editing ? 'border-l-[3px] border-dashed border-accent' : 'bg-accent'}`}
    >
      {/* A hit area wider than the bar; the slider carries the marker's name and value. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label="Timeline marker"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={count}
        aria-valuenow={index}
        aria-valuetext={text}
        aria-disabled={locked || undefined}
        title={locked ? undefined : 'Drag to roll the model back or forward'}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => end(true)}
        onPointerCancel={() => end(false)}
        onKeyDown={onKeyDown}
        className={`absolute -inset-x-1.5 -inset-y-1 touch-none rounded-sm focus-visible:outline-2 focus-visible:outline-accent ${locked ? 'cursor-not-allowed' : 'cursor-ew-resize'}`}
      />
    </li>
  );
}

/** Where a dragged chip would land: accent, or the error colour with the reason when refused. */
function DropIndicator({ drag }: { drag: ChipDrag }) {
  const refused = drag.problem !== undefined;
  return (
    <li
      aria-hidden="true"
      data-drop-index={drag.index}
      data-drop-refused={refused || undefined}
      title={drag.problem}
      className="pointer-events-none absolute top-0.5 bottom-0.5 w-0.5 -translate-x-1/2 rounded-sm"
      style={{ left: drag.x, background: refused ? 'var(--x-error)' : 'var(--x-accent)' }}
    />
  );
}

/**
 * The viewport's frame rate and frame time. The view draws only when
 * something changes, so a still view reads "idle"; orbit or drag to measure.
 */
function RenderRate({ viewport }: { viewport: ViewportStore }) {
  const stats = useStore(viewport, (s) => s.renderStats);
  return (
    <Tooltip
      label="Rendering"
      hint="Frames drawn in the last second, and the mean time to draw one. The view only redraws when something changes, so a still view is idle."
    >
      <output
        aria-label="Rendering"
        data-render-stats
        className="-ml-1 font-mono text-[11px] whitespace-nowrap text-muted tabular-nums"
      >
        · {formatRenderStats(stats)}
      </output>
    </Tooltip>
  );
}
