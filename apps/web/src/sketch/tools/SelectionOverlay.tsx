import {
  type DocumentStore,
  type FeatureId,
  readSketch,
  type SessionStore,
  type SketchFrame,
  sketchToWorld,
  type Vec2,
} from '@extrudo/core';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { viewProject } from '../../viewport/camera';
import type { ViewportStore } from '../../viewport/store';
import { profileIdsIn } from '../profiles';
import { EntityHighlight } from './ConstraintGlyphs';
import { sketchSummary } from './SketchOverlay';

export interface SelectionOverlayProps {
  store: DocumentStore;
  session: SessionStore;
  viewport: ViewportStore;
  sketchId: FeatureId;
  frame: SketchFrame;
}

/**
 * Selection in the open sketch while no tool runs (P1-09, UI spec §3.2):
 * the entity under the pointer in a light tint, the selected ones in the
 * accent. The tool host does the picking; this only draws, in screen space
 * over the 3D view.
 */
export function SelectionOverlay({
  store,
  session,
  viewport,
  sketchId,
  frame,
}: SelectionOverlayProps) {
  const layer = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const view = useStore(viewport, (s) => s.view);
  const projection = useStore(viewport, (s) => s.projection);
  const selection = useStore(session, (s) => s.selection);
  const hover = useStore(session, (s) =>
    s.hover?.kind === 'sketchEntity' ? s.hover.id : undefined,
  );
  const hoverProfile = useStore(session, (s) => profileIdsIn([s.hover], sketchId)[0]);
  const doc = useStore(store, (s) => s.doc);
  const data = useMemo(() => {
    const feature = doc.features.find((f) => f.id === sketchId);
    return feature ? readSketch(feature)?.data : undefined;
  }, [doc, sketchId]);
  const summary = useMemo(() => sketchSummary(doc, sketchId), [doc, sketchId]);

  const { width, height } = size;
  const toScreen = (p: Vec2): [number, number] | undefined => {
    if (width === 0 || height === 0) return undefined;
    const ndc = viewProject(view, projection, width / height, sketchToWorld(frame, p));
    return ndc && [((ndc[0] + 1) / 2) * width, ((1 - ndc[1]) / 2) * height];
  };
  const selected = selection
    .filter((s) => s.kind === 'sketchEntity' && data && s.id in data.entities)
    .map((s) => s.id);

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0 z-[3] overflow-hidden"
      data-sketch-summary={summary}
      data-selected-entities={selected.join(' ')}
      data-hover-entity={hover}
      data-selected-profiles={profileIdsIn(selection, sketchId).join(' ')}
      data-hover-profile={hoverProfile}
    >
      {data && (
        <svg
          className="absolute inset-0 h-full w-full"
          width={width}
          height={height}
          aria-hidden="true"
        >
          {hover && !selected.includes(hover) && (
            <g data-selection="hover" opacity={0.6}>
              <EntityHighlight data={data} id={hover} toScreen={toScreen} width={3} />
            </g>
          )}
          <g data-selection="selected">
            {selected.map((id) => (
              <EntityHighlight key={id} data={data} id={id} toScreen={toScreen} width={3.5} />
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}
