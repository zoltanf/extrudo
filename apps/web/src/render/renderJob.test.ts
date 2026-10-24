import {
  applyCommand,
  createDocument,
  DEFAULT_RENDER_SETTINGS,
  newId,
  type RenderSettings,
  saveView,
  type ViewCamera,
  type ViewId,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import type { MeshedBodies } from '../export/modelExport';
import {
  buildAppJob,
  buildRenderJob,
  commonFinish,
  currentRenderSettings,
  engineOf,
  finishOf,
  jobCamera,
  renderFileName,
  settingsChanged,
  withEngine,
  withFinish,
  withFinishForAll,
} from './renderJob';

const A = 'E1:A' as never;
const B = 'E1:B' as never;
const base: RenderSettings = DEFAULT_RENDER_SETTINGS;
const camera: ViewCamera = {
  projection: 'perspective',
  position: [10, 10, 10],
  target: [0, 0, 0],
  up: [0, 0, 1],
};

describe('render settings helpers', () => {
  it('uses the defaults for a design without a render section', () => {
    expect(currentRenderSettings(createDocument())).toEqual(DEFAULT_RENDER_SETTINGS);
  });

  it('reads a finish, matte by default', () => {
    expect(finishOf(base, A)).toBe('matte');
    expect(finishOf({ ...base, finishes: { [A]: 'metal' } }, A)).toBe('metal');
  });

  it('withFinish stores a finish and drops matte entries and an empty map', () => {
    const metal = withFinish(base, A, 'metal');
    expect(metal.finishes).toEqual({ [A]: 'metal' });
    const both = withFinish(metal, B, 'wood');
    expect(withFinish(both, A, 'matte').finishes).toEqual({ [B]: 'wood' });
    expect('finishes' in withFinish(metal, A, 'matte')).toBe(false);
    // The input is not changed.
    expect(metal.finishes).toEqual({ [A]: 'metal' });
  });

  it('commonFinish is the one finish all bodies share, matte for none, undefined when mixed', () => {
    expect(commonFinish(base, [])).toBe('matte');
    expect(commonFinish(base, [A, B])).toBe('matte');
    const metal = withFinishForAll(base, [A, B], 'metal');
    expect(metal.finishes).toEqual({ [A]: 'metal', [B]: 'metal' });
    expect(commonFinish(metal, [A, B])).toBe('metal');
    expect(commonFinish(withFinish(metal, B, 'wood'), [A, B])).toBeUndefined();
    // Back to matte drops the entries.
    expect('finishes' in withFinishForAll(metal, [A, B], 'matte')).toBe(false);
  });

  it('settingsChanged ignores the key order of finishes', () => {
    const x: RenderSettings = { ...base, finishes: { [A]: 'metal', [B]: 'wood' } };
    const y: RenderSettings = { ...base, finishes: { [B]: 'wood', [A]: 'metal' } };
    expect(settingsChanged(x, y)).toBe(false);
    expect(settingsChanged(x, { ...y, quality: 'high' })).toBe(true);
    expect(settingsChanged(base, { ...base, width: 1280, height: 720 })).toBe(true);
    expect(settingsChanged(base, { ...base, finishes: { [A]: 'glossy' } })).toBe(true);
    expect(settingsChanged(base, { ...base, camera: { kind: 'auto' } })).toBe(true);
  });
});

describe('jobCamera', () => {
  const id = newId<ViewId>();
  const doc = applyCommand(createDocument(), saveView({ id, name: 'Front', camera })).doc;

  it('is undefined for auto, live for current, the named view for view', () => {
    const live = () => ({ ...camera, position: [1, 2, 3] as [number, number, number] });
    expect(jobCamera({ ...base, camera: { kind: 'auto' } }, doc, live)).toBeUndefined();
    // The default is the current view.
    expect(jobCamera(base, doc, live)?.position).toEqual([1, 2, 3]);
    expect(jobCamera({ ...base, camera: { kind: 'view', id } }, doc, live)).toEqual(camera);
  });

  it('falls back to auto for a deleted view', () => {
    const gone = newId<ViewId>();
    expect(jobCamera({ ...base, camera: { kind: 'view', id: gone } }, doc, () => camera)).toBe(
      undefined,
    );
  });
});

describe('buildRenderJob', () => {
  const tri = {
    positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: Uint32Array.from([0, 1, 2]),
  };
  const meshed = {
    bodies: [
      { id: A, meta: { name: 'Base', visible: true, color: '#ff0000' } },
      { id: B, meta: { name: 'Lid', visible: true } },
    ],
    meshes: [
      { id: A, mesh: tri },
      { id: B, mesh: tri },
    ],
    reports: [],
    triangles: 2,
  } as unknown as MeshedBodies;

  it('writes one object per body with its colour and finish, and carries the settings', () => {
    const settings: RenderSettings = {
      ...base,
      preset: 'table',
      quality: 'high',
      finishes: { [B]: 'wood' },
    };
    const job = buildRenderJob('Box', meshed, settings, camera);
    expect(job.obj.match(/^o /gm)).toHaveLength(2);
    expect(job.obj).toContain('o Base');
    expect(job.obj).toContain('o Lid');
    expect(job.mtl).toContain('Kd 1 0 0');
    expect(job.objects).toEqual([
      { name: 'Base', finish: 'matte', color: '#ff0000' },
      { name: 'Lid', finish: 'wood' },
    ]);
    expect(job).toMatchObject({
      project: 'Box',
      preset: 'table',
      quality: 'high',
      width: 1920,
      height: 1080,
      camera,
    });
    expect('camera' in buildRenderJob('Box', meshed, base, undefined)).toBe(false);
  });
});

describe('the engine (ADR-0101 §6)', () => {
  const found = { state: 'found', version: '4.5.1', path: '/b' } as const;

  it('is Blender only when stored so and found; else the app', () => {
    expect(engineOf(base)).toBe('app');
    expect(engineOf(base, found)).toBe('app');
    expect(engineOf({ ...base, engine: 'blender' }, found)).toBe('blender');
    expect(engineOf({ ...base, engine: 'blender' })).toBe('app');
    expect(engineOf({ ...base, engine: 'blender' }, { state: 'missing' })).toBe('app');
    expect(
      engineOf({ ...base, engine: 'blender' }, { state: 'too-old', version: '3.6', path: '/b' }),
    ).toBe('app');
  });

  it('is stored only when Blender: the app removes the key, and counts as a change', () => {
    const blender = withEngine(base, 'blender');
    expect(blender.engine).toBe('blender');
    expect(withEngine(blender, 'app')).toEqual(base);
    expect('engine' in withEngine(blender, 'app')).toBe(false);
    expect(settingsChanged(base, blender)).toBe(true);
    expect(settingsChanged(base, { ...base, engine: 'app' })).toBe(false);
  });
});

describe('buildAppJob', () => {
  const tri = {
    positions: Float64Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: Uint32Array.from([0, 1, 2]),
  };
  const meshed = {
    bodies: [
      { id: A, meta: { name: 'Base', visible: true, color: '#ff0000' } },
      { id: B, meta: { name: 'Lid', visible: true } },
    ],
    meshes: [
      { id: A, mesh: tri },
      { id: B, mesh: tri },
    ],
    reports: [],
    triangles: 2,
  } as unknown as MeshedBodies;

  it('carries each body with its mesh, colour and finish, and the settings', () => {
    const settings: RenderSettings = { ...base, preset: 'outdoor', finishes: { [A]: 'glossy' } };
    const job = buildAppJob('Box', meshed, settings, camera);
    expect(job.bodies).toEqual([
      { name: 'Base', mesh: tri, finish: 'glossy', color: '#ff0000' },
      { name: 'Lid', mesh: tri, finish: 'matte' },
    ]);
    expect(job).toMatchObject({
      project: 'Box',
      preset: 'outdoor',
      quality: 'standard',
      width: 1920,
      height: 1080,
      camera,
    });
    expect('camera' in buildAppJob('Box', meshed, base, undefined)).toBe(false);
  });
});

describe('renderFileName', () => {
  it('is "<project> - <preset label>.png" without path characters', () => {
    expect(renderFileName('a/b', 'table')).toBe('a b - Wooden table.png');
    expect(renderFileName('Box', 'studio')).toBe('Box - Studio.png');
  });
});
