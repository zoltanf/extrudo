import {
  createModelStore,
  type DocumentStore,
  type Feature,
  type FeatureId,
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
import { type FeatureProblem, featureProblem, StatusGlyph } from './featureStatus';
import { chipSelection, edgeScrollStep } from './timelineDrag';
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
  /** The size of the box around the selection ("40.00 × 80.00 × 60.00 mm", P2-13). */
  selectionSize?: string | undefined;
}

/** A chip being dragged to a new place (FR-TL-04). */
interface ChipDrag {
  id: FeatureId;
  /** Every feature that moves: the dragged one, or the selected chips it is one of (P3-17). */
  ids: FeatureId[];
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
 * Scrolls the list while `active` and the pointer (`pointerX`, client px) is near one of its
 * ends; `onScroll` runs after each step, so the drop or gap can follow.
 */
function useEdgeScroll(
  list: RefObject<HTMLOListElement | null>,
  active: boolean,
  pointerX: RefObject<number | undefined>,
  onScroll: () => void,
) {
  const callback = useRef(onScroll);
  callback.current = onScroll;
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = () => {
      const el = list.current;
      const x = pointerX.current;
      if (el && x !== undefined) {
        const r = el.getBoundingClientRect();
        const step = edgeScrollStep(x, r.left, r.right);
        const before = el.scrollLeft;
        if (step !== 0) el.scrollLeft += step;
        if (el.scrollLeft !== before) callback.current();
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, list, pointerX]);
}

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
  selectionSize,
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
  // The marker is drawn between other chips after a key moves it: focus follows it there.
  const refocus = useRef(false);
  // Chips picked with a click (Ctrl/⌘ adds, Shift a run): dragging one of them moves them all
  // (P3-17). Timeline state only; features that went away drop out.
  const [picked, setPicked] = useState<FeatureId[]>([]);
  const anchor = useRef<FeatureId>(undefined);
  const order = doc.features.map((f) => f.id);
  const selected = picked.filter((id) => order.includes(id));
  const select = (id: FeatureId, mode: 'replace' | 'toggle' | 'range') => {
    setPicked(chipSelection(order, selected, id, mode, anchor.current));
    if (mode !== 'range') anchor.current = id;
  };
  const movingWith = (id: FeatureId) =>
    selected.length > 1 && selected.includes(id) ? selected : [id];

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
            data-selected-features={selected.join(' ') || undefined}
            className="relative flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 py-1"
            onClick={(event) => {
              // A click between chips clears the chip selection, and so does Esc on a chip.
              if (event.target === event.currentTarget) setPicked([]);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && selected.length > 0) setPicked([]);
            }}
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
                    refocus={refocus}
                  />
                )}
                <Chip
                  feature={feature}
                  index={index}
                  marker={marker}
                  count={count}
                  problem={featureProblem(feature, index, marker, statuses)}
                  rolledBack={index >= (markerDrag?.index ?? marker)}
                  dimmed={editIndex >= 0 && index > editIndex}
                  editable={actions.canEdit(feature, index, marker)}
                  actions={actions}
                  list={list}
                  locked={locked}
                  dragging={chipDrag?.ids.includes(feature.id) ?? false}
                  onDrag={setChipDrag}
                  selected={selected.includes(feature.id)}
                  moving={movingWith(feature.id)}
                  onSelect={select}
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
                refocus={refocus}
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
      {session && <SelectionState session={session} size={selectionSize} />}
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
  problem,
  rolledBack,
  dimmed,
  editable,
  actions,
  list,
  locked,
  dragging,
  onDrag,
  selected,
  moving,
  onSelect,
}: {
  feature: Feature;
  index: number;
  marker: number;
  count: number;
  /** The kernel's verdict; only for active features (`featureProblem`). */
  problem: FeatureProblem | undefined;
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
  /** Picked with a click (P3-17). */
  selected: boolean;
  /** What a drag of this chip moves: it, or the selected chips when it is one of them. */
  moving: readonly FeatureId[];
  onSelect(id: FeatureId, mode: 'replace' | 'toggle' | 'range'): void;
}) {
  const [renaming, setRenaming] = useState(false);
  // The press that may become a drag, then the drag's latest drop.
  const press = useRef<{ x: number; y: number; drag?: ChipDrag }>(undefined);
  // The pointer during a drag (client px), for scrolling at the ends; a drag isn't a click.
  const pointerX = useRef<number>(undefined);
  const dragged = useRef(false);
  const dropAt = (x: number): ChipDrag | undefined => {
    const el = list.current;
    if (!el) return undefined;
    const ids = [...moving];
    const items = timelineItems(el).filter(
      (item) => !ids.includes(item.dataset.featureId as FeatureId),
    );
    const before = items.filter((item) => centreOf(item) < x);
    const target = before.filter((item) => item.dataset.timelineItem === 'chip').length;
    const active = !before.some((item) => item.dataset.timelineItem === 'marker');
    const unchanged = ids.length === 1 && target === index && active === index < marker;
    const edge = before.at(-1)?.getBoundingClientRect().right;
    const next = items[before.length]?.getBoundingClientRect().left;
    const at = edge !== undefined ? edge + 3 : (next ?? 0) - 3;
    return {
      id: feature.id,
      ids,
      index: target,
      active,
      x: at - el.getBoundingClientRect().left + el.scrollLeft,
      problem: unchanged
        ? undefined
        : actions.moveProblem(ids.length === 1 ? feature.id : ids, target),
    };
  };
  useEdgeScroll(list, dragging && press.current?.drag !== undefined, pointerX, () => {
    const p = press.current;
    if (!p?.drag || pointerX.current === undefined) return;
    p.drag = dropAt(pointerX.current);
    onDrag(p.drag);
  });
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || locked || renaming) return;
    press.current = { x: event.clientX, y: event.clientY };
    dragged.current = false;
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.drag && Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD) return;
    if (!p.drag) event.currentTarget.setPointerCapture(event.pointerId);
    pointerX.current = event.clientX;
    p.drag = dropAt(event.clientX);
    onDrag(p.drag);
  };
  const endDrag = (drop: boolean) => {
    const drag = press.current?.drag;
    press.current = undefined;
    pointerX.current = undefined;
    if (!drag) return;
    dragged.current = true;
    onDrag(undefined);
    if (!drop) return;
    if (drag.ids.length === 1 && drag.index === index && drag.active === index < marker) return;
    actions.move(drag.ids.length === 1 ? drag.id : drag.ids, drag.index, drag.active);
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
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={(event) => {
        // The click that ends a drag doesn't change the selection.
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onSelect(
          feature.id,
          event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace',
        );
      }}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          setRenaming(true);
        }
      }}
      className={`relative grid size-[30px] shrink-0 touch-none place-items-center rounded-control border ${feature.suppressed ? 'border-dashed' : ''} ${dragging ? 'cursor-grabbing ring-2 ring-accent' : selected ? 'ring-2 ring-accent/60 ring-offset-1 ring-offset-panel' : ''}`}
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
      {problem && <StatusGlyph status={problem.status} corner />}
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

