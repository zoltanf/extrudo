/**
 * The model's bodies as mesh or STEP files (P2-12, ADR-0034), without a file
 * to put them in: the export's tessellation presets, the meshing of a list of
 * bodies with each mesh's manifold check, the file names and the bytes
 * `@extrudo/io` writes.
 *
 * **Shared by the app and the headless CLI (ADR-0069)**, so a design exported
 * from a script holds what the app's Export dialog holds: the same presets,
 * the same header and 3MF metadata, the same names and colours. The app wraps
 * the bytes in a `Blob` to download (`modelExport.ts`); the CLI writes them to
 * a file.
 */
import type { BodyId, BodyMeta, ComponentId } from '@extrudo/core';
import {
  checkManifold,
  type ManifoldReport,
  type ThreeMfAssembly,
  write3mf,
  writeStl,
} from '@extrudo/io';
import type { MeshOptions } from './mesh';
import type { BodyExportMesh, ExportProgress } from './service';

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

/** What the kernel does for an export: the project's `Recomputer`, or `KernelService` in Node. */
export interface ModelExporter {
  exportMeshes(
    bodies: readonly BodyId[],
    tessellation: MeshOptions,
    onProgress?: ExportProgress,
  ): Promise<BodyExportMesh[]>;
  exportStep(bodies: readonly StepBody[]): Promise<string>;
}

/**
 * A body as a STEP export takes it: its name (the product's) and its colour
 * (`#rrggbb`, the solid's styled item; P4-12, ADR-0034's amendment), and the
 * name of its component when the export keeps components together (P6-05,
 * ADR-0081 §7): the bodies of one component are the parts of one assembly
 * product named after it.
 */
export interface StepBody {
  id: BodyId;
  name: string;
  color?: string;
  component?: string;
}

/**
 * The STEP groups of `bodies` (P6-05, ADR-0081 §7): each body's index into
 * the component names in first-seen order, or `undefined` for a loose body.
 */
export function stepGroups(bodies: readonly StepBody[]): {
  groups: string[];
  of: (number | undefined)[];
} {
  const groups: string[] = [];
  const of = bodies.map(({ component }) => {
    if (component === undefined) return undefined;
    const at = groups.indexOf(component);
    if (at >= 0) return at;
    groups.push(component);
    return groups.length - 1;
  });
  return { groups, of };
}

/** A body's STEP part: the name, and the colour when it has one. */
export function stepBody(body: ExportBody): StepBody {
  const { color } = body.meta;
  return {
    id: body.id,
    name: body.meta.name,
    ...(color !== undefined && { color }),
    ...(body.component !== undefined && { component: body.component.name }),
  };
}

export interface ExportBody {
  id: BodyId;
  meta: BodyMeta;
  /**
   * The body is a mesh, not a solid (P4-06, ADR-0066 §3): STEP holds exact
   * B-rep geometry, so the dialog leaves a mesh body out of a STEP file. STL
   * and 3MF take its triangles as they are.
   */
  mesh?: boolean;
  /**
   * The component the body is in (P6-05, ADR-0081 §7), when the export keeps
   * components together: its bodies become the parts of one 3MF object or one
   * STEP assembly. Absent for a loose body.
   */
  component?: { id: ComponentId; name: string };
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

/** A file name from a project name: no path separators or control characters. */
export function safeFileName(name: string, extension: string): string {
  const base = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return `${base || 'Untitled'}${extension}`;
}

/**
 * The file name: the project's, and the body's when there is only one (or the
 * component's, when every body is in the same one and there is more than one;
 * P6-05, ADR-0081 §7).
 */
export function modelFileName(
  project: string,
  bodies: readonly ExportBody[],
  format: ModelFormat,
): string {
  const [only] = bodies;
  const component = only?.component;
  let base = project;
  if (bodies.length === 1 && only) base = `${project} - ${only.meta.name}`;
  else if (bodies.length > 1 && component !== undefined) {
    if (bodies.every((body) => body.component?.id === component.id)) {
      base = `${project} - ${component.name}`;
    }
  }
  return safeFileName(base, format === 'step' ? '.step' : `.${format}`);
}

/** The bodies of `meshed` grouped by component, in first-seen order (ADR-0081 §7). */
export function componentAssemblies(bodies: readonly ExportBody[]): ThreeMfAssembly[] | undefined {
  const order: ComponentId[] = [];
  const names = new Map<ComponentId, string>();
  const parts = new Map<ComponentId, number[]>();
  for (const [i, body] of bodies.entries()) {
    const component = body.component;
    if (component === undefined) continue;
    const list = parts.get(component.id);
    if (list) list.push(i);
    else {
      order.push(component.id);
      names.set(component.id, component.name);
      parts.set(component.id, [i]);
    }
  }
  if (order.length === 0) return undefined;
  return order.map((id) => ({ name: names.get(id) as string, parts: parts.get(id) as number[] }));
}

/**
 * The bytes of an STL (all bodies' triangles in one list) or a 3MF (an object
 * per body, named and coloured), written the way the app's dialog writes them:
 * the header carries the application and the design, the 3MF keeps each body's
 * name and colour. With `groupComponents` (P6-05, ADR-0081 §7) a 3MF groups
 * each component's bodies as one object's `<components>`, so a slicer sees one
 * part made of several.
 */
export function meshBytes(
  meshed: MeshedBodies,
  format: 'stl' | '3mf',
  options: { application: string; project: string; groupComponents?: boolean },
): Uint8Array {
  const { application, project } = options;
  return format === 'stl'
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
        {
          title: project,
          application,
          ...(options.groupComponents === true && {
            assemblies: componentAssemblies(meshed.bodies),
          }),
        },
      );
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
