/**
 * What a posed body looks like for tests (P6-05 J2): `data-posed-bodies`, the box of each posed
 * body's mesh through its pose, `Leaf:<x,y,z min>..<x,y,z max>` joined by `;`. Pure.
 */
import type { BodyId, BodyMeta } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { apply, type Matrix12 } from '@extrudo/kernel/matrix';

type Vec3 = [number, number, number];

/** The axis-aligned box of `mesh` moved by `pose`, or `undefined` for an empty mesh. */
export function posedBox(mesh: BodyMesh, pose: Matrix12): { min: Vec3; max: Vec3 } | undefined {
  const p = mesh.positions;
  if (p.length < 3) return undefined;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < p.length; i += 3) {
    const q = apply(pose, [p[i] as number, p[i + 1] as number, p[i + 2] as number]);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, q[k] as number);
      max[k] = Math.max(max[k] as number, q[k] as number);
    }
  }
  return { min, max };
}

const num = (n: number) => {
  const r = Number(n.toFixed(2));
  return Object.is(r, -0) ? 0 : r;
};

export function posedSummary(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  meta: Readonly<Record<BodyId, BodyMeta>>,
  posed: Readonly<Record<BodyId, Matrix12>> | undefined,
): string | undefined {
  if (!posed) return undefined;
  const parts: string[] = [];
  for (const [id, pose] of Object.entries(posed) as [BodyId, Matrix12][]) {
    const mesh = bodies[id];
    const box = mesh && posedBox(mesh, pose);
    if (!box) continue;
    const name = (meta[id]?.name ?? id).replace(/\s+/g, '_');
    parts.push(`${name}:${box.min.map(num).join(',')}..${box.max.map(num).join(',')}`);
  }
  return parts.length > 0 ? parts.join(';') : undefined;
}

/**
 * The bodies the view lets be picked: the shown ones, minus those drawn posed (P6-05 J2:
 * nothing is modelled against a body that is not where its geometry is).
 */
export function pickableBodies(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  meta: Readonly<Record<BodyId, BodyMeta>>,
  posed: Readonly<Record<BodyId, Matrix12>> | undefined,
): { id: BodyId; mesh: BodyMesh }[] {
  return (Object.entries(bodies) as [BodyId, BodyMesh][])
    .filter(([id]) => (meta[id]?.visible ?? true) && !posed?.[id])
    .map(([id, mesh]) => ({ id, mesh }));
}
