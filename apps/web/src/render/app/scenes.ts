/**
 * The in-app renderer's scenes (ADR-0101 §6.3): the four presets built around
 * the model exactly like `render.py`'s (`place_model`, `SCENES`), in
 * millimetres with Z up. The model stands on z = 0 centred on x/y; every size
 * and light position scales with `s`, the model's largest side (at least
 * 50 mm, the script's 0.05 m). Lights: raster mode (Draft) has no shadowed
 * area lights, so each of the script's area lights is a `DirectionalLight`
 * from the same place towards the model, and only the key casts shadows; trace
 * mode (Standard and High, ADR-0101 §6.2) keeps the script's area lights as
 * `RectAreaLight`s (soft shadows) with the script's sizes.
 */
import type { RenderPreset } from '@extrudo/core';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  type Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  type MeshPhysicalMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  RectAreaLight,
  Scene,
  type Texture,
  Vector3,
} from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AppRenderBody, AppRenderJob } from '../../platform/render';
import { bodyColor, finishMaterial, woodTexture, worktopTexture } from './finishes';

/** Where the model stands and how big it is (`place_model`'s return), millimetres. */
export interface Placement {
  /** Added to the design's coordinates to stand the model on z = 0 centred on x/y. */
  offset: Vector3;
  /** The middle of the placed box: (0, 0, height / 2). */
  centre: Vector3;
  /** Half the box's diagonal. */
  radius: number;
  /** The box's largest side. */
  size: number;
  /** Half the box's sides. */
  extent: Vector3;
  /** The scene's scale: `size`, at least 50 mm. */
  s: number;
}

/** `place_model` over the bodies' meshes (design millimetres). */
export function placeModel(bodies: readonly AppRenderBody[]): Placement {
  const lo = new Vector3(Infinity, Infinity, Infinity);
  const hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const { mesh } of bodies) {
    const p = mesh.positions;
    for (let i = 0; i + 2 < p.length; i += 3) {
      lo.set(
        Math.min(lo.x, p[i] as number),
        Math.min(lo.y, p[i + 1] as number),
        Math.min(lo.z, p[i + 2] as number),
      );
      hi.set(
        Math.max(hi.x, p[i] as number),
        Math.max(hi.y, p[i + 1] as number),
        Math.max(hi.z, p[i + 2] as number),
      );
    }
  }
  if (![lo.x, lo.y, lo.z, hi.x, hi.y, hi.z].every(Number.isFinite)) {
    throw new Error('The model has no geometry.');
  }
  const sides = hi.clone().sub(lo);
  const size = Math.max(sides.x, sides.y, sides.z);
  return {
    offset: new Vector3(-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z),
    centre: new Vector3(0, 0, sides.z / 2),
    radius: Math.max(sides.length() / 2, 0.1),
    size,
    extent: sides.clone().multiplyScalar(0.5),
    s: Math.max(size, 50),
  };
}

/**
 * Light strengths: the script's watts (which scale with s², so they are the
 * same at every model size) to three's units. Calibrated so a matte white
 * body facing the studio's key reads about 0.8 grey in a draft at exposure 1.
 */
export const WATTS_TO_THREE = 1 / 1200;
/**
 * Area lights' watts to three's units (nits): a RectAreaLight's intensity is
 * radiance, so this is a different scale from `WATTS_TO_THREE`. Calibrated so
 * a Standard render of the studio has the matte white body about as bright as
 * the draft (the same PNG comparison), independent of the light's size.
 */
export const WATTS_TO_AREA = 1 / 160;
/** The outdoor sun (the script's 6 W/m² Sun lamp) in three's units. */
export const SUN_INTENSITY = 3;

/** How the scene is drawn: raster (Draft) or trace (Standard and High). */
export type RenderMode = 'raster' | 'trace';

/** How a preset's environment is lit; the renderer makes it (it needs the GL context). */
export type EnvironmentKind =
  | { kind: 'room'; intensity: number }
  | { kind: 'sky'; elevation: number; rotation: number };

export interface SceneDeps {
  wood(): Texture;
  worktop(): Texture;
  /** Gives the scene its environment (and the sky's background); returns what to dispose. */
  environment?(scene: Scene, kind: EnvironmentKind, mode: RenderMode): () => void;
}

const DEFAULT_DEPS: SceneDeps = { wood: woodTexture, worktop: worktopTexture };

