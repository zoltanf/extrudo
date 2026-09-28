import {
  type BodyId,
  type DocumentStore,
  type Feature,
  type FeatureId,
  isFeatureVisible,
  updateBody,
} from '@extrudo/core';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Settings2,
  Video,
} from 'lucide-react';
import { type HTMLAttributes, type KeyboardEvent, type ReactNode, useState } from 'react';
import { useStore } from 'zustand';
import { ContextMenu, IconButton, ToolIcon } from '../design-system';
import { ORIGIN_ITEMS, type ViewportStore } from '../viewport/store';
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
}

/**
 * The browser (UI spec §2, FR-VP-07): document settings, views, origin,
 * sketches, construction and bodies. Built from the document; the eyes on
 * sketches and bodies are real, undoable visibility changes, and a folder's
 * eye shows or hides everything in it in one step. The origin's eyes are
 * viewport settings (P0-05), not document changes. A sketch opens with a
 * double-click or its pencil button (P1-01); F2 or its right-click menu
 * renames it, Delete deletes it, and the pointer on its row highlights it in
 * the view (P1-12).
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
}: BrowserPanelProps) {
  const doc = useStore(store, (s) => s.doc);
  const origin = useStore(viewport, (s) => s.origin);

  const sketches = doc.features
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => feature.type === 'sketch');
  const originShown = ORIGIN_ITEMS.some(({ value }) => origin[value]);
  const sketchesShown = sketches.some(({ feature }) => isFeatureVisible(feature));
  const bodies = Object.entries(doc.bodies) as [BodyId, (typeof doc.bodies)[BodyId]][];
  const bodiesShown = bodies.some(([, body]) => body.visible);

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
              eye={
                bodies.length > 0
                  ? {
                      visible: bodiesShown,
                      onToggle: () => {
                        const state = store.getState();
                        state.beginTransaction(bodiesShown ? 'Hide bodies' : 'Show bodies');
                        for (const [id] of bodies) {
                          state.dispatch(updateBody({ id, changes: { visible: !bodiesShown } }));
                        }
                        state.commitTransaction();
                      },
                    }
                  : undefined
              }
            >
              {bodies.length === 0 ? (
                <Leaf muted>No bodies yet</Leaf>
              ) : (
                bodies.map(([id, body]) => (
                  <Leaf key={id}>
                    <span className={body.visible ? '' : 'text-muted'}>{body.name}</span>
                    <EyeToggle
                      name={body.name}
                      visible={body.visible}
                      onToggle={() =>
                        store
                          .getState()
                          .dispatch(updateBody({ id, changes: { visible: !body.visible } }))
                      }
                    />
                  </Leaf>
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
  children,
}: {
  label: string;
  icon: ReactNode;
  defaultOpen?: boolean;
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
  children,
  ...rest
}: {
  muted?: boolean;
  active?: boolean;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLLIElement>, 'className'>) {
  return (
    <li
      aria-current={active || undefined}
      {...rest}
      className={`flex h-7 items-center gap-1.5 rounded-input pr-1 pl-[46px] ${muted ? 'text-muted' : ''} ${active ? 'bg-accent-soft' : ''}`}
    >
      {children}
    </li>
  );
}
