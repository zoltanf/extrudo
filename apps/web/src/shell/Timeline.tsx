import {
  createModelStore,
  type DocumentStore,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type FeatureStatus,
  type GroupId,
  type ModelState,
  type ModelStore,
  readSketch,
  type SessionStore,
  type SketchData,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import {
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Folder,
  FolderOpen,
} from 'lucide-react';
import {
  Fragment,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import { ContextMenu, IconButton, Popover, ToolIcon, Tooltip } from '../design-system';
import { type MacroStore, recordedCount } from '../macro/macro';
import { selectionSummary } from '../selection/items';
import { formatRenderStats } from '../viewport/renderMeter';
import { SoftwareRendering } from '../viewport/SoftwareRendering';
import type { ViewportStore } from '../viewport/store';
import { webglSupport } from '../viewport/webglSupport';
import { FeatureMenuItems, GroupMenuItems, RenameField } from './FeatureMenu';
import type { FeatureActions } from './featureActions';
import { type FeatureProblem, featureProblem, StatusGlyph, scriptChipHint } from './featureStatus';
import type { GroupActions } from './groupActions';
import { chipSelection, edgeScrollStep } from './timelineDrag';
import {
  dropAt,
  type GroupRun,
  planTimeline,
  stepMarker,
  type TimelineSelectionStore,
} from './timelineGroups';
import { toolForFeature } from './tools';

export interface TimelineProps {
  store: DocumentStore;
  collapsed: boolean;
  onToggle(): void;
  /** Name of the sketch being edited. The marker can't move meanwhile (it could roll the sketch back). */
  activeSketch?: string;
  /** Edit, rename, suppress, delete and hover (P1-12). */
  actions: FeatureActions;
  /** Group, ungroup, fold and open the timeline's groups (P4-09, ADR-0065 §2). */
  groups: GroupActions;
  /** The picked chips (P3-17) and the picked group (P4-09), shared with the marking menu. */
  selection: TimelineSelectionStore;
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
  /** The macro recorder (P5-05): while it records, the status bar says so. */
  macro?: MacroStore;
}

/** A chip being dragged to a new place (FR-TL-04). */
interface ChipDrag {
  /** What it holds: one feature, the picked chips, or every member of a group (P4-09). */
  ids: FeatureId[];
  /** Where it would go: the index its first feature lands at, and whether it lands active (left of the marker). */
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
 *
 * Groups (P4-09, ADR-0065 §2): a run of neighbouring chips picks with Shift and
 * groups from the chip menu or the marking menu; a folded group is one chip
 * with its name, how many features are in it and the worst of their statuses,
 * and an open one a band around its members' chips. The marker passes a folded
 * group whole, and dragging its chip moves every member together.
 */
export function Timeline({
  store,
  collapsed,
  onToggle,
  activeSketch,
  actions,
  groups,
  selection,
  viewport,
  model,
  session,
  editing,
  selectionSize,
  macro,
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
  const plan = useMemo(() => planTimeline(doc, statuses), [doc, statuses]);
  const move = (index: number) => actions.rollTo(index);
  const list = useRef<HTMLOListElement>(null);
  // Where the marker is drawn while it is dragged, and a chip being dragged.
  const [markerDrag, setMarkerDrag] = useState<MarkerDrag>();
  const [chipDrag, setChipDrag] = useState<ChipDrag>();
  // The marker stays put while dragged (it holds the pointer); a ghost shows where it goes.
  const shown = editIndex >= 0 ? editIndex + 1 : marker;
  // The marker is drawn between other chips after a key moves it: focus follows it there.
  const refocus = useRef(false);
  // Chips picked with a click (Ctrl/⌘ adds, Shift a run) and the group chip picked with one
  // (P3-17, P4-09). Timeline state, shared with the marking menu; features that went away drop out.
  const picked = useStore(selection, (s) => s.chips);
  const pickedGroup = useStore(selection, (s) => s.group);
  const anchor = useRef<FeatureId>(undefined);
  const order = useMemo(() => doc.features.map((f) => f.id), [doc.features]);
  const live = picked.filter((id) => order.includes(id));
  const pick = (chips: FeatureId[], group?: GroupId) => {
    selection.getState().pick(chips, group);
  };
  const select = (id: FeatureId, mode: 'replace' | 'toggle' | 'range') => {
    pick(chipSelection(order, live, id, mode, anchor.current));
    if (mode !== 'range') anchor.current = id;
  };
  const movingWith = (id: FeatureId) => (live.length > 1 && live.includes(id) ? live : [id]);
  /** A click on a group's chip: it picks the group, or (with Shift) the run over its members. */
  const pickGroup = (run: GroupRun, shift: boolean) => {
    const last = run.members.at(-1)?.id;
    if (shift && last) {
      pick(chipSelection(order, live, last, 'range', anchor.current ?? run.members[0]?.id));
      return;
    }
    pick([], run.group.id);
    anchor.current = run.members[0]?.id;
  };
  // The marker one step on, over a folded group whole.
  const stepBack = stepMarker(plan.gaps, marker, -1);
  const stepForward = stepMarker(plan.gaps, marker, 1);
  const markerAt = (index: number) => (
    <Marker
      list={list}
      features={doc.features}
      gaps={plan.gaps}
      index={index}
      editing={editIndex >= 0 ? doc.features[editIndex]?.name : undefined}
      locked={locked}
      onDrag={setMarkerDrag}
      onMove={move}
      refocus={refocus}
    />
  );

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
              disabled={locked || stepBack === marker}
              onClick={() => move(stepBack)}
            >
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton
              label="Step forward"
              disabled={locked || stepForward === marker}
              onClick={() => move(stepForward)}
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
            data-selected-features={live.join(' ') || undefined}
            data-selected-group={pickedGroup || undefined}
            className="relative flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 py-1"
            onClick={(event) => {
              // A click between chips clears what was picked, and so does Esc on a chip.
              if (event.target === event.currentTarget) selection.getState().clear();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && (live.length > 0 || pickedGroup))
                selection.getState().clear();
            }}
          >
            {plan.bands.map((band) => {
              // A folded group is one chip of its own; an open one a band around its members.
              if (!band.group) {
                return (
                  <Fragment key={band.chips[0]?.id ?? `gap-${band.from}`}>
                    {band.chips.map((feature, i) => {
                      const index = band.from + i;
                      return (
                        <Fragment key={feature.id}>
                          {index === shown && markerAt(index)}
                          <Chip
                            feature={feature}
                            index={index}
                            count={count}
                            marker={marker}
                            problem={featureProblem(feature, index, marker, statuses)}
                            scriptStatus={statuses[feature.id]}
                            rolledBack={index >= (markerDrag?.index ?? marker)}
                            dimmed={editIndex >= 0 && index > editIndex}
                            editable={actions.canEdit(feature, index, marker)}
                            actions={actions}
                            groups={groups}
                            list={list}
                            locked={locked}
                            dragging={chipDrag?.ids.includes(feature.id) ?? false}
                            onDrag={setChipDrag}
                            selected={live.includes(feature.id)}
                            moving={movingWith(feature.id)}
                            onSelect={select}
                            // Two chips or more picked: the menu can group them (P4-09).
                            range={live.length > 1 ? live : undefined}
                          />
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              }
              const run = band.group;
              if (run.group.collapsed) {
                return (
                  <Fragment key={run.group.id}>
                    {band.from === shown && markerAt(band.from)}
                    <GroupChip
                      run={run}
                      actions={actions}
                      groups={groups}
                      list={list}
                      locked={locked}
                      dragging={chipDrag?.ids.includes(run.members[0]?.id as FeatureId) ?? false}
                      onDrag={setChipDrag}
                      selected={pickedGroup === run.group.id}
                      marker={marker}
                      statuses={statuses}
                      onPick={(shift) => pickGroup(run, shift)}
                    />
                  </Fragment>
                );
              }
              return (
                <Fragment key={run.group.id}>
                  {band.from === shown && markerAt(band.from)}
                  {/* An open group is a band around its members' chips: the marker that
                      belongs in front of it is a chip of the timeline again, and the members
                      are a list of their own. */}
                  <li
                    data-group-band={run.group.id}
                    className="flex shrink-0 items-center gap-1 rounded-control border border-dashed px-1 py-0.5"
                    style={{ background: 'color-mix(in srgb, var(--x-accent) 7%, transparent)' }}
                  >
                    <GroupLabel run={run} groups={groups} />
                    <ul className="flex items-center gap-1">
                      {run.members.map((feature, i) => {
                        const index = band.from + i;
                        return (
                          <Fragment key={feature.id}>
                            {/* The band's own marker, before the label, is the first member's. */}
                            {i > 0 && index === shown && markerAt(index)}
                            <Chip
                              feature={feature}
                              index={index}
                              count={count}
                              marker={marker}
                              problem={featureProblem(feature, index, marker, statuses)}
                              scriptStatus={statuses[feature.id]}
                              rolledBack={index >= (markerDrag?.index ?? marker)}
                              dimmed={editIndex >= 0 && index > editIndex}
                              editable={actions.canEdit(feature, index, marker)}
                              actions={actions}
                              groups={groups}
                              list={list}
                              locked={locked}
                              dragging={chipDrag?.ids.includes(feature.id) ?? false}
                              onDrag={setChipDrag}
                              selected={live.includes(feature.id) || pickedGroup === run.group.id}
                              moving={movingWith(feature.id)}
                              onSelect={select}
                              range={live.length > 1 ? live : undefined}
                            />
                          </Fragment>
                        );
                      })}
                    </ul>
                  </li>
                </Fragment>
              );
            })}
            {shown === count && count > 0 && markerAt(count)}
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
      {macro && <MacroRecording macro={macro} store={store} />}
      {session && <SelectionState session={session} store={store} size={selectionSize} />}
      <output className="font-mono text-[11px] whitespace-nowrap text-muted" aria-label="Status">
        {activeSketch ? `Editing ${activeSketch} · ` : ''}
        {count} {count === 1 ? 'feature' : 'features'} · {doc.settings.units}
        {errors > 0 && ` · ${errors} ${errors === 1 ? 'error' : 'errors'}`}
      </output>
      {model && <KernelState model={model} />}
      {viewport && <SoftwareRendering support={webglSupport()} />}
      {viewport && <RenderRate viewport={viewport} />}
      <IconButton label={collapsed ? 'Show timeline' : 'Hide timeline'} onClick={onToggle}>
        {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </IconButton>
    </section>
  );
}

/** What a chip holds and where it starts: a feature's own index, or its group's range. */
interface ChipContents {
  ids: readonly FeatureId[];
  from: number;
  to: number;
}

/**
 * The press-then-drag of a chip (FR-TL-04, P3-17, P4-09): what it holds moves to the gap under
 * the pointer, refused with a message when it would break a reference. Gaps are counted in
 * features, not in drawn chips, so a folded group (one chip, several features) is stepped over
 * whole and its members move together.
 */
function useChipDrag(options: {
  contents: ChipContents;
  marker: number;
  list: RefObject<HTMLOListElement | null>;
  locked: boolean;
  actions: FeatureActions;
  onDrag(drag: ChipDrag | undefined): void;
  dragging: boolean;
}) {
  const { contents, marker, list, locked, actions, onDrag, dragging } = options;
  // The press that may become a drag, then the drag's latest drop.
  const press = useRef<{ x: number; y: number; drag?: ChipDrag }>(undefined);
  // The pointer during a drag (client px), for scrolling at the ends; a drag isn't a click.
  const pointerX = useRef<number>(undefined);
  const dragged = useRef(false);
  const dropAt = (x: number): ChipDrag | undefined => {
    const el = list.current;
    if (!el) return undefined;
    const ids = [...contents.ids];
    const items = timelineItems(el).filter(
      (item) =>
        !(
          item.dataset.timelineItem === 'chip' && ids.includes(item.dataset.featureId as FeatureId)
        ),
    );
    const before = items.filter((item) => centreOf(item) < x);
    // What is before the gap: chips count as the features they stand for, the marker as none.
    const target = dropIndex(before.filter((item) => item.dataset.timelineItem === 'chip'));
    const active = !before.some((item) => item.dataset.timelineItem === 'marker');
    const unchanged = target === contents.from && active === contents.from < marker;
    const edge = before.at(-1)?.getBoundingClientRect().right;
    const next = items[before.length]?.getBoundingClientRect().left;
    const at = edge !== undefined ? edge + 3 : (next ?? 0) - 3;
    return {
      ids,
      index: target,
      active,
      x: at - el.getBoundingClientRect().left + el.scrollLeft,
      problem: unchanged
        ? undefined
        : actions.moveProblem(ids.length === 1 ? (ids[0] as FeatureId) : ids, target),
    };
  };
  useEdgeScroll(list, dragging && press.current?.drag !== undefined, pointerX, () => {
    const p = press.current;
    if (!p?.drag || pointerX.current === undefined) return;
    p.drag = dropAt(pointerX.current);
    onDrag(p.drag);
  });
  const endDrag = (drop: boolean) => {
    const drag = press.current?.drag;
    press.current = undefined;
    pointerX.current = undefined;
    if (!drag) return;
    dragged.current = true;
    onDrag(undefined);
    if (!drop) return;
    if (drag.index === contents.from && drag.active === contents.from < marker) return;
    actions.move(
      drag.ids.length === 1 ? (drag.ids[0] as FeatureId) : drag.ids,
      drag.index,
      drag.active,
    );
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
  return {
    /** Whether the click that ends a drag must not change the selection. */
    dragged,
    handlers: {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0 || locked) return;
        press.current = { x: event.clientX, y: event.clientY };
        dragged.current = false;
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const p = press.current;
        if (!p) return;
        if (!p.drag && Math.hypot(event.clientX - p.x, event.clientY - p.y) < DRAG_THRESHOLD)
          return;
        if (!p.drag) event.currentTarget.setPointerCapture(event.pointerId);
        pointerX.current = event.clientX;
        p.drag = dropAt(event.clientX);
        onDrag(p.drag);
      },
      onPointerUp: () => endDrag(true),
      onPointerCancel: () => endDrag(false),
    },
  };
}

/** The feature index a gap after these drawn chips is at (P4-09, `timelineGroups.ts`). */
function dropIndex(chips: readonly HTMLElement[]): number {
  return dropAt(
    chips.map((item) => ({
      from: Number(item.dataset.featureFrom ?? 0),
      to: Number(item.dataset.featureTo ?? 1),
    })),
  );
}

function Chip({
  feature,
  index,
  count,
  marker,
  problem,
  scriptStatus,
  rolledBack,
  dimmed,
  editable,
  actions,
  groups,
  list,
  locked,
  dragging,
  onDrag,
  selected,
  moving,
  onSelect,
  range,
}: {
  feature: Feature;
  index: number;
  /** How many features the timeline has (for "Move to End"). */
  count: number;
  marker: number;
  /** The kernel's verdict; only for active features (`featureProblem`). */
  problem: FeatureProblem | undefined;
  scriptStatus?: FeatureStatus | undefined;
  rolledBack: boolean;
  /** After the feature a dialog edits: drawn like a rolled-back one (not named so). */
  dimmed: boolean;
  editable: boolean;
  actions: FeatureActions;
  groups: GroupActions;
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
  /** Two chips or more are picked: the menu groups them (P4-09). */
  range: readonly FeatureId[] | undefined;
}) {
  const [renaming, setRenaming] = useState(false);
  const ids = [...moving];
  const drag = useChipDrag({
    contents: { ids, from: index, to: index + 1 },
    marker,
    list,
    locked: locked || renaming,
    actions,
    onDrag,
    dragging,
  });
  const tool = toolForFeature(feature.type);
  const states = [
    rolledBack && 'rolled back',
    feature.suppressed && 'suppressed',
    problem?.status,
  ].filter(Boolean);
  const hint = [tool.label, ...states, scriptChipHint(scriptStatus)].filter(Boolean).join(' · ');
  const chip = (
    <button
      type="button"
      aria-label={`${feature.name}${states.length > 0 ? ` (${states.join(', ')})` : ''}`}
      onDoubleClick={editable ? () => actions.edit(feature.id) : undefined}
      onPointerEnter={() => actions.hover(feature.id)}
      onPointerLeave={() => actions.hover(undefined)}
      {...drag.handlers}
      data-timeline-item="chip"
      data-feature-id={feature.id}
      data-feature-from={index}
      data-feature-to={index + 1}
      data-feature-status={problem?.status}
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={(event) => {
        // The click that ends a drag doesn't change the selection.
        if (drag.dragged.current) {
          drag.dragged.current = false;
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
                {...(range && { group: { features: range, actions: groups } })}
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

/**
 * A folded group as one chip (P4-09, ADR-0065 §2): a folder glyph, its name, how
 * many features are in it and the worst of their statuses. Its arrow opens the
 * group, a double-click does the same, and a drag moves every member together
 * (one command, refused as a whole).
 */
function GroupChip({
  run,
  actions,
  groups,
  list,
  locked,
  dragging,
  onDrag,
  selected,
  marker,
  statuses,
  onPick,
}: {
  run: GroupRun;
  actions: FeatureActions;
  groups: GroupActions;
  list: RefObject<HTMLOListElement | null>;
  locked: boolean;
  dragging: boolean;
  onDrag(drag: ChipDrag | undefined): void;
  selected: boolean;
  marker: number;
  statuses: Readonly<Record<string, FeatureStatus | undefined>>;
  onPick(shift: boolean): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const members = run.members.map((f) => f.id);
  const ids = [...members];
  const drag = useChipDrag({
    contents: { ids, from: run.from, to: run.to + 1 },
    marker,
    list,
    locked: locked || renaming,
    actions,
    onDrag,
    dragging,
  });
  const states = [
    run.rolledBack && 'rolled back',
    run.split && 'partly rolled back',
    run.suppressed && 'suppressed',
    run.status,
  ].filter(Boolean);
  const count = run.members.length;
  const first = run.members[0];
  const group = run.group;
  const chip = (
    <button
      type="button"
      aria-label={`${group.name}, ${count} ${count === 1 ? 'feature' : 'features'}${states.length > 0 ? ` (${states.join(', ')})` : ''}`}
      onDoubleClick={() => groups.setCollapsed(group.id, false)}
      onPointerEnter={() => actions.hover(first?.id)}
      onPointerLeave={() => actions.hover(undefined)}
      {...drag.handlers}
      data-timeline-item="chip"
      data-group={group.id}
      data-group-collapsed
      data-feature-id={first?.id}
      data-feature-from={run.from}
      data-feature-to={run.to + 1}
      data-feature-status={run.status}
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={(event) => {
        if (drag.dragged.current) {
          drag.dragged.current = false;
          return;
        }
        onPick(event.shiftKey);
      }}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          setRenaming(true);
        }
      }}
      className={`relative flex h-8 max-w-52 shrink-0 touch-none items-center gap-1.5 rounded-control border px-1.5 ${dragging ? 'cursor-grabbing ring-2 ring-accent' : selected ? 'ring-2 ring-accent/60 ring-offset-1 ring-offset-panel' : ''}`}
      style={{
        background: 'color-mix(in srgb, var(--x-accent) 10%, var(--x-bg))',
        borderColor: run.status
          ? `var(--x-${run.status})`
          : 'color-mix(in srgb, var(--x-accent) 38%, transparent)',
        opacity: run.rolledBack ? 0.38 : run.suppressed ? 0.6 : 1,
      }}
    >
      <Folder size={14} className="shrink-0" />
      <span className="truncate text-[11px]">{group.name}</span>
      <span className="font-mono text-[10px] text-muted">{count}</span>
      {run.errors > 0 && (
        <span className="font-mono text-[10px] text-error" aria-hidden="true">
          ✕{run.errors > 1 ? run.errors : ''}
        </span>
      )}
      {!run.status && run.members.some((f) => statuses[f.id]?.status === 'warning') && (
        <StatusGlyph status="warning" />
      )}
    </button>
  );
  return (
    <li className="flex shrink-0 items-center">
      <Popover
        anchorOnly
        open={renaming}
        onOpenChange={setRenaming}
        side="top"
        label={`Rename ${group.name}`}
        trigger={
          <span className="block">
            <ContextMenu
              label={`${group.name} group menu`}
              trigger={
                <Tooltip
                  label={group.name}
                  side="top"
                  hint={`${count} ${count === 1 ? 'feature' : 'features'}${run.message ? `: ${run.message}` : ''}`}
                >
                  {chip}
                </Tooltip>
              }
            >
              <GroupMenuItems run={run} actions={groups} onRename={() => setRenaming(true)} />
            </ContextMenu>
          </span>
        }
      >
        <RenameField
          name={group.name}
          label="Name"
          className="w-48"
          onCommit={(name) => groups.rename(group.id, name)}
          onDone={() => setRenaming(false)}
        />
      </Popover>
      {/* The arrow beside the chip opens the group, like a double-click does. */}
      <IconButton
        label={`Expand ${group.name}`}
        onClick={() => groups.setCollapsed(group.id, false)}
        className="-ml-2 !size-6"
      >
        <ChevronRight size={12} />
      </IconButton>
    </li>
  );
}

/**
 * The label of an open group's band (P4-09, ADR-0065 §2): its name, which
 * collapses the group when clicked, a rename field (F2) and the group's menu.
 */
function GroupLabel({ run, groups }: { run: GroupRun; groups: GroupActions }) {
  const [renaming, setRenaming] = useState(false);
  const group = run.group;
  const label = (
    <button
      type="button"
      aria-label={`Collapse ${group.name}`}
      data-group-label={group.id}
      onClick={() => groups.setCollapsed(group.id, true)}
      onDoubleClick={() => groups.setCollapsed(group.id, true)}
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          setRenaming(true);
        }
      }}
      className="flex shrink-0 items-center gap-1 rounded px-1 text-[10px] text-muted hover:text-ink"
    >
      <FolderOpen size={12} />
      <span className="max-w-24 truncate">{group.name}</span>
    </button>
  );
  return (
    <Popover
      anchorOnly
      open={renaming}
      onOpenChange={setRenaming}
      side="top"
      label={`Rename ${group.name}`}
      trigger={
        <span className="block">
          <ContextMenu label={`${group.name} group menu`} trigger={label}>
            <GroupMenuItems run={run} actions={groups} onRename={() => setRenaming(true)} />
          </ContextMenu>
        </span>
      }
    >
      <RenameField
        name={group.name}
        label="Name"
        className="w-48"
        onCommit={(name) => groups.rename(group.id, name)}
        onDone={() => setRenaming(false)}
      />
    </Popover>
  );
}

const NO_MODEL = createModelStore<BodyMesh>();

/** The sketches of a document, for naming what the selection holds (P4-03). */
function sketchLookup(
  doc: ExtrudoDocument,
): (id: FeatureId) => { name?: string; data: SketchData } | undefined {
  return (id) => {
    const feature = doc.features.find((f) => f.id === id);
    const sketch = feature && readSketch(feature);
    return sketch && { name: feature?.name, data: sketch.data };
  };
}

/**
 * The selection summary (UI spec §2): "2 faces", "1 edge"; nothing while
 * nothing is selected. Then the size of the box around it (P2-13), once
 * the kernel has measured it.
 */
function SelectionState({
  session,
  store,
  size,
}: {
  session: SessionStore;
  store: DocumentStore;
  size?: string | undefined;
}) {
  // The document tells a whole text from a sketch curve (P4-03).
  const doc = useStore(store, (s) => s.doc);
  const lookup = sketchLookup(doc);
  const summary = useStore(session, (s) => selectionSummary(s.selection, { sketch: lookup }));
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

/** A red dot and the count while a macro records (P5-05): the count follows the document. */
function MacroRecording({ macro, store }: { macro: MacroStore; store: DocumentStore }) {
  const recording = useStore(macro, (s) => s.recording);
  const doc = useStore(store, (s) => s.doc);
  if (!recording) return null;
  const made = recordedCount(recording, doc);
  return (
    <output
      aria-label="Macro recording"
      data-macro-recording={made}
      className="flex items-center gap-1.5 font-mono text-[11px] whitespace-nowrap text-ink"
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-error" />
      Recording macro · {made} {made === 1 ? 'feature' : 'features'}
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

/** The timeline's items (chips, group chips and the marker) in order. */
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
 * End. The arrow keys step between the gaps the timeline draws, so a folded
 * group is passed whole (P4-09). While a dialog edits a feature it sits
 * after that feature, dashed.
 */
function Marker({
  list,
  features,
  gaps,
  index,
  editing,
  locked,
  onDrag,
  onMove,
  refocus,
}: {
  list: RefObject<HTMLOListElement | null>;
  features: readonly Feature[];
  /** The gaps the marker may stop in (never inside a folded group). */
  gaps: readonly number[];
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
    const before = chips.filter((item) => centreOf(item) < x);
    // The gap after the last chip before the pointer, counted in features (P4-09).
    const at = dropIndex(before);
    const left = before.at(-1)?.getBoundingClientRect().right;
    const right =
      chips[chips.indexOf(before.at(-1) as HTMLElement) + 1]?.getBoundingClientRect().left;
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
        ? stepMarker(gaps, index, -1)
        : event.key === 'ArrowRight' || event.key === 'ArrowUp'
          ? stepMarker(gaps, index, 1)
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
