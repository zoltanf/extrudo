// @vitest-environment jsdom
import { planeFrame, type SketchData, type SketchFrame } from '@extrudo/core';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { renderHook } from '@testing-library/react';
import { type Mesh, MeshBasicMaterial, ShapeUtils, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSketchFill } from './SketchFill';

const rectangle = (w: number): SketchData =>
  ({
    entities: {
      a: { type: 'point', x: 0, y: 0 },
      b: { type: 'point', x: w, y: 0 },
      c: { type: 'point', x: w, y: 5 },
      d: { type: 'point', x: 0, y: 5 },
      ab: { type: 'line', start: 'a', end: 'b', construction: false },
      bc: { type: 'line', start: 'b', end: 'c', construction: false },
      cd: { type: 'line', start: 'c', end: 'd', construction: false },
      da: { type: 'line', start: 'd', end: 'a', construction: false },
    },
    constraints: {},
    dimensions: {},
  }) as unknown as SketchData;

const xy = planeFrame({ kind: 'plane', id: 'origin:xy' }) as SketchFrame;
const materials = [new MeshBasicMaterial(), new MeshBasicMaterial(), new MeshBasicMaterial()];

afterEach(() => vi.restoreAllMocks());

function setup() {
  const build = vi.spyOn(ShapeUtils, 'triangulateShape');
  const profiles = detectProfiles(rectangle(10));
  const id = (profiles[0] as { id: string }).id;
  interface Props {
    profiles: typeof profiles | undefined;
    frame: SketchFrame;
    hover?: string;
    selected: readonly string[];
  }
  const initialProps: Props = { profiles, frame: xy, selected: [] };
  const view = renderHook(
    (p: Props) => useSketchFill(p.profiles, p.frame, p.hover, p.selected, materials),
    { initialProps },
  );
  return { build, profiles, id, view };
}

const groups = (mesh: Mesh | undefined) => mesh?.geometry.groups.map((g) => g.materialIndex);

describe('useSketchFill', () => {
  it('builds the triangles once, whatever a selection does', () => {
    const { build, profiles, id, view } = setup();
    expect(build).toHaveBeenCalledTimes(1);
    expect(groups(view.result.current)).toEqual([0]);
    view.rerender({ profiles, frame: xy, selected: [id] });
    expect(groups(view.result.current)).toEqual([2]);
    // A new list with the same regions, as every render of the shell makes.
    view.rerender({ profiles, frame: xy, selected: [id] });
    view.rerender({ profiles, frame: xy, selected: [] });
    expect(groups(view.result.current)).toEqual([0]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('builds nothing for a hover', () => {
    const { build, profiles, id, view } = setup();
    const mesh = view.result.current;
    view.rerender({ profiles, frame: xy, hover: id, selected: [] });
    expect(groups(view.result.current)).toEqual([1]);
    view.rerender({ profiles, frame: xy, selected: [] });
    expect(groups(view.result.current)).toEqual([0]);
    expect(view.result.current).toBe(mesh);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('builds nothing for a kernel report: a new frame only moves the mesh', () => {
    const { build, profiles, view } = setup();
    const mesh = view.result.current as Mesh;
    view.rerender({ profiles, frame: { ...xy }, selected: [] });
    const moved: SketchFrame = { ...xy, origin: [1, 2, 3] };
    view.rerender({ profiles, frame: moved, selected: [] });
    expect(view.result.current).toBe(mesh);
    expect(new Vector3().setFromMatrixPosition(mesh.matrix).toArray()).toEqual([1, 2, 3]);
    expect(mesh.matrixWorldNeedsUpdate).toBe(true);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('builds again for new regions, and frees the old mesh', () => {
    const { build, view } = setup();
    const mesh = view.result.current as Mesh;
    const freed = vi.spyOn(mesh.geometry, 'dispose');
    view.rerender({ profiles: detectProfiles(rectangle(20)), frame: xy, selected: [] });
    expect(build).toHaveBeenCalledTimes(2);
    expect(view.result.current).not.toBe(mesh);
    expect(freed).toHaveBeenCalled();
  });

  it('builds nothing for a sketch past the budget', () => {
    const build = vi.spyOn(ShapeUtils, 'triangulateShape');
    const view = renderHook(() => useSketchFill(undefined, xy, undefined, [], materials));
    expect(view.result.current).toBeUndefined();
    expect(build).not.toHaveBeenCalled();
  });
});
