import {
  type BodyId,
  type DocumentStore,
  type Feature,
  type FeatureId,
  isFeatureVisible,
} from '@extrudo/core';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
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
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useState,
} from 'react';
import { useStore } from 'zustand';
import {
  ContextMenu,
  IconButton,
  MenuItem,
  MenuSeparator,
  Popover,
  ToolIcon,
} from '../design-system';
import { ORIGIN_ITEMS, type ViewportStore } from '../viewport/store';
import { BODY_COLORS, BODY_OPACITIES, type BodyActions, type BodyEntry } from './bodies';
import { FeatureMenuItems, RenameField } from './FeatureMenu';
import type { FeatureActions } from './featureActions';

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
  selectedBodies = NO_BODIES,
  onPickBody,
  onHoverBody,
}: BrowserPanelProps) {
  const doc = useStore(store, (s) => s.doc);
  const origin = useStore(viewport, (s) => s.origin);

  const sketches = doc.features
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => feature.type === 'sketch');
  const originShown = ORIGIN_ITEMS.some(({ value }) => origin[value]);
  const sketchesShown = sketches.some(({ feature }) => isFeatureVisible(feature));
  const bodiesShown = bodies.some(({ meta }) => meta.visible);

  // Collapsed, the panel slides to no width (its content keeps its width and is clipped, so
  // nothing reflows on the way), then turns invisible (visibility switches at the end of the
  // transition when hiding), and a small tab at the view's left edge brings it back.
  const motion = 'duration-(--x-normal) ease-ui';
  return (
    <>
      <aside
        id={BROWSER_ID}
        aria-label="Browser"
        inert={collapsed}
        style={{ width: collapsed ? 0 : width }}
        className={`flex shrink-0 overflow-hidden bg-panel ${collapsed ? 'invisible' : ''} ${animate ? `transition-[width,visibility] ${motion}` : ''}`}
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
              <Leaf muted>
                {doc.views.length === 0 ? 'No named views yet' : `${doc.views.length} views`}
              </Leaf>
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
                <Leaf key={value}>
                  <span className={origin[value] ? '' : 'text-muted'}>{label}</span>
                  <EyeToggle
                    name={label}
                    visible={origin[value]}
                    onToggle={() => viewport.getState().setOrigin(value, !origin[value])}
                  />
                </Leaf>
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
                    active={feature.id === activeSketchId}
                    actions={actions}
                  />
                ))
              )}
            </Folder>
            <Folder
              label="Construction"
              icon={<ToolIcon name="offset-plane" category="construct" size={16} />}
            >
              <Leaf muted>No construction geometry yet</Leaf>
            </Folder>
            <Folder
              label="Bodies"
              icon={<Box size={14} />}
              count={bodies.length}
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
              {bodies.length === 0 ? (
                <Leaf muted>No bodies yet</Leaf>
              ) : (
                bodies.map((body) => (
                  <BodyLeaf
                    key={body.id}
                    body={body}
                    selected={selectedBodies.has(body.id)}
                    selection={selectedBodies}
                    actions={bodyActions}
                    onPick={onPickBody}
                    onHover={onHoverBody}
                  />
                ))
              )}
            </Folder>
          </ul>
        </div>
      </aside>
      <div
        inert={!collapsed}
        className={`absolute top-2 left-0 z-20 transition-[opacity,translate,visibility] ${motion} ${collapsed ? '' : 'invisible -translate-x-full opacity-0'}`}
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
  active,
  actions,
}: {
  feature: Feature;
  editable: boolean;
  rolledBack: boolean;
  active: boolean;
  actions: FeatureActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const visible = isFeatureVisible(feature);
  const states = [
    active && 'editing',
    rolledBack && 'rolled back',
    feature.suppressed && 'suppressed',
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
          onDoubleClick={editable && !renaming ? () => actions.edit(feature.id) : undefined}
          onPointerEnter={() => actions.hover(feature.id)}
          onPointerLeave={() => actions.hover(undefined)}
        >
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
      />
    </ContextMenu>
  );
}

const NO_BODIES: ReadonlySet<string> = new Set();

/**
 * A body in the browser (P2-08, ADR-0030): a click picks it like the view
 * does, the pointer on it highlights it, F2 or Rename renames it, the eye
 * hides it, Appearance sets its colour and opacity, Delete removes it (the
 * selected bodies, when it is one of them) through a Remove feature.
 */
function BodyLeaf({
  body,
  selected,
  selection,
  actions,
  onPick,
  onHover,
}: {
  body: BodyEntry;
  selected: boolean;
  selection: ReadonlySet<string>;
  actions: BodyActions;
  onPick?(id: BodyId, toggle: boolean): void;
  onHover?(id: BodyId | undefined): void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [appearance, setAppearance] = useState(false);
  const { id, meta } = body;
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
      aria-selected={selected}
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
          className={`min-w-0 truncate rounded-input text-left focus-visible:outline-2 focus-visible:outline-accent ${meta.visible ? '' : 'text-muted'}`}
        >
          {meta.name}
        </button>
      )}
      {!renaming && (
        <EyeToggle
          name={meta.name}
          visible={meta.visible}
          onToggle={() => actions.setVisible([id], !meta.visible)}
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
      <MenuItem
        icon={meta.visible ? <EyeOff size={14} /> : <Eye size={14} />}
        onSelect={() => actions.setVisible([id], !meta.visible)}
      >
        {meta.visible ? 'Hide' : 'Show'}
      </MenuItem>
      <MenuItem icon={<Palette size={14} />} onSelect={() => setAppearance(true)}>
        Appearance…
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<Trash2 size={14} />} shortcut="Del" onSelect={remove}>
        Delete
      </MenuItem>
    </ContextMenu>
  );
}

/** Colour swatches and opacity presets (ADR-0030); each choice is one undo step. */
function AppearancePanel({ body, actions }: { body: BodyEntry; actions: BodyActions }) {
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

function Folder({
  label,
  icon,
  defaultOpen = true,
  eye,
  count,
  children,
}: {
  label: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  /** A count badge after the label (the Bodies folder, P2-08). */
  count?: number;
  /** A folder eye: shows everything in it when all is hidden, else hides it all. */
  eye?: { visible: boolean; onToggle(): void };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li>
      <div className="flex h-7 items-center rounded-input pr-1 hover:bg-accent-soft">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-input px-1 text-left"
        >
          <span className="text-muted">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="grid w-4 place-items-center text-muted">{icon}</span>
          {label}
          {count !== undefined && count > 0 && (
            <span
              data-folder-count={count}
              className="ml-1 rounded-full bg-accent-soft px-1.5 font-mono text-xs text-muted"
            >
              {count}
            </span>
          )}
        </button>
        {eye && (
          <EyeToggle
            name={`all ${label.toLowerCase()}`}
            visible={eye.visible}
            onToggle={eye.onToggle}
          />
        )}
      </div>
      {open && <ul className="pb-1">{children}</ul>}
    </li>
  );
}

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
