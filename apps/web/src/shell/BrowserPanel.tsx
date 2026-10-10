import {
  type BodyId,
  bodyDisplay,
  CANVAS_TYPE,
  type Component,
  type ComponentId,
  type DocumentStore,
  type Feature,
  type FeatureId,
  type FeatureStatus,
  isConstructionType,
  isFeatureVisible,
  type JointId,
  type NamedView,
} from '@extrudo/core';
import {
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeDashed,
  EyeOff,
  FileDown,
  Move3d,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Settings2,
  TextCursorInput,
  Trash2,
  Video,
} from 'lucide-react';
import {
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import type { ComponentActions } from '../components/componentActions';
import { type ComponentRow, componentRows } from '../components/componentRows';
import type { PlacementActions } from '../components/placement';
import {
  ContextMenu,
  IconButton,
  MenuItem,
  MenuSeparator,
  MenuSub,
  Popover,
  TextInput,
  ToolIcon,
  Tooltip,
} from '../design-system';
import type { JointActions } from '../joints/jointActions';
import type { JointRow } from '../joints/jointRows';
import { PLANE_AXIS_COLOR, TOKENS } from '../viewport/colors';
import { ProgressCube } from '../viewport/ModelProgress';
import { activeFeatureCount } from '../viewport/progressRules';
import { ORIGIN_ITEMS, type OriginItem, type ViewportStore } from '../viewport/store';
import {
  BODY_COLORS,
  BODY_OPACITIES,
  type BodyActions,
  type BodyDisplay,
  type BodyEntry,
  bodiesEmptyState,
  bodyEyeLabel,
  isSwatch,
  nextBodyDisplay,
  parseBodyColor,
} from './bodies';
import { FeatureMenuItems, RenameField } from './FeatureMenu';
import type { FeatureActions } from './featureActions';
import { type FeatureProblem, featureProblem, StatusGlyph } from './featureStatus';
import type { ViewActions } from './namedViews';
import { toolForFeature } from './tools';

export const BROWSER_ID = 'browser-panel';

export interface BrowserPanelProps {
  store: DocumentStore;
  viewport: ViewportStore;
  width: number;
  collapsed: boolean;
  /** Slide open or closed (a toggle) rather than follow at once (a resize). */
  animate?: boolean;
  onToggle(): void;
  /** The sketch being edited, marked in the tree. */
  activeSketchId?: FeatureId;
  /** Edit, rename, show/hide, suppress, delete and hover (P1-12). */
  actions: FeatureActions;
  /** The model's bodies with their names (`bodyEntries`). */
  bodies: readonly BodyEntry[];
  /** Rename, show/hide, colour, opacity and remove bodies (P2-08). */
  bodyActions: BodyActions;
  /** Rename, show/hide, select and delete components (P6-05, ADR-0081 §6). */
  componentActions: ComponentActions;
  /**
   * Joints (P6-05 J1, ADR-0081 §6): each component lists the joints it moves after its bodies.
   * Absent: no joint rows (and no New Joint… in a component's menu).
   */
  joints?: {
    rows(component: ComponentId): JointRow[];
    actions: JointActions;
    /** The pointer on a joint's row (`undefined` when it leaves): the view draws its axis. */
    onHover(id: JointId | undefined): void;
  };
  /** The active and the isolated component (session state, P6-05 S4). */
  activeComponent?: ComponentId;
  isolatedComponent?: ComponentId;
  /** Move, copy and place a component as one (P6-05 S5, ADR-0081 §3). */
  placementActions?: PlacementActions;
  /** Bodies in the model selection: their rows show selected. */
  selectedBodies?: ReadonlySet<string>;
  /**
   * A click on a body's row: picks the body as the view would (the
   * session's selection, or an open feature dialog's field); `toggle`
   * with Shift, Ctrl or ⌘. Absent while bodies can't be picked (sketch mode).
   */
  onPickBody?(id: BodyId, toggle: boolean): void;
  /** The pointer on a body's row (`undefined` when it leaves): the view highlights the body. */
  onHoverBody?(id: BodyId | undefined): void;
  /**
   * The section analysis (P3-09), while there is one: an Analysis folder with its row. The eye
   * clips the view or not, a click opens the panel, the menu removes it.
   */
  section?: AnalysisEntry;
  /** The overhang analysis (P3-10), while there is one: a row in the same folder. */
  overhang?: AnalysisEntry;
  /** The wall-thickness check (P5-06), while there is one: a row in the same folder. */
  thickness?: AnalysisEntry;
  /** The kernel's verdict per feature: rows show ✕ or ⚠ as the timeline's chips do (P3-17). */
  statuses?: Readonly<Record<string, FeatureStatus | undefined>>;
  /** A recompute has finished since the page opened (default: yes). Until then an empty Bodies folder is "computing" (ADR-0078). */
  recomputeFinished?: boolean;
  /** Restore, update, rename and delete the named views (ADR-0008's amendment, 2026-10-10). */
  viewActions: ViewActions;
}

/** One row of the Analysis folder: a view analysis with its eye, its panel and its removal. */
export interface AnalysisEntry {
  label: string;
  on: boolean;
  /** The panel is open. */
  active: boolean;
  onToggle(): void;
  onEdit(): void;
  onRemove(): void;
}

/**
 * The browser (UI spec §2, FR-VP-07): document settings, views, origin,
 * sketches, construction and bodies. Built from the document; the eyes on
 * sketches and bodies are real, undoable visibility changes, and a folder's
 * eye shows or hides everything in it in one step. The origin's eyes are
 * viewport settings (P0-05), not document changes. A sketch opens with a
 * double-click or its pencil button (P1-01); F2 or its right-click menu
 * renames it, Delete deletes it, and the pointer on its row highlights it in
 * the view (P1-12). Bodies are the model's (P2-06): a body without stored
 * metadata gets it when its eye is first used.
 */
export function BrowserPanel({
  store,
  viewport,
  width,
  collapsed,
  animate = false,
  onToggle,
  activeSketchId,
  actions,
  bodies,
  bodyActions,
  componentActions,
  joints,
  activeComponent,
  isolatedComponent,
  placementActions,
  selectedBodies = NO_BODIES,
  onPickBody,
  onHoverBody,
  section,
  overhang,
  thickness,
  statuses = NO_STATUSES,
  recomputeFinished = true,
  viewActions,
}: BrowserPanelProps) {
  const doc = useStore(store, (s) => s.doc);
  const origin = useStore(viewport, (s) => s.origin);

  const sketches = doc.features
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => feature.type === 'sketch');
  const constructions = doc.features
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => isConstructionType(feature.type));
  const constructionShown = constructions.some(({ feature }) => isFeatureVisible(feature));
  const canvasFeatures = doc.features
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => feature.type === CANVAS_TYPE);
  const canvasShown = canvasFeatures.some(({ feature }) => isFeatureVisible(feature));
  const originShown = ORIGIN_ITEMS.some(({ value }) => origin[value]);
  const sketchesShown = sketches.some(({ feature }) => isFeatureVisible(feature));
  const bodiesShown = bodies.some(({ display }) => display === 'shown');
  const grouped = componentRows(doc, bodies);
  const components = doc.components ?? [];

  // The panel floats over the view's left edge in frosted glass (like the nav bar), so the
  // view never resizes. Collapsed, it slides out to the left, then turns invisible
  // (visibility switches at the end of the transition when hiding), and a small tab at the
  // view's left edge brings it back.
  const motion = 'duration-(--x-normal) ease-ui';
  return (
    <>
      <aside
        id={BROWSER_ID}
        aria-label="Browser"
        inert={collapsed}
        style={{ width, background: 'color-mix(in srgb, var(--x-panel) 85%, transparent)' }}
        className={`pointer-events-auto flex shrink-0 overflow-hidden backdrop-blur-[6px] ${collapsed ? 'invisible -translate-x-full' : ''} ${animate ? `transition-[translate,visibility] ${motion}` : ''}`}
      >
        <div style={{ width }} className="flex shrink-0 flex-col">
          <div className="flex h-9 items-center justify-between pr-1 pl-3">
            <h2 className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">
              Browser
            </h2>
            <IconButton label="Hide browser" onClick={onToggle}>
              <PanelLeftClose size={16} strokeWidth={1.75} />
            </IconButton>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 text-base">
            <Folder label="Document settings" icon={<Settings2 size={14} />} defaultOpen={false}>
              <Leaf>
                Units{' '}
                <span className="ml-auto font-mono text-field text-muted">
                  {doc.settings.units}
                </span>
              </Leaf>
            </Folder>
            <Folder label="Named views" icon={<Video size={14} />} defaultOpen={false}>
              {doc.views.length === 0 ? (
                <Leaf muted>No named views yet</Leaf>
              ) : (
                doc.views.map((view) => (
                  <ViewLeaf key={view.id} view={view} actions={viewActions} />
                ))
              )}
            </Folder>
            <Folder
              label="Origin"
              icon={<ToolIcon name="axis" category="construct" size={16} />}
              eye={{
                visible: originShown,
                onToggle: () => {
                  for (const { value } of ORIGIN_ITEMS)
                    viewport.getState().setOrigin(value, !originShown);
                },
              }}
            >
              {ORIGIN_ITEMS.map(({ value, label }) => (
                <ContextMenu
                  key={value}
                  label={`${label} menu`}
                  trigger={
                    <Leaf>
                      {PLANE_SWATCH[value] && (
                        <span
                          aria-hidden
                          data-plane-swatch={value}
                          className="size-2.5 shrink-0 rounded-sm"
                          style={{ background: `var(${PLANE_SWATCH[value]})` }}
                        />
                      )}
                      <span className={origin[value] ? '' : 'text-muted'}>{label}</span>
                      <EyeToggle
                        name={label}
                        visible={origin[value]}
                        onToggle={() => viewport.getState().setOrigin(value, !origin[value])}
                      />
                    </Leaf>
                  }
                >
                  <MenuItem
                    icon={origin[value] ? <EyeOff size={14} /> : <Eye size={14} />}
                    onSelect={() => viewport.getState().setOrigin(value, !origin[value])}
                  >
                    {origin[value] ? 'Hide' : 'Show'}
                  </MenuItem>
                </ContextMenu>
              ))}
            </Folder>
            <Folder
              label="Sketches"
              icon={<ToolIcon name="create-sketch" category="sketch" size={16} />}
              eye={
                sketches.length > 0
                  ? {
                      visible: sketchesShown,
                      onToggle: () =>
                        actions.setVisible(
                          sketches.map(({ feature }) => feature.id),
                          !sketchesShown,
                        ),
                    }
                  : undefined
              }
            >
              {sketches.length === 0 ? (
                <Leaf muted>No sketches yet</Leaf>
              ) : (
                sketches.map(({ feature, index }) => (
                  <SketchLeaf
                    key={feature.id}
                    feature={feature}
                    editable={actions.canEdit(feature, index, doc.timelineMarker)}
                    rolledBack={index >= doc.timelineMarker}
                    problem={featureProblem(feature, index, doc.timelineMarker, statuses)}
                    position={{ index, marker: doc.timelineMarker, count: doc.features.length }}
                    active={feature.id === activeSketchId}
                    actions={actions}
                  />
                ))
              )}
            </Folder>
            <Folder
              label="Construction"
              icon={<ToolIcon name="offset-plane" category="construct" size={16} />}
              eye={
                constructions.length > 0
                  ? {
                      visible: constructionShown,
                      onToggle: () =>
                        actions.setVisible(
                          constructions.map(({ feature }) => feature.id),
                          !constructionShown,
                        ),
                    }
                  : undefined
              }
            >
              {constructions.length === 0 ? (
                <Leaf muted>No construction geometry yet</Leaf>
              ) : (
                constructions.map(({ feature, index }) => (
                  <SketchLeaf
                    key={feature.id}
                    feature={feature}
                    editable={actions.canEdit(feature, index, doc.timelineMarker)}
                    rolledBack={index >= doc.timelineMarker}
                    problem={featureProblem(feature, index, doc.timelineMarker, statuses)}
                    position={{ index, marker: doc.timelineMarker, count: doc.features.length }}
                    active={false}
                    actions={actions}
                    rowAttribute={{ 'data-construction': feature.id }}
                    icon={
                      <ToolIcon
                        name={toolForFeature(feature.type).icon}
                        category="construct"
                        size={14}
                      />
                    }
                  />
                ))
              )}
            </Folder>
            {/* The Canvases folder while there is one (P4-06, ADR-0066 §5), as
                the Analysis folder below: a design with no picture has nothing to
                show there. */}
            {canvasFeatures.length > 0 && (
              <Folder
                label="Canvases"
                icon={<ToolIcon name="canvas" category="insert" size={16} />}
                eye={{
                  visible: canvasShown,
                  onToggle: () =>
                    actions.setVisible(
                      canvasFeatures.map(({ feature }) => feature.id),
                      !canvasShown,
                    ),
                }}
              >
                {canvasFeatures.map(({ feature, index }) => (
                  <SketchLeaf
                    key={feature.id}
                    feature={feature}
                    editable={actions.canEdit(feature, index, doc.timelineMarker)}
                    rolledBack={index >= doc.timelineMarker}
                    problem={featureProblem(feature, index, doc.timelineMarker, statuses)}
                    position={{ index, marker: doc.timelineMarker, count: doc.features.length }}
                    active={false}
                    actions={actions}
                    rowAttribute={{ 'data-canvas': feature.id }}
                    icon={
                      <ToolIcon
                        name={toolForFeature(feature.type).icon}
                        category="insert"
                        size={14}
                      />
                    }
                  />
                ))}
              </Folder>
            )}
            {(section || overhang || thickness) && (
              <Folder
                label="Analysis"
                icon={<ToolIcon name="section" category="inspect" size={16} />}
                eye={{
                  visible: Boolean(section?.on || overhang?.on || thickness?.on),
                  onToggle: () => {
                    const on = Boolean(section?.on || overhang?.on || thickness?.on);
                    for (const entry of [section, overhang, thickness]) {
                      if (entry && entry.on === on) entry.onToggle();
                    }
                  },
                }}
              >
                {section && (
                  <AnalysisRow
                    name="section"
                    entry={section}
                    rowAttribute={{ 'data-section-row': section.on ? 'on' : 'off' }}
                  />
                )}
                {overhang && (
                  <AnalysisRow
                    name="overhang"
                    entry={overhang}
                    rowAttribute={{ 'data-overhang-row': overhang.on ? 'on' : 'off' }}
                  />
                )}
                {thickness && (
                  <AnalysisRow
                    name="wall thickness"
                    entry={thickness}
                    rowAttribute={{ 'data-thickness-row': thickness.on ? 'on' : 'off' }}
                  />
                )}
              </Folder>
            )}
            <Folder
              label="Bodies"
              icon={<Box size={14} />}
              count={bodies.length}
              dropTarget={{
                name: 'bodies',
                onDrop: (ids) => bodyActions.moveToComponent(ids, null),
              }}
              menu={
                bodies.length > 0 && bodyActions.exportBodies ? (
                  <MenuItem
                    icon={<FileDown size={14} />}
                    onSelect={() => bodyActions.exportBodies?.(bodies.map((b) => b.id))}
                  >
                    Export all bodies…
                  </MenuItem>
                ) : undefined
              }
              eye={
                bodies.length > 0
                  ? {
                      visible: bodiesShown,
                      onToggle: () =>
                        bodyActions.setVisible(
                          bodies.map((b) => b.id),
                          !bodiesShown,
                        ),
                    }
                  : undefined
              }
            >
              {bodies.length === 0 && components.length === 0 ? (
                bodiesEmptyState({
                  listed: bodies.length,
                  finished: recomputeFinished,
                  activeFeatures: activeFeatureCount(doc),
                }) === 'computing' ? (
                  <Leaf muted>
                    <span
                      data-bodies-computing
                      aria-busy="true"
                      className="inline-flex items-center gap-1.5"
                    >
                      <ProgressCube size={12} />
                      Computing bodies…
                    </span>
                  </Leaf>
                ) : (
                  <Leaf muted>No bodies yet</Leaf>
                )
              ) : (
                <>
                  {grouped.rows.map((row) => (
                    <ComponentFolder
                      key={row.component.id}
                      row={row}
                      actions={componentActions}
                      active={row.component.id === activeComponent}
                      isolated={isolatedComponent}
                      placement={placementActions}
                      bodyActions={bodyActions}
                      {...(joints && { joints })}
                      renderBody={(body) => (
                        <BodyLeaf
                          key={body.id}
                          body={body}
                          selected={selectedBodies.has(body.id)}
                          selection={selectedBodies}
                          actions={bodyActions}
                          components={components}
                          onPick={onPickBody}
                          onHover={onHoverBody}
                        />
                      )}
                    />
                  ))}
                  {grouped.loose.map((body) =>
                    body.pending ? (
                      <PendingBodyLeaf key={body.id} body={body} actions={bodyActions} />
                    ) : (
                      <BodyLeaf
                        key={body.id}
                        body={body}
                        selected={selectedBodies.has(body.id)}
                        selection={selectedBodies}
                        actions={bodyActions}
                        components={components}
                        onPick={onPickBody}
                        onHover={onHoverBody}
                      />
                    ),
                  )}
                </>
              )}
            </Folder>
          </ul>
        </div>
      </aside>
      <div
        inert={!collapsed}
        className={`pointer-events-auto absolute top-2 left-0 z-20 transition-[opacity,translate,visibility] ${motion} ${collapsed ? '' : 'invisible -translate-x-full opacity-0'}`}
      >
        <IconButton
          label="Show browser"
          aria-controls={BROWSER_ID}
          aria-expanded={false}
          onClick={onToggle}
          className="rounded-l-none border border-l-0 border-line bg-panel shadow-raised"
        >
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
    </>
  );
}

