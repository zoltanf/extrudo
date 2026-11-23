/**
 * Test support (no production code): a FreeCAD mesh kernel entry (`*.bms`, FORMAT.md) from
 * points and facets, for tests that need meshes the fixtures don't have.
 */

/** A mesh kernel entry: `points` (x, y, z each) and `facets` (three indices each), neighbours open. */
export function bms(
  points: readonly number[],
  facets: readonly number[],
  counts?: { points?: number; facets?: number },
): Uint8Array {
  const p = points.length / 3;
  const f = facets.length / 3;
  const bytes = new Uint8Array(296 + 12 * p + 24 * f);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0xa0b0c0d0, true);
  view.setUint32(4, 0x00010000, true);
  view.setUint32(264, counts?.points ?? p, true);
  view.setUint32(268, counts?.facets ?? f, true);
  for (const [i, v] of points.entries()) view.setFloat32(272 + 4 * i, v, true);
  let at = 272 + 12 * p;
  for (let i = 0; i < f; i++, at += 24) {
    for (let k = 0; k < 3; k++) view.setUint32(at + 4 * k, facets[3 * i + k] as number, true);
    for (let k = 3; k < 6; k++) view.setUint32(at + 4 * k, 0xffffffff, true);
  }
  return bytes;
}
