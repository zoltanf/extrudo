/**
 * The model's bodies as an STL, 3MF or STEP file (P2-12, ADR-0034). The
 * kernel worker tessellates at the export's own deflection (welded meshes)
 * or writes STEP; `@extrudo/io` writes the mesh files; the dialog shows
 * what the file will hold and saves it through the platform.
 *
 * The export itself — the presets, the meshing, the file names, the bytes —
 * is `@extrudo/kernel`'s (`modelExport.ts` there), which the headless CLI
 * shares so an export from a script holds what this dialog holds
 * (ADR-0069). What stays here is the browser's part: the `Blob`s the
 * platform downloads, the slicer hand-off and which bodies an export starts
 * with.
 */
import type { BodyId, BodyMeta, SelectionItem } from '@extrudo/core';
import {
  type ExportBody,
  type MeshedBodies,
  type ModelExporter,
  type ModelFormat,
  meshBytes,
  modelFileName,
} from '@extrudo/kernel';
import { SLICERS, type SlicerFile, type SlicerId } from '../platform/slicer';
import { readTopology } from '../selection/items';
import { APP_VERSION } from '../version';

export {
  ANGLE_RANGE,
  DEFLECTION_RANGE,
  formatBytes,
  meshBodies,
  modelFileName,
  openBodies,
  RESOLUTIONS,
  type Resolution,
  safeFileName,
  stlBytes,
} from '@extrudo/kernel';
export type { ExportBody, MeshedBodies, ModelExporter, ModelFormat };

/** The bodies an export starts with: those selected (a face picks its body), else every shown one. */
export function initialBodies(
  bodies: readonly { id: BodyId; meta: BodyMeta }[],
  selection: readonly SelectionItem[],
  only?: readonly BodyId[],
): BodyId[] {
  const live = new Set(bodies.map((b) => b.id));
  if (only && only.length > 0) return only.filter((id) => live.has(id));
  const picked = new Set<BodyId>();
  for (const item of selection) {
    const body = readTopology(item)?.body;
    if (body) picked.add(body);
  }
  const selected = bodies.filter((b) => picked.has(b.id)).map((b) => b.id);
  if (selected.length > 0) return selected;
  const shown = bodies.filter((b) => b.meta.visible).map((b) => b.id);
  return shown.length > 0 ? shown : bodies.map((b) => b.id);
}

export interface ModelFile {
  blob: Blob;
  name: string;
}

const TYPES: Record<ModelFormat, string> = {
  stl: 'model/stl',
  '3mf': 'model/3mf',
  step: 'model/step',
};

/** An STL (all bodies' triangles in one list) or a 3MF (an object per body, named and coloured). */
export function meshFile(meshed: MeshedBodies, format: 'stl' | '3mf', project: string): ModelFile {
  const bytes = meshBytes(meshed, format, { application: `Extrudo ${APP_VERSION}`, project });
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: TYPES[format] }),
    name: modelFileName(project, meshed.bodies, format),
  };
}

/** A STEP AP242 file of the bodies, each a product with its name. */
export async function stepFile(
  kernel: ModelExporter,
  bodies: readonly ExportBody[],
  project: string,
): Promise<ModelFile> {
  const text = await kernel.exportStep(bodies.map((b) => ({ id: b.id, name: b.meta.name })));
  return {
    blob: new Blob([text], { type: TYPES.step }),
    name: modelFileName(project, bodies, 'step'),
  };
}

/**
 * Hands the exported file to a slicer (P4-08, ADR-0062 §3): the same bytes
 * Export saves, read back out of the blob the platform downloads from. What
 * a refused hand-off says, for the dialog's usual error line.
 */
export async function handToSlicer(
  open: (file: SlicerFile, slicer: SlicerId) => Promise<boolean>,
  file: ModelFile,
  format: ModelFormat,
  slicer: SlicerId,
): Promise<string | undefined> {
  const bytes = new Uint8Array(await file.blob.arrayBuffer());
  const label = SLICERS.find((s) => s.id === slicer)?.label ?? slicer;
  try {
    const opened = await open({ name: file.name, bytes, format }, slicer);
    if (opened) return undefined;
    return `${label} didn't take the file. Is it installed?`;
  } catch (error) {
    return `Couldn't open the file in ${label}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}