function SketchLeaf({
  feature,
  editable,
  rolledBack,
  problem,
  position,
  active,
  actions,
  icon,
  rowAttribute,
}: {
  feature: Feature;
  editable: boolean;
  rolledBack: boolean;
  /** The kernel's warning or error, shown as on a timeline chip (P3-17). */
  problem?: FeatureProblem;
  position: { index: number; marker: number; count: number };
  active: boolean;
  actions: FeatureActions;
  /** A small icon before the name (construction and canvas rows, P3-05, P4-06). */
  icon?: ReactNode;
  /** A hook for the test to find this row (`data-construction`, `data-canvas`). */
  rowAttribute?: Record<string, string>;
}) {
  const [renaming, setRenaming] = useState(false);
  const visible = isFeatureVisible(feature);
  const states = [
    active && 'editing',
    rolledBack && 'rolled back',
    feature.suppressed && 'suppressed',
    problem && (problem.message ? `${problem.status}: ${problem.message}` : problem.status),
  ].filter(Boolean);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'F2') setRenaming(true);
    else if (event.key === 'Delete' || event.key === 'Backspace') actions.remove(feature.id);
    else if (event.key === 'Enter' && editable) actions.edit(feature.id);
    else return;
    // Handled here: not a shortcut for the view as well.
    event.preventDefault();
  };
  return (
    <ContextMenu
      label={`${feature.name} menu`}
      disabled={renaming}
      trigger={
        <Leaf
          active={active}
          {...rowAttribute}
          data-feature-row={feature.id}
          data-feature-status={problem?.status}
          onDoubleClick={editable && !renaming ? () => actions.edit(feature.id) : undefined}
          onPointerEnter={() => actions.hover(feature.id)}
          onPointerLeave={() => actions.hover(undefined)}
        >
          {icon && <span className="-ml-5 grid w-4 place-items-center">{icon}</span>}
          {renaming ? (
            <RenameField
              name={feature.name}
              label={`Rename ${feature.name}`}
              className="h-6 min-w-0 flex-1 px-1"
              onCommit={(name) => actions.rename(feature.id, name)}
              onDone={() => setRenaming(false)}
            />
          ) : (
            <button
              type="button"
              onKeyDown={onKeyDown}
              aria-description={states.join(', ') || undefined}
              className={`min-w-0 truncate rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent ${
                visible && !rolledBack && !feature.suppressed ? '' : 'text-muted'
              } ${feature.suppressed ? 'line-through' : ''}`}
            >
              {feature.name}
            </button>
          )}
          {active && <span className="text-xs text-muted">editing</span>}
          {problem && !renaming && (
            <Tooltip
              label={problem.status === 'error' ? 'Error' : 'Warning'}
              hint={problem.message}
              side="right"
            >
              <span className="grid size-5 shrink-0 place-items-center">
                <StatusGlyph status={problem.status} />
              </span>
            </Tooltip>
          )}
          {!renaming && (
            <span className="ml-auto flex items-center">
              {editable && !active && (
                <IconButton
                  label={`Edit ${feature.name}`}
                  className="size-6"
                  onClick={() => actions.edit(feature.id)}
                >
                  <Pencil size={13} />
                </IconButton>
              )}
              <EyeToggle
                name={feature.name}
                visible={visible}
                onToggle={() => actions.setVisible([feature.id], !visible)}
              />
            </span>
          )}
        </Leaf>
      }
    >
      <FeatureMenuItems
        feature={feature}
        editable={editable && !active}
        actions={actions}
        onRename={() => setRenaming(true)}
        position={position}
      />
    </ContextMenu>
  );
}

