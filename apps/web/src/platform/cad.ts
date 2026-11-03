/**
 * Other CAD files (P6-19, ADR-0115 §1): the desktop app converts them to STEP
 * with the bundled cadmpeg before the normal import, so a design only ever
 * holds the STEP. The formats are named by extension only. A leaf module (no
 * React, no DOM) so main can import its types.
 */

/** The extensions the desktop converts to STEP with cadmpeg (ADR-0115 §1), lower case, with the dot. */
export const CAD_CONVERT_EXTENSIONS = [
  '.sldprt',
  '.ipt',
  '.iam',
  '.catpart',
  '.fcstd',
  '.sat',
  '.smt',
  '.smb',
  '.sab',
  '.igs',
  '.iges',
  '.pvz',
] as const;

/** The extensions as a file picker's `accept`. */
export const CAD_CONVERT_ACCEPT = CAD_CONVERT_EXTENSIONS.join(',');

/** The extension of `fileName`, lower case with the dot; '' without one. */
function extensionOf(fileName: string): string {
  const match = /\.[^./\\]+$/.exec(fileName);
  return match ? match[0].toLowerCase() : '';
}

/** Whether the desktop converts `fileName` (by its extension, any case). */
export function isConvertibleCad(fileName: string): boolean {
  return (CAD_CONVERT_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/** A picked file, as the renderer hands it to main. */
export interface CadFile {
  name: string;
  bytes: Uint8Array;
}

/** A conversion's answer: the STEP (`name` is `<base>.step`), or why there is none. */
export type CadConvertResult =
  | { ok: true; name: string; bytes: Uint8Array }
  | { ok: false; message: string };

export type ConvertCad = (file: CadFile) => Promise<CadConvertResult>;

/** What main reports about the converter: where it is, or why not. */
export interface CadmpegStatus {
  found: boolean;
  path?: string;
  version?: string;
  message?: string;
}

/** The STEP file a conversion makes: `Bracket.SLDPRT` → `Bracket.step`. */
export function stepNameFor(fileName: string): string {
  const base = fileName.slice(0, fileName.length - extensionOf(fileName).length);
  return `${base || 'model'}.step`;
}
