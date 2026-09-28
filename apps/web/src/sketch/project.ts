/**
 * The Project tool (P2-09, FR-SK-12, ADR-0031): in sketch mode, the view
 * picks body edges and faces as in the model, and a click projects the
 * pick into the open sketch (`addProjection`). The kernel then reports the
 * projected curves, and the tool host adds them to the sketch in the same
 * undo step (`ToolHost.syncProjections`).
 *
 * A sketch can only use geometry made before it: while the tool runs on a
 * sketch that isn't the last feature, the view shows and picks the bodies
 * as they were before the sketch (the kernel's preview base, as a feature
 * dialog does when editing).
 */
import {
  addProjection,
  type BodyId,
  CommandError,
  type DocumentStore,
  type FeatureId,
  newId,
  type ProjectionId,
  type SessionStore,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useEffect, useMemo, useState } from 'react';
import type { DialogKernel } from '../features/dialog';
import { fieldFilter } from '../features/refs';
import { readTopology } from '../selection/items';
import { clearPickedHover } from '../selection/useModelSelection';
import type { ViewportStore } from '../viewport/store';
import type { ModelSelect } from '../viewport/Viewport';

/** The session tool ID of the Project tool (not a tool host tool: it picks in 3D). */
export const PROJECT_TOOL = 'project';

/** What the Project tool picks: body edges and faces. */
export const PROJECT_FILTER = fieldFilter(['edge', 'face']);

export interface ProjectToolOptions {
  store: DocumentStore;
  session: SessionStore;
  viewport: ViewportStore;
  kernel: DialogKernel | undefined;
  notify(tone: 'info' | 'error', text: string): void;
  /** The tool runs (sketch mode, the session's tool is `PROJECT_TOOL`). */
  active: boolean;
  /** The open sketch. */
  sketchId: FeatureId | undefined;
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
  active,
  sketchId,
}: ProjectToolOptions): ProjectTool {
  const [base, setBase] = useState<Record<BodyId, BodyMesh>>();

  // The bodies before the sketch, when later features change them.
  useEffect(() => {
    if (!active || !sketchId || !kernel) return;
    const { doc } = store.getState();
    const index = doc.features.findIndex((f) => f.id === sketchId);
    const feature = doc.features[index];
    const later = doc.features
      .slice(index + 1, doc.timelineMarker)
      .some((f) => !f.suppressed && f.type !== 'sketch');
    if (!feature || !later) return;
    let current = true;
    kernel.preview(feature, index, { base: true }).then((preview) => {
      if (current && preview?.base) setBase(preview.base);
    });
    return () => {
      current = false;
      setBase(undefined);
      kernel.endPreview();
    };
  }, [active, sketchId, kernel, store]);

  // Only edges and faces can be picked; the tool's hover goes when it stops.
  useEffect(() => {
    if (!active) return;
    viewport.getState().setFieldFilter(PROJECT_FILTER);
    return () => {
      viewport.getState().setFieldFilter(undefined);
      clearPickedHover(session);
    };
  }, [active, viewport, session]);

  const usesBase = base !== undefined;
  const select = useMemo<ModelSelect | undefined>(() => {
    if (!active || !sketchId) return undefined;
    return {
      onHover: (item) => {
        const topology = readTopology(item);
        if (item && (topology?.kind === 'edge' || topology?.kind === 'face')) {
          session.getState().setHover(item);
        } else clearPickedHover(session);
      },
      onClick: (item) => {
        const topology = readTopology(item);
        if (!topology || (topology.kind !== 'edge' && topology.kind !== 'face')) return;
        if (!kernel) return;
        void kernel
          .reference(topology.body, topology.kind, topology.index, usesBase)
          .then((ref) => {
            if (!ref) {
              notify('error', "Can't project that yet: the model is still computing.");
              return;
            }
            try {
              store
                .getState()
                .dispatch(addProjection({ feature: sketchId, id: newId<ProjectionId>(), ref }));
            } catch (error) {
              if (!(error instanceof CommandError)) throw error;
              notify('error', error.message);
            }
          });
      },
      onBox: () => {},
    };
  }, [active, sketchId, kernel, session, store, notify, usesBase]);

  return { select, bodies: active ? base : undefined };
}
