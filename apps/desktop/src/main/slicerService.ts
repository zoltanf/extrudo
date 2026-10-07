/**
 * What the `slicer:*` channels answer (P6-02): detection and launch over a
 * fresh environment per call (so a slicer installed while the app runs, or an
 * edited `slicers.paths` preference, is seen), with the renderer's arguments
 * checked first. Free of Electron, so it is unit-tested.
 */
import type { SlicerFile, SlicerId } from '@extrudo/web/platform/slicer';
import { SLICERS } from '@extrudo/web/platform/slicer';
import {
  cleanupSlicerFiles,
  findSlicers,
  isSlicerFile,
  isSlicerId,
  nodeSlicerEnv,
  openInSlicer,
  type SlicerEnv,
} from './slicers';

export interface SlicerService {
  list(): { id: SlicerId; path: string }[];
  open(file: unknown, id: unknown): Promise<boolean>;
  cleanup(): void;
}

/** The `slicers.paths` preference: only string values under a slicer's ID count. */
export function slicerOverrides(value: unknown): Partial<Record<SlicerId, string>> {
  const result: Partial<Record<SlicerId, string>> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const { id } of SLICERS) {
    const path = (value as Record<string, unknown>)[id];
    if (typeof path === 'string' && path !== '') result[id] = path;
  }
  return result;
}

export function createSlicerService(makeEnv: () => SlicerEnv): SlicerService {
  return {
    list: () => findSlicers(makeEnv()).map(({ id, path }) => ({ id, path })),
    async open(file: unknown, id: unknown) {
      if (!isSlicerFile(file) || !isSlicerId(id)) {
        throw new Error('The slicer request is malformed.');
      }
      const env = makeEnv();
      return openInSlicer(env, findSlicers(env), file as SlicerFile, id);
    },
    cleanup: () => cleanupSlicerFiles(makeEnv()),
  };
}

/** The real service: the temp directory and the preference's overrides, read per call. */
export function nodeSlicerService(tempDir: string, preference: () => unknown): SlicerService {
  return createSlicerService(() => nodeSlicerEnv(tempDir, slicerOverrides(preference())));
}
