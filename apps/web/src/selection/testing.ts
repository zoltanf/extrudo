/** Test fixtures for model-mode selection: a hand-made B-rep cube mesh and cameras. */
import type { BodyMesh } from '@extrudo/kernel';
import { orientationFor, type Projection, type Vec3, type View } from '../viewport/camera';
import type { PickCamera } from './pick';

/**
 * An axis-aligned box from `min` to `max` as the kernel meshes one: six
 * faces with their own four nodes and two triangles each (in the order
 * −Z, +Z, −Y, +Y, −X, +X), twelve two-point edges and eight vertices.
 */
export function boxMesh(min: Vec3 = [0, 0, 0], max: Vec3 = [10, 10, 10]): BodyMesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const corner = (i: number): Vec3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  // Corners of each face, counter-clockwise from outside, and its normal.
  const faces: [number[], Vec3][] = [
    [
      [0, 2, 3, 1],
      [0, 0, -1],
    ],
    [
      [4, 5, 7, 6],
      [0, 0, 1],
    ],
    [
      [0, 1, 5, 4],
      [0, -1, 0],
    ],
    [
      [2, 6, 7, 3],
      [0, 1, 0],
    ],
    [
      [0, 4, 6, 2],
      [-1, 0, 0],
    ],
    [
      [1, 3, 7, 5],
      [1, 0, 0],
    ],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceRanges: number[] = [];
  faces.forEach(([corners, normal], f) => {
    const base = f * 4;
    for (const c of corners) {
      positions.push(...corner(c));
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    faceRanges.push(2 * f, 2);
  });
  const edgeCorners = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const edgePoints: number[] = [];
  const edgeRanges: number[] = [];
  edgeCorners.forEach(([a, b], e) => {
    edgePoints.push(...corner(a as number), ...corner(b as number));
    edgeRanges.push(2 * e, 2);
  });
  const vertices: number[] = [];
  for (let i = 0; i < 8; i++) vertices.push(...corner(i));
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    faceRanges: new Uint32Array(faceRanges),
    edgePoints: new Float32Array(edgePoints),
    edgeRanges: new Uint32Array(edgeRanges),
    edgeFlags: new Uint8Array(12),
    vertices: new Float32Array(vertices),
  };
}

/** A camera looking from `direction` at `target`, `size` mm tall, 800 × 600 px. */
export function cameraFrom(
  direction: Vec3,
  {
    target = [0, 0, 0],
    size = 100,
    projection = 'orthographic',
    width = 800,
    height = 600,
  }: {
    target?: Vec3;
    size?: number;
    projection?: Projection;
    width?: number;
    height?: number;
  } = {},
): PickCamera {
  const view: View = { target, orientation: orientationFor(direction), size };
  return { view, projection, width, height };
}

/**
 * Where a world point shows in a camera looking straight down (Top view,
 * orthographic): +X to the right, +Y up the screen.
 */
export function topViewPx(camera: PickCamera, x: number, y: number): [number, number] {
  const perPixel = camera.view.size / camera.height;
  const [tx, ty] = camera.view.target;
  return [camera.width / 2 + (x - tx) / perPixel, camera.height / 2 - (y - ty) / perPixel];
}
