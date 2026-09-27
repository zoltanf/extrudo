import { type DocumentStore, type Feature, moveTimelineMarker } from '@extrudo/core';
import {
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import { useStore } from 'zustand';
import { ContextMenu, IconButton, Popover, ToolIcon, Tooltip } from '../design-system';
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
}

/**
 * Timeline and status bar (UI spec §2). Chips follow the document's features;
 * the playback buttons move the rollback marker (FR-TL-02) as undoable
 * commands. A chip opens its sketch on double-click, highlights its geometry
 * on hover and has a right-click menu (P1-12). Dragging the marker comes with
 * P2-11.
 */
export function Timeline({ store, collapsed, onToggle, activeSketch, actions }: TimelineProps) {
  const doc = useStore(store, (s) => s.doc);
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
          <ol
            aria-label="Features"
            className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-1"
          >
            {doc.features.map((feature, index) => (
              <Fragment key={feature.id}>
                {index === marker && <Marker />}
                <Chip
                  feature={feature}
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
      <output className="font-mono text-[11px] whitespace-nowrap text-muted" aria-label="Status">
        {activeSketch ? `Editing ${activeSketch} · ` : ''}
        {count} {count === 1 ? 'feature' : 'features'} · {doc.settings.units} · kernel idle
      </output>
      <IconButton label={collapsed ? 'Show timeline' : 'Hide timeline'} onClick={onToggle}>
        {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </IconButton>
    </section>
  );
}

function Chip({
  feature,
  rolledBack,
  editable,
  actions,
}: {
  feature: Feature;
  rolledBack: boolean;
  editable: boolean;
  actions: FeatureActions;
}) {
  const [renaming, setRenaming] = useState(false);
  const tool = toolForFeature(feature.type);
  const states = [rolledBack && 'rolled back', feature.suppressed && 'suppressed'].filter(Boolean);
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
      className={`grid size-[30px] place-items-center rounded-control border ${feature.suppressed ? 'border-dashed' : ''}`}
      style={{
        background: feature.suppressed
          ? 'transparent'
          : `color-mix(in srgb, var(--x-cat-${tool.category}) 16%, var(--x-bg))`,
        borderColor: `color-mix(in srgb, var(--x-cat-${tool.category}) 38%, transparent)`,
        opacity: rolledBack ? 0.38 : feature.suppressed ? 0.6 : 1,
      }}
    >
      <ToolIcon name={tool.icon} category={tool.category} size={18} />
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
                <Tooltip label={feature.name} side="top" hint={[tool.label, ...states].join(' · ')}>
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

function Marker() {
  return (
    <li className="relative mx-0.5 h-8 w-[3px] rounded-sm bg-accent before:absolute before:-top-1 before:-left-1 before:border-[5.5px] before:border-transparent before:border-t-accent">
      <span className="sr-only">Timeline marker</span>
    </li>
  );
}
