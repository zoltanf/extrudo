/**
 * The Project tool (P2-09, FR-SK-12, ADR-0031): in sketch mode, the view
 * picks body edges, faces and vertices as in the model (a body through its
 * browser row, P4-12), and a click projects the pick into the open sketch
 * (`addProjection`). Since ADR-0125 it also picks a curve or point of an
 * earlier sketch in the view (a `sketchEntity` item) and a whole earlier
 * sketch through its browser row (a `feature` item). The kernel then reports
 * the projected curves, and the tool host adds them to the sketch in the same
 * undo step (`ToolHost.syncProjections`). The Intersect tool (P4-12) is the
 * same with faces and bodies, and adds the curves where they meet the sketch
 * plane. With "Keep linked" off the curves come in as plain entities (an
 * include).
 *
 * A sketch can only use geometry made before it: while the tool runs on a
 * sketch that isn't the last feature, the view shows and picks the bodies
 * as they were before the sketch (the kernel's preview base, as a feature
 * dialog does when editing). A sketch source must be earlier in the timeline
 * too (ADR-0125): a later one is refused.
 */
import {
  addProjection,
  type BodyId,
  CommandError,
  type DocumentStore,
  type FeatureId,
  type GeomRef,
  type GeomRefKind,
  newId,
  type ProjectionId,
  parseSketchEntityRefId,
  readSketch,
  type SessionStore,
  SKETCH_TYPE,
  type SketchData,
  type SketchEntityId,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useEffect, useMemo } from 'react';
import type { DialogKernel } from '../features/dialog';
import { fieldFilter } from '../features/refs';
import { readTopology } from '../selection/items';
import { clearPickedHover } from '../selection/useModelSelection';
import type { ViewportStore } from '../viewport/store';
import type { ModelSelect } from '../viewport/Viewport';
import { useBodiesBefore } from './baseBodies';

/** The session tool ID of the Project tool (not a tool host tool: it picks in 3D). */
export const PROJECT_TOOL = 'project';
/** The session tool ID of the Intersect tool (P4-12). */
export const INTERSECT_TOOL = 'intersect';

/** What each tool picks (P4-12: vertices and bodies too; ADR-0125: sketches; Intersect faces and bodies). */
const PICKS: Record<'project' | 'intersect', readonly GeomRefKind[]> = {
  project: ['edge', 'face', 'vertex', 'body', 'sketchEntity', 'feature'],
  intersect: ['face', 'body'],
};

/** What the Project tool picks: body edges, faces, vertices, bodies and earlier sketches. */
export const PROJECT_FILTER = fieldFilter(PICKS.project);
/** What the Intersect tool picks: faces and bodies. */
export const INTERSECT_FILTER = fieldFilter(PICKS.intersect);

/** Whether a session tool is Project or Intersect. */
export function isProjectTool(tool: string | undefined): tool is 'project' | 'intersect' {
  return tool === PROJECT_TOOL || tool === INTERSECT_TOOL;
}

export interface ProjectToolOptions {
  store: DocumentStore;
  session: SessionStore;
  viewport: ViewportStore;
  kernel: DialogKernel | undefined;
  notify(tone: 'info' | 'error', text: string): void;
  /** The tool that runs (sketch mode, the session's tool is `PROJECT_TOOL` or `INTERSECT_TOOL`). */
  tool: 'project' | 'intersect' | undefined;
  /** The open sketch. */
  sketchId: FeatureId | undefined;
  /** Keep the curves linked to the model (default); off, they come in as plain entities. */
  linked?: boolean;
}

export interface ProjectTool {
  /** The view's picking while the tool runs. */
  select: ModelSelect | undefined;
  /** The bodies to show and pick instead of the model's (those before the sketch), if they differ. */
  bodies: Record<BodyId, BodyMesh> | undefined;
}

