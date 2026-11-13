/**
 * A face under the pointer on a view (P6-24 S4): a leader note's dot. A hidden-line view has
 * no face regions, so the face is found in the model: a ray along the view's direction
 * through the point under the pointer, cast into the bodies' display meshes (the viewport's
 * picking index, `faceAlong`), the nearest face it meets. Only on views whose exact lines
 * are current (as `sheetPickables`), and only among the bodies those lines are drawn from.
 */
import type { BodyId, Sheet, SheetViewId, Vec2, Vec3 } from '@extrudo/core';
import { sheetViewFrame } from '@extrudo/core';
import type { BodyMesh, ViewGeometry } from '@extrudo/kernel';
import { faceAlong } from '../selection/pick';
import { type SheetHit, toView } from './dimensionTool';

/** How far before the model a ray starts, mm: further than any design is big. */
const FAR = 1e6;

/**
 * The face under sheet point `point` (mm) on the views of `sheet`, as a hit whose pickable
 * is the face (kind `face`, no paths: there is nothing of it drawn), or `undefined`.
 */
export function faceHit(
  sheet: Sheet,
  geometry: ReadonlyMap<SheetViewId, ViewGeometry>,
  pending: ReadonlySet<SheetViewId>,
  scaleOf: (view: SheetViewId) => number,
  meshes: Readonly<Record<string, BodyMesh>>,
  point: Vec2,
  only?: SheetViewId,
): SheetHit | undefined {
  for (const view of sheet.views) {
    if (only && view.id !== only) continue;
    const g = geometry.get(view.id);
    if (!g?.exact || !g.bounds || pending.has(view.id)) continue;
    const k = scaleOf(view.id);
    const [x, y] = toView(view, k, point);
    if (x < g.bounds.min[0] || x > g.bounds.max[0] || y < g.bounds.min[1] || y > g.bounds.max[1]) {
      continue;
    }
    const frame = sheetViewFrame(sheet, view.id);
    if (!frame) continue;
    const { right, up, direction } = frame;
    const along = (i: 0 | 1 | 2) => x * right[i] + y * up[i] - FAR * direction[i];
    const origin: Vec3 = [along(0), along(1), along(2)];
    let best: { body: BodyId; name: string; distance: number } | undefined;
    for (const body of new Set(g.curves.map((c) => c.body))) {
      const mesh = meshes[body];
      if (!mesh || mesh.mesh || !mesh.faceIds) continue;
      const hit = faceAlong(mesh, origin, direction);
      const name = hit && mesh.faceIds[hit.face];
      if (hit && name && (!best || hit.distance < best.distance)) {
        best = { body, name, distance: hit.distance };
      }
    }
    if (!best) continue;
    return {
      pickable: {
        key: `${view.id}|${best.body}|face|${best.name}`,
        view: view.id,
        body: best.body,
        kind: 'face',
        name: best.name,
        shape: { type: 'curve' },
        paths: [],
        ends: [],
      },
      at: point,
    };
  }
  return undefined;
}
