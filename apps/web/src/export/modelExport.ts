/**
 * The model's bodies as an STL, 3MF or STEP file (P2-12, ADR-0034). The
 * kernel worker tessellates at the export's own deflection (welded meshes)
 * or writes STEP; `@extrudo/io` writes the mesh files; the dialog shows
 * what the file will hold and saves it through the platform.
 */
import type { BodyId, BodyMeta, SelectionItem } from '@extrudo/core';
import { checkManifold, type ManifoldReport, write3mf, writeStl } from '@extrudo/io';
import type { BodyExportMesh, ExportProgress, MeshOptions } from '@extrudo/kernel';
import { safeFileName } from '../platform/files';
import { SLICERS, type SlicerFile, type SlicerId } from '../platform/slicer';
import { readTopology } from '../selection/items';
import { APP_VERSION } from '../version';

export type ModelFormat = 'stl' | '3mf' | 'step';
export type Resolution = 'coarse' | 'medium' | 'fine' | 'custom';

const DEGREE = Math.PI / 180;

/**
 * Mesh presets: the largest distance between the mesh and the surface
 * (mm) and the largest angle between neighbouring facets. A 3D printer
 * resolves about 0.05 mm, so Medium is finer than any print shows.
 */
export const RESOLUTIONS: Record<Exclude<Resolution, 'custom'>, MeshOptions> = {
  coarse: { linearDeflection: 0.1, angularDeflection: 30 * DEGREE },
  medium: { linearDeflection: 0.02, angularDeflection: 15 * DEGREE },
  fine: { linearDeflection: 0.005, angularDeflection: 5 * DEGREE },
};

/** The deflection's bounds: finer makes files no printer can use, coarser nothing useful. */
export const DEFLECTION_RANGE = { min: 0.001, max: 5 } as const;
export const ANGLE_RANGE = { min: 1 * DEGREE, max: 90 * DEGREE } as const;

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

/** What the kernel does for an export: the project's `Recomputer`. */
export interface ModelExporter {
  exportMeshes(
    bodies: readonly BodyId[],
    tessellation: MeshOptions,
    onProgress?: ExportProgress,
  ): Promise<BodyExportMesh[]>;
  exportStep(bodies: readonly { id: BodyId; name: string }[]): Promise<string>;
}

export interface ExportBody {
  id: BodyId;
  meta: BodyMeta;
}

/** Meshed bodies with their check, for the summary and the file. */
export interface MeshedBodies {
  bodies: readonly ExportBody[];
  meshes: BodyExportMesh[];
  /** Per body, in order. */
  reports: ManifoldReport[];
  triangles: number;
}

/**
 * Tessellates the bodies in the kernel and checks each mesh is closed and
 * manifold. The kernel meshes one body at a time (P3-13): `onProgress`
 * hears how many are done, and returning `false` from it stops the kernel
 * before the next body (the promise then rejects; see `isExportCancelled`).
 */
export async function meshBodies(
  kernel: ModelExporter,
  bodies: readonly ExportBody[],
  tessellation: MeshOptions,
  onProgress?: ExportProgress,
): Promise<MeshedBodies> {
  const meshes = await kernel.exportMeshes(
    bodies.map((b) => b.id),
    tessellation,
    onProgress,
  );
  const reports = meshes.map(({ mesh }) => checkManifold(mesh));
  return {
    bodies,
    meshes,
    reports,
    triangles: reports.reduce((n, r) => n + r.triangles, 0),
  };
}

/** The bodies whose meshes aren't closed and manifold (a slicer would repair them). */
export function openBodies(meshed: MeshedBodies): string[] {
  return meshed.bodies.filter((_, i) => !meshed.reports[i]?.ok).map((b) => b.meta.name);
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

/** The file name: the project's, and the body's when there is only one. */
export function modelFileName(
  project: string,
  bodies: readonly ExportBody[],
  format: ModelFormat,
): string {
  const [only] = bodies;
  const base = bodies.length === 1 && only ? `${project} - ${only.meta.name}` : project;
  return safeFileName(base, format === 'step' ? '.step' : `.${format}`);
}

/** An STL (all bodies' triangles in one list) or a 3MF (an object per body, named and coloured). */
export function meshFile(meshed: MeshedBodies, format: 'stl' | '3mf', project: string): ModelFile {
  const application = `Extrudo ${APP_VERSION}`;
  const bytes =
    format === 'stl'
      ? writeStl(
          meshed.meshes.map((m) => m.mesh),
          { header: `${application}: ${project} (mm)` },
        )
      : write3mf(
          meshed.meshes.map(({ mesh }, i) => {
            const meta = meshed.bodies[i]?.meta;
            return {
              name: meta?.name ?? `Body${i + 1}`,
              mesh,
              ...(meta?.color !== undefined && { color: meta.color }),
            };
          }),
          { title: project, application },
        );
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

/** A byte count for people: "845 B", "12.3 kB", "4.1 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The size of a binary STL of `triangles` triangles. */
export function stlBytes(triangles: number): number {
  return 84 + 50 * triangles;
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
