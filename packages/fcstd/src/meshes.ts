/**
 * Meshes (P6-25 S12b, ADR-0144): each `Mesh::Feature` that is a final shape
 * comes in as a mesh body. Its kernel entry is read (`mesh-read.ts`), placed
 * where FreeCAD shows it (its containers, then its own `Placement`), written
 * as binary STL (an attachment named by its SHA-256, so equal meshes share
 * one) and imported by an `import` feature, in a transaction of its own that
 * is kept only when the bodies the kernel makes have the pieces, volume, area
 * and box the triangles themselves give (S5's tolerances).
 */
import type { Design } from '@extrudo/api';
import { type AttachmentId, addAttachment, importInputs, newId } from '@extrudo/core';
import { writeStl } from '@extrudo/io';
import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_BYTES, sha256Hex } from '@extrudo/storage';
import {
  combined,
  HISTORY_AREA_TOLERANCE,
  HISTORY_BOX_TOLERANCE,
  HISTORY_VOLUME_TOLERANCE,
} from './check';
import type { FinalShape } from './final-shapes';
import type { ShapeMeasure } from './import-kernel';
import {
  MAX_MESH_FACETS,
  type MeshKernel,
  maxMeshEntryBytes,
  meshFacts,
  readMeshKernel,
} from './mesh-read';
import type { FcDocument, FcPlacement } from './model';
import { cleanName, clip, modelFileName } from './names';
import { attachmentBytes, type LeftOutReason, setBodies } from './shapes';
import type { StructureBuild } from './structure-build';

/** The most meshes one import brings in (the library's largest file has 83). */
export const MAX_IMPORT_MESHES = 512;

export interface MeshImport {
  /** The FreeCAD object's internal name. */
  readonly object: string;
  readonly name: string;
  /** `in`: a mesh body (or one per piece); else left out with `reason`. */
  readonly outcome: 'in' | 'left-out';
  readonly reason?: LeftOutReason;
  readonly detail?: string;
  /** The `import` feature and its bodies. */
  readonly feature?: string;
  readonly bodies: readonly string[];
  readonly facets?: number;
  readonly pieces?: number;
  readonly stlBytes?: number;
}

export interface MeshImportOptions {
  readonly maxFacets?: number;
  readonly maxMeshes?: number;
  readonly maxAttachmentsBytes?: number;
  readonly onStep?: () => void;
  /** Hears each mesh that came in, with its kernel (a link's copy of it is checked against it). */
  readonly keep?: (object: string, mesh: MeshKernel) => void;
}

const placementOf = (o: FinalShape['object']): FcPlacement | undefined => {
  const v = o.properties.Placement?.value;
  return v?.kind === 'placement' ? v.value : undefined;
};

const relative = (a: number, b: number) => {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
};

/** Why the kernel's bodies are not the triangles, or `undefined` when they are. */
export function meshDisagreement(
  got: ShapeMeasure,
  bodies: number,
  facts: { pieces: number; volume: number; area: number; box: ShapeMeasure['box'] },
): string | undefined {
  if (bodies !== facts.pieces)
    return `${facts.pieces} piece${facts.pieces === 1 ? '' : 's'} in the mesh, ${bodies} bod${bodies === 1 ? 'y' : 'ies'} made`;
  const volume = relative(Math.abs(got.volume), Math.abs(facts.volume));
  if (!(volume <= HISTORY_VOLUME_TOLERANCE))
    return `the volume differs by ${(volume * 100).toPrecision(2)} %`;
  const area = relative(got.area, facts.area);
  if (!(area <= HISTORY_AREA_TOLERANCE))
    return `the area differs by ${(area * 100).toPrecision(2)} %`;
  const s = facts.box;
  const diagonal = Math.hypot(...s.max.map((v, i) => v - (s.min[i] as number)));
  const corners = [...s.min, ...s.max];
  const after = [...got.box.min, ...got.box.max];
  const moved = Math.max(...corners.map((v, i) => Math.abs(v - (after[i] as number))));
  if (!(moved <= HISTORY_BOX_TOLERANCE * diagonal + 1e-6))
    return `the bounding box differs by ${moved.toPrecision(3)} mm`;
  return undefined;
}