const NO_MODEL = createModelStore<BodyMesh>();

/**
 * The selection summary (UI spec §2): "2 faces", "1 edge"; nothing while
 * nothing is selected. Then the size of the box around it (P2-13), once
 * the kernel has measured it.
 */
function SelectionState({ session, size }: { session: SessionStore; size?: string | undefined }) {
  const summary = useStore(session, (s) => selectionSummary(s.selection));
  if (!summary) return null;
  return (
    <>
      <output
        aria-label="Selection"
        className="font-mono text-[11px] whitespace-nowrap text-ink tabular-nums"
      >
        {summary} ·
      </output>
      {size && (
        <Tooltip
          label="Selection size"
          hint="The box around the selection along X, Y and Z. Measure (I) says more."
        >
          <output
            aria-label="Selection size"
            data-selection-size={size}
            className="-ml-1 font-mono text-[11px] whitespace-nowrap text-ink tabular-nums"
          >
            {size} ·
          </output>
        </Tooltip>
      )}
    </>
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
  refocus,
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
  /** Set before a key moves it: the marker in its new place takes the focus. */
  refocus: RefObject<boolean>;
}) {
  const drag = useRef<{ from: number; at: number }>(undefined);
  const slider = useRef<HTMLDivElement>(null);
  // The pointer while dragging (client px): the list scrolls at its ends (P3-17).
  const pointerX = useRef<number>(undefined);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    slider.current?.focus();
  });
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
    setDragging(true);
  };
  const follow = (x: number) => {
    const d = drag.current;
    if (!d) return;
    const gap = gapAt(x);
    if (gap.index === d.at) return;
    d.at = gap.index;
    onDrag(gap);
  };
  useEdgeScroll(list, dragging, pointerX, () => {
    if (pointerX.current !== undefined) follow(pointerX.current);
  });
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    pointerX.current = event.clientX;
    follow(event.clientX);
  };
  const end = (drop: boolean) => {
    const d = drag.current;
    drag.current = undefined;
    pointerX.current = undefined;
    setDragging(false);
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
    if (to >= 0 && to <= count && to !== index) {
      refocus.current = true;
      onMove(to);
    }
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
        ref={slider}
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
