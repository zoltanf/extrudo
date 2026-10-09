import { type SketchFrame, worldToSketch } from '@extrudo/core';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, Matrix4, type Mesh, ShaderMaterial, Vector2, Vector3 } from 'three';
import type { Rgba } from './colors';
import { GRID_PIXELS } from './grid';
import type { ViewportStore } from './store';

/**
 * The adaptive, infinite-looking grid on the XY plane (FR-VP-04,
 * docs/05-brand.md §3.1), with the X and Y axes drawn along it. In sketch
 * mode it lies on the sketch plane instead, with the sketch's axes (UI spec
 * §4).
 *
 * One quad under the camera target, drawn by a shader: each pixel picks its
 * grid level from its own footprint (`fwidth`), so spacing adapts to zoom
 * and to distance in perspective. Levels are powers of ten mm; a level's
 * lines fade out as they crowd together, while the next level up takes over
 * as the minor lines. Major lines are twice as strong. The grid fades out
 * radially around the target and at grazing angles.
 */

/** The grid has faded out this many view sizes from the target. */
export const GRID_RADIUS = 0.95;

/** The world XY plane, the grid's plane outside sketch mode. */
export const XY_FRAME: SketchFrame = {
  origin: [0, 0, 0],
  x: [1, 0, 0],
  y: [0, 1, 0],
  normal: [0, 0, 1],
};

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uGridColor;
  uniform float uGridAlpha;
  uniform float uShowGrid;
  uniform vec3 uAxisX;
  uniform vec3 uAxisY;
  uniform vec2 uShowAxes;
  uniform vec2 uCenter;
  uniform float uRadius;
  uniform vec3 uOrigin;
  uniform vec3 uU;
  uniform vec3 uV;
  uniform vec3 uN;
  varying vec3 vWorld;

  // Coverage of grid lines 1 px wide with the given spacing (mm).
  float lines(vec2 uv, float spacing, vec2 dudv) {
    vec2 d = abs(fract(uv / spacing + 0.5) - 0.5) * spacing / dudv;
    vec2 c = clamp(1.0 - d, 0.0, 1.0);
    return max(c.x, c.y);
  }

  // Coverage of one line along an axis, width in px.
  float axis(float distance, float perPixel, float width) {
    return clamp(width * 0.5 + 0.5 - abs(distance) / perPixel, 0.0, 1.0);
  }

  void main() {
    vec3 rel = vWorld - uOrigin;
    vec2 uv = vec2(dot(rel, uU), dot(rel, uV));
    vec2 dudv = max(fwidth(uv), vec2(1e-6));
    float perPixel = max(dudv.x, dudv.y);

    float lod = max(0.0, log(perPixel * ${GRID_PIXELS.toFixed(1)}) / log(10.0));
    float level = floor(lod);
    float fade = smoothstep(0.0, 1.0, fract(lod));
    float s0 = pow(10.0, level);
    float s1 = s0 * 10.0;
    float s2 = s1 * 10.0;

    float minor = uGridAlpha;
    float major = min(1.0, uGridAlpha * 2.0);
    float grid = max(
      lines(uv, s0, dudv) * minor * (1.0 - fade),
      max(lines(uv, s1, dudv) * mix(major, minor, fade), lines(uv, s2, dudv) * major)
    ) * uShowGrid;

    float ax = axis(uv.y, dudv.y, 1.5) * uShowAxes.x;
    float ay = axis(uv.x, dudv.x, 1.5) * uShowAxes.y;

    // Fade radially around the target, and where the plane is seen edge-on.
    float radial = 1.0 - smoothstep(uRadius * 0.1, uRadius, distance(uv, uCenter));
    float facing = abs(dot(normalize(cameraPosition - vWorld), uN));
    float grazing = smoothstep(0.0, 0.2, facing);
    float visible = radial * grazing;

    // Axes over the grid, premultiplied.
    float aA = max(ax, ay) * 0.85 * visible;
    vec3 axisColor = ax >= ay ? uAxisX : uAxisY;
    float gA = grid * visible;
    float alpha = aA + gA * (1.0 - aA);
    if (alpha <= 0.001) discard;
    vec3 color = (axisColor * aA + uGridColor * gA * (1.0 - aA)) / alpha;
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
  }
`;

const color = (c: Rgba) => new Color().setRGB(c.r, c.g, c.b, 'srgb');

export interface GridProps {
  store: ViewportStore;
  /** The plane the grid lies on; `axisX` and `axisY` colour its X and Y axes. */
  frame?: SketchFrame;
  grid: Rgba;
  axisX: Rgba;
  axisY: Rgba;
  showGrid: boolean;
  showX: boolean;
  showY: boolean;
}

/** Scene objects named so are left out of a thumbnail: they run to the picture's edges. */
export const THUMBNAIL_HIDDEN = 'thumbnail-hidden';

export function Grid({
  store,
  frame = XY_FRAME,
  grid,
  axisX,
  axisY,
  showGrid,
  showX,
  showY,
}: GridProps) {
  const mesh = useRef<Mesh>(null);
  const { material, u } = useMemo(() => {
    const u = {
      uGridColor: { value: new Color() },
      uGridAlpha: { value: 0 },
      uShowGrid: { value: 1 },
      uAxisX: { value: new Color() },
      uAxisY: { value: new Color() },
      uShowAxes: { value: new Vector2(1, 1) },
      uCenter: { value: new Vector2() },
      uRadius: { value: 1 },
      uOrigin: { value: new Vector3() },
      uU: { value: new Vector3(1, 0, 0) },
      uV: { value: new Vector3(0, 1, 0) },
      uN: { value: new Vector3(0, 0, 1) },
    };
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      uniforms: u,
    });
    return { material, u };
  }, []);

  u.uGridColor.value = color(grid);
  u.uGridAlpha.value = grid.a;
  u.uShowGrid.value = showGrid ? 1 : 0;
  u.uAxisX.value = color(axisX);
  u.uAxisY.value = color(axisY);
  u.uShowAxes.value.set(showX ? 1 : 0, showY ? 1 : 0);
  u.uOrigin.value.set(...frame.origin);
  u.uU.value.set(...frame.x);
  u.uV.value.set(...frame.y);
  u.uN.value.set(...frame.normal);
  const rotation = useMemo(
    () =>
      new Matrix4().makeBasis(
        new Vector3(...frame.x),
        new Vector3(...frame.y),
        new Vector3(...frame.normal),
      ),
    [frame],
  );

  useFrame(() => {
    const { view } = store.getState();
    const radius = view.size * GRID_RADIUS;
    // The quad sits under the camera target, projected onto the plane.
    const [cu, cv] = worldToSketch(frame, view.target);
    u.uCenter.value.set(cu, cv);
    u.uRadius.value = radius;
    const m = mesh.current;
    if (!m) return;
    m.quaternion.setFromRotationMatrix(rotation);
    m.position
      .set(...frame.origin)
      .addScaledVector(u.uU.value, cu)
      .addScaledVector(u.uV.value, cv);
    m.scale.set(radius, radius, 1);
  });

  return (
    <mesh
      ref={mesh}
      name={THUMBNAIL_HIDDEN}
      material={material}
      frustumCulled={false}
      renderOrder={1}
    >
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
