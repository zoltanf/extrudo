import type { BodyId, BodyMeta, SelectionItem } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { useFrame } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  GreaterDepth,
  type Material,
  Plane,
  Vector3,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { OverhangView } from '../print/overhang';
import type { SectionClip } from '../section/clip';
import {
  type BodyHighlight,
  bodyHighlight,
  edgeSegmentsOf,
  type FacePalette,
  paintFaces,
  vertexPositions,
} from '../selection/highlight';
import { boundsOf, edgeSegments } from './bodyGeometry';
import { capColors, type Rgba } from './colors';
import { createDotMaterial } from './dots';
import { createOverhangShading } from './overhangShading';
import { SectionCap } from './SectionCap';
import {
  curvedFaces,
  type SilhouetteView,
  silhouetteCapacity,
  silhouetteSegments,
} from './silhouette';
import type { Bounds, VisualStyle } from './store';

/**
 * Body meshes from the model store, drawn in the chosen visual style
 * (FR-VP-03): faces as one geometry per body, B-rep edges as screen-space
 * lines (architecture §5.4). Hovered and selected faces are tinted through
 * the geometry's colour attribute; hovered and selected edges and vertices
 * are drawn over the body in the accent (P2-03, ADR-0026). Vertices only
 * show as dots while hovered or selected. Bodies take their stored colour
 * and opacity; in the wireframe and hidden-edge styles, curved faces show
 * their silhouette for the current camera (P2-08, ADR-0030). A section
 * analysis (P3-09, ADR-0045) clips faces, edges and silhouettes with a
 * clipping plane on their materials and caps the cut (`SectionCap`).
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
  /** Silhouette segments drawn per body, after each change (tests read the total). */
  onSilhouettes?(body: BodyId, segments: number): void;
  /** A section analysis (P3-09): what lies on the clip's side is not drawn, and the cut is capped. */
  section?: { clip: SectionClip; color: Rgba; hatch: Rgba };
  /** An overhang analysis (P3-10, ADR-0048): the faces it flags are shaded in `color`. */
  overhang?: { view: OverhangView; color: Rgba };
}

/** The clipping plane as three.js keeps it: it keeps what lies on its normal's side. */
export function clipPlanes(clip: SectionClip | undefined): Plane[] | undefined {
  if (!clip) return undefined;
  const n = new Vector3(-clip.normal[0], -clip.normal[1], -clip.normal[2]);
  return [
    new Plane(
      n,
      clip.normal[0] * clip.origin[0] +
        clip.normal[1] * clip.origin[1] +
        clip.normal[2] * clip.origin[2],
    ),
  ];
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
  onSilhouettes,
  section,
  overhang,
}: BodiesProps) {
  const shown = useMemo(
    () =>
      (Object.entries(bodies) as [BodyId, BodyMesh][]).filter(([id]) => meta[id]?.visible ?? true),
    [bodies, meta],
  );
  const bounds = useMemo(() => boundsOf(shown.map(([, mesh]) => mesh)), [shown]);
  useEffect(() => onBounds(bounds), [bounds, onBounds]);
  const clip = section?.clip;
  const planes = useMemo(() => clipPlanes(clip), [clip]);

  return shown.map(([id, mesh], index) => (
    <Body
      key={id}
      id={id}
      mesh={mesh}
      style={style}
      body={meta[id]?.color ? hex(meta[id].color) : body}
      opacity={meta[id]?.opacity ?? 1}
      edge={edge}
      accent={highlight}
      marks={bodyHighlight(id, mesh, hover, selection)}
      onSilhouettes={onSilhouettes}
      {...(overhang && { overhang })}
      {...(section && planes && { section: { ...section, planes, order: 10 + 3 * index } })}
    />
  ));
}

