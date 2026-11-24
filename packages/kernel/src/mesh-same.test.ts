// `sameMesh` (ADR-0024's amendment of 2026-11-24): the same in every field, bit for bit.
import { describe, expect, it } from 'vitest';
import { type BodyMesh, sameMesh } from './mesh';

function mesh(): BodyMesh {
  return {
    positions: new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    faceRanges: new Uint32Array([0, 1]),
    edgePoints: new Float32Array([0, 1, 2, 3, 4, 5]),
    edgeRanges: new Uint32Array([0, 2]),
    edgeFlags: new Uint8Array([0]),
    vertices: new Float32Array([0, 1, 2]),
    faceIds: ['f'],
    edgeIds: ['e'],
    vertexIds: ['v'],
  };
}

describe('sameMesh', () => {
  it('finds a copy in new arrays the same, also through views at an offset', () => {
    const a = mesh();
    const b = { ...mesh(), faceIds: ['f'] };
    expect(sameMesh(a, b)).toBe(true);
    const buffer = new ArrayBuffer(4 + a.positions.byteLength);
    const shifted = new Float32Array(buffer, 4, 9);
    shifted.set(a.positions);
    expect(sameMesh(a, { ...a, positions: shifted })).toBe(true);
    // Not on a multiple of four: compared byte by byte.
    const bytes = new Uint8Array(3);
    bytes.set([7, 8, 9]);
    const odd = new Uint8Array(new ArrayBuffer(4), 1, 3);
    odd.set([7, 8, 9]);
    expect(sameMesh({ ...a, edgeFlags: bytes }, { ...a, edgeFlags: odd })).toBe(true);
  });

  it('tells -0 from 0 and one NaN from another', () => {
    const a = mesh();
    const zero = a.positions.slice();
    zero[0] = -0;
    expect(sameMesh(a, { ...a, positions: zero })).toBe(false);
    const n1 = a.normals.slice();
    const n2 = a.normals.slice();
    new Uint32Array(n1.buffer)[0] = 0x7fc00000;
    new Uint32Array(n2.buffer)[0] = 0x7fc00001;
    expect(sameMesh({ ...a, normals: n1 }, { ...a, normals: n2 })).toBe(false);
    expect(sameMesh({ ...a, normals: n1 }, { ...a, normals: n1.slice() })).toBe(true);
  });

  it('finds any field changed, gone, added or of another kind different', () => {
    const a = mesh();
    for (const key of Object.keys(a) as (keyof BodyMesh)[]) {
      const value = a[key];
      const changed = ArrayBuffer.isView(value)
        ? (() => {
            const copy = (value as Uint8Array).slice();
            const bytes = new Uint8Array(copy.buffer);
            bytes[0] = (bytes[0] as number) ^ 1;
            return copy;
          })()
        : ['other'];
      expect(sameMesh(a, { ...a, [key]: changed }), key).toBe(false);
      const gone = { ...a };
      delete gone[key];
      expect(sameMesh(a, gone), key).toBe(false);
    }
    expect(sameMesh(a, { ...a, mesh: true })).toBe(false);
    expect(sameMesh({ ...a, mesh: false }, { ...a, mesh: true })).toBe(false);
    // The same bytes in another kind of array.
    expect(sameMesh(a, { ...a, edgeFlags: new Int8Array([0]) as unknown as Uint8Array })).toBe(
      false,
    );
    // A field this doesn't know.
    expect(
      sameMesh({ ...a, extra: { x: 1 } } as BodyMesh, { ...a, extra: { x: 1 } } as BodyMesh),
    ).toBe(false);
  });
});
