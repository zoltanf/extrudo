import type { SketchFrame } from '@extrudo/core';
import type { Profile } from '@extrudo/sketch/profiles';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial } from 'three';
import type { Rgba } from './colors';
import { LineMarks } from './LineMarks';
import {
  type FillLayout,
  fillGroups,
  fillLayout,
  fillMatrix,
  noteUnbuiltFill,
  type ProfileFill,
  profileFill,
  regionOutlines,
} from './profileFills';
import { PROFILE_SHADES, type ProfileShade, type SketchDrawing } from './sketchGeometry';

const NONE: readonly string[] = [];

/**
 * The mesh of a sketch's fill. Only a new list of regions builds triangles:
 * the frame sets the mesh's matrix and the hover and selection its groups.
 */
export function useSketchFill(
  profiles: readonly Profile[] | undefined,
  frame: SketchFrame,
  hover: string | undefined,
  selected: readonly string[],
  materials: readonly MeshBasicMaterial[],
): Mesh | undefined {
  // No memory for the fill costs this sketch its shading, not the view.
  const fill = useMemo((): ProfileFill | null | undefined => {
    if (!profiles) return undefined;
    try {
      return profileFill(profiles);
    } catch (error) {
      console.warn('[sketch] no fill for a sketch:', error);
      return null;
    }
  }, [profiles]);
  useEffect(() => {
    if (fill === null && profiles) noteUnbuiltFill(profiles);
  }, [fill, profiles]);
  const mesh = useMemo(() => {
    if (!fill || fill.positions.length === 0) return undefined;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(fill.positions, 3));
    const out = new Mesh(geometry, materials as MeshBasicMaterial[]);
    // Coplanar with the grid and the curves: drawn after the grid, under the curves.
    out.renderOrder = 3;
    out.frustumCulled = false;
    out.matrixAutoUpdate = false;
    // Picking profiles is the tool host's (sketch plane maths), not R3F's.
    out.raycast = () => {};
    return out;
  }, [fill, materials]);
  useEffect(() => () => mesh?.geometry.dispose(), [mesh]);

  useLayoutEffect(() => {
    if (!mesh) return;
    mesh.matrix.copy(fillMatrix(frame));
    mesh.matrixWorldNeedsUpdate = true;
  }, [mesh, frame]);

  const layout = useRef<FillLayout | undefined>(undefined);
  const key = selected.join();
  // A selection lays the fill out: at most one pass over its vertices.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `selected`.
  useLayoutEffect(() => {
    if (!mesh || !fill) return;
    const { geometry } = mesh;
    try {
      layout.current = fillLayout(fill, selected, geometry.index?.array as Uint32Array | undefined);
    } catch (error) {
      console.warn('[sketch] no fill for a sketch:', error);
      layout.current = undefined;
      if (profiles) noteUnbuiltFill(profiles);
      return;
    }
    const { order } = layout.current;
    if (order && geometry.index) geometry.index.needsUpdate = true;
    else if (order) geometry.setIndex(new BufferAttribute(order, 1));
  }, [mesh, fill, profiles, key]);
  // A hover only cuts the hovered region out of its group.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `selected`.
  useLayoutEffect(() => {
    if (!mesh || !fill || !layout.current) return;
    mesh.geometry.clearGroups();
    for (const run of fillGroups(layout.current, fill, hover)) {
      mesh.geometry.addGroup(run.start, run.count, PROFILE_SHADES.indexOf(run.shade));
    }
  }, [mesh, fill, hover, key]);
  return mesh;
}

/** A sketch's closed regions: a pale fill, the one under the pointer and the selected ones in the accent. */
export function SketchFill({
  drawing,
  colors,
  highlight,
}: {
  drawing: SketchDrawing;
  /** Fills: plain, under the pointer, selected. */
  colors: Readonly<Record<ProfileShade, Rgba>>;
  /** What marks a region of a sketch without a fill. */
  highlight: Rgba;
}) {
  const { profiles, frame, hoverProfile, selectedProfiles = NONE, unshaded } = drawing;
  const materials = useMemo(
    () =>
      PROFILE_SHADES.map(
        () =>
          new MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            side: DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      for (const m of materials) m.dispose();
    },
    [materials],
  );
  const mesh = useSketchFill(
    unshaded ? undefined : profiles,
    frame,
    hoverProfile,
    selectedProfiles,
    materials,
  );
  // Sketches that aren't being edited stay visible, but step back.
  const alpha = drawing.active || drawing.highlight ? 1 : 0.55;
  PROFILE_SHADES.forEach((shade, i) => {
    const c = colors[shade];
    const material = materials[i] as MeshBasicMaterial;
    material.color = new Color().setRGB(c.r, c.g, c.b, 'srgb');
    material.opacity = c.a * alpha;
  });
  if (unshaded && profiles) {
    return (
      <RegionMarks
        profiles={profiles}
        frame={frame}
        hover={hoverProfile}
        selected={selectedProfiles}
        color={highlight}
      />
    );
  }
  return mesh ? <primitive object={mesh} /> : null;
}

/** The hovered and selected regions of a sketch without a fill, as outlines. */
function RegionMarks({
  profiles,
  frame,
  hover,
  selected,
  color,
}: {
  profiles: readonly Profile[];
  frame: SketchFrame;
  hover: string | undefined;
  selected: readonly string[];
  color: Rgba;
}) {
  const key = selected.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `selected`.
  const chosen = useMemo(() => regionOutlines(profiles, selected, frame), [profiles, frame, key]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `selected`.
  const hovered = useMemo(
    () =>
      hover === undefined || selected.includes(hover)
        ? new Float32Array()
        : regionOutlines(profiles, [hover], frame),
    [profiles, frame, hover, key],
  );
  return (
    <>
      <LineMarks positions={chosen} color={color} width={3} />
      <LineMarks positions={hovered} color={{ ...color, a: color.a * 0.75 }} width={2.5} />
    </>
  );
}