const NO_BODIES: ReadonlySet<string> = new Set();
const NO_STATUSES: Readonly<Record<string, FeatureStatus | undefined>> = {};

/**
 * A body in the browser (P2-08, ADR-0030): a click picks it like the view
 * does, the pointer on it highlights it, F2 or Rename renames it, the eye
 * hides it, Appearance sets its colour and opacity, Delete removes it (the
 * selected bodies, when it is one of them) through a Remove feature.
 */
/**
 * A body the last session made, listed before the kernel has computed it
 * (ADR-0078): the name and colour from the document, the eye (a document
 * command), and a small cube where the badge would be. No selection, menu or
 * appearance until the recompute replaces the row.
 */
function PendingBodyLeaf({ body, actions }: { body: BodyEntry; actions: BodyActions }) {
  const { id, meta } = body;
  return (
    <Leaf data-body={id} data-body-pending aria-busy="true">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-full border border-line"
        style={{
          background: meta.color ?? 'var(--x-body-default)',
          opacity: Math.max(meta.opacity ?? 1, 0.35),
        }}
      />
      <span className="min-w-0 truncate text-muted">{meta.name}</span>
      <ProgressCube size={12} />
      <EyeToggle
        name={meta.name}
        visible={meta.visible}
        onToggle={() => actions.setVisible([id], !meta.visible)}
      />
    </Leaf>
  );
}

