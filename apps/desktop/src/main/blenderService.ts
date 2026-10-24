/**
 * What the `render:*` channels answer (P6-15, ADR-0101 §3): Blender's status
 * and one render at a time over a fresh environment per call (so a Blender
 * installed while the app runs, or an edited `blender.path` preference, is
 * seen), with the renderer's job checked field by field first. Free of
 * Electron, so it is unit-tested.
 */
import {
  RENDER_FINISHES,
  RENDER_MAX_SIDE,
  RENDER_MIN_SIDE,
  RENDER_PRESETS,
  RENDER_QUALITIES,
  ViewCameraSchema,
} from '@extrudo/core';
import type {
  BlenderStatus,
  RenderJob,
  RenderProgress,
  RenderResult,
} from '@extrudo/web/platform/render';
import {
  type BlenderEnv,
  blenderStatus,
  cleanupRenderFiles,
  findBlender,
  nodeBlenderEnv,
  type RenderSignal,
  renderInBlender,
} from './blender';

export interface BlenderService {
  status(): BlenderStatus;
  /** Renders the job; `{ ok: false }` while another render runs. Throws on a malformed job. */
  render(job: unknown): Promise<RenderResult>;
  /** Stops the running render, if any; its promise resolves cancelled. */
  cancel(): void;
  /** Cancels and removes the temp files (on quit). */
  cleanup(): void;
}

const MAX_TEXT = 200;
const MAX_OBJECTS = 10_000;
const COLOR = /^#[0-9a-f]{6}$/i;

const isSide = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= RENDER_MIN_SIDE &&
  value <= RENDER_MAX_SIDE;

const isObject = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.name === 'string' &&
    o.name.length <= MAX_TEXT &&
    (RENDER_FINISHES as readonly string[]).includes(o.finish as string) &&
    (o.color === undefined || (typeof o.color === 'string' && COLOR.test(o.color)))
  );
};

/** Whether `value` is a well-formed `RenderJob` (it crossed the bridge, so it is checked). */
export function isRenderJob(value: unknown): value is RenderJob {
  if (!value || typeof value !== 'object') return false;
  const job = value as Record<string, unknown>;
  return (
    typeof job.project === 'string' &&
    job.project.length <= MAX_TEXT &&
    typeof job.obj === 'string' &&
    typeof job.mtl === 'string' &&
    Array.isArray(job.objects) &&
    job.objects.length <= MAX_OBJECTS &&
    job.objects.every(isObject) &&
    (RENDER_PRESETS as readonly string[]).includes(job.preset as string) &&
    (RENDER_QUALITIES as readonly string[]).includes(job.quality as string) &&
    isSide(job.width) &&
    isSide(job.height) &&
    (job.camera === undefined || ViewCameraSchema.safeParse(job.camera).success)
  );
}

/** The `blender.path` preference: a non-empty string, else nothing. */
export function blenderOverride(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function createBlenderService(
  makeEnv: () => BlenderEnv,
  onProgress: (progress: RenderProgress) => void,
): BlenderService {
  let current: RenderSignal | undefined;
  const cancel = () => {
    if (!current) return;
    current.cancelled = true;
    current.process?.kill();
  };
  return {
    status: () => blenderStatus(makeEnv()),
    async render(job) {
      if (!isRenderJob(job)) throw new Error('The render request is malformed.');
      if (current) return { ok: false, message: 'A render is already running.' };
      const env = makeEnv();
      const status = blenderStatus(env);
      if (status.state === 'missing') return { ok: false, message: "Blender wasn't found." };
      if (status.state === 'too-old') {
        return {
          ok: false,
          message: `Blender ${status.version} is too old; 4.2 or newer is needed.`,
        };
      }
      const found = findBlender(env);
      if (!found) return { ok: false, message: "Blender wasn't found." };
      const signal: RenderSignal = { cancelled: false };
      current = signal;
      try {
        return await renderInBlender(env, found, job, onProgress, signal);
      } finally {
        if (current === signal) current = undefined;
      }
    },
    cancel,
    cleanup() {
      cancel();
      cleanupRenderFiles(makeEnv());
    },
  };
}

/** The real service: the temp directory and the preference, read per call. */
export function nodeBlenderService(
  tempDir: string,
  preference: () => unknown,
  onProgress: (progress: RenderProgress) => void,
): BlenderService {
  return createBlenderService(
    () => nodeBlenderEnv(tempDir, blenderOverride(preference())),
    onProgress,
  );
}
