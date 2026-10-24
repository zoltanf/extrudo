/**
 * Render Picture (P6-15, ADR-0101): two engines behind one interface. The app
 * renders itself with three.js everywhere (`AppRenderJob`, ADR-0101 §6); the
 * desktop app can also hand a job to main, which runs Blender headless and
 * returns the PNG (`BlenderRenderer`, absent on the web, where nothing can
 * start a program).
 */
import type { RenderFinish, RenderPreset, RenderQuality, ViewCamera } from '@extrudo/core';
import type { ExportMesh } from '@extrudo/kernel';

/** One body of the job: its OBJ object and how it is finished. */
export interface RenderObject {
  /** The `o` name in the OBJ (the body's name). */
  name: string;
  finish: RenderFinish;
  /** `#rrggbb`; absent → the script's default grey. */
  color?: string;
}

/** Everything main needs to render: the model, the scene and the picture size. */
export interface RenderJob {
  project: string;
  /** The OBJ and MTL texts the renderer wrote with `writeObj`; main writes them to disk. */
  obj: string;
  mtl: string;
  objects: RenderObject[];
  preset: RenderPreset;
  /** Absent: the script frames the model itself. Millimetres, Z up, as a named view. */
  camera?: ViewCamera;
  width: number;
  height: number;
  quality: RenderQuality;
}

/** One body of an in-app render: its mesh and how it is finished. */
export interface AppRenderBody {
  name: string;
  /** The export mesh (`RESOLUTIONS.medium`, the OBJ's): millimetres, Z up, shared nodes, no normals. */
  mesh: ExportMesh;
  finish: RenderFinish;
  /** `#rrggbb`; absent → the default grey. */
  color?: string;
}

/** Everything the app's own renderer needs (ADR-0101 §6.3): `RenderJob` without the OBJ. */
export interface AppRenderJob {
  project: string;
  bodies: AppRenderBody[];
  preset: RenderPreset;
  /** Absent: the renderer frames the model itself. Millimetres, Z up, as a named view. */
  camera?: ViewCamera;
  width: number;
  height: number;
  quality: RenderQuality;
}

/** Whether a usable Blender is installed (ADR-0101 §3). */
export type BlenderStatus =
  | { state: 'found'; version: string; path: string }
  | { state: 'too-old'; version: string; path: string }
  | { state: 'missing' };

export interface RenderProgress {
  /** 0–1. */
  fraction: number;
  phase: 'starting' | 'importing' | 'rendering' | 'saving';
}

export type RenderResult =
  | { ok: true; png: Uint8Array }
  | { ok: false; message: string; cancelled?: boolean };

/** What renders a picture: the app's engine or Blender (ADR-0101 §6.3). */
export interface PictureRenderer<Job = AppRenderJob> {
  /** One at a time; a second call while one runs resolves `{ ok: false }`. */
  render(job: Job, onProgress: (progress: RenderProgress) => void): Promise<RenderResult>;
  /** Stops the running render; it resolves `{ ok: false, cancelled: true }`. */
  cancel(): void;
}

export interface BlenderRenderer extends PictureRenderer<RenderJob> {
  status(): Promise<BlenderStatus>;
}

/** The oldest Blender with the built-in OBJ importer the script uses. */
export const BLENDER_MIN_VERSION = '4.2';
export const BLENDER_DOWNLOAD_URL = 'https://www.blender.org/download/';
