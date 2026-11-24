/**
 * A body mesh's bounds, worked out once per positions array (ADR-0102 §9). The view asks for
 * the bounds of every shown body on every change of the shown bodies (`Bodies`' bounds,
 * `Viewport`'s `data-bodies`), and walked every node of every mesh each time, although a drag
 * or an edit changes one body or none.
 *
 * Kept in a `WeakMap` by the mesh's `positions` array, not by the mesh object: the bounds are
 * read from that array alone, so a new mesh object around the same array keeps them. A kept value
 * goes stale only if the array is written in place, and nothing writes into a mesh's positions:
 * the kernel copies them out of WASM into a new array for each mesh, the worker hands them over,
 * importers, scaling and transforms write into new arrays, and the view's geometries take them as
 * they are.
 */
import { Box3 } from 'three';

const boxes = new WeakMap<ArrayLike<number> & object, Box3>();
const sizes = new WeakMap<ArrayLike<number> & object, string>();

/**
 * The box of a mesh's nodes, as `Box3.setFromArray` gives it. Never hand it out: it is shared by
 * every caller (read it, as `Box3.union` does).
 */
export function meshBox(positions: ArrayLike<number> & object): Box3 {
  let box = boxes.get(positions);
  if (!box) {
    box = new Box3().setFromArray(positions);
    boxes.set(positions, box);
  }
  return box;
}

/**
 * The box's size in mm to 0.1 mm, "60,40,15", for `data-bodies`: each axis's lowest and highest
 * coordinate (a NaN node left out), rounded, `-0` written as 0.
 */
export function meshSize(positions: ArrayLike<number> & object): string {
  let size = sizes.get(positions);
  if (size === undefined) {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i++) {
      const k = i % 3;
      const v = positions[i] ?? 0;
      if (v < (lo[k] ?? 0)) lo[k] = v;
      if (v > (hi[k] ?? 0)) hi[k] = v;
    }
    size = [0, 1, 2].map((k) => Math.round(((hi[k] ?? 0) - (lo[k] ?? 0)) * 10) / 10 + 0).join(',');
    sizes.set(positions, size);
  }
  return size;
}
