/**
 * Keeps `docs/file-format.md` in step with the schema (P2-16): the example
 * document in the spec must load, and every key, type and enum value the
 * schema knows must be mentioned in the text, so adding one without
 * documenting it fails here.
 */
import { readFileSync } from 'node:fs';
import {
  type AttachmentId,
  AttachmentSchema,
  addAttachment,
  applyCommand,
  BODY_OPERATIONS,
  BodyMetaSchema,
  boxFeature,
  COIL_DIRECTIONS,
  COIL_POSITIONS,
  COIL_SECTIONS,
  COIL_TYPES,
  COMBINE_OPERATIONS,
  CONSTRUCTION_FEATURES,
  ComponentSchema,
  ConfigurationSchema,
  CustomizerSchema,
  circularPatternFeature,
  coilFeature,
  combineFeature,
  cylinderFeature,
  DocumentSchema,
  draftFeature,
  EMBOSS_MODES,
  EXTRUDE_DIRECTIONS,
  EXTRUDE_EXTENTS,
  ExprInputSchema,
  embossFeature,
  extrudeFeature,
  FeatureRegistry,
  FeatureSchema,
  GeomFingerprintSchema,
  GeomRefKindSchema,
  GeomRefSchema,
  GroupSchema,
  HOLE_EXTENTS,
  HOLE_KINDS,
  holeFeature,
  InputSchema,
  JointFrameSchema,
  JointSchema,
  LengthUnitSchema,
  loadDocument,
  loftFeature,
  MOVE_MODES,
  mirrorFeature,
  moveBodiesFeature,
  NamedViewSchema,
  ORIGIN_AXES,
  ORIGIN_PLANES,
  offsetFaceFeature,
  PATH_POSITIONS,
  PATTERN_ANGLES,
  PATTERN_MEASURES,
  PATTERN_OBJECTS,
  ParameterSchema,
  pathPatternFeature,
  placeOnBedFeature,
  REVOLVE_DIRECTIONS,
  RIB_SIDES,
  rectangularPatternFeature,
  removeBodiesFeature,
  revolveFeature,
  ribFeature,
  SettingsSchema,
  SketchConstraintSchema,
  SketchDataSchema,
  SketchDimensionSchema,
  SketchEntitySchema,
  SketchProjectionSchema,
  SWEEP_ORIENTATIONS,
  scaleFeature,
  shellFeature,
  sketchFeature,
  sphereFeature,
  splitBodyFeature,
  sweepFeature,
  THREAD_EXTENTS,
  THREAD_HANDS,
  threadFeature,
  torusFeature,
  UnitKindSchema,
} from '@extrudo/core';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readArchive, writeArchive } from './archive';
import { sha256Hex } from './sha256';

const text = readFileSync(new URL('../../../docs/file-format.md', import.meta.url), 'utf8');

/** The spec's example: the fenced block whose info string is `json example`. */
function example(): unknown {
  const match = /```json example\n([\s\S]*?)\n```/.exec(text);
  if (!match?.[1]) throw new Error('docs/file-format.md has no "json example" block');
  return JSON.parse(match[1]);
}

type Shape = Record<string, { value?: string }>;

/** Shape keys of a (possibly refined) strict object schema. */
function keys(schema: unknown): string[] {
  return Object.keys((schema as { shape: Shape }).shape);
}

/** The variants of a discriminated union: their tag value and their other keys. */
function variants(union: unknown, tag = 'type'): { name: string; keys: string[] }[] {
  const options = (union as { options: { shape: Shape }[] }).options;
  return options.map((o) => ({
    name: o.shape[tag]?.value as string,
    keys: Object.keys(o.shape).filter((k) => k !== tag),
  }));
}

const mentioned = (word: string) => text.includes(`\`${word}\``);
/** What the schema says about a document, one line per issue. */
const issuesOf = (doc: unknown): string[] => {
  const result = DocumentSchema.safeParse(doc);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};
const missing = (words: Iterable<string>) => [...new Set(words)].filter((w) => !mentioned(w));

const FEATURES = [
  sketchFeature,
  extrudeFeature,
  revolveFeature,
  removeBodiesFeature,
  combineFeature,
  moveBodiesFeature,
  mirrorFeature,
  shellFeature,
  offsetFaceFeature,
  splitBodyFeature,
  sweepFeature,
  loftFeature,
  coilFeature,
  scaleFeature,
  draftFeature,
  holeFeature,
  threadFeature,
  embossFeature,
  placeOnBedFeature,
  rectangularPatternFeature,
  circularPatternFeature,
  pathPatternFeature,
  boxFeature,
  cylinderFeature,
  sphereFeature,
  torusFeature,
  ribFeature,
  ...Object.values(CONSTRUCTION_FEATURES),
];

