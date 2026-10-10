import type { BodyId, BodyMeta } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, Color, type Plane } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { SectionClip } from '../section/clip';
import { edgeSegments } from './bodyGeometry';
import { ghostBodies } from './bodyGhosts';
import { clipPlanes } from './clipPlanes';
import type { Rgba } from './colors';

/**
 * Bodies drawn as ghosts (ADR-0030's amendment, 2026-10-09): a vague grey shape
 * at 30 % opacity, drawn by a small separate component so none of the
 * selection, analysis or section-cap machinery touches it. A ghost takes no
 * picks, no highlights, no silhouettes and no part in Fit. Its faces and edges
 * are clipped by the section planes like the other bodies (P3-09), with no cap.
 */
export function GhostBodies({
  bodies,
  meta,
  color,
  edge,
  section,
}: {
  bodies: Readonly<Record<BodyId, BodyMesh>>;
  meta: Record<BodyId, BodyMeta>;
  /** The ghost bodies' flat grey. */
  color: Rgba;
  /** The edge colour; the ghost's edges are drawn at a quarter of its alpha. */
  edge: Rgba;
  section?: { clips: readonly SectionClip[] };
}) {
  const ghosts = useMemo(() => ghostBodies(bodies, meta), [bodies, meta]);
  const planes = useMemo(() => clipPlanes(section?.clips) ?? null, [section?.clips]);
  return ghosts.map(([id, mesh]) => (
    <GhostBody key={id} mesh={mesh} color={color} edge={edge} planes={planes} />
  ));
}

/** 30 % opacity: the vague grey a ghost is drawn at. */
const GHOST_OPACITY = 0.3;

/** The edge alpha's share for a ghost (about a quarter of a body's edges). */
const GHOST_EDGE_ALPHA = 0.25;

function GhostBody({
  mesh,
  color,
  edge,
  planes,
}: {
  mesh: BodyMesh;
  color: Rgba;
  edge: Rgba;
  planes: Plane[] | null;
}) {
  const faces = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    g.setIndex(new BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  const edges = useMemo(() => {
    const g = new LineSegmentsGeometry();
    g.setPositions(edgeSegments(mesh));
    return g;
  }, [mesh]);
  useEffect(
    () => () => {
      faces.dispose();
      edges.dispose();
    },
    [faces, edges],
  );

  const faceColor = useMemo(() => new Color().setRGB(color.r, color.g, color.b, 'srgb'), [color]);
  const edgeMaterial = useMemo(
    () => new LineMaterial({ linewidth: 1.25, transparent: true, depthWrite: false }),
    [],
  );
  useEffect(() => () => edgeMaterial.dispose(), [edgeMaterial]);
  edgeMaterial.color = new Color().setRGB(edge.r, edge.g, edge.b, 'srgb');
  edgeMaterial.opacity = edge.a * GHOST_EDGE_ALPHA;
  edgeMaterial.clippingPlanes = planes;
  const lines = useMemo(() => new LineSegments2(edges, edgeMaterial), [edges, edgeMaterial]);

  return (
    <group>
      <mesh geometry={faces}>
        <meshStandardMaterial
          color={faceColor}
          roughness={0.9}
          metalness={0}
          // `transparent` from creation, never toggled (ADR-0030's amendment:
          // three bakes OPAQUE while it is false and never recompiles).
          transparent
          opacity={GHOST_OPACITY}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          clippingPlanes={planes}
        />
      </mesh>
      <primitive object={lines} />
    </group>
  );
}
