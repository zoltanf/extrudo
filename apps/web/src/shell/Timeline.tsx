import {
  createModelStore,
  type DocumentStore,
  type Feature,
  type FeatureStatus,
  type ModelState,
  type ModelStore,
  moveTimelineMarker,
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
import { Fragment, useState } from 'react';
import { useStore } from 'zustand';
import { ContextMenu, IconButton, Popover, ToolIcon, Tooltip } from '../design-system';
import { selectionSummary } from '../selection/items';
import { formatRenderStats } from '../viewport/renderMeter';
import type { ViewportStore } from '../viewport/store';
import { FeatureMenuItems, RenameField } from './FeatureMenu';
import { type FeatureActions, isEditableSketch } from './featureActions';
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
}

/**
 * Timeline and status bar (UI spec §2). Chips follow the document's features;
 * the playback buttons move the rollback marker (FR-TL-02) as undoable
 * commands. A chip opens its sketch on double-click, highlights its geometry
 * on hover and has a right-click menu (P1-12). An active feature the kernel
 * couldn't compute shows ✕ (or ⚠ for a warning) and says why in its tooltip
 * (P2-01). Dragging the marker comes with P2-11.
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
}: TimelineProps) {
  const doc = useStore(store, (s) => s.doc);
  const statuses = useStore(model ?? NO_MODEL, (s) => s.features);
  const errors = doc.features.filter(
    (f, i) => i < doc.timelineMarker && !f.suppressed && statuses[f.id]?.status === 'error',
  ).length;
  const marker = doc.timelineMarker;
  const count = doc.features.length;
  const locked = activeSketch !== undefined;
  const move = (index: number) => store.getState().dispatch(moveTimelineMarker({ index }));

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
            aria-label="Features"
            className="flex min-w-0 items-center gap-1.5 overflow-x-auto px-1 py-1"
          >
            {doc.features.map((feature, index) => (
              <Fragment key={feature.id}>
                {index === marker && <Marker />}
                <Chip
                  feature={feature}
                  status={index < marker && !feature.suppressed ? statuses[feature.id] : undefined}
                  rolledBack={index >= marker}
                  editable={isEditableSketch(feature, index, marker)}
                  actions={actions}
                />
              </Fragment>
            ))}
            {marker === count && count > 0 && <Marker />}
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
  status,
  rolledBack,
  editable,
  actions,
}: {
  feature: Feature;
  /** The kernel's verdict; only for active features. */
  status: FeatureStatus | undefined;
  rolledBack: boolean;
  editable: boolean;
  actions: FeatureActions;
}) {
  const [renaming, setRenaming] = useState(false);
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
      onKeyDown={(event) => {
        if (event.key === 'F2') {
          event.preventDefault();
          setRenaming(true);
        }
      }}
      className={`relative grid size-[30px] place-items-center rounded-control border ${feature.suppressed ? 'border-dashed' : ''}`}
      style={{
        background: feature.suppressed
          ? 'transparent'
          : `color-mix(in srgb, var(--x-cat-${tool.category}) 16%, var(--x-bg))`,
        borderColor: problem
          ? `var(--x-${problem.status})`
          : `color-mix(in srgb, var(--x-cat-${tool.category}) 38%, transparent)`,
        opacity: rolledBack ? 0.38 : feature.suppressed ? 0.6 : 1,
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

function Marker() {
  return (
    <li className="relative mx-0.5 h-8 w-[3px] rounded-sm bg-accent before:absolute before:-top-1 before:-left-1 before:border-[5.5px] before:border-transparent before:border-t-accent">
      <span className="sr-only">Timeline marker</span>
    </li>
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
