/**
 * Dragging a note's anchor dot onto other geometry (ADR-0126 S4): what a point of the view
 * would anchor to, through the same picks and anchor builders as the Annotate tool — the
 * model's pick and the kernel's name and fingerprint in the model, the sketch's pick in an
 * open sketch.
 */
import {
  type AnnotationAnchor,
  type BodyId,
  type DocumentStore,
  readSketch,
  type SelectionItem,
  type SketchEntityId,
  sketchToWorld,
  worldToSketch,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { pickEntity } from '@extrudo/sketch/inference';
import { SNAP_PIXELS } from '../sketch/tools/host';
import { rayPlane, viewRay, worldPerPixel } from '../viewport/camera';
import type { ViewportStore } from '../viewport/store';
import type { OpenSketch, ResolveAnnotation, Vec3 } from './anchor';
import { modelAnchorFor, sketchAnchorFor } from './tool';

export interface Reanchor {
  /** What a drop at view px (`x`, `y`) would take: the hover the tool shows. */
  hover(x: number, y: number, size: { width: number; height: number }): SelectionItem | undefined;
  /** The anchor a drop there makes, and the world point it is drawn at. */
  anchor(
    x: number,
    y: number,
    size: { width: number; height: number },
  ): Promise<{ anchor: AnnotationAnchor; world: Vec3 } | undefined>;
}

export function createReanchor(deps: {
  store: DocumentStore;
  viewport: ViewportStore;
  bodies(): Readonly<Record<BodyId, BodyMesh>>;
  resolve: ResolveAnnotation | undefined;
  openSketch(): OpenSketch | undefined;
}): Reanchor {
  const { store, viewport } = deps;
  /** In an open sketch: the sketch point under the view point, and the entity there. */
  const inSketch = (open: OpenSketch, x: number, y: number, width: number, height: number) => {
    if (width <= 0 || height <= 0) return undefined;
    const { view, projection } = viewport.getState();
    const ray = viewRay(view, projection, width / height, [
      (x / width) * 2 - 1,
      1 - (y / height) * 2,
    ]);
    const hit = rayPlane(ray, open.frame.origin, open.frame.normal);
    if (!hit) return undefined;
    const world: Vec3 = [hit.x, hit.y, hit.z];
    const point = worldToSketch(open.frame, world);
    const feature = store.getState().doc.features.find((f) => f.id === open.id);
    const data = feature ? readSketch(feature)?.data : undefined;
    const reach = SNAP_PIXELS * worldPerPixel(view, projection, height, world);
    const entity = data ? pickEntity(data, point, reach) : undefined;
    return { point, data, entity: entity as SketchEntityId | undefined };
  };
  return {
    hover(x, y, { width, height }) {
      const open = deps.openSketch();
      if (open) {
        const found = inSketch(open, x, y, width, height);
        return found?.entity ? { kind: 'sketchEntity', id: found.entity } : undefined;
      }
      return viewport.getState().pickAt?.(x, y, { width, height })?.item;
    },
    async anchor(x, y, { width, height }) {
      const open = deps.openSketch();
      if (open) {
        const found = inSketch(open, x, y, width, height);
        if (!found?.data) return undefined;
        const world = sketchToWorld(open.frame, found.point);
        return {
          anchor: sketchAnchorFor(found.data, open.id, found.point, found.entity),
          world: [world[0], world[1], world[2]],
        };
      }
      const picked = viewport.getState().pickAt?.(x, y, { width, height });
      if (!picked?.at) return undefined;
      const anchor = await modelAnchorFor(deps, picked.item, picked.at);
      return anchor && { anchor, world: picked.at };
    },
  };
}
