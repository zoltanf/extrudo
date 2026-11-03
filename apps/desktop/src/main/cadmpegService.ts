/**
 * What the `cad:*` channels answer (P6-19, ADR-0115 §2): the converter's
 * status and a conversion over a fresh environment per call (so an edited
 * `cadmpeg.path` preference is seen), with the renderer's file checked first.
 * Free of Electron, so it is unit-tested.
 */
import type { CadConvertResult, CadFile, CadmpegStatus } from '@extrudo/web/platform/cad';
import {
  type CadmpegEnv,
  cadmpegStatus,
  cleanupCadmpegFiles,
  convertWithCadmpeg,
  nodeCadmpegEnv,
} from './cadmpeg';

export interface CadmpegService {
  status(): CadmpegStatus;
  /** Converts the file to STEP; `{ ok: false }` says why not. Throws on a malformed file. */
  convert(file: unknown): Promise<CadConvertResult>;
  /** Removes the conversion directories (on quit). */
  cleanup(): void;
}

/** Whether `value` is a `CadFile` (it crossed the bridge, so it is checked). */
export function isCadFile(value: unknown): value is CadFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Record<string, unknown>;
  return typeof file.name === 'string' && file.bytes instanceof Uint8Array;
}

/** The `cadmpeg.path` preference: a non-empty string, else nothing. */
export function cadmpegOverride(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function createCadmpegService(makeEnv: () => CadmpegEnv): CadmpegService {
  return {
    status: () => cadmpegStatus(makeEnv()),
    async convert(file) {
      if (!isCadFile(file)) throw new Error('The conversion request is malformed.');
      // The extension and the size are checked again in `convertWithCadmpeg`.
      return convertWithCadmpeg(makeEnv(), file);
    },
    cleanup: () => cleanupCadmpegFiles(makeEnv()),
  };
}

/** The real service: the temp directory and the preference, read per call. */
export function nodeCadmpegService(
  tempDir: string,
  preference: () => unknown,
  resourcesPath: string | undefined,
  devVendorDir: string | undefined,
): CadmpegService {
  return createCadmpegService(() =>
    nodeCadmpegEnv(tempDir, cadmpegOverride(preference()), resourcesPath, devVendorDir),
  );
}
