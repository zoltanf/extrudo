import { Matrix3, type Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { basis, orientationFor } from './camera';
import { allHotspots, directionName, FACES, faceCells, faceOn, namedDirection } from './viewcube';

describe('ViewCube hotspots', () => {
  it('has 6 faces, 12 edges and 8 corners with unique names', () => {
    const all = allHotspots();
    expect(all).toHaveLength(26);
    const count = (kind: string) => all.filter((h) => h.kind === kind).length;
    expect([count('face'), count('edge'), count('corner')]).toEqual([6, 12, 8]);
    expect(new Set(all.map((h) => h.name)).size).toBe(26);
  });

  it('names directions Top/Bottom, then Front/Back, then Left/Right', () => {
    expect(directionName([0, 0, 1])).toBe('Top');
    expect(directionName([0, -1, 1])).toBe('Top Front');
    expect(directionName([1, -1, 1])).toBe('Top Front Right');
    expect(directionName([-1, 1, -1])).toBe('Bottom Back Left');
  });

  it('shows each edge on two faces and each corner on three', () => {
    const cells = FACES.flatMap(faceCells);
    const times = new Map<string, number>();
    for (const c of cells) times.set(c.name, (times.get(c.name) ?? 0) + 1);
    for (const h of allHotspots()) {
      expect(times.get(h.name)).toBe(h.kind === 'face' ? 1 : h.kind === 'edge' ? 2 : 3);
    }
  });

  it('lays out each face as its label reads: top-left corner, top edge, …', () => {
    const top = FACES.find((f) => f.name === 'Top');
    if (!top) throw new Error('no top');
    // Seen from above with +Y up, the top-left corner of the Top face is Top Back Left.
    expect(faceCells(top).map((c) => c.name)).toEqual([
      'Top Back Left',
      'Top Back',
      'Top Back Right',
      'Top Left',
      'Top',
      'Top Right',
      'Top Front Left',
      'Top Front',
      'Top Front Right',
    ]);
    const front = FACES.find((f) => f.name === 'Front');
    if (!front) throw new Error('no front');
    expect(faceCells(front)[0]?.name).toBe('Top Front Left');
  });

  it("orients every face's label like the camera in that face's standard view", () => {
    for (const face of FACES) {
      const b = basis({ target: [0, 0, 0], orientation: orientationFor(face.normal), size: 1 });
      const eq = (v: Vector3, w: readonly number[]) =>
        [v.x, v.y, v.z].forEach((c, i) => {
          expect(c).toBeCloseTo(w[i] ?? Number.NaN, 9);
        });
      eq(b.right, face.right);
      eq(b.up.negate(), face.down);
    }
  });

  it('uses face frames that CSS can draw (a reflection, matching the y-down screen)', () => {
    for (const face of FACES) {
      const m = new Matrix3().set(...face.right, ...face.down, ...face.normal).transpose();
      expect(m.determinant()).toBeCloseTo(-1, 12);
    }
  });

  it('recognises face-on and named views', () => {
    expect(faceOn([0, 0, 1])?.name).toBe('Top');
    expect(faceOn([0.1, 0, 0.99])).toBeUndefined();
    const s = Math.SQRT1_2;
    expect(namedDirection([0, -s, s])?.name).toBe('Top Front');
    const c = 1 / Math.sqrt(3);
    expect(namedDirection([c, -c, c])?.name).toBe('Top Front Right');
    expect(namedDirection([0.2, -0.5, 0.84])).toBeUndefined();
  });
});