export interface BuiltScene {
  scene: Scene;
  /** The light that casts the shadows (raster mode only; the tracer needs none). */
  key?: DirectionalLight;
  placement: Placement;
  environment: EnvironmentKind;
  /** Frees every geometry, material and texture of the scene, and the environment. */
  dispose(): void;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Edges sharper than this stay sharp; flatter ones are shaded smooth (curved faces). */
const CREASE = Math.PI / 6;

/**
 * A body's mesh as a geometry: the export mesh (shared nodes, no normals)
 * with normals creased at 30°, and box-projected UVs (in model sizes) for
 * wood's grain.
 */
export function bodyGeometry(body: AppRenderBody, size: number): BufferGeometry {
  const indexed = new BufferGeometry();
  indexed.setAttribute('position', new BufferAttribute(Float32Array.from(body.mesh.positions), 3));
  indexed.setIndex(new BufferAttribute(body.mesh.indices, 1));
  const geometry = toCreasedNormals(indexed, CREASE);
  indexed.dispose();
  // The script's grain uses object coordinates; three's map needs UVs: project
  // each node on the plane its normal faces most, the grain along x where it can.
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const uv = new Float32Array(positions.count * 2);
  const scale = 1 / Math.max(size, 1e-3);
  for (let i = 0; i < positions.count; i++) {
    const nx = Math.abs(normals.getX(i));
    const ny = Math.abs(normals.getY(i));
    const nz = Math.abs(normals.getZ(i));
    const [a, b] =
      nx >= ny && nx >= nz
        ? [positions.getY(i), positions.getZ(i)]
        : ny >= nz
          ? [positions.getX(i), positions.getZ(i)]
          : [positions.getX(i), positions.getY(i)];
    uv[2 * i] = a * scale;
    uv[2 * i + 1] = b * scale;
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  return geometry;
}

/** The studio's sweep: the script's profile (floor, an arc of 8 steps, wall), 2·100·s wide, turned 45°. */
export function sweepGeometry(s: number): BufferGeometry {
  const w = 100 * s;
  const back = 10 * s;
  const bend = 2 * s;
  const height = 40 * s;
  const profile: [number, number][] = [
    [-100 * s, 0],
    [back, 0],
  ];
  for (let k = 1; k <= 8; k++) {
    const angle = -Math.PI / 2 + ((Math.PI / 2) * k) / 8;
    profile.push([back + bend * Math.cos(angle), bend + bend * Math.sin(angle)]);
  }
  profile.push([back + bend, height]);
  const positions: number[] = [];
  for (const [y, z] of profile) positions.push(-w, y, z, w, y, z);
  const index: number[] = [];
  for (let k = 0; k < profile.length - 1; k++) {
    index.push(2 * k, 2 * k + 1, 2 * k + 3, 2 * k, 2 * k + 3, 2 * k + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.rotateZ(Math.PI / 4);
  return geometry;
}

/** A slab `side` × `side` × `thick` whose top is at z = 0 (`render.py`'s `box`). */
function slab(side: number, thick: number, material: MeshStandardMaterial | MeshPhysicalMaterial) {
  const mesh = new Mesh(new BoxGeometry(side, side, thick), material);
  mesh.position.set(0, 0, -thick / 2);
  mesh.receiveShadow = true;
  return mesh;
}

/** A light from `position` towards `target`, `watts` the script's energy, `size` (mm) its side. */
interface LampSpec {
  position: Vector3;
  watts: number;
  /** The script's `area_light` size in millimetres; ignored by a directional lamp. */
  size: number;
  color?: Color | number;
}

/** One of the script's lights: a soft area light when tracing, a directional one when rasterising. */
function lamp(spec: LampSpec, target: Vector3, mode: RenderMode): RectAreaLight | DirectionalLight {
  const color = spec.color ?? 0xffffff;
  if (mode === 'trace') {
    const area = new RectAreaLight(color, spec.watts * WATTS_TO_AREA, spec.size, spec.size);
    area.position.copy(spec.position);
    area.lookAt(target);
    return area;
  }
  const directional = new DirectionalLight(color, spec.watts * WATTS_TO_THREE);
  directional.position.copy(spec.position);
  directional.target.position.copy(target);
  return directional;
}

/** The key casts the shadows: its shadow camera covers the model's box ×1.5. */
function castShadows(key: DirectionalLight, placement: Placement) {
  const r = placement.radius * 1.5;
  const distance = key.position.distanceTo(key.target.position);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = placement.radius / 500;
  key.shadow.radius = 4;
  const camera = key.shadow.camera;
  camera.left = -r;
  camera.right = r;
  camera.top = r;
  camera.bottom = -r;
  camera.near = Math.max(distance - 2 * r, 0.1);
  camera.far = distance + 2 * r;
  camera.updateProjectionMatrix();
}

function scenery(
  preset: RenderPreset,
  s: number,
  target: Vector3,
  deps: SceneDeps,
  mode: RenderMode,
) {
  const objects: Object3D[] = [];
  let key: DirectionalLight | undefined;
  let environment: EnvironmentKind;
  let background: number | undefined;
  /** The first light of each preset is the key (it casts the shadows in raster mode). */
  const addLamp = (spec: LampSpec) => {
    const made = lamp(spec, target, mode);
    if (made instanceof DirectionalLight && key === undefined) key = made;
    objects.push(made);
    return made;
  };
  switch (preset) {
    case 'studio': {
      const material = new MeshStandardMaterial({ color: bodyColor('#f2f2f2'), roughness: 0.7 });
      material.side = DoubleSide;
      const sweep = new Mesh(sweepGeometry(s), material);
      sweep.name = 'Sweep';
      sweep.receiveShadow = true;
      objects.push(sweep);
      addLamp({ position: v(6 * s, -6 * s, 8 * s), watts: 2000, size: 4 * s });
      addLamp({ position: v(-7 * s, -5 * s, 4 * s), watts: 400, size: 6 * s });
      addLamp({ position: v(-2 * s, 8 * s, 6 * s), watts: 600, size: 3 * s });
      // 0.5, not 0.8: brighter washes the white-on-white shot flat.
      environment = { kind: 'room', intensity: 0.5 };
      background = 0xf2f2f2;
      break;
    }
    case 'table': {
      const material = new MeshStandardMaterial({ color: bodyColor('#8b5a2b'), roughness: 0.4 });
      material.map = deps.wood();
      // A grain line about every s/7 (the script's 1.2 / s noise scale), stretched along x.
      material.map.repeat.set(6, 90);
      const table = slab(200 * s, 30, material);
      table.name = 'Table';
      objects.push(table);
      addLamp({
        position: v(-8 * s, -6 * s, 7 * s),
        watts: 1500,
        size: 6 * s,
        color: bodyColor('#fff1e0'),
      });
      addLamp({ position: v(6 * s, -4 * s, 3 * s), watts: 250, size: 5 * s });
      environment = { kind: 'room', intensity: 0.5 };
      background = 0x2a1d14;
      break;
    }
    case 'workbench': {
      const material = new MeshStandardMaterial({ roughness: 0.6 });
      material.map = deps.worktop();
      // One tile is 50 mm: a line every 10 mm.
      material.map.repeat.set((200 * s) / 50, (200 * s) / 50);
      const top = slab(200 * s, 40, material);
      top.name = 'Worktop';
      objects.push(top);
      addLamp({
        position: v(5 * s, -7 * s, 8 * s),
        watts: 1000,
        size: 4 * s,
        color: bodyColor('#e4ecff'),
      });
      addLamp({ position: v(-4 * s, 7 * s, 5 * s), watts: 1400, size: 3 * s });
      environment = { kind: 'room', intensity: 0.35 };
      background = 0x1b1d21;
      break;
    }
    case 'outdoor': {
      const material = new MeshStandardMaterial({ color: bodyColor('#6b7a5a'), roughness: 0.9 });
      const ground = new Mesh(new PlaneGeometry(400 * s, 400 * s), material);
      ground.name = 'Ground';
      ground.receiveShadow = true;
      const elevation = (40 * Math.PI) / 180;
      const rotation = (300 * Math.PI) / 180;
      // The sky's sun sits at `elevation` above the horizon, `rotation` around Z.
      // The sun is a DirectionalLight in both modes: the tracer takes one too.
      const direction = v(
        -Math.sin(rotation) * Math.cos(elevation),
        -Math.cos(rotation) * Math.cos(elevation),
        Math.sin(elevation),
      );
      key = new DirectionalLight(0xffffff, SUN_INTENSITY);
      key.position.copy(target).addScaledVector(direction, 10 * s);
      key.target.position.copy(target);
      objects.push(ground, key);
      environment = { kind: 'sky', elevation, rotation };
      break;
    }
  }
  return { objects, key, environment, background };
}

/**
 * The scene of a job: the bodies placed like `place_model`, the preset's
 * scenery and lights, and its environment through `deps.environment` (left
 * out without one, as in unit tests). `mode` picks the lights: soft area
 * lights for the tracer, directional ones for the rasteriser.
 */
export function buildScene(
  job: AppRenderJob,
  placement: Placement = placeModel(job.bodies),
  deps: SceneDeps = DEFAULT_DEPS,
  mode: RenderMode = 'raster',
): BuiltScene {
  const scene = new Scene();
  for (const body of job.bodies) {
    const mesh = new Mesh(
      bodyGeometry(body, placement.size),
      finishMaterial(body.finish, body.color, placement.size, { wood: deps.wood }),
    );
    mesh.name = body.name;
    mesh.position.copy(placement.offset);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const { objects, key, environment, background } = scenery(
    job.preset,
    placement.s,
    placement.centre,
    deps,
    mode,
  );
  for (const object of objects) {
    scene.add(object);
    if (object instanceof DirectionalLight) scene.add(object.target);
  }
  if (mode === 'raster' && key) castShadows(key, placement);
  if (background !== undefined)
    scene.background = bodyColor(`#${background.toString(16).padStart(6, '0')}`);
  const disposeEnvironment = deps.environment?.(scene, environment, mode);
  scene.updateMatrixWorld(true);
  return {
    scene,
    key,
    placement,
    environment,
    dispose() {
      disposeEnvironment?.();
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          object.geometry.dispose();
          const material = object.material as MeshStandardMaterial;
          material.map?.dispose();
          material.dispose();
        }
        if (object instanceof DirectionalLight) object.shadow.dispose();
      });
    },
  };
}
