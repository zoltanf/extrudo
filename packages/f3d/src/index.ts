/**
 * @extrudo/f3d: reads `.f3d` archives and turns them into
 * Extrudo designs.
 *
 * ```ts
 * import { importF3d } from '@extrudo/f3d';
 *
 * const { design, report } = importF3d(bytes, 'Bracket');
 * design.toJSON(); // the timeline: parameters, sketches, extrudes
 * report.skipped;  // what the file had that the import left out, and why
 * ```
 *
 * The format is undocumented; what is read here was worked out from real
 * files (`FORMAT.md` beside this package's sources). Two layers:
 * `readF3d` decodes the design records into plain data, `f3dToDesign` maps
 * that onto `@extrudo/api`.
 */
import { previewBytes, unzip } from './archive';
import { bodiesStep } from './brep-step';
import type { ImportOptions, ImportResult } from './map';
import { f3dToDesign } from './map';
import { readF3dEntries } from './model';

export { MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES, previewBytes } from './archive';
export { type AsmBodyFace, type AsmBodySolid, asmBodies } from './asm-body';
export {
  applyBodyPlan,
  BOX_TOLERANCE,
  type BodyMeasure,
  type BodyMeasures,
  type BodyPlan,
  type BodyProbe,
  bodyFiles,
  bodyOutcomes,
  type FileBody,
  fileBodies,
  IOU_MIN,
  measureProbe,
  type PlannedBody,
  type ProbeBody,
  type ProbeOutput,
  planBodies,
  probeDocument,
  REMOVE_NAME,
  type ReplayedBody,
  stepSize,
  VOLUME_TOLERANCE,
} from './body-check';
export { type BodyStep, bodiesStep, f3dBodiesStep, UnsupportedGeometry } from './brep-step';
export { F3dFormatError } from './bytes';
export {
  type BodyLink,
  type BodyOutcome,
  f3dToDesign,
  type ImportOptions,
  type ImportReport,
  type ImportResult,
  MAX_REASON,
  type SkippedFeature,
} from './map';
export {
  type F3dDesign,
  type F3dExtrude,
  type F3dFeature,
  type F3dSketch,
  type F3dSketchFeature,
  readF3d,
} from './model';

/**
 * Reads a `.f3d` file and builds the Extrudo design it describes. The preview
 * PNG comes back from the entries this already unpacked, so a caller needs no
 * second unzip (M2).
 */
export function importF3d(
  bytes: Uint8Array,
  name: string,
  options: ImportOptions = {},
): ImportResult {
  const entries = unzip(bytes);
  const f3d = readF3dEntries(entries);
  const { design, report, bodies } = f3dToDesign(f3d, name, options);
  const preview = previewBytes(entries);
  if (!options.bodies) return { design, report, ...(preview ? { preview } : {}) };
  // The B-rep writer runs on the entries already unzipped (M2).
  const steps = bodiesStep(entries, f3d);
  return { design, report, ...(preview ? { preview } : {}), bodies, steps };
}

/** The PNG preview stored in the file, if there is a usable one (L1). */
export function f3dPreview(bytes: Uint8Array): Uint8Array | undefined {
  return previewBytes(unzip(bytes));
}