/** Brings in the meshes among `shapes`, in document order; every mesh gets one outcome. */
export async function importMeshes(
  doc: FcDocument,
  shapes: readonly FinalShape[],
  design: Design,
  build: StructureBuild,
  budget: { readonly broken: boolean; left(): number },
  options: MeshImportOptions = {},
): Promise<MeshImport[]> {
  const out: MeshImport[] = [];
  const maxFacets = options.maxFacets ?? MAX_MESH_FACETS;
  const maxMeshes = options.maxMeshes ?? MAX_IMPORT_MESHES;
  let count = 0;
  for (const shape of shapes) {
    if (shape.format !== 'mesh') continue;
    const name = cleanName(shape.name, shape.object.name);
    const leave = (reason: LeftOutReason, detail?: string, facets?: number) =>
      out.push({
        object: shape.object.name,
        name,
        outcome: 'left-out',
        reason,
        ...(detail ? { detail: clip(detail) } : {}),
        bodies: [],
        ...(facets !== undefined ? { facets } : {}),
      });
    try {
      if (++count > maxMeshes) {
        leave('limit', `more than ${maxMeshes} meshes in one file`);
        continue;
      }
      if (budget.broken) {
        leave('restarts');
        continue;
      }
      if (budget.left() <= 0) {
        leave('import-time');
        continue;
      }
      const entry = shape.entry;
      if (entry === undefined) {
        leave('empty');
        continue;
      }
      // The archive's own size first: nothing is inflated past what a mesh under the cap can be.
      const size = doc.entries.size(entry);
      if (size === undefined) {
        leave('unreadable', 'its mesh is missing from the file');
        continue;
      }
      if (size > maxMeshEntryBytes(maxFacets)) {
        leave('too-large', `its mesh entry is ${size} bytes, more than ${maxFacets} facets take`);
        continue;
      }
      const bytes = doc.entries.get(entry);
      if (!bytes) {
        leave('unreadable', 'its mesh is missing from the file');
        continue;
      }
      const read = readMeshKernel(bytes, maxFacets);
      if ('empty' in read) {
        leave('empty');
        continue;
      }
      if ('refused' in read) {
        leave(read.refused === 'facets' ? 'too-large' : 'unreadable', read.detail);
        continue;
      }
      const facetCount = read.mesh.facets.length / 3;
      const own = placementOf(shape.object);
      const facts = meshFacts(read.mesh, own ? [...shape.chain, own] : shape.chain);
      if (facts.openEdges > 0) {
        leave(
          'not-closed',
          `${facts.openEdges} edge${facts.openEdges === 1 ? '' : 's'} not closed`,
          facetCount,
        );
        continue;
      }
      const stl = writeStl(facts.triangles, { header: 'Extrudo: a mesh from a FreeCAD file' });
      if (stl.length > MAX_ATTACHMENT_BYTES) {
        leave('too-large', `${stl.length} bytes of STL`, facetCount);
        continue;
      }
      const sha256 = sha256Hex(stl);
      const existing = Object.entries(design.doc.attachments ?? {}).find(
        ([, a]) => a.sha256 === sha256,
      )?.[0] as AttachmentId | undefined;
      if (
        existing === undefined &&
        attachmentBytes(design) + stl.length >
          (options.maxAttachmentsBytes ?? MAX_ATTACHMENTS_BYTES)
      ) {
        leave('design-full', `${stl.length} bytes of STL`, facetCount);
        continue;
      }
      const tried = await build.attempt(
        `Import ${name}`,
        () => {
          const id = existing ?? newId<AttachmentId>();
          if (existing === undefined)
            design.state.dispatch(
              addAttachment({
                id,
                attachment: {
                  name,
                  fileName: modelFileName(name, 'stl'),
                  mediaType: 'model/stl',
                  sha256,
                  size: stl.length,
                },
              }),
            );
          const feature = design.add(
            'import',
            importInputs({ file: id, units: 'mm', up: 'z', position: 'file' }),
            { name: `Import ${name}` },
          );
          return {
            value: feature.id as string,
            ...(existing === undefined ? { files: new Map([[id, stl]]) } : {}),
          };
        },
        (fresh, feature) => {
          const bodies = fresh.filter((id) => id.startsWith(`${feature}:`));
          const measures = bodies.map((id) => build.measure(id));
          if (bodies.length === 0 || measures.some((m) => m === undefined))
            return "the kernel didn't measure every body";
          const wrong = meshDisagreement(
            combined(measures as ShapeMeasure[]),
            bodies.length,
            facts,
          );
          if (wrong) return wrong;
          setBodies(design, bodies, shape, name);
          return undefined;
        },
      );
      if ('stop' in tried) {
        const reason: LeftOutReason =
          tried.stop === 'failed' ? 'kernel' : tried.stop === 'check' ? 'check' : tried.stop;
        leave(reason, tried.detail, facetCount);
        continue;
      }
      options.keep?.(shape.object.name, read.mesh);
      out.push({
        object: shape.object.name,
        name,
        outcome: 'in',
        feature: tried.value,
        bodies: tried.fresh.filter((id) => id.startsWith(`${tried.value}:`)),
        facets: facetCount,
        pieces: facts.pieces,
        stlBytes: stl.length,
      });
    } finally {
      options.onStep?.();
    }
  }
  return out;
}