/**
 * A named view's row (ADR-0008's amendment, 2026-10-10): a click restores the
 * saved camera (an animated move, not a command), F2 or Rename renames it,
 * Update to Current View overwrites its camera, Delete removes it.
 */
function ViewLeaf({ view, actions }: { view: NamedView; actions: ViewActions }) {
  const [renaming, setRenaming] = useState(false);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'F2') setRenaming(true);
    else if (event.key === 'Delete' || event.key === 'Backspace') actions.remove(view.id);
    else if (event.key === 'Enter') actions.restore(view.id);
    else return;
    // Handled here: not a shortcut for the view as well.
    event.preventDefault();
  };
  return (
    <ContextMenu
      label={`${view.name} menu`}
      disabled={renaming}
      trigger={
        <Leaf data-view={view.id}>
          {renaming ? (
            <RenameField
              name={view.name}
              label={`Rename ${view.name}`}
              className="h-6 min-w-0 flex-1 px-1"
              onCommit={(name) => actions.rename(view.id, name)}
              onDone={() => setRenaming(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => actions.restore(view.id)}
              onKeyDown={onKeyDown}
              className="min-w-0 truncate rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent"
            >
              {view.name}
            </button>
          )}
        </Leaf>
      }
    >
      <MenuItem onSelect={() => actions.restore(view.id)}>Restore</MenuItem>
      <MenuItem onSelect={() => actions.update(view.id)}>Update to Current View</MenuItem>
      <MenuItem icon={<Pencil size={14} />} shortcut="F2" onSelect={() => setRenaming(true)}>
        Rename
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 size={14} />} shortcut="Del" onSelect={() => actions.remove(view.id)}>
        Delete
      </MenuItem>
    </ContextMenu>
  );
}

