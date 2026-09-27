import type { BodyId, BodyMeta, SelectionItem } from '@extrudo/core';
import { type BodyMesh, EDGE_SEAM } from '@extrudo/kernel';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Box3, BufferAttribute, BufferGeometry, Color, GreaterDepth, Sphere } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import {
  type BodyHighlight,
  bodyHighlight,
  edgeSegmentsOf,
  type FacePalette,
  paintFaces,
  vertexPositions,
} from '../selection/highlight';
import type { Rgba } from './colors';
import { createDotMaterial } from './dots';
import type { Bounds, VisualStyle } from './store';

/**
 * Body meshes from the model store, drawn in the chosen visual style
 * (FR-VP-03): faces as one geometry per body, B-rep edges as screen-space
 * lines (architecture §5.4). Hovered and selected faces are tinted through
 * the geometry's colour attribute; hovered and selected edges and vertices
 * are drawn over the body in the accent (P2-03, ADR-0026). Vertices only
 * show as dots while hovered or selected.
 */

export interface BodiesProps {
  bodies: Record<BodyId, BodyMesh>;
  meta: Record<BodyId, BodyMeta>;
  style: VisualStyle;
  body: Rgba;
  edge: Rgba;
  /** The selection accent. */
  highlight: Rgba;
  /** The item under the pointer (session hover). */
  hover?: SelectionItem;
  /** The session's selection. */
  selection?: readonly SelectionItem[];
  onBounds(bounds: Bounds | undefined): void;
}

const NO_SELECTION: readonly SelectionItem[] = [];

export function Bodies({
  bodies,
  meta,
  style,
  body,
  edge,
  highlight,
  hover,
  selection = NO_SELECTION,
  onBounds,
}: BodiesProps) {
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
      accent={highlight}
      marks={bodyHighlight(id, mesh, hover, selection)}
    />
  ));
}

function hex(value: string): Rgba {
  const n = Number.parseInt(value.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

/** The bounding sphere and box of the visible bodies, or `undefined` if there are none. */
export function boundsOf(meshes: readonly BodyMesh[]): Bounds | undefined {
  const box = new Box3();
  for (const mesh of meshes) {
    if (mesh.positions.length >= 3) box.union(new Box3().setFromArray(mesh.positions));
  }
  if (box.isEmpty()) return undefined;
  const sphere = box.getBoundingSphere(new Sphere());
  return {
    center: [sphere.center.x, sphere.center.y, sphere.center.z],
    radius: sphere.radius,
    box: { min: box.min.toArray(), max: box.max.toArray() },
  };
}

function Body({
  mesh,
  style,
  body,
  edge,
  accent,
  marks,
}: {
  mesh: BodyMesh;
  style: VisualStyle;
  body: Rgba;
  edge: Rgba;
  accent: Rgba;
  marks: BodyHighlight;
}) {
  const faces = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(mesh.positions.length), 3));
    g.setIndex(new BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  useFaceColors(faces, mesh, body, accent, marks.faces);
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
            vertexColors
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
      <EdgeMarks mesh={mesh} edges={marks.selectedEdges} color={accent} width={3} />
      <EdgeMarks mesh={mesh} edges={marks.hoverEdges} color={accent} width={2.5} over />
      <VertexMarks mesh={mesh} vertices={marks.selectedVertices} color={accent} />
      <VertexMarks mesh={mesh} vertices={marks.hoverVertices} color={accent} />
    </group>
  );
}

const linear = (c: Rgba): [number, number, number] => {
  const l = new Color().setRGB(c.r, c.g, c.b, 'srgb');
  return [l.r, l.g, l.b];
};

/**
 * Keeps the faces' colour attribute in step with the body colour and the
 * face states: a state change rewrites only the nodes of the faces it
 * touches and uploads that range (architecture §5.4). The scene asks for a
 * frame after every render, so the new colours show.
 */
