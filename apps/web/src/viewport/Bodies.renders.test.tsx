// @vitest-environment jsdom
/**
 * Counted renders of the bodies (ADR-0159 §5): `Bodies` renders with every render of the view
 * (a hover, a document change), and each `Body` now renders only when one of its props changes.
 * A body counts a render through its object name, which it asks for once a render.
 */
import type { BodyId, BodyMeta, SelectionItem } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { cleanup, render } from '@testing-library/react';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SectionClip } from '../section/clip';
import { topologyItem } from '../selection/items';
import { boxMesh } from '../selection/testing';
import type { Rgba } from './colors';

const named = vi.hoisted(() => ({ n: 0 }));
vi.mock('@react-three/fiber', () => ({
  useThree: (pick: (s: unknown) => unknown) =>
    pick({ invalidate: () => {}, size: { width: 800, height: 600 } }),
  useFrame: () => {},
}));
vi.mock('./snapshotView', async (importOriginal) => {
  const real = await importOriginal<typeof import('./snapshotView')>();
  return {
    ...real,
    bodyObjectName: (id: string) => {
      named.n++;
      return real.bodyObjectName(id);
    },
  };
});
vi.mock('./SectionCap', () => ({ SectionCap: () => null }));
const { Bodies } = await import('./Bodies');

// react-dom doesn't know three's elements (`group`, `mesh`, `primitive`): it says so.
let quiet: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  // A body's group takes its pose in a layout effect (`usePose`): give react-dom's stand-in
  // element the parts of a three.js object it sets.
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
const onBounds = () => {};
const ids = Array.from({ length: 30 }, (_, i) => `b${i}` as BodyId);
const meshes = (): Record<BodyId, BodyMesh> =>
  Object.fromEntries(
    ids.map((id, i) => [id, boxMesh([i * 20, 0, 0], [i * 20 + 10, 10, 10])]),
  ) as Record<BodyId, BodyMesh>;
const meta: Record<BodyId, BodyMeta> = {};

type Props = Parameters<typeof Bodies>[0];

function view(first: Partial<Props> = {}) {
  const bodies = meshes();
  const props = (more: Partial<Props>): Props => ({
    bodies,
    meta,
    style: 'shadedEdges',
    body: ink,
    edge: ink,
    highlight: accent,
    onBounds,
    ...first,
    ...more,
  });
  const out = render(<Bodies {...props({})} />);
  named.n = 0;
  return {
    bodies,
    /** A render of the view: new elements, the given props changed. */
    again: (more: Partial<Props> = {}) => {
      named.n = 0;
      out.rerender(<Bodies {...props(more)} />);
      return named.n;
    },
  };
}

describe('Bodies renders', () => {
  it('a render of the view with the same props renders no body', () => {
    const { again } = view();
    expect(again()).toBe(0);
    expect(again()).toBe(0);
  });

  it('a hover on one body renders that body only, and leaving it renders it again', () => {
    const { again } = view();
    const face: SelectionItem = topologyItem({ kind: 'face', body: ids[7] as BodyId, index: 2 });
    expect(again({ hover: face })).toBe(1);
    expect(again({ hover: face })).toBe(0);
    expect(again({ hover: undefined })).toBe(1);
  });

  it('a new mesh for one body renders that body only', () => {
    const { again, bodies } = view();
    const edited = { ...bodies, [ids[3] as BodyId]: boxMesh([60, 0, 0], [72, 10, 10]) };
    expect(again({ bodies: edited })).toBe(1);
  });

  it('with a section and a thickness check on, a render renders no body', () => {
    const clips: readonly SectionClip[] = [{ origin: [0, 0, 5], normal: [0, 0, 1] }];
    const section = { clips, color: ink, hatch: ink };
    const thin = Object.fromEntries(ids.map((id) => [id, new Float32Array(24)])) as Record<
      BodyId,
      Float32Array
    >;
    const thickness = { thin, color: accent };
    const { again } = view({ section, thickness });
    expect(again()).toBe(0);
    // A new section (dragged) renders every body: they all take its planes.
    const moved = {
      ...section,
      clips: [{ origin: [0, 0, 6], normal: [0, 0, 1] }] as SectionClip[],
    };
    expect(again({ section: moved })).toBe(30);
  });

  it('a new accent renders every body (a theme change)', () => {
    const { again } = view();
    expect(again({ highlight: { ...accent } })).toBe(30);
  });
});
