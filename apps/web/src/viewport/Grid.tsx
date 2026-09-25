import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, type Mesh, ShaderMaterial, Vector2 } from 'three';
import type { Rgba } from './colors';
import type { ViewportStore } from './store';

/**
 * The adaptive, infinite-looking grid on the XY plane (FR-VP-04,
 * docs/05-brand.md §3.1), with the X and Y axes drawn along it.
 *
 * One quad under the camera target, drawn by a shader: each pixel picks its
 * grid level from its own footprint (`fwidth`), so spacing adapts to zoom
 * and to distance in perspective. Levels are powers of ten mm; a level's
 * lines fade out as they crowd together, while the next level up takes over
 * as the minor lines. Major lines are twice as strong. The grid fades out
 * radially around the target and at grazing angles.
 */

/** A minor cell is between PIXELS / 10 and PIXELS wide on screen. */
const PIXELS = 60;
/** The grid has faded out this many view sizes from the target. */
export const GRID_RADIUS = 0.95;

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
    vec2 uv = vWorld.xy;
    vec2 dudv = max(fwidth(uv), vec2(1e-6));
    float perPixel = max(dudv.x, dudv.y);

    float lod = max(0.0, log(perPixel * ${PIXELS.toFixed(1)}) / log(10.0));
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
    float facing = abs(normalize(cameraPosition - vWorld).z);
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
  grid: Rgba;
  axisX: Rgba;
  axisY: Rgba;
  showGrid: boolean;
  showX: boolean;
  showY: boolean;
}

export function Grid({ store, grid, axisX, axisY, showGrid, showX, showY }: GridProps) {
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

  useFrame(() => {
    const { view } = store.getState();
    const radius = view.size * GRID_RADIUS;
    u.uCenter.value.set(view.target[0], view.target[1]);
    u.uRadius.value = radius;
    mesh.current?.position.set(view.target[0], view.target[1], 0);
    mesh.current?.scale.set(radius, radius, 1);
  });

  return (
    <mesh ref={mesh} material={material} frustumCulled={false} renderOrder={1}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
}
