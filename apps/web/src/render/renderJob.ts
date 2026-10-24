/**
 * Render Picture (P6-15, ADR-0101): the pure parts of the dialog. The stored
 * settings and the choices on screen, the camera a job carries, the job
 * itself (OBJ over the meshed bodies) and the picture's file name.
 */
import {
  type BodyId,
  DEFAULT_FINISH,
  DEFAULT_RENDER_SETTINGS,
  type ExtrudoDocument,
  RENDER_PRESET_INFO,
  type RenderEngine,
  type RenderFinish,
  type RenderPreset,
  type RenderSettings,
  type ViewCamera,
} from '@extrudo/core';
import { type MeshObject, writeObj } from '@extrudo/io';
import { safeFileName } from '@extrudo/kernel';
import type { MeshedBodies } from '../export/modelExport';
import type { AppRenderJob, BlenderStatus, RenderJob } from '../platform/render';
import { APP_VERSION } from '../version';

/** The stored settings, or the defaults for a design without any. */
export function currentRenderSettings(doc: ExtrudoDocument): RenderSettings {
  return doc.render ?? DEFAULT_RENDER_SETTINGS;
}

/** The finish of a body: the stored one, else `DEFAULT_FINISH`. */
export function finishOf(settings: RenderSettings, body: BodyId): RenderFinish {
  return settings.finishes?.[body] ?? DEFAULT_FINISH;
}

/** Settings with one body's finish changed; `matte` removes the entry, an empty map removes `finishes`. */
export function withFinish(
  settings: RenderSettings,
  body: BodyId,
  finish: RenderFinish,
): RenderSettings {
  const { finishes, ...rest } = settings;
  const next = { ...finishes };
  if (finish === DEFAULT_FINISH) delete next[body];
  else next[body] = finish;
  return Object.keys(next).length > 0 ? { ...rest, finishes: next } : rest;
}

/** The finish every one of `bodies` has, or undefined when they differ (matte for none). */
export function commonFinish(
  settings: RenderSettings,
  bodies: readonly BodyId[],
): RenderFinish | undefined {
  const [first, ...rest] = bodies.map((body) => finishOf(settings, body));
  if (first === undefined) return DEFAULT_FINISH;
  return rest.every((finish) => finish === first) ? first : undefined;
}

/** Settings with every one of `bodies` set to `finish`. */
export function withFinishForAll(
  settings: RenderSettings,
  bodies: readonly BodyId[],
  finish: RenderFinish,
): RenderSettings {
  return bodies.reduce((next, body) => withFinish(next, body, finish), settings);
}

const sortedFinishes = (settings: RenderSettings) =>
  Object.entries(settings.finishes ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** True when the two differ (deep equal on the schema's fields, `finishes` key order ignored). */
export function settingsChanged(a: RenderSettings, b: RenderSettings): boolean {
  return (
    JSON.stringify([
      a.preset,
      a.camera,
      a.width,
      a.height,
      a.quality,
      a.engine ?? 'app',
      sortedFinishes(a),
    ]) !==
    JSON.stringify([
      b.preset,
      b.camera,
      b.width,
      b.height,
      b.quality,
      b.engine ?? 'app',
      sortedFinishes(b),
    ])
  );
}

/** Who renders (ADR-0101 §6.1): Blender only when stored so and found; else the app. */
export function engineOf(settings: RenderSettings, blender?: BlenderStatus): RenderEngine {
  return settings.engine === 'blender' && blender?.state === 'found' ? 'blender' : 'app';
}

/** Settings with the engine chosen; `app` (the default) removes the key, so unchanged designs stay so. */
export function withEngine(settings: RenderSettings, engine: RenderEngine): RenderSettings {
  const { engine: _, ...rest } = settings;
  return engine === 'app' ? rest : { ...rest, engine };
}

/**
 * The camera the job carries: undefined for `auto`; the live viewport camera for
 * `current`; the named view's for `view` (a missing view falls back to `auto`).
 */
export function jobCamera(
  settings: RenderSettings,
  doc: ExtrudoDocument,
  live: () => ViewCamera,
): ViewCamera | undefined {
  const { camera } = settings;
  if (camera.kind === 'current') return live();
  if (camera.kind === 'view') return doc.views.find((v) => v.id === camera.id)?.camera;
  return undefined;
}

/** Builds the job: `writeObj` over the meshed bodies (name, colour from the body's meta), the objects with their finish, and the settings. */
export function buildRenderJob(
  project: string,
  meshed: MeshedBodies,
  settings: RenderSettings,
  camera: ViewCamera | undefined,
): RenderJob {
  const objects: MeshObject[] = meshed.meshes.map(({ id, mesh }, i) => {
    const body = meshed.bodies[i];
    return {
      name: body?.meta.name ?? id,
      mesh,
      ...(body?.meta.color !== undefined && { color: body.meta.color }),
    };
  });
  const { obj, mtl } = writeObj(objects, { application: `Extrudo ${APP_VERSION}`, project });
  return {
    project,
    obj,
    mtl,
    objects: objects.map((o, i) => ({
      name: o.name,
      finish: finishOf(settings, meshed.meshes[i]?.id as BodyId),
      ...(o.color !== undefined && { color: o.color }),
    })),
    preset: settings.preset,
    ...(camera !== undefined && { camera }),
    width: settings.width,
    height: settings.height,
    quality: settings.quality,
  };
}

/** The in-app renderer's job (ADR-0101 §6.3): `buildRenderJob` without the OBJ, the meshes as they are. */
export function buildAppJob(
  project: string,
  meshed: MeshedBodies,
  settings: RenderSettings,
  camera: ViewCamera | undefined,
): AppRenderJob {
  return {
    project,
    bodies: meshed.meshes.map(({ id, mesh }, i) => {
      const body = meshed.bodies[i];
      return {
        name: body?.meta.name ?? id,
        mesh,
        finish: finishOf(settings, id as BodyId),
        ...(body?.meta.color !== undefined && { color: body.meta.color }),
      };
    }),
    preset: settings.preset,
    ...(camera !== undefined && { camera }),
    width: settings.width,
    height: settings.height,
    quality: settings.quality,
  };
}

/** "<project> - <preset label>.png", through `safeFileName`. */
export function renderFileName(project: string, preset: RenderPreset): string {
  return safeFileName(`${project} - ${RENDER_PRESET_INFO[preset].label}`, '.png');
}
