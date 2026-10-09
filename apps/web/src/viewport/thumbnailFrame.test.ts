import { describe, expect, it } from 'vitest';
import { applyView } from './applyView';
import { homeView, orientationFor, type Projection, type View, viewProject } from './camera';
import { THUMBNAIL_MARGIN, thumbnailView } from './thumbnailFrame';

const corners = (min: number[], max: number[]) => {
  const out: [number, number, number][] = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) out.push([x as number, y as number, z as number]);
  return out;
};

/** The corners' NDC extent through the thumbnail view. */
function extent(view: View, projection: Projection, min: number[], max: number[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const c of corners(min, max)) {
    const p = viewProject(view, projection, 1, c);
    if (!p) throw new Error('behind the camera');
    xs.push(p[0]);
    ys.push(p[1]);
  }
  return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] };
}

describe('thumbnailView', () => {
  const view: View = { ...homeView(), shift: 0.3 };
  for (const projection of ['orthographic', 'perspective'] as const) {
    it(`centres a box away from the origin (${projection})`, () => {
      const min = [100, -40, 20];
      const max = [140, -20, 60];
      const framed = thumbnailView(view, { min: min as never, max: max as never }, projection);
      expect(framed.shift).toBeUndefined();
      expect(framed.target).toEqual([120, -30, 40]);
      expect(framed.orientation).toEqual(view.orientation);
      const e = extent(framed, projection, min, max);
      // Centred, and clear of every edge by about the margin.
      expect(Math.abs((e.x[0] as number) + (e.x[1] as number))).toBeLessThan(0.15);
      expect(Math.abs((e.y[0] as number) + (e.y[1] as number))).toBeLessThan(0.15);
      const limit = 1 - 2 * THUMBNAIL_MARGIN;
      expect(Math.max(...e.x.map(Math.abs), ...e.y.map(Math.abs))).toBeLessThanOrEqual(
        limit + 0.02,
      );
      expect(Math.max(...e.x.map(Math.abs), ...e.y.map(Math.abs))).toBeGreaterThan(limit - 0.1);
    });
  }

  it('fits the long side of a thin body with the margin', () => {
    const front = { ...homeView(), orientation: orientationFor([0, -1, 0]) };
    const min = [-100, -2, -5];
    const max = [100, 2, 5];
    const framed = thumbnailView(front, { min: min as never, max: max as never }, 'orthographic');
    // 200 mm long takes 76 % of the height.
    expect(framed.size).toBeCloseTo(200 / (1 - 2 * THUMBNAIL_MARGIN), 6);
    const e = extent(framed, 'orthographic', min, max);
    expect(e.x[1]).toBeCloseTo(1 - 2 * THUMBNAIL_MARGIN, 6);
    expect(e.y[1]).toBeLessThan(0.1);
  });

  it('uses a square camera with no view offset', async () => {
    const { OrthographicCamera } = await import('three');
    const framed = thumbnailView(view, { min: [0, 0, 0], max: [10, 10, 10] }, 'orthographic');
    const camera = new OrthographicCamera();
    applyView(camera, framed, 'orthographic', 1);
    expect(camera.view?.enabled ?? false).toBe(false);
  });
});
