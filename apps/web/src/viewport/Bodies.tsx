import type { BodyId, BodyMeta } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useEffect, useMemo } from 'react';
import { Box3, BufferAttribute, BufferGeometry, Color, GreaterDepth, Sphere } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Rgba } from './colors';
import type { Bounds, VisualStyle } from './store';

/**
 * Body meshes from the model store, drawn in the chosen visual style
 * (FR-VP-03): faces as one geometry per body, B-rep edges as screen-space
 * lines (architecture §5.4).
 */

export interface BodiesProps {
  bodies: Record<BodyId, BodyMesh>;
  meta: Record<BodyId, BodyMeta>;
  style: VisualStyle;
  body: Rgba;
  edge: Rgba;
  onBounds(bounds: Bounds | undefined): void;
}

export function Bodies({ bodies, meta, style, body, edge, onBounds }: BodiesProps) {
  const shown = useMemo(
    () =>
      (Object.entries(bodies) as [BodyId, BodyMesh][]).filter(([id]) => meta[id]?.visible ?? true),
    [bodies, meta],
  );
  const bounds = useMemo(() => boundsOf(shown.map(([, mesh]) => mesh)), [shown]);
  useEffect(() => onBounds(bounds), [bounds, onBounds]);

  return shown.map(([id, mesh]) => (
    <Body
      key={id}
      mesh={mesh}
      style={style}
      body={meta[id]?.color ? hex(meta[id].color) : body}
      edge={edge}
    />
  ));
}

function hex(value: string): Rgba {
  const n = Number.parseInt(value.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

/** The bounding sphere of the visible bodies, or `undefined` if there are none. */
export function boundsOf(meshes: readonly BodyMesh[]): Bounds | undefined {
  const box = new Box3();
  for (const mesh of meshes) {
    if (mesh.positions.length >= 3) box.union(new Box3().setFromArray(mesh.positions));
  }
  if (box.isEmpty()) return undefined;
  const sphere = box.getBoundingSphere(new Sphere());
  return { center: [sphere.center.x, sphere.center.y, sphere.center.z], radius: sphere.radius };
}

function Body({
  mesh,
  style,
  body,
  edge,
}: {
  mesh: BodyMesh;
  style: VisualStyle;
  body: Rgba;
  edge: Rgba;
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

  const bodyColor = new Color().setRGB(body.r, body.g, body.b, 'srgb');
  const edgeColor = new Color().setRGB(edge.r, edge.g, edge.b, 'srgb');
  const visibleEdges = useMemo(() => new LineMaterial({ linewidth: 1.25, transparent: true }), []);
  const hiddenEdges = useMemo(
    () =>
      new LineMaterial({
        linewidth: 1,
        transparent: true,
        depthFunc: GreaterDepth,
        depthWrite: false,
      }),
    [],
  );
  useEffect(
    () => () => {
      visibleEdges.dispose();
      hiddenEdges.dispose();
    },
    [visibleEdges, hiddenEdges],
  );
  visibleEdges.color = edgeColor;
  visibleEdges.opacity = edge.a;
  hiddenEdges.color = edgeColor;
  hiddenEdges.opacity = edge.a * 0.35;

  const showFaces = style !== 'wireframe';
  const showEdges = style !== 'shaded';
  const edgeLines = useMemo(() => new LineSegments2(edges, visibleEdges), [edges, visibleEdges]);
  const hiddenLines = useMemo(() => new LineSegments2(edges, hiddenEdges), [edges, hiddenEdges]);

  return (
    <group>
      {showFaces && (
        <mesh geometry={faces}>
          <meshStandardMaterial
            color={bodyColor}
            roughness={0.62}
            metalness={0.05}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
      )}
      {showEdges && <primitive object={edgeLines} />}
      {style === 'hiddenEdges' && <primitive object={hiddenLines} />}
    </group>
  );
}

/** Edge polylines as line-segment pairs (xyz xyz per segment). */
export function edgeSegments(mesh: BodyMesh): Float32Array {
  const { edgePoints, edgeRanges } = mesh;
  let count = 0;
  for (let e = 0; e + 1 < edgeRanges.length; e += 2)
    count += Math.max(0, (edgeRanges[e + 1] ?? 0) - 1);
  const out = new Float32Array(count * 6);
  let o = 0;
  for (let e = 0; e + 1 < edgeRanges.length; e += 2) {
    const first = edgeRanges[e] ?? 0;
    const n = edgeRanges[e + 1] ?? 0;
    for (let i = 0; i + 1 < n; i++) {
      const a = (first + i) * 3;
      out.set(edgePoints.subarray(a, a + 6), o);
      o += 6;
    }
  }
  return out;
}
