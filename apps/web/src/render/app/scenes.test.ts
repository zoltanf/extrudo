/** The in-app renderer's scenes (ADR-0101 §6.3): `place_model`'s placement and each preset's scenery, built without rendering. */
import { RENDER_PRESETS } from '@extrudo/core';
import { Box3, DirectionalLight, Mesh, RectAreaLight, type Scene, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import type { AppRenderJob } from '../../platform/render';
import { MAT_THICKNESS } from './mat';
import { buildScene, placeModel, sweepGeometry, WATTS_TO_AREA } from './scenes';

/** A box from (10, 20, 5) to (50, 40, 25) mm: 40 × 20 × 20. */
function boxMesh() {
  const [x0, y0, z0, x1, y1, z1] = [10, 20, 5, 50, 40, 25];
  const positions = Float64Array.from([
    x0,
    y0,
    z0,
    x1,
    y0,
    z0,
    x1,
    y1,
    z0,
    x0,
    y1,
    z0,
    x0,
    y0,
    z1,
    x1,
    y0,
    z1,
    x1,
    y1,
    z1,
    x0,
    y1,
    z1,
  ]);
  const indices = Uint32Array.from([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0,
    4, 3, 4, 7,
  ]);
  return { positions, indices };
}

const job = (preset: AppRenderJob['preset']): AppRenderJob => ({
  project: 'Box',
  bodies: [{ name: 'Box', mesh: boxMesh(), finish: 'wood', color: '#aa8844' }],
  preset,
  width: 640,
  height: 360,
  quality: 'draft',
});

const deps = { wood: () => new Texture(), worktop: () => new Texture() };
const named = (scene: Scene, name: string) => scene.getObjectByName(name) as Mesh;
const worldBox = (object: Mesh) => new Box3().setFromObject(object);

describe('placeModel', () => {
  it('stands the box on z = 0 centred on x/y, like place_model, with s at least 50 mm', () => {
    const p = placeModel(job('studio').bodies);
    expect(p.offset.toArray()).toEqual([-30, -30, -5]);
    expect(p.centre.toArray()).toEqual([0, 0, 10]);
    expect(p.size).toBe(40);
    expect(p.extent.toArray()).toEqual([20, 10, 10]);
    expect(p.radius).toBeCloseTo(Math.sqrt(40 ** 2 + 20 ** 2 + 20 ** 2) / 2, 9);
    expect(p.s).toBe(50);
  });

  it('refuses a model without geometry', () => {
    expect(() =>
      placeModel([
        {
          name: 'x',
          finish: 'matte',
          mesh: { positions: new Float64Array(), indices: new Uint32Array() },
        },
      ]),
    ).toThrow('The model has no geometry.');
  });
});

describe('buildScene', () => {
  it('places the bodies on z = 0, casting and receiving shadows, with UVs and normals', () => {
    const { scene, dispose } = buildScene(job('studio'), undefined, deps);
    const body = named(scene, 'Box');
    const box = worldBox(body);
    expect(box.min.toArray()).toEqual([-20, -10, 0]);
    expect(box.max.toArray()).toEqual([20, 10, 20]);
    expect(body.castShadow && body.receiveShadow).toBe(true);
    expect(body.geometry.getAttribute('normal')).toBeTruthy();
    expect(body.geometry.getAttribute('uv')).toBeTruthy();
    dispose();
  });

  it("builds the studio's sweep from the script's arc, 200·s wide, turned 45°", () => {
    const s = 50;
    const geometry = sweepGeometry(s);
    // Floor + back + 8 arc steps + top: 11 profile points, two nodes each.
    expect(geometry.getAttribute('position').count).toBe(22);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox as Box3;
    expect(box.min.z).toBe(0);
    expect(box.max.z).toBeCloseTo(40 * s, 6);
    const { scene, key } = buildScene(job('studio'), undefined, deps);
    expect(named(scene, 'Sweep').receiveShadow).toBe(true);
    // The key at the script's (6s, −6s, 8s), aimed at the model's centre, shadows fitted ×1.5.
    expect(key?.position.toArray()).toEqual([6 * s, -6 * s, 8 * s]);
    expect(key?.target.position.toArray()).toEqual([0, 0, 10]);
    expect(key?.castShadow).toBe(true);
    expect(key?.shadow.mapSize.x).toBe(2048);
    expect(key?.shadow.bias).toBe(-0.0005);
    const r = placeModel(job('studio').bodies).radius;
    expect(key?.shadow.camera.right).toBeCloseTo(1.5 * r, 9);
    const lights = scene.children.filter((c) => c instanceof DirectionalLight);
    expect(lights).toHaveLength(3);
  });

  it('puts the table and the workbench on 200·s slabs, the model and the mat on z = 0', () => {
    for (const [preset, name, thick, top] of [
      ['table', 'Table', 30, 0],
      ['workbench', 'Worktop', 40, -MAT_THICKNESS],
    ] as const) {
      const { scene } = buildScene(job(preset), undefined, deps);
      const box = worldBox(named(scene, name));
      expect(box.max.z).toBeCloseTo(top, 9);
      expect(box.min.z).toBeCloseTo(top - thick, 9);
      expect(box.max.x - box.min.x).toBeCloseTo(200 * 50, 6);
    }
    const { scene } = buildScene(job('workbench'), undefined, deps);
    expect(worldBox(named(scene, 'Cutting mat')).max.z).toBeCloseTo(0, 9);
  });

  it('lays the cutting mat on the workbench only', () => {
    for (const preset of ['studio', 'table', 'outdoor'] as const) {
      const { scene } = buildScene(job(preset), undefined, deps);
      expect(scene.getObjectByName('Cutting mat')).toBeUndefined();
    }
  });

  it('stands the outdoor model on a 400·s ground with the sun at 40° elevation', () => {
    const { scene, key, environment } = buildScene(job('outdoor'), undefined, deps);
    const box = worldBox(named(scene, 'Ground'));
    expect(box.max.x - box.min.x).toBeCloseTo(400 * 50, 6);
    const direction = key?.position.clone().sub(key.target.position).normalize();
    expect(Math.asin(direction?.z ?? 0)).toBeCloseTo((40 * Math.PI) / 180, 9);
    expect(environment.kind).toBe('sky');
  });

  it("trace mode uses the script's area lights with the script's sizes, raster mode is unchanged", () => {
    const s = 50;
    const trace = buildScene(job('studio'), undefined, deps, 'trace');
    const areas = trace.scene.children.filter((c) => c instanceof RectAreaLight) as RectAreaLight[];
    expect(areas).toHaveLength(3);
    expect(trace.scene.children.filter((c) => c instanceof DirectionalLight)).toHaveLength(0);
    expect(trace.key).toBeUndefined();
    expect(areas.map((l) => l.position.toArray())).toEqual([
      [6 * s, -6 * s, 8 * s],
      [-7 * s, -5 * s, 4 * s],
      [-2 * s, 8 * s, 6 * s],
    ]);
    expect(areas.map((l) => l.width)).toEqual([4 * s, 6 * s, 3 * s]);
    expect(areas.every((l) => l.height === l.width)).toBe(true);
    expect(areas[0]?.intensity).toBeCloseTo(2000 * WATTS_TO_AREA, 9);
    trace.dispose();
    const raster = buildScene(job('studio'), undefined, deps);
    expect(raster.scene.children.filter((c) => c instanceof RectAreaLight)).toHaveLength(0);
    expect(raster.scene.children.filter((c) => c instanceof DirectionalLight)).toHaveLength(3);
    raster.dispose();
  });

  it('trace mode keeps the outdoor sun a DirectionalLight and has no area light', () => {
    const { scene, key, dispose } = buildScene(job('outdoor'), undefined, deps, 'trace');
    expect(scene.children.filter((c) => c instanceof RectAreaLight)).toHaveLength(0);
    expect(scene.children.filter((c) => c instanceof DirectionalLight)).toHaveLength(1);
    expect(key).toBeInstanceOf(DirectionalLight);
    expect(key?.castShadow).toBe(false);
    dispose();
  });

  it('hands each preset its environment and frees everything on dispose', () => {
    for (const preset of RENDER_PRESETS) {
      const made: string[] = [];
      let freed = 0;
      const built = buildScene(job(preset), undefined, {
        ...deps,
        environment: (_scene, kind) => {
          made.push(kind.kind);
          return () => freed++;
        },
      });
      expect(made).toEqual([preset === 'outdoor' ? 'sky' : 'room']);
      let disposed = 0;
      built.scene.traverse((o) => {
        if (o instanceof Mesh) o.geometry.addEventListener('dispose', () => disposed++);
      });
      built.dispose();
      expect(freed).toBe(1);
      expect(disposed).toBeGreaterThanOrEqual(2);
    }
  });
});