function BodyLeaf({
  body,
  selected,
  selection,
  actions,
  components,
  onPick,
  onHover,
}: {
  body: BodyEntry;
  selected: boolean;
  selection: ReadonlySet<string>;
  actions: BodyActions;
  /** The design's components, for the menu's "Move to Component". */
  components: readonly Component[];
  onPick?(id: BodyId, toggle: boolean): void;
  onHover?(id: BodyId | undefined): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [appearance, setAppearance] = useState(false);
  const { id, meta } = body;
  // The eye acts on the body's own state; the row shows what is drawn (a component's
  // hidden or ghost state wins, ADR-0081 §6).
  const own = bodyDisplay(meta);
  const display = body.display;
  const dragIds = () => (selected && selection.size > 1 ? ([...selection] as BodyId[]) : [id]);
  const remove = () =>
    actions.remove(selected && selection.size > 1 ? ([...selection] as BodyId[]) : [id]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'F2') setRenaming(true);
    else if (event.key === 'Delete' || event.key === 'Backspace') remove();
    else return;
    // Handled here: not a shortcut for the view as well.
    event.preventDefault();
    event.stopPropagation();
  };
  const onClick = (event: MouseEvent) =>
    onPick?.(id, event.shiftKey || event.ctrlKey || event.metaKey);
  const row = (
    <Leaf
      data-body={id}
      data-body-display={display}
      data-body-component={body.component}
      draggable
      onDragStart={(event: DragEvent) => {
        event.dataTransfer?.setData(BODIES_MIME, JSON.stringify(dragIds()));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      }}
      // Selection is the name button's aria-pressed: a list item takes no aria-selected (axe).
      data-selected={selected || undefined}
      // A mesh body (P4-06, ADR-0066 §3) says so, next to its "Mesh" tag.
      data-body-mesh={body.mesh || undefined}
      className={selected ? 'bg-accent-soft' : ''}
      onPointerEnter={() => onHover?.(id)}
      onPointerLeave={() => onHover?.(undefined)}
    >
      <Popover
        anchorOnly
        open={appearance}
        onOpenChange={setAppearance}
        side="right"
        label={`${meta.name} appearance`}
        trigger={
          // The popover sits on the colour dot; a plain element takes its anchor ref.
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full border border-line"
            style={{
              background: meta.color ?? 'var(--x-body-default)',
              opacity: Math.max(meta.opacity ?? 1, 0.35),
            }}
          />
        }
      >
        <AppearancePanel body={body} actions={actions} />
      </Popover>
      {renaming ? (
        <RenameField
          name={meta.name}
          label={`Rename ${meta.name}`}
          className="h-6 min-w-0 flex-1 px-1"
          onCommit={(name) => actions.rename(id, name)}
          onDone={() => setRenaming(false)}
        />
      ) : (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onClick}
          onKeyDown={onKeyDown}
          className={`min-w-0 truncate rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent ${display === 'shown' ? '' : 'text-muted'}`}
        >
          {meta.name}
        </button>
      )}
      {body.mesh && (
        <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-xs text-muted">Mesh</span>
      )}
      {!renaming && (
        <BodyEyeToggle
          name={meta.name}
          display={own}
          onToggle={() => actions.setDisplay([id], nextBodyDisplay(own))}
        />
      )}
    </Leaf>
  );
  return (
    <ContextMenu label={`${meta.name} menu`} disabled={renaming} trigger={row}>
      <MenuItem
        icon={<TextCursorInput size={14} />}
        shortcut="F2"
        onSelect={() => setRenaming(true)}
      >
        Rename
      </MenuItem>
      {own !== 'shown' && (
        <MenuItem icon={<Eye size={14} />} onSelect={() => actions.setDisplay([id], 'shown')}>
          Show Body
        </MenuItem>
      )}
      {own !== 'ghost' && (
        <MenuItem icon={<EyeDashed size={14} />} onSelect={() => actions.setDisplay([id], 'ghost')}>
          Show as Ghost
        </MenuItem>
      )}
      {own !== 'hidden' && (
        <MenuItem icon={<EyeOff size={14} />} onSelect={() => actions.setDisplay([id], 'hidden')}>
          Hide Body
        </MenuItem>
      )}
      <MenuItem icon={<Palette size={14} />} onSelect={() => setAppearance(true)}>
        Appearance…
      </MenuItem>
      <MenuSub label="Move to Component" icon={<Boxes size={14} />}>
        {components
          .filter((c) => c.id !== body.component)
          .map((c) => (
            <MenuItem key={c.id} onSelect={() => actions.moveToComponent(dragIds(), c.id)}>
              {c.name}
            </MenuItem>
          ))}
        <MenuItem onSelect={() => actions.newComponent(dragIds())}>New Component…</MenuItem>
        {body.component !== undefined && (
          <MenuItem onSelect={() => actions.moveToComponent(dragIds(), null)}>
            No Component
          </MenuItem>
        )}
      </MenuSub>
      {actions.exportBodies && (
        <MenuItem
          icon={<FileDown size={14} />}
          onSelect={() =>
            actions.exportBodies?.(
              selected && selection.size > 1 ? ([...selection] as BodyId[]) : [id],
            )
          }
        >
          Export…
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<Trash2 size={14} />} shortcut="Del" onSelect={remove}>
        Delete
      </MenuItem>
    </ContextMenu>
  );
}

/**
 * Any colour beside the swatches (P3-17): the system colour picker, which commits when it
 * closes (one undo step, not one per drag), and the hex code, committed by Enter or leaving
 * the field. Marked while the body's colour is none of the swatches.
 */
function CustomColor({
  color,
  onPick,
}: {
  color: string | undefined;
  onPick(color: string): void;
}) {
  const custom = color !== undefined && !isSwatch(color);
  const [draft, setDraft] = useState<string>();
  const picker = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  // React's onChange on a colour input fires on every move of the picker; the native `change`
  // fires once, when the choice is made.
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const onChange = () => {
      const value = parseBodyColor(el.value);
      if (value) pick.current(value);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);
  const text = draft ?? (custom ? color : '');
  const parsed = draft === undefined ? undefined : parseBodyColor(draft);
  const commit = () => {
    if (draft === undefined) return;
    if (parsed && parsed !== color) onPick(parsed);
    if (parsed || draft.trim() === '') setDraft(undefined);
  };
  return (
    <div className="col-span-5 mt-1 flex items-center gap-2">
      <label
        title="Custom colour"
        className={`relative grid size-8 shrink-0 place-items-center rounded-input border ${custom ? 'border-accent outline-2 outline-accent' : 'border-line'}`}
      >
        <input
          ref={picker}
          type="color"
          aria-label="Custom colour"
          data-custom-colour={custom || undefined}
          defaultValue={color ?? '#8c93a3'}
          key={color ?? 'default'}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
        <span
          className="pointer-events-none size-5 rounded-full border border-line"
          style={{
            background: custom
              ? color
              : 'conic-gradient(#ff7a66, #f2b21b, #2fbf8f, #22b3c2, #5b7cff, #f0609a, #ff7a66)',
          }}
        />
      </label>
      <TextInput
        aria-label="Hex colour"
        placeholder="#rrggbb"
        spellCheck={false}
        value={text}
        aria-invalid={draft !== undefined && draft.trim() !== '' && !parsed ? true : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape' && draft !== undefined) {
            event.stopPropagation();
            setDraft(undefined);
          }
        }}
        className="min-w-0 flex-1 font-mono"
      />
    </div>
  );
}