function useFaceColors(
  faces: BufferGeometry,
  mesh: BodyMesh,
  body: Rgba,
  accent: Rgba,
  states: Uint8Array,
) {
  const painted = useRef<{ geometry: BufferGeometry; key: string; states: Uint8Array }>(undefined);
  useLayoutEffect(() => {
    const attribute = faces.getAttribute('color') as BufferAttribute;
    const palette: FacePalette = { base: linear(body), accent: linear(accent) };
    const key = `${palette.base.join()}/${palette.accent.join()}`;
    const last = painted.current;
    const previous = last?.geometry === faces && last.key === key ? last.states : undefined;
    const range = paintFaces(attribute.array as Float32Array, mesh, states, palette, previous);
    painted.current = { geometry: faces, key, states };
    if (!range) return;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(range[0] * 3, range[1] * 3);
    attribute.needsUpdate = true;
  }, [faces, mesh, body, accent, states]);
}

/** Edges drawn over the body in the accent: selected ones, or the one under the pointer. */
function EdgeMarks({
  mesh,
  edges,
  color,
  width,
  over = false,
}: {
  mesh: BodyMesh;
  edges: readonly number[];
  color: Rgba;
  width: number;
  /** Drawn over everything, so a hidden edge offered by "Select other…" shows. */
  over?: boolean;
}) {
  const key = edges.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `edges`.
  const line = useMemo(() => {
    if (edges.length === 0) return undefined;
    const g = new LineSegmentsGeometry();
    g.setPositions(edgeSegmentsOf(mesh, edges));
    const m = new LineMaterial({ linewidth: width, transparent: true, depthTest: !over });
    const l = new LineSegments2(g, m);
    l.renderOrder = over ? 6 : 2;
    return l;
  }, [mesh, key, width, over]);
  useEffect(
    () => () => {
      line?.geometry.dispose();
      line?.material.dispose();
    },
    [line],
  );
  if (!line) return null;
  line.material.color = new Color().setRGB(color.r, color.g, color.b, 'srgb');
  line.material.opacity = color.a;
  return <primitive object={line} />;
}

/** B-rep vertices as dots: only the selected ones and the one under the pointer. */
function VertexMarks({
  mesh,
  vertices,
  color,
}: {
  mesh: BodyMesh;
  vertices: readonly number[];
  color: Rgba;
}) {
  const key = vertices.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `vertices`.
  const geometry = useMemo(() => {
    if (vertices.length === 0) return undefined;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(vertexPositions(mesh, vertices), 3));
    return g;
  }, [mesh, key]);
  const dots = useMemo(() => createDotMaterial(), []);
  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => dots.material.dispose(), [dots]);
  if (!geometry) return null;
  dots.uniforms.uColor.value = new Color().setRGB(color.r, color.g, color.b, 'srgb');
  dots.uniforms.uAlpha.value = color.a;
  return (
    <points
      geometry={geometry}
      material={dots.material}
      renderOrder={7}
      frustumCulled={false}
      onBeforeRender={(renderer) => {
        dots.uniforms.uSize.value = 8 * renderer.getPixelRatio();
      }}
    />
  );
}

/**
 * Edge polylines as line-segment pairs (xyz xyz per segment). Seams are left
 * out: they are B-rep edges, but not lines anyone sees on the part.
 */
export function edgeSegments(mesh: BodyMesh): Float32Array {
  const { edgePoints, edgeRanges, edgeFlags } = mesh;
  const edges = edgeRanges.length >> 1;
  const drawn = (e: number) => ((edgeFlags[e] ?? 0) & EDGE_SEAM) === 0;
  let count = 0;
  for (let e = 0; e < edges; e++) {
    if (drawn(e)) count += Math.max(0, (edgeRanges[2 * e + 1] ?? 0) - 1);
  }
  const out = new Float32Array(count * 6);
  let o = 0;
  for (let e = 0; e < edges; e++) {
    if (!drawn(e)) continue;
    const first = edgeRanges[2 * e] ?? 0;
    const n = edgeRanges[2 * e + 1] ?? 0;
    for (let i = 0; i + 1 < n; i++) {
      const a = (first + i) * 3;
      out.set(edgePoints.subarray(a, a + 6), o);
      o += 6;
    }
  }
  return out;
}