function hex(value: string): Rgba {
  const n = Number.parseInt(value.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

function Body({
  id,
  mesh,
  style,
  body,
  opacity,
  edge,
  accent,
  marks,
  onSilhouettes,
  section,
  overhang,
}: {
  id: BodyId;
  mesh: BodyMesh;
  style: VisualStyle;
  body: Rgba;
  /** 1 is opaque. */
  opacity: number;
  edge: Rgba;
  accent: Rgba;
  marks: BodyHighlight;
  onSilhouettes?(body: BodyId, segments: number): void;
  section?: { clip: SectionClip; color: Rgba; hatch: Rgba; planes: Plane[]; order: number };
  overhang?: { view: OverhangView; color: Rgba };
}) {
  const planes = section?.planes ?? null;
  // The overhang shading is one patch of the face material; its settings are uniforms.
  const shading = useMemo(() => createOverhangShading(), []);
  shading.set(overhang?.view, overhang?.color ?? body);
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
  // The edges and silhouettes are clipped like the faces (P3-09).
  visibleEdges.clippingPlanes = planes;
  hiddenEdges.clippingPlanes = planes;

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
            transparent={opacity < 1}
            opacity={opacity}
            // A see-through body doesn't hide what is behind it.
            depthWrite={opacity >= 1}
            clippingPlanes={planes}
            onBeforeCompile={shading.onBeforeCompile}
            customProgramCacheKey={shading.cacheKey}
          />
        </mesh>
      )}
      {showFaces && section && (
        <SectionCap
          faces={faces}
          mesh={mesh}
          clip={section.clip}
          planes={section.planes}
          {...capColors(body, section.color, section.hatch)}
          order={section.order}
        />
      )}
      {showEdges && <primitive object={edgeLines} />}
      {style === 'hiddenEdges' && <primitive object={hiddenLines} />}
      {(style === 'wireframe' || style === 'hiddenEdges') && (
        <Silhouettes
          id={id}
          mesh={mesh}
          visible={visibleEdges}
          hidden={style === 'hiddenEdges' ? hiddenEdges : undefined}
          onCount={onSilhouettes}
        />
      )}
      <EdgeMarks mesh={mesh} edges={marks.selectedEdges} color={accent} width={3} planes={planes} />
      <EdgeMarks
        mesh={mesh}
        edges={marks.hoverEdges}
        color={accent}
        width={2.5}
        over
        planes={planes}
      />
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

/**
 * The silhouette of the body's curved faces for the current camera, drawn
 * like its edges (hidden parts faint in the hidden-edge style). Recomputed
 * in the frame loop whenever the camera moved: the view only renders on
 * change, and the work is one pass over the curved faces' triangles.
 */
function Silhouettes({
  id,
  mesh,
  visible,
  hidden,
  onCount,
}: {
  id: BodyId;
  mesh: BodyMesh;
  visible: Material;
  hidden: Material | undefined;
  onCount?(body: BodyId, segments: number): void;
}) {
  const curved = useMemo(() => curvedFaces(mesh), [mesh]);
  const buffer = useMemo(() => new Float32Array(silhouetteCapacity(curved)), [curved]);
  const geometry = useMemo(() => new LineSegmentsGeometry(), []);
  const lines = useMemo(() => {
    const front = new LineSegments2(geometry, visible as LineMaterial);
    const back = new LineSegments2(geometry, (hidden ?? visible) as LineMaterial);
    for (const line of [front, back]) {
      // The segments change with the camera; their bounds aren't worth keeping up to date.
      line.frustumCulled = false;
      line.visible = false;
    }
    return { front, back };
  }, [geometry, visible, hidden]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => onCount?.(id, 0), [id, onCount]);
  const last = useRef<{ key: string; buffer: Float32Array; lines: object } | undefined>(undefined);
  useFrame(({ camera }) => {
    const m = camera.matrixWorld.elements;
    const perspective = (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;
    const key = `${perspective}:${m.join(',')}`;
    const was = last.current;
    if (was?.key === key && was.buffer === buffer && was.lines === lines) return;
    last.current = { key, buffer, lines };
    const view: SilhouetteView = perspective
      ? { eye: [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0] }
      : { direction: [-(m[8] ?? 0), -(m[9] ?? 0), -(m[10] ?? 1)] };
    const count = silhouetteSegments(mesh, curved, view, buffer);
    if (count > 0) geometry.setPositions(buffer.subarray(0, count));
    lines.front.visible = count > 0;
    lines.back.visible = count > 0 && hidden !== undefined;
    onCount?.(id, count / 6);
  });
  return (
    <>
      <primitive object={lines.front} />
      <primitive object={lines.back} />
    </>
  );
}

/** Edges drawn over the body in the accent: selected ones, or the one under the pointer. */
function EdgeMarks({
  mesh,
  edges,
  color,
  width,
  over = false,
  planes,
}: {
  mesh: BodyMesh;
  edges: readonly number[];
  color: Rgba;
  width: number;
  planes: Plane[] | null;
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
  line.material.clippingPlanes = planes;
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
