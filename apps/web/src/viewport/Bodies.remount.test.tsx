// @vitest-environment jsdom
/**
 * Bodies that mount again take what they built before (ADR-0102 §10): when a feature dialog
 * closes, the bodies after the edited feature mount again with the same meshes. Builds are
 * counted through the two functions that do them; no clock.
 */
import type { BodyId, BodyMeta } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { cleanup, render } from '@testing-library/react';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { boxMesh } from '../selection/testing';
import type { Rgba } from './colors';

const built = vi.hoisted(() => ({ edges: 0, paints: 0 }));
vi.mock('@react-three/fiber', () => ({
  useThree: (pick: (s: unknown) => unknown) =>
    pick({ invalidate: () => {}, size: { width: 800, height: 600 } }),
  useFrame: () => {},
}));
vi.mock('./SectionCap', () => ({ SectionCap: () => null }));
vi.mock('./bodyGeometry', async (importOriginal) => {
  const real = await importOriginal<typeof import('./bodyGeometry')>();
  return {
    ...real,
    edgeSegments: (mesh: BodyMesh) => {
      built.edges++;
      return real.edgeSegments(mesh);
    },
  };
});
vi.mock('../selection/highlight', async (importOriginal) => {
  const real = await importOriginal<typeof import('../selection/highlight')>();
  return {
    ...real,
    paintFaces: (...args: Parameters<typeof real.paintFaces>) => {
      // A whole painting only (no states it paints over): what a new geometry needs.
      if (args[4] === undefined) built.paints++;
      return real.paintFaces(...args);
    },
  };
});
const { Bodies } = await import('./Bodies');

let quiet: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const [key, make] of [
    ['matrix', () => new Matrix4()],
    ['position', () => new Vector3()],
    ['quaternion', () => new Quaternion()],
    ['scale', () => new Vector3()],
  ] as const) {
    Object.defineProperty(HTMLUnknownElement.prototype, key, { get: make, configurable: true });
  }
});
afterAll(() => quiet.mockRestore());
afterEach(cleanup);

const ink: Rgba = { r: 0.2, g: 0.2, b: 0.2, a: 1 };
const accent: Rgba = { r: 1, g: 0.5, b: 0, a: 1 };
const ids = Array.from({ length: 30 }, (_, i) => `b${i}` as BodyId);
const meta: Record<BodyId, BodyMeta> = {};

function shown(bodies: Record<BodyId, BodyMesh>) {
  return (
    <Bodies
      bodies={bodies}
      meta={meta}
      style="shadedEdges"
      body={ink}
      edge={ink}
      highlight={accent}
      onBounds={() => {}}
    />
  );
}

describe('bodies that mount again (ADR-0102 §10)', () => {
  it('a dialog closing: 30 bodies mount again and build nothing; a changed one builds itself', () => {
    const all = Object.fromEntries(
      ids.map((id, i) => [id, boxMesh([i * 20, 0, 0], [i * 20 + 10, 10, 10])]),
    ) as Record<BodyId, BodyMesh>;
    built.edges = 0;
    built.paints = 0;
    const out = render(shown(all));
    expect(built).toEqual({ edges: 30, paints: 30 });
    // The dialog of the first body's feature opens: only what comes before it is shown.
    out.rerender(shown({}));
    built.edges = 0;
    built.paints = 0;
    // It closes: every body mounts again, the first with a new mesh.
    const after = { ...all, [ids[0] as BodyId]: boxMesh([0, 0, 0], [12, 10, 10]) };
    out.rerender(shown(after));
    expect(built).toEqual({ edges: 1, paints: 1 });
  });
});
