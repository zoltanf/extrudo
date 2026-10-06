import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { Color, type Group } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Rgba } from './colors';
import { type Ghost, ghostSegments } from './ghostGeometry';
import type { ViewportStore } from './store';

/** Dash and gap, px (as the sketches' construction curves). */
const DASH = 6;
const GAP = 4;
/** A vertex's cross, as a share of the view size (a construction point's size). */
export const GHOST_CROSS = 0.02;

/**
 * Ghosts of lost geometry (P4-12): dashed marks in the error colour where a
 * lost or guessed reference's geometry was. No depth test, so a ghost inside a
 * body shows; dashes and a vertex's cross keep a steady size on screen.
 */
export function Ghosts({
  store,
  ghosts,
  color,
}: {
  store: ViewportStore;
  ghosts: readonly Ghost[];
  color: Rgba;
}) {
  const height = useThree((s) => s.size.height);
  const material = useMemo(
    () =>
      new LineMaterial({
        linewidth: 1.75,
        transparent: true,
        dashed: true,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);
  material.color = new Color().setRGB(color.r, color.g, color.b, 'srgb');
  material.opacity = color.a;
  useFrame(() => {
    const perPixel = store.getState().view.size / Math.max(1, height);
    material.dashSize = DASH * perPixel;
    material.gapSize = GAP * perPixel;
  });
  return (
    <>
      {ghosts.map((g) => (
        <GhostMarks
          key={`${g.feature}:${g.kind}:${g.fingerprint.at.join(',')}:${g.type}`}
          store={store}
          ghost={g}
          material={material}
        />
      ))}
    </>
  );
}

function GhostMarks({
  store,
  ghost,
  material,
}: {
  store: ViewportStore;
  ghost: Ghost;
  material: LineMaterial;
}) {
  const group = useRef<Group>(null);
  const vertex = ghost.kind === 'vertex';
  const line = useMemo(() => {
    // A vertex's cross is a unit one at the origin of a group that scales with the view.
    const segments = vertex
      ? ghostSegments({ type: 'point', at: [0, 0, 0] }, 'vertex', 1)
      : ghostSegments(ghost.fingerprint, ghost.kind);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(segments);
    const l = new LineSegments2(geometry, material);
    l.computeLineDistances();
    l.renderOrder = 6;
    l.frustumCulled = false;
    return l;
  }, [ghost, vertex, material]);
  useEffect(() => () => line.geometry.dispose(), [line]);
  useFrame(() => {
    if (vertex) group.current?.scale.setScalar(store.getState().view.size * GHOST_CROSS);
  });
  const at = ghost.at;
  return (
    <group ref={group} {...(vertex && { position: [at[0], at[1], at[2]] })}>
      <primitive object={line} />
    </group>
  );
}
