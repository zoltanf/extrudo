/**
 * The ghost bodies of the view (ADR-0030's amendment, 2026-10-09): a body whose
 * stored metadata is `visible: false, ghost: true` is drawn by a small separate
 * component as a vague grey shape at 30 % opacity, and takes no part in picking,
 * selection, bounds, silhouettes or analyses. The pure parts live here, so unit
 * tests don't load React Three Fiber.
 */
import { type BodyId, type BodyMeta, bodyDisplay } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';

/** The ghost bodies among `bodies`, in the order the layer lists them. */
export function ghostBodies(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  meta: Readonly<Record<BodyId, BodyMeta>>,
): [BodyId, BodyMesh][] {
  return (Object.entries(bodies) as [BodyId, BodyMesh][]).filter(
    ([id]) => bodyDisplay(meta[id]) === 'ghost',
  );
}

/**
 * The names of the ghost bodies for tests (`data-ghost-bodies`), in the order
 * the bodies are listed; `undefined` when there are none.
 */
export function ghostBodiesSummary(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  meta: Readonly<Record<BodyId, BodyMeta>>,
): string | undefined {
  const names = ghostBodies(bodies, meta).map(([id]) => meta[id]?.name ?? id);
  return names.length > 0 ? names.join(' ') : undefined;
}
