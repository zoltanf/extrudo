// The media types a design's attachments may have, and what a file name's
// extension gives (P4-06, ADR-0066 §0): the app that adds a file, the dialog
// that reads one back and the kernel that parses it take the type from the
// name, never from the browser's `File.type`.
import { describe, expect, it } from 'vitest';
import {
  baseName,
  FILE_INPUT_MEDIA_TYPES,
  isMeshMediaType,
  isModelMediaType,
  MEDIA_TYPES,
  mediaTypeOf,
  modelKind,
} from './media-types';
import { AttachmentSchema, DocumentSchema } from './schema';

describe('mediaTypeOf', () => {
  it('reads the extension, case apart, and only the last one', () => {
    expect(mediaTypeOf('bracket.STEP')).toBe('model/step');
    expect(mediaTypeOf('part.stp')).toBe('model/step');
    expect(mediaTypeOf('part.step.gz')).toBeUndefined();
    expect(mediaTypeOf('bracket.stl')).toBe('model/stl');
    expect(mediaTypeOf('plate.3MF')).toBe('model/3mf');
    expect(mediaTypeOf('cube.obj')).toBe('model/obj');
    expect(mediaTypeOf('plan.png')).toBe('image/png');
    expect(mediaTypeOf('photo.JPG')).toBe('image/jpeg');
    expect(mediaTypeOf('photo.jpeg')).toBe('image/jpeg');
    expect(mediaTypeOf('scan.webp')).toBe('image/webp');
    expect(mediaTypeOf('Inter.ttf')).toBe('font/ttf');
    expect(mediaTypeOf('Inter.otf')).toBe('font/otf');
    expect(mediaTypeOf('Inter.woff')).toBe('font/woff');
  });

  it('says nothing for a name with no extension, or one Extrudo cannot read', () => {
    expect(mediaTypeOf('bracket')).toBeUndefined();
    expect(mediaTypeOf('drawing.svg')).toBeUndefined();
    expect(mediaTypeOf('drawing.dxf')).toBeUndefined();
    // WOFF2 is refused (ADR-0061 §1): the font shaper can't read it.
    expect(mediaTypeOf('Inter.woff2')).toBeUndefined();
  });

  it('knows which types are models, meshes and STEP', () => {
    expect(MEDIA_TYPES).toHaveLength(10);
    expect(isModelMediaType('model/step')).toBe(true);
    expect(isModelMediaType('model/3mf')).toBe(true);
    expect(isModelMediaType('image/png')).toBe(false);
    expect(isModelMediaType(undefined)).toBe(false);
    expect(isMeshMediaType('model/stl')).toBe(true);
    // STEP converts its own units, so it has no `units` field.
    expect(isMeshMediaType('model/step')).toBe(false);
    expect(modelKind('model/step')).toBe('step');
    expect(modelKind('model/obj')).toBe('mesh');
    expect(modelKind('font/ttf')).toBeUndefined();
  });

  it('has the media types the attachment schema accepts', () => {
    for (const mediaType of MEDIA_TYPES) {
      const parsed = AttachmentSchema.safeParse({
        name: 'A file',
        fileName: 'a-file',
        mediaType,
        sha256: 'a'.repeat(64),
        size: 10,
      });
      expect(parsed.success, mediaType).toBe(true);
    }
    // Still no WOFF2, and nothing new either.
    expect(
      AttachmentSchema.safeParse({
        name: 'A font',
        fileName: 'a.woff2',
        mediaType: 'font/woff2',
        sha256: 'a'.repeat(64),
        size: 10,
      }).success,
    ).toBe(false);
  });

  it('lists the media types each feature type may read', () => {
    expect(FILE_INPUT_MEDIA_TYPES.import).toEqual([
      'model/step',
      'model/stl',
      'model/3mf',
      'model/obj',
    ]);
    expect(FILE_INPUT_MEDIA_TYPES.canvas).toEqual(['image/png', 'image/jpeg', 'image/webp']);
  });

  it('names a file without its extension', () => {
    expect(baseName('bracket.step')).toBe('bracket');
    expect(baseName('plate.v2.3mf')).toBe('plate.v2');
    expect(baseName('.step')).toBe('.step');
  });
});

describe('a file input in the document', () => {
  const doc = (file: unknown, mediaType = 'model/step') => ({
    format: 'extrudo',
    formatVersion: 1,
    id: 'd1',
    name: 'Design',
    settings: { units: 'mm', precision: 2 },
    parameters: [],
    features: [
      {
        id: 'f1',
        type: 'import',
        name: 'Import1',
        suppressed: false,
        inputs: { file: { kind: 'file', id: file } },
      },
    ],
    timelineMarker: 1,
    bodies: {},
    views: [],
    attachments: {
      a1: {
        name: 'bracket',
        fileName: 'bracket.step',
        mediaType,
        sha256: 'b'.repeat(64),
        size: 100,
      },
    },
    meta: {
      created: '2026-10-04T00:00:00.000Z',
      modified: '2026-10-04T00:00:00.000Z',
      appVersion: '0.4.0',
    },
  });

  const issues = (value: unknown) => {
    const parsed = DocumentSchema.safeParse(value);
    if (parsed.success) return [];
    return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  };

  it('needs the attachment its file input names', () => {
    expect(issues(doc('a1'))).toEqual([]);
    expect(issues(doc('a2'))).toEqual([
      'features.0.inputs.file: is attachment "a2", which this design doesn\'t carry',
    ]);
  });

  it('needs a media type the feature reads', () => {
    expect(issues(doc('a1', 'image/png'))).toEqual([
      'features.0.inputs.file: is "bracket.step", whose media type image/png isn\'t one this feature reads',
    ]);
    expect(issues(doc('a1', 'model/stl'))).toEqual([]);
  });

  it('leaves a feature type alone that has no file input rule', () => {
    const other = doc('a2');
    const [feature] = other.features;
    if (!feature) throw new Error('no feature');
    other.features[0] = { ...feature, type: 'something-else' };
    expect(issues(other)).toEqual([]);
  });
});