describe('docs/file-format.md', () => {
  it('has an example that loads and passes every feature check', () => {
    const raw = example();
    expect(DocumentSchema.safeParse(raw).success).toBe(true);
    const { doc, migrated } = loadDocument(raw);
    expect(migrated).toBe(false);
    const registry = new FeatureRegistry();
    for (const feature of FEATURES) registry.register(feature);
    expect(registry.check(doc)).toEqual([]);
  });

  it('describes the container the writer produces', () => {
    const { doc } = loadDocument(example());
    const summary = {
      number: 1,
      description: 'First cut',
      created: doc.meta.created,
      name: doc.name,
    };
    const bytes = writeArchive(doc, new Uint8Array([137, 80, 78, 71]), [{ summary, doc }]);
    const entries = unzipSync(bytes);
    expect(Object.keys(entries).sort()).toEqual([
      'document.json',
      'manifest.json',
      'thumbnail.png',
      'versions/1.json',
      'versions/index.json',
    ]);
    for (const name of ['manifest.json', 'document.json', 'thumbnail.png', 'versions/index.json']) {
      expect(mentioned(name)).toBe(true);
    }
    expect(text).toContain('versions/<n>.json');
    const manifest = JSON.parse(strFromU8(entries['manifest.json'] as Uint8Array));
    expect(Object.keys(manifest).filter((k) => !mentioned(k))).toEqual([]);
    expect(readArchive(bytes).versions).toHaveLength(1);
  });

  it('describes attachments as content-addressed entries beside the document (P4-03b)', () => {
    const font = new Uint8Array([1, 2, 3, 4]);
    const hash = sha256Hex(font);
    const withFont = applyCommand(
      loadDocument(example()).doc,
      addAttachment({
        id: 'font-1' as AttachmentId,
        attachment: {
          name: 'Comic Neue Bold',
          fileName: 'ComicNeue-Bold.ttf',
          mediaType: 'font/ttf',
          sha256: hash,
          size: font.length,
        },
      }),
    ).doc;
    const bytes = writeArchive(withFont, undefined, [], new Map([[hash, font]]));
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      `attachments/${hash}`,
      'document.json',
      'manifest.json',
    ]);
    expect(mentioned(`attachments/${hash}`)).toBe(false);
    expect(text).toContain('`attachments/<sha256>`');
    // Every field and media type of the record is in the text.
    expect(Object.keys(AttachmentSchema.shape).filter((k) => !mentioned(k))).toEqual([]);
    expect(AttachmentSchema.shape.mediaType.options.filter((m) => !mentioned(m))).toEqual([]);
    // A design that names the font in a text loads, and its bytes travel with it.
    expect(issuesOf(withFont)).toEqual([]);
    expect(readArchive(bytes).attachments.get(hash)).toEqual(font);
  });

  it('mentions every document key, input kind and feature type', () => {
    const meta = (DocumentSchema as unknown as { shape: { meta: unknown } }).shape.meta;
    const words = [
      ...keys(DocumentSchema),
      ...keys(SettingsSchema),
      ...keys(ParameterSchema),
      ...keys(CustomizerSchema),
      ...keys(ConfigurationSchema),
      ...keys(FeatureSchema),
      ...keys(GroupSchema),
      ...keys(ComponentSchema),
      ...keys(JointSchema),
      ...keys(JointFrameSchema),
      ...JointSchema.shape.type.options,
      ...keys(BodyMetaSchema),
      ...keys(NamedViewSchema),
      ...keys(meta),
      ...keys(ExprInputSchema),
      ...variants(InputSchema, 'kind').flatMap((v) => [v.name, ...v.keys]),
      ...LengthUnitSchema.options,
      ...UnitKindSchema.options,
      ...FEATURES.map((f) => f.type),
    ];
    expect(missing(words)).toEqual([]);
  });

  it('mentions every feature input and its choices', () => {
    const inputs = FEATURES.flatMap((f) => keys(f.inputsSchema));
    const choices = [
      ...BODY_OPERATIONS,
      ...EXTRUDE_DIRECTIONS,
      ...EXTRUDE_EXTENTS,
      ...REVOLVE_DIRECTIONS,
      ...COMBINE_OPERATIONS,
      ...MOVE_MODES,
      ...PATTERN_OBJECTS,
      ...PATTERN_MEASURES,
      ...PATH_POSITIONS,
      ...PATTERN_ANGLES,
      ...HOLE_KINDS,
      ...HOLE_EXTENTS,
      ...SWEEP_ORIENTATIONS,
      ...COIL_TYPES,
      ...COIL_DIRECTIONS,
      ...COIL_SECTIONS,
      ...COIL_POSITIONS,
      ...THREAD_EXTENTS,
      ...THREAD_HANDS,
      ...EMBOSS_MODES,
      ...RIB_SIDES,
    ];
    const origin = [...ORIGIN_PLANES.map((p) => p.id), ...ORIGIN_AXES.map((a) => a.id)];
    expect(missing([...inputs, ...choices, ...origin])).toEqual([]);
  });

  it('mentions every sketch entity, constraint, dimension and reference field', () => {
    const words = [
      ...keys(SketchDataSchema),
      ...[SketchEntitySchema, SketchConstraintSchema, SketchDimensionSchema].flatMap((u) =>
        variants(u).flatMap((v) => [v.name, ...v.keys]),
      ),
      ...keys(SketchProjectionSchema),
      ...keys(GeomRefSchema),
      ...keys(GeomFingerprintSchema),
      ...GeomRefKindSchema.options,
    ];
    expect(missing(words)).toEqual([]);
  });
});
