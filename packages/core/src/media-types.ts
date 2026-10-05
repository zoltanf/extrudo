/**
 * The media types a design's attachments may have (P4-03b, ADR-0061 §1; P4-06,
 * ADR-0066 §0), and the file name extensions they come from.
 *
 * The type comes from the **name's extension**, never from the browser's
 * `File.type`, which is empty for most of these files (`.step`, `.stl`,
 * `.3mf`). Pure, so the app that adds a file, the dialog that reads one back
 * and the kernel that parses it all agree.
 */
import type { Attachment } from './schema';

/** Every media type a design's attachments may carry. */
export const MEDIA_TYPES = [
  'font/ttf',
  'font/otf',
  'font/woff',
  'model/step',
  'model/stl',
  'model/3mf',
  'model/obj',
  'application/x-openscad',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * The media types an `import` feature's `file` may have (ADR-0066 §2): STEP,
 * the meshes, and an OpenSCAD file, which compiles to a mesh (ADR-0071 §2).
 */
export const MODEL_MEDIA_TYPES: readonly MediaType[] = [
  'model/step',
  'model/stl',
  'model/3mf',
  'model/obj',
  'application/x-openscad',
];

/** An OpenSCAD source file (P5-04, ADR-0071). */
export const SCAD_MEDIA_TYPE = 'application/x-openscad' satisfies MediaType;

/** The media types a canvas image may have (ADR-0066 §5). */
export const IMAGE_MEDIA_TYPES: readonly MediaType[] = ['image/png', 'image/jpeg', 'image/webp'];

/** The font types. WOFF2 is not one of them: the shaper can't read it (ADR-0061 §1). */
export const FONT_MEDIA_TYPES: readonly MediaType[] = ['font/ttf', 'font/otf', 'font/woff'];

/** What a model file's extension is, for the import dialog's `units` field. */
export type ModelKind = 'step' | 'mesh';

const BY_EXTENSION: Readonly<Record<string, MediaType>> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  step: 'model/step',
  stp: 'model/step',
  stl: 'model/stl',
  '3mf': 'model/3mf',
  obj: 'model/obj',
  scad: 'application/x-openscad',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * The media type a file name's extension gives, or `undefined` when Extrudo
 * doesn't read that kind of file. Case doesn't matter (`.STEP` is a STEP
 * file), and only the last extension counts (`part.step.gz` is a gzip).
 */
export function mediaTypeOf(fileName: string): MediaType | undefined {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return undefined;
  return BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()];
}

/** Whether a media type is one Extrudo can read at all. */
export function isKnownMediaType(mediaType: string): mediaType is Attachment['mediaType'] {
  return (MEDIA_TYPES as readonly string[]).includes(mediaType);
}

/** Whether a media type is a model file (an `import` feature's, ADR-0066 §2). */
export function isModelMediaType(
  mediaType: string | undefined,
): mediaType is Attachment['mediaType'] {
  return mediaType !== undefined && MODEL_MEDIA_TYPES.includes(mediaType as MediaType);
}

/**
 * Whether a media type is a mesh: a mesh model, whose `units` the user picks.
 * An OpenSCAD file is one: it compiles to a mesh body (ADR-0071 §2), so it
 * needs manifold-3d like the others.
 */
export function isMeshMediaType(mediaType: string | undefined): boolean {
  return mediaType !== undefined && isModelMediaType(mediaType) && mediaType !== 'model/step';
}

/** Whether a media type is an OpenSCAD file, which the kernel compiles first (ADR-0071). */
export function isScadMediaType(mediaType: string | undefined): boolean {
  return mediaType === SCAD_MEDIA_TYPE;
}

/** STEP or a mesh: what kind of import a file is. */
export function modelKind(mediaType: string | undefined): ModelKind | undefined {
  if (mediaType === 'model/step') return 'step';
  return isMeshMediaType(mediaType) ? 'mesh' : undefined;
}

/**
 * Which media types a feature type's `file` inputs may name (ADR-0066): an
 * `import` reads models, a `canvas` an image. A feature type that isn't
 * listed can't have a `file` input. Keyed by the feature type, so the
 * document check in `schema.ts` needs no knowledge of the features
 * themselves (this module is imported by the schema, so it must not import
 * it back).
 */
export const FILE_INPUT_MEDIA_TYPES: Readonly<Record<string, readonly MediaType[]>> = {
  import: MODEL_MEDIA_TYPES,
  canvas: IMAGE_MEDIA_TYPES,
};

/** A file name without its extension: what a file with no name of its own is called. */
export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '') || fileName;
}