/** Colour swatches and opacity presets (ADR-0030); each choice is one undo step. */
export function AppearancePanel({ body, actions }: { body: BodyEntry; actions: BodyActions }) {
  const { id, meta } = body;
  const opacity = meta.opacity ?? 1;
  const group = `appearance-${id}`;
  return (
    <div className="flex w-56 flex-col gap-3">
      <fieldset className="grid grid-cols-5 gap-1.5">
        <legend className="mb-1.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
          Colour
        </legend>
        {BODY_COLORS.map(({ value, label }) => (
          <label key={label} title={label} className="relative grid h-8 place-items-center">
            <input
              type="radio"
              name={`${group}-colour`}
              aria-label={label}
              checked={meta.color === value}
              onChange={() => actions.setColor(id, value)}
              className="peer absolute inset-0 cursor-pointer appearance-none rounded-input border border-line checked:border-accent checked:outline-2 checked:outline-accent focus-visible:outline-2 focus-visible:outline-accent"
            />
            <span
              className="pointer-events-none size-5 rounded-full border border-line"
              style={{ background: value ?? 'var(--x-body-default)' }}
            />
          </label>
        ))}
        <CustomColor color={meta.color} onPick={(color) => actions.setColor(id, color)} />
      </fieldset>
      <fieldset className="grid grid-cols-4 gap-1">
        <legend className="mb-1.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
          Opacity
        </legend>
        {BODY_OPACITIES.map(({ value, label }) => (
          <label key={label} className="relative grid h-7 place-items-center text-xs">
            <input
              type="radio"
              name={`${group}-opacity`}
              checked={opacity === value}
              onChange={() => actions.setOpacity(id, value)}
              className="peer absolute inset-0 cursor-pointer appearance-none rounded-input border border-line checked:border-accent checked:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
            />
            <span className="pointer-events-none relative">{label}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

function EyeToggle({
  name,
  visible,
  onToggle,
}: {
  name: string;
  visible: boolean;
  onToggle(): void;
}) {
  return (
    <IconButton
      label={`${visible ? 'Hide' : 'Show'} ${name}`}
      className="ml-auto size-6"
      onClick={onToggle}
    >
      {visible ? <Eye size={14} /> : <EyeOff size={14} />}
    </IconButton>
  );
}

/**
 * A body row's eye (ADR-0030's amendment): it cycles shown → ghost → hidden →
 * shown, and its label says what the click does next. The icon is `Eye` while
 * shown, `EyeDashed` while a ghost and `EyeOff` while hidden.
 */
function BodyEyeToggle({
  name,
  display,
  onToggle,
}: {
  name: string;
  display: BodyDisplay;
  onToggle(): void;
}) {
  return (
    <IconButton
      label={`${bodyEyeLabel(display)} ${name}`}
      className="ml-auto size-6"
      onClick={onToggle}
    >
      {display === 'shown' ? (
        <Eye size={14} />
      ) : display === 'ghost' ? (
        <EyeDashed size={14} />
      ) : (
        <EyeOff size={14} />
      )}
    </IconButton>
  );
}

/** What a body row drag carries: a JSON list of body IDs (P6-05 S3). */
const BODIES_MIME = 'application/x-extrudo-bodies';

/** A component in the Bodies folder (ADR-0081 §6): a nested folder of its live bodies. */
function ComponentFolder({
  row,
  actions,
  active,
  isolated,
  placement,
  bodyActions,
  joints,
  renderBody,
}: {
  row: ComponentRow;
  actions: ComponentActions;
  active: boolean;
  isolated: ComponentId | undefined;
  placement?: PlacementActions;
  bodyActions: BodyActions;
  joints?: BrowserPanelProps['joints'];
  renderBody(body: BodyEntry): ReactNode;
}) {
  const { component, bodies, display } = row;
  const id = component.id;
  const jointRows = joints?.rows(id) ?? [];
  return (
    <Folder
      label={component.name}
      icon={<Boxes size={14} />}
      count={bodies.length}
      nested
      attrs={{
        'data-component': id,
        'data-component-display': display,
        'data-component-active': active ? '' : undefined,
        'data-isolated-out': isolated !== undefined && isolated !== id ? '' : undefined,
      }}
      marker={active}
      dimmed={isolated !== undefined && isolated !== id}
      dropTarget={{
        name: `component:${id}`,
        onDrop: (ids) => bodyActions.moveToComponent(ids, id),
      }}
      rename={{ onCommit: (name) => actions.rename(id, name) }}
      onSelect={(mode) => actions.select(id, mode)}
      displayEye={{
        display,
        onToggle: () => actions.setDisplay([id], nextBodyDisplay(display)),
      }}
      menu={
        <>
          {display !== 'shown' && (
            <MenuItem icon={<Eye size={14} />} onSelect={() => actions.setDisplay([id], 'shown')}>
              Show Component
            </MenuItem>
          )}
          {display !== 'ghost' && (
            <MenuItem
              icon={<EyeDashed size={14} />}
              onSelect={() => actions.setDisplay([id], 'ghost')}
            >
              Show as Ghost
            </MenuItem>
          )}
          {display !== 'hidden' && (
            <MenuItem
              icon={<EyeOff size={14} />}
              onSelect={() => actions.setDisplay([id], 'hidden')}
            >
              Hide Component
            </MenuItem>
          )}
          {joints && (
            <>
              <MenuSeparator />
              <MenuItem
                icon={<ToolIcon name="joint-revolute" category="construct" size={14} />}
                onSelect={() => joints.actions.start()}
              >
                New Joint…
              </MenuItem>
            </>
          )}
          <MenuSeparator />
          {active ? (
            <MenuItem onSelect={() => actions.activate(undefined)}>Deactivate</MenuItem>
          ) : (
            <MenuItem onSelect={() => actions.activate(id)}>Activate</MenuItem>
          )}
          {isolated === id ? (
            <MenuItem onSelect={() => actions.isolate(undefined)}>Exit Isolation</MenuItem>
          ) : (
            <MenuItem onSelect={() => actions.isolate(id)}>Isolate</MenuItem>
          )}
          <MenuSeparator />
          {placement && bodies.length > 0 && (
            <>
              <MenuItem icon={<Move3d size={14} />} onSelect={() => placement.move(id)}>
                Move Component
              </MenuItem>
              <MenuItem icon={<Copy size={14} />} onSelect={() => placement.copy(id)}>
                Copy Component
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          {bodyActions.exportBodies && bodies.length > 0 && (
            <MenuItem
              icon={<FileDown size={14} />}
              onSelect={() => bodyActions.exportBodies?.(bodies.map((b) => b.id))}
            >
              Export Component…
            </MenuItem>
          )}
          <MenuItem icon={<Trash2 size={14} />} onSelect={() => actions.remove(id)}>
            Delete Component
          </MenuItem>
        </>
      }
    >
      {bodies.length === 0 ? <Leaf muted>No bodies</Leaf> : bodies.map((body) => renderBody(body))}
      {joints &&
        jointRows.map((jointRow) => (
          <JointLeaf
            key={jointRow.joint.id}
            row={jointRow}
            actions={joints.actions}
            onHover={joints.onHover}
          />
        ))}
    </Folder>
  );
}

const JOINT_ICONS = {
  rigid: 'joint-rigid',
  revolute: 'joint-revolute',
  slider: 'joint-slider',
} as const;

/**
 * A joint in its moving component's folder (P6-05 J1, ADR-0081 §6): the type's icon, the name
 * (F2 renames, double-click or Enter edits, Delete deletes), the kernel's ✕ or ⚠ with its message,
 * and a menu: Edit, Rename, Suppress, Fix References / Keep Closest Match, Delete Joint. The
 * pointer on it draws its axis in the view.
 */
function JointLeaf({
  row,
  actions,
  onHover,
}: {
  row: JointRow;
  actions: JointActions;
  onHover(id: JointId | undefined): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const { joint, status, message, refs } = row;
  const suppressed = joint.suppressed === true;
  const problem = status === 'error' || status === 'warning' ? status : undefined;
  const fixable = (refs?.length ?? 0) > 0;
  const guessed = refs?.some((r) => r.state === 'guessed' && r.now) ?? false;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'F2') setRenaming(true);
    else if (event.key === 'Delete' || event.key === 'Backspace') actions.remove([joint.id]);
    else if (event.key === 'Enter') actions.edit(joint.id);
    else return;
    event.preventDefault();
  };
  const states = [
    suppressed && 'suppressed',
    status === 'inactive' && 'rolled back',
    problem && (message ? `${problem}: ${message}` : problem),
  ].filter(Boolean);
  return (
    <ContextMenu
      label={`${joint.name} menu`}
      disabled={renaming}
      trigger={
        <Leaf
          data-joint={joint.id}
          data-joint-type={joint.type}
          data-joint-status={suppressed ? undefined : status}
          data-joint-suppressed={suppressed || undefined}
          onDoubleClick={renaming ? undefined : () => actions.edit(joint.id)}
          onPointerEnter={() => onHover(joint.id)}
          onPointerLeave={() => onHover(undefined)}
        >
          <span className="-ml-5 grid w-4 place-items-center">
            <ToolIcon name={JOINT_ICONS[joint.type]} category="construct" size={14} />
          </span>
          {renaming ? (
            <RenameField
              name={joint.name}
              label={`Rename ${joint.name}`}
              className="h-6 min-w-0 flex-1 px-1"
              onCommit={(name) => actions.rename(joint.id, name)}
              onDone={() => setRenaming(false)}
            />
          ) : (
            <button
              type="button"
              onKeyDown={onKeyDown}
              aria-description={states.join(', ') || undefined}
              className={`min-w-0 truncate rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent ${
                suppressed || status === 'inactive' ? 'text-muted' : ''
              } ${suppressed ? 'line-through' : ''}`}
            >
              {joint.name}
            </button>
          )}
          {problem && !renaming && (
            <Tooltip label={problem === 'error' ? 'Error' : 'Warning'} hint={message} side="right">
              <span className="grid size-5 shrink-0 place-items-center">
                <StatusGlyph status={problem} />
              </span>
            </Tooltip>
          )}
          {!renaming && (
            <span className="ml-auto flex items-center">
              <IconButton
                label={`Edit ${joint.name}`}
                className="size-6"
                onClick={() => actions.edit(joint.id)}
              >
                <Pencil size={13} />
              </IconButton>
            </span>
          )}
        </Leaf>
      }
    >
      <MenuItem icon={<Pencil size={14} />} onSelect={() => actions.edit(joint.id)}>
        Edit
      </MenuItem>
      <MenuItem
        icon={<TextCursorInput size={14} />}
        shortcut="F2"
        onSelect={() => setRenaming(true)}
      >
        Rename
      </MenuItem>
      {actions.pose && joint.type !== 'rigid' && !suppressed && (
        <MenuItem onSelect={() => actions.pose?.(joint.id)}>Pose…</MenuItem>
      )}
      <MenuItem onSelect={() => actions.setSuppressed([joint.id], !suppressed)}>
        {suppressed ? 'Unsuppress' : 'Suppress'}
      </MenuItem>
      {fixable && (
        <MenuItem onSelect={() => actions.edit(joint.id, { fix: refs ?? [] })}>
          Fix References
        </MenuItem>
      )}
      {guessed && (
        <MenuItem onSelect={() => actions.keepClosestMatch(joint.id)}>Keep Closest Match</MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<Trash2 size={14} />} onSelect={() => actions.remove([joint.id])}>
        Delete Joint
      </MenuItem>
    </ContextMenu>
  );
}

function Folder({
  label,
  icon,
  defaultOpen = true,
  eye,
  displayEye,
  count,
  menu,
  nested,
  attrs,
  marker,
  dimmed,
  dropTarget,
  rename,
  onSelect,
  children,
}: {
  /** Listed inside another folder: one level deeper. */
  nested?: boolean;
  /** Extra `data-*` attributes on the row's `li`. */
  attrs?: Record<`data-${string}`, string | undefined>;
  /** A filled dot before the label: the active component. */
  marker?: boolean;
  /** Drawn at half opacity (another component is isolated). */
  dimmed?: boolean;
  /** Body rows dragged onto the folder's header arrive here with their IDs. */
  dropTarget?: { name: string; onDrop(ids: BodyId[]): void };
  /** A three-state eye (shown, ghost, hidden) instead of `eye`'s two. */
  displayEye?: { display: BodyDisplay; onToggle(): void };
  /** The label renames in place (F2, double-click, or the menu's Rename). */
  rename?: { onCommit(name: string): boolean };
  /** A click on the label selects what is in the folder (`Shift` adds); the chevron toggles. */
  onSelect?(mode: 'replace' | 'add'): void;
  label: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  /** A count badge after the label (the Bodies folder, P2-08). */
  count?: number;
  /** A folder eye: shows everything in it when all is hidden, else hides it all. */
  eye?: { visible: boolean; onToggle(): void };
  /**
   * More items for the folder row's right-click menu (P3-11), after the ones every folder has
   * (Expand or Collapse, and Show or Hide all when there is an eye).
   */
  menu?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [renaming, setRenaming] = useState(false);
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) =>
    dropTarget !== undefined && event.dataTransfer?.types.includes(BODIES_MIME) === true;
  const labelNode =
    renaming && rename ? (
      <RenameField
        name={label}
        label={`Rename ${label}`}
        className="h-6 min-w-0 flex-1 px-1"
        onCommit={rename.onCommit}
        onDone={() => setRenaming(false)}
      />
    ) : null;
  const onLabelKey = (event: KeyboardEvent) => {
    if (event.key === 'F2' && rename) {
      setRenaming(true);
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const chevron = (
    <span className="text-muted">
      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
    </span>
  );
  const countBadge = count !== undefined && count > 0 && (
    <span
      data-folder-count={count}
      className="ml-1 rounded-full bg-accent-soft px-1.5 font-mono text-xs text-muted"
    >
      {count}
    </span>
  );
  const header = (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only drop target for body rows; the Move to Component menu is the keyboard path
    <div
      data-drop={dropTarget?.name}
      data-drop-over={over || undefined}
      className={`flex h-7 items-center rounded-input pr-1 hover:bg-accent-soft ${over ? 'bg-accent-soft outline-2 outline-accent' : ''}`}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        if (!accepts(event) || !dropTarget) return;
        event.preventDefault();
        try {
          const ids = JSON.parse(event.dataTransfer.getData(BODIES_MIME)) as BodyId[];
          if (Array.isArray(ids)) dropTarget.onDrop(ids);
        } catch {
          // Not ours.
        }
      }}
    >
      {onSelect ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            onClick={() => setOpen(!open)}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-input px-1"
          >
            {chevron}
            <span className="grid w-4 place-items-center text-muted">{icon}</span>
          </button>
          {marker && (
            <span
              data-active-marker
              role="img"
              aria-label="Active component"
              className="mr-1 size-2 shrink-0 rounded-full bg-accent"
            />
          )}
          {labelNode ?? (
            <button
              type="button"
              onClick={(event) =>
                onSelect(event.shiftKey || event.ctrlKey || event.metaKey ? 'add' : 'replace')
              }
              onDoubleClick={() => rename && setRenaming(true)}
              onKeyDown={onLabelKey}
              className="flex h-7 min-w-0 flex-1 items-center rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent"
            >
              <span className="min-w-0 truncate">{label}</span>
            </button>
          )}
          {countBadge}
        </>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-input px-1 text-left"
        >
          {chevron}
          <span className="grid w-4 place-items-center text-muted">{icon}</span>
          {label}
          {countBadge}
        </button>
      )}
      {eye && (
        <EyeToggle
          name={`all ${label.toLowerCase()}`}
          visible={eye.visible}
          onToggle={eye.onToggle}
        />
      )}
      {displayEye && !renaming && (
        <BodyEyeToggle name={label} display={displayEye.display} onToggle={displayEye.onToggle} />
      )}
    </div>
  );
  return (
    <li
      {...attrs}
      className={`${nested ? 'pl-3' : ''} ${dimmed ? 'opacity-50' : ''}`.trim() || undefined}
    >
      <ContextMenu label={`${label} menu`} trigger={header} disabled={renaming}>
        {rename && (
          <MenuItem
            icon={<TextCursorInput size={14} />}
            shortcut="F2"
            onSelect={() => setRenaming(true)}
          >
            Rename
          </MenuItem>
        )}
        <MenuItem
          icon={open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          onSelect={() => setOpen(!open)}
        >
          {open ? 'Collapse' : 'Expand'}
        </MenuItem>
        {eye && (
          <MenuItem
            icon={eye.visible ? <EyeOff size={14} /> : <Eye size={14} />}
            onSelect={eye.onToggle}
          >
            {eye.visible ? 'Hide' : 'Show'} all {label.toLowerCase()}
          </MenuItem>
        )}
        {menu}
      </ContextMenu>
      {open && <ul className="pb-1">{children}</ul>}
    </li>
  );
}

/** The swatch of each origin plane's row: its normal axis's colour (`PLANE_AXIS_COLOR`). */
const PLANE_SWATCH: Partial<Record<OriginItem, string>> = {
  xy: TOKENS[PLANE_AXIS_COLOR.xy],
  xz: TOKENS[PLANE_AXIS_COLOR.xz],
  yz: TOKENS[PLANE_AXIS_COLOR.yz],
};

function Leaf({
  muted,
  active,
  className = '',
  children,
  ...rest
}: {
  muted?: boolean;
  active?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLLIElement> & { [data: `data-${string}`]: string | undefined }) {
  return (
    <li
      aria-current={active || undefined}
      {...rest}
      className={`flex h-7 items-center gap-1.5 rounded-input pr-1 pl-[46px] ${muted ? 'text-muted' : ''} ${active ? 'bg-accent-soft' : ''} ${className}`}
    >
      {children}
    </li>
  );
}

/** The menu label of an Analysis row, by its name. */
const ANALYSIS_MENUS: Record<string, string> = {
  section: 'Section',
  overhang: 'Overhang',
  'wall thickness': 'Wall thickness',
};

/** A row of the Analysis folder (P3-09, P3-10, P5-06): name (opens the panel), eye, and a menu. */
function AnalysisRow({
  name,
  entry,
  rowAttribute,
}: {
  name: string;
  entry: AnalysisEntry;
  rowAttribute: Record<string, string>;
}) {
  return (
    <ContextMenu
      label={`${ANALYSIS_MENUS[name] ?? name} menu`}
      trigger={
        <Leaf active={entry.active} {...rowAttribute}>
          <button
            type="button"
            onClick={entry.onEdit}
            className={`min-w-0 flex-1 truncate text-left ${entry.on ? '' : 'text-muted'}`}
          >
            {entry.label}
          </button>
          <EyeToggle name={name} visible={entry.on} onToggle={entry.onToggle} />
        </Leaf>
      }
    >
      <MenuItem icon={<Pencil size={14} />} onSelect={entry.onEdit}>
        Edit
      </MenuItem>
      <MenuItem
        icon={entry.on ? <EyeOff size={14} /> : <Eye size={14} />}
        onSelect={entry.onToggle}
      >
        {entry.on ? 'Hide' : 'Show'}
      </MenuItem>
      <MenuItem icon={<Trash2 size={14} />} onSelect={entry.onRemove}>
        Remove
      </MenuItem>
    </ContextMenu>
  );
}
