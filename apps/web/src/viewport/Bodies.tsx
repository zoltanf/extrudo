import type { BodyId, BodyMeta, SelectionItem } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import type { Matrix12 } from '@extrudo/kernel/matrix';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  GreaterDepth,
  type Group,
  type Material,
  Matrix4,
  type Plane,
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
  COLLIDE,
  edgeSegmentsOf,
  type FacePalette,
  paintFaces,
  vertexPositions,
} from '../selection/highlight';
import { boundsOf, edgeSegments } from './bodyGeometry';
import { clipPlanes } from './clipPlanes';
import { capColors, type Rgba } from './colors';
import { createDotMaterial } from './dots';
import { createOverhangShading } from './overhangShading';
import { SectionCap } from './SectionCap';
import {
  curvedFaces,
  type SilhouetteView,
  silhouetteCapacity,
  silhouettePlan,
  silhouetteSegments,
} from './silhouette';
import type { Bounds, VisualStyle } from './store';
import { createThicknessShading } from './thicknessShading';

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
  section?: { clips: readonly SectionClip[]; color: Rgba; hatch: Rgba };
  /** An overhang analysis (P3-10, ADR-0048): the faces it flags are shaded in `color`. */
  overhang?: { view: OverhangView; color: Rgba };
  /**
   * The wall-thickness check (P5-06, ADR-0072): `thin` is a per-node flag per body (1 where a
   * triangle is thinner than the minimum), shaded in `color`.
   */
  thickness?: { thin: Record<BodyId, Float32Array>; color: Rgba };
  /** A joint's clearance check (P6-05 J3): the colliding faces per body, tinted in `color`. */
  collisions?: { faces: Readonly<Record<BodyId, readonly number[]>>; color: Rgba };
  /**
   * Bodies drawn posed (P6-05 J2): each through its matrix, a view-side look only. A posed
   * body takes no section cap (the cap's quad is placed in world space).
   */
  posed?: Readonly<Record<BodyId, Matrix12>>;
}

/** A pose as a three.js matrix (both are row-major with the translation in the last column). */
export function poseToMatrix4(pose: Matrix12): Matrix4 {
  const m = pose;
  // biome-ignore format: keeps the rows of the 4 x 4 together.
  return new Matrix4().set(
    m[0] as number, m[1] as number, m[2] as number, m[3] as number,
    m[4] as number, m[5] as number, m[6] as number, m[7] as number,
    m[8] as number, m[9] as number, m[10] as number, m[11] as number,
    0, 0, 0, 1,
  );
}

export { clipPlanes };

/** The most planes a section has (a box's six), which bounds the render orders per body. */
const CAP_SLOTS = 6;

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
  thickness,
  collisions,
  posed,
}: BodiesProps) {
  const shown = useMemo(
    () =>
      (Object.entries(bodies) as [BodyId, BodyMesh][]).filter(([id]) => meta[id]?.visible ?? true),
    [bodies, meta],
  );
  const bounds = useMemo(() => boundsOf(shown.map(([, mesh]) => mesh)), [shown]);
  useEffect(() => onBounds(bounds), [bounds, onBounds]);
  const clips = section?.clips;
  const planes = useMemo(() => clipPlanes(clips), [clips]);

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
      marks={withCollisions(bodyHighlight(id, mesh, hover, selection), collisions?.faces[id])}
      {...(collisions && { error: collisions.color })}
      onSilhouettes={onSilhouettes}
      {...(posed?.[id] && { pose: posed[id] })}
      {...(overhang && { overhang })}
      {...(thickness && { thickness: { thin: thickness.thin[id], color: thickness.color } })}
      {...(section &&
        planes && { section: { ...section, planes, order: 10 + 3 * CAP_SLOTS * index } })}
    />
  ));
}

/** Marks a check's colliding faces on a body's highlight. */
function withCollisions(marks: BodyHighlight, faces: readonly number[] | undefined): BodyHighlight {
  if (!faces) return marks;
  for (const f of faces) {
    if (f < marks.faces.length) marks.faces[f] = (marks.faces[f] ?? 0) | COLLIDE;
  }
  return marks;
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
  error,
  marks,
  onSilhouettes,
  section,
  overhang,
  thickness,
  pose,
}: {
  id: BodyId;
  mesh: BodyMesh;
  style: VisualStyle;
  body: Rgba;
  /** 1 is opaque. */
  opacity: number;
  edge: Rgba;
  accent: Rgba;
  /** The colour colliding faces take (P6-05 J3). */
  error?: Rgba;
  marks: BodyHighlight;
  onSilhouettes?(body: BodyId, segments: number): void;
  section?: {
    clips: readonly SectionClip[];
    color: Rgba;
    hatch: Rgba;
    planes: Plane[];
    order: number;
  };
  overhang?: { view: OverhangView; color: Rgba };
  /** The wall-thickness check (P5-06): per-node thin flags, shaded in `color`. */
  thickness?: { thin: Float32Array | undefined; color: Rgba };
  /** Drawn through this matrix (a joint posed, P6-05 J2). */
  pose?: Matrix12;
}) {
  const planes = section?.planes ?? null;
  const group = usePose(pose);
  // The analysis shadings are patches of the face material; their settings are uniforms.
  // The thin-wall mix runs after the overhang one wherever both flag a triangle (ADR-0072 §3).
  const shading = useMemo(() => createOverhangShading(), []);
  const thinShading = useMemo(() => createThicknessShading(), []);
  shading.set(overhang?.view, overhang?.color ?? body);
  thinShading.set(thickness?.thin ? thickness.color : undefined);
  const faces = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(mesh.positions.length), 3));
    g.setAttribute('aThin', new BufferAttribute(new Float32Array(mesh.positions.length / 3), 1));
    g.setIndex(new BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);
  useFaceColors(faces, mesh, body, accent, marks.faces, error);
  useThinFlags(faces, thickness?.thin);
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
    <group ref={group}>
      {showFaces && (
        <mesh geometry={faces}>
          <meshStandardMaterial
            // three bakes OPAQUE into the program while `transparent` is false and R3F
            // never sets `needsUpdate`: a new material per mode (ADR-0030's amendment).
            key={opacity < 1 ? 'see-through' : 'opaque'}
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
            onBeforeCompile={(shader) => {
              thinShading.onBeforeCompile(shader);
              shading.onBeforeCompile(shader);
            }}
            customProgramCacheKey={analysisCacheKey}
          />
        </mesh>
      )}
      {showFaces && section && !pose && (
        <SectionCap
          faces={faces}
          mesh={mesh}
          clips={section.clips}
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
          pose={pose}
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
      <VertexMarks mesh={mesh} vertices={marks.selectedVertices} color={accent} planes={planes} />
      <VertexMarks mesh={mesh} vertices={marks.hoverVertices} color={accent} planes={planes} />
    </group>
  );
}

