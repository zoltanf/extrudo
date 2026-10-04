/**
 * Slicer hand-off (P4-08, ADR-0062 §3, FR-3DP-06, NFR-08). A slicer can only
 * open a file it can read: a URL, or a path on this machine. A web app that
 * keeps designs in the browser has no such URL, so the browser build leaves
 * `openInSlicer` undefined and the Export dialog shows nothing about slicers
 * (FR-IO-02 keeps the files local: uploading a design to a server to get a
 * download URL is not an option).
 *
 * The **Electron build** (Phase 6) implements it: write the exported bytes to
 * a temporary file and launch the program with it. The URL schemes the
 * slicers register (`prusaslicer://open?file=…`) need an http(s) URL, which is
 * why this is a file hand-off instead.
 */

/** The slicers the desktop build can launch, by what it looks for. */
export type SlicerId = 'prusaslicer' | 'orcaslicer' | 'bambustudio' | 'cura';

/** The slicers in the Export dialog's select, with their labels. */
export const SLICERS: readonly { id: SlicerId; label: string }[] = [
  { id: 'prusaslicer', label: 'PrusaSlicer' },
  { id: 'orcaslicer', label: 'OrcaSlicer' },
  { id: 'bambustudio', label: 'Bambu Studio' },
  { id: 'cura', label: 'Cura' },
];

/** What a slicer is handed: the same bytes Export saves, and what they are. */
export interface SlicerFile {
  /** The file name, extension included ("Bracket.3mf"). */
  name: string;
  bytes: Uint8Array;
  format: '3mf' | 'stl' | 'step';
}

/**
 * Opens `file` in `slicer`. Resolves true when the program took the file,
 * false when it refused (or isn't installed): the dialog then says so.
 */
export type OpenInSlicer = (file: SlicerFile, slicer: SlicerId) => Promise<boolean>;