export function useProjectTool({
  store,
  session,
  viewport,
  kernel,
  notify,
  tool,
  sketchId,
  linked = true,
}: ProjectToolOptions): ProjectTool {
  const active = tool !== undefined;
  const mode = tool ?? 'project';
  // The bodies before the sketch, when later features change them.
  const base = useBodiesBefore({ active, featureId: sketchId, store, kernel });

  // Only what the tool takes can be picked; the tool's hover goes when it stops.
  useEffect(() => {
    if (!active) return;
    viewport.getState().setFieldFilter(mode === 'intersect' ? INTERSECT_FILTER : PROJECT_FILTER);
    return () => {
      viewport.getState().setFieldFilter(undefined);
      clearPickedHover(session);
    };
  }, [active, mode, viewport, session]);

  const usesBase = base !== undefined;
  const takes: readonly GeomRefKind[] = PICKS[mode];
  const select = useMemo<ModelSelect | undefined>(() => {
    if (!active || !sketchId) return undefined;
    const featureAt = (id: string) => store.getState().doc.features.find((f) => f.id === id);
    const sketchData = (id: string): SketchData | undefined => {
      const feature = featureAt(id);
      return feature ? readSketch(feature)?.data : undefined;
    };
    // A source sketch must be earlier in the timeline than the open sketch (ADR-0125).
    const earlier = (feature: FeatureId): boolean => {
      const features = store.getState().doc.features;
      const open = features.findIndex((f) => f.id === sketchId);
      const source = features.findIndex((f) => f.id === feature);
      return source >= 0 && (open < 0 || source < open);
    };
    const isText = (sketch: FeatureId, entity: string) =>
      sketchData(sketch)?.entities[entity as SketchEntityId]?.type === 'text';
    const sketchEntities = mode === 'project' && takes.includes('sketchEntity');
    const wholeSketches = mode === 'project' && takes.includes('feature');
    const later = 'Only a sketch earlier in the timeline can be projected.';
    return {
      onHover: (item) => {
        if (item?.kind === 'sketchEntity' && sketchEntities) {
          const parsed = parseSketchEntityRefId(item.id);
          if (parsed && earlier(parsed.feature) && !isText(parsed.feature, parsed.entity)) {
            session.getState().setHover(item);
          } else clearPickedHover(session);
          return;
        }
        if (item?.kind === 'feature' && wholeSketches) {
          if (featureAt(item.id)?.type === SKETCH_TYPE && earlier(item.id as FeatureId)) {
            session.getState().setHover(item);
          } else clearPickedHover(session);
          return;
        }
        const topology = readTopology(item);
        if (item && topology && takes.includes(topology.kind)) {
          session.getState().setHover(item);
        } else clearPickedHover(session);
      },
      onClick: (item) => {
        const add = (ref: GeomRef) => {
          try {
            store.getState().dispatch(
              addProjection({
                feature: sketchId,
                id: newId<ProjectionId>(),
                ref,
                ...(mode === 'intersect' && { mode }),
                ...(!linked && { linked: false }),
              }),
            );
          } catch (error) {
            if (!(error instanceof CommandError)) throw error;
            notify('error', error.message);
          }
        };
        // A curve or point of an earlier sketch (ADR-0125): one `sketchEntity` ref.
        if (item?.kind === 'sketchEntity' && sketchEntities) {
          const parsed = parseSketchEntityRefId(item.id);
          if (!parsed) return;
          if (!earlier(parsed.feature)) {
            notify('error', later);
            return;
          }
          if (isText(parsed.feature, parsed.entity)) {
            notify('error', "Text can't be projected: project its sketch's curves instead.");
            return;
          }
          add({ kind: 'sketchEntity', id: item.id });
          return;
        }
        // A whole earlier sketch through its browser row (ADR-0125): a `feature` ref.
        if (item?.kind === 'feature' && wholeSketches) {
          if (featureAt(item.id)?.type !== SKETCH_TYPE || !earlier(item.id as FeatureId)) {
            notify('error', later);
            return;
          }
          add({ kind: 'feature', id: item.id });
          return;
        }
        const topology = readTopology(item);
        if (!topology || !takes.includes(topology.kind)) return;
        // A body is referred to by its ID (a browser row, ADR-0030).
        if (topology.kind === 'body') {
          add({ kind: 'body', id: topology.body });
          return;
        }
        if (!kernel) return;
        void kernel
          .reference(topology.body, topology.kind, topology.index, usesBase)
          .then((ref) => {
            if (!ref) {
              notify(
                'error',
                `Can't ${mode === 'intersect' ? 'intersect' : 'project'} that yet: the model is still computing.`,
              );
              return;
            }
            add(ref);
          });
      },
      onBox: () => {},
    };
  }, [active, sketchId, kernel, session, store, notify, usesBase, mode, linked, takes]);

  return { select, bodies: active ? base : undefined };
}
