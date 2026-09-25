import { type DocumentStore, moveTimelineMarker } from '@extrudo/core';
import {
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
} from 'lucide-react';
import { Fragment } from 'react';
import { useStore } from 'zustand';
import { IconButton, ToolIcon, Tooltip } from '../design-system';
import { toolForFeature } from './tools';

export interface TimelineProps {
  store: DocumentStore;
  collapsed: boolean;
  onToggle(): void;
}

/**
 * Timeline and status bar (UI spec §2). Chips follow the document's features;
 * the playback buttons move the rollback marker (FR-TL-02) as undoable
 * commands. Dragging the marker and the chip menus come with P2-11.
 */
export function Timeline({ store, collapsed, onToggle }: TimelineProps) {
  const doc = useStore(store, (s) => s.doc);
  const marker = doc.timelineMarker;
  const count = doc.features.length;
  const move = (index: number) => store.getState().dispatch(moveTimelineMarker({ index }));

  return (
    <section
      aria-label="Timeline"
      className="flex min-h-9 items-center gap-2 border-t border-line bg-panel px-2 py-1"
    >
      {!collapsed && (
        <>
          <fieldset className="m-0 flex border-0 p-0" aria-label="Playback">
            <IconButton label="Roll back to start" disabled={marker === 0} onClick={() => move(0)}>
              <ChevronFirst size={16} />
            </IconButton>
            <IconButton label="Step back" disabled={marker === 0} onClick={() => move(marker - 1)}>
              <ChevronLeft size={16} />
            </IconButton>
            <IconButton
              label="Step forward"
              disabled={marker === count}
              onClick={() => move(marker + 1)}
            >
              <ChevronRight size={16} />
            </IconButton>
            <IconButton
              label="Roll forward to end"
              disabled={marker === count}
              onClick={() => move(count)}
            >
              <ChevronLast size={16} />
            </IconButton>
          </fieldset>
          <ol
            aria-label="Features"
            className="flex min-w-0 items-center gap-1.5 overflow-x-auto py-1"
          >
            {doc.features.map((feature, index) => {
              const tool = toolForFeature(feature.type);
              const rolledBack = index >= marker;
              return (
                <Fragment key={feature.id}>
                  {index === marker && <Marker />}
                  <li>
                    <Tooltip
                      label={feature.name}
                      side="top"
                      hint={`${tool.label}${rolledBack ? ' · rolled back' : ''}${feature.suppressed ? ' · suppressed' : ''}`}
                    >
                      <button
                        type="button"
                        aria-label={`${feature.name}${rolledBack ? ' (rolled back)' : ''}`}
                        className="grid size-[30px] place-items-center rounded-control border"
                        style={{
                          background: `color-mix(in srgb, var(--x-cat-${tool.category}) 16%, var(--x-bg))`,
                          borderColor: `color-mix(in srgb, var(--x-cat-${tool.category}) 38%, transparent)`,
                          opacity: rolledBack ? 0.38 : 1,
                        }}
                      >
                        <ToolIcon name={tool.icon} category={tool.category} size={18} />
                      </button>
                    </Tooltip>
                  </li>
                </Fragment>
              );
            })}
            {marker === count && count > 0 && <Marker />}
          </ol>
        </>
      )}
      <span className="flex-1" />
      <output className="font-mono text-[11px] whitespace-nowrap text-muted" aria-label="Status">
        {count} {count === 1 ? 'feature' : 'features'} · {doc.settings.units} · kernel idle
      </output>
      <IconButton label={collapsed ? 'Show timeline' : 'Hide timeline'} onClick={onToggle}>
        {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </IconButton>
    </section>
  );
}

function Marker() {
  return (
    <li className="relative mx-0.5 h-8 w-[3px] rounded-sm bg-accent before:absolute before:-top-1 before:-left-1 before:border-[5.5px] before:border-transparent before:border-t-accent">
      <span className="sr-only">Timeline marker</span>
    </li>
  );
}