/**
 * Puts a pose on a group (P6-05 J2): the matrix is the group's own, never recomputed from
 * position/rotation/scale, and the scene asks for a frame as it changes.
 */
export function usePose(pose: Matrix12 | undefined) {
  const group = useRef<Group>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;
    g.matrixAutoUpdate = pose === undefined;
    if (pose) g.matrix.copy(poseToMatrix4(pose));
    else {
      g.matrix.identity();
      g.position.set(0, 0, 0);
      g.quaternion.identity();
      g.scale.set(1, 1, 1);
    }
    g.matrixWorldNeedsUpdate = true;
    invalidate();
  }, [pose, invalidate]);
  return group;
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
  error?: Rgba,
) {
  const painted = useRef<{ geometry: BufferGeometry; key: string; states: Uint8Array }>(undefined);
  useLayoutEffect(() => {
    const attribute = faces.getAttribute('color') as BufferAttribute;
    const palette: FacePalette = {
      base: linear(body),
      accent: linear(accent),
      ...(error && { error: linear(error) }),
    };
    const key = `${palette.base.join()}/${palette.accent.join()}/${palette.error?.join() ?? ''}`;
    const last = painted.current;
    const previous = last?.geometry === faces && last.key === key ? last.states : undefined;
    const range = paintFaces(attribute.array as Float32Array, mesh, states, palette, previous);
    painted.current = { geometry: faces, key, states };
    if (!range) return;
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(range[0] * 3, range[1] * 3);
    attribute.needsUpdate = true;
  }, [faces, mesh, body, accent, states, error]);
}

/** One compiled program for both analysis patches; their settings are uniforms. */
const analysisCacheKey = () => 'extrudo-body-analysis';

/**
 * Keeps the faces' thin-wall attribute in step with the check (P5-06): 1 on the nodes of a
 * thin triangle (nodes are shared inside a face, so a thin edge bleeds one triangle), 0
 * elsewhere. No flags clear it.
 */
function useThinFlags(faces: BufferGeometry, thin: Float32Array | undefined) {
  useLayoutEffect(() => {
    const attribute = faces.getAttribute('aThin') as BufferAttribute;
    const array = attribute.array as Float32Array;
    if (thin) array.set(thin);
    else array.fill(0);
    attribute.needsUpdate = true;
  }, [faces, thin]);
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
  pose,
}: {
  id: BodyId;
  mesh: BodyMesh;
  visible: Material;
  hidden: Material | undefined;
  onCount?(body: BodyId, segments: number): void;
  /** The group's pose: the camera is turned into the mesh's own space. */
  pose?: Matrix12 | undefined;
}) {
  const inverse = useMemo(() => (pose ? poseToMatrix4(pose).invert() : undefined), [pose]);
  const curved = useMemo(() => curvedFaces(mesh), [mesh]);
  const plan = useMemo(() => silhouettePlan(mesh, curved), [mesh, curved]);
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
    const key = `${perspective}:${m.join(',')}:${pose?.join(',') ?? ''}`;
    const was = last.current;
    if (was?.key === key && was.buffer === buffer && was.lines === lines) return;
    last.current = { key, buffer, lines };
    let view: SilhouetteView = perspective
      ? { eye: [m[12] ?? 0, m[13] ?? 0, m[14] ?? 0] }
      : { direction: [-(m[8] ?? 0), -(m[9] ?? 0), -(m[10] ?? 1)] };
    if (inverse) {
      // A posed body's mesh stays in its own space: look at it from where the camera is there.
      if ('eye' in view) {
        const e = new Vector3(...view.eye).applyMatrix4(inverse);
        view = { eye: [e.x, e.y, e.z] };
      } else {
        const d = new Vector3(...view.direction).transformDirection(inverse);
        view = { direction: [d.x, d.y, d.z] };
      }
    }
    const count = silhouetteSegments(mesh, plan, view, buffer);
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

/**
 * B-rep vertices as dots: only the selected ones and the one under the pointer. A section
 * clips them like the edges (P3-17).
 */
function VertexMarks({
  mesh,
  vertices,
  color,
  planes,
}: {
  mesh: BodyMesh;
  vertices: readonly number[];
  color: Rgba;
  planes: Plane[] | null;
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
  dots.material.clippingPlanes = planes;
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
