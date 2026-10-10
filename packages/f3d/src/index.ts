/**
 * @extrudo/f3d: reads Autodesk Fusion `.f3d` archives and turns them into
 * Extrudo designs.
 *
 * ```ts
 * import { importF3d } from '@extrudo/f3d';
 *
 * const { design, report } = importF3d(bytes, 'Bracket');
 * design.toJSON(); // the timeline: parameters, sketches, extrudes
 * report.skipped;  // what Fusion had that the import left out, and why
 * ```
 *
 * The format is undocumented; what is read here was worked out from real
 * files (`FORMAT.md` beside this package's sources). Two layers:
 * `readF3d` decodes the design records into plain data, `f3dToDesign` maps
 * that onto `@extrudo/api`.
 */
import { unzip } from './archive';
import type { ImportOptions, ImportResult } from './map';
import { f3dToDesign } from './map';
import { readF3d } from './model';

export { F3dFormatError } from './bytes';
export { f3dToDesign, type ImportOptions, type ImportReport, type ImportResult } from './map';
export {
  type F3dDesign,
  type F3dExtrude,
  type F3dFeature,
  type F3dSketch,
  type F3dSketchFeature,
  readF3d,
} from './model';

/** Reads a `.f3d` file and builds the Extrudo design it describes. */
export function importF3d(
  bytes: Uint8Array,
  name: string,
  options: ImportOptions = {},
): ImportResult {
  return f3dToDesign(readF3d(bytes), name, options);
}

/** The PNG preview Fusion stores in the file, if there is one. */
export function f3dPreview(bytes: Uint8Array): Uint8Array | undefined {
  for (const [name, content] of unzip(bytes))
    if (name.endsWith('/Previews/small.png')) return content;
  return undefined;
}
