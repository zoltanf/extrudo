import { describe, expect, it } from 'vitest';
import v0Bracket from '../fixtures/v0-bracket.json' with { type: 'json' };
import { FORMAT_VERSION } from './format';
import { BodyIdSchema } from './ids';
import {
  DocumentLoadError,
  loadDocument,
  loadNotice,
  MIGRATIONS,
  parseLeniently,
} from './migrations';
import { BodyMetaSchema, DocumentSchema, type ExtrudoDocument, FeatureSchema } from './schema';
import { sampleDocument } from './testing';
import { z } from './zod';

/** Deterministic IDs for migrations: id-1, id-2, … */
function counterIds() {
  let n = 0;
  return () => `id-${++n}`;
}

function loadError(raw: unknown): DocumentLoadError {
  try {
    loadDocument(raw);
  } catch (error) {
    if (error instanceof DocumentLoadError) return error;
    throw error;
  }
  throw new Error('expected loadDocument to fail');
}

describe('migrations', () => {
  it('cover every version from 0 up to the current one, one step each', () => {
    expect(MIGRATIONS.map((m) => m.from)).toEqual(
      Array.from({ length: FORMAT_VERSION }, (_, i) => i),
    );
  });

  it('migrate the v0 fixture to a valid v1 document', () => {
    const { doc, loadedVersion, migrated } = loadDocument(v0Bracket, {
      newId: counterIds(),
      now: '2026-09-25T12:00:00.000Z',
    });
    expect(loadedVersion).toBe(0);
    expect(migrated).toBe(true);
    expect(doc).toMatchObject({
      format: 'extrudo',
      formatVersion: 1,
      id: 'id-1',
      name: 'Wall bracket',
      settings: { units: 'mm', precision: 2 },
      timelineMarker: 3,
      bodies: {},
      views: [],
      meta: {
        created: '2026-09-01T09:30:00.000Z',
        modified: '2026-09-01T09:30:00.000Z',
        appVersion: '0.0.0-dev',
      },
    });
    expect(doc.parameters).toEqual([
      {
        id: 'id-2',
        name: 'width',
        expression: '40 mm',
        unit: 'length',
        comment: 'Along the wall',
      },
      { id: 'id-3', name: 'wall', expression: '3 mm', unit: 'length' },
      { id: 'id-4', name: 'tilt', expression: '15 deg', unit: 'angle' },
      { id: 'id-5', name: 'holes', expression: '2', unit: 'unitless' },
    ]);
    expect(doc.features.map((f) => [f.name, f.suppressed])).toEqual([
      ['Sketch1', false],
      ['Extrude1', false],
      ['Fillet1', true],
    ]);
    // Inputs are carried over untouched, except sketch data, which is keyed by ID in v1.
    expect(doc.features[1]?.inputs).toEqual(v0Bracket.features[1]?.inputs);
    expect(doc.features[0]?.inputs).toEqual({
      plane: { kind: 'ref', refs: [{ kind: 'plane', id: 'origin:xy' }] },
      sketch: { kind: 'sketchData', sketch: { entities: {}, constraints: {}, dimensions: {} } },
    });
  });

  it('key v0 sketch entities and constraints by their IDs', () => {
    const raw = JSON.parse(JSON.stringify(v0Bracket)) as {
      features: { inputs: Record<string, unknown> }[];
    };
    const [sketch] = raw.features;
    if (!sketch) throw new Error('fixture has no sketch');
    sketch.inputs.sketch = {
      kind: 'sketchData',
      sketch: {
        entities: [
          { id: 'p1', type: 'point', x: 0, y: 0 },
          { id: 'p2', type: 'point', x: 10, y: 0 },
          { id: 'l1', type: 'line', start: 'p1', end: 'p2', construction: false },
        ],
        constraints: [{ id: 'c1', type: 'horizontal', a: 'l1' }],
      },
    };
    const { doc } = loadDocument(raw);
    expect(doc.features[0]?.inputs.sketch).toEqual({
      kind: 'sketchData',
      sketch: {
        entities: {
          p1: { type: 'point', x: 0, y: 0 },
          p2: { type: 'point', x: 10, y: 0 },
          l1: { type: 'line', start: 'p1', end: 'p2', construction: false },
        },
        constraints: { c1: { type: 'horizontal', a: 'l1' } },
        dimensions: {},
      },
    });
  });

  it('do not modify the input', () => {
    const before = JSON.stringify(v0Bracket);
    loadDocument(v0Bracket);
    expect(JSON.stringify(v0Bracket)).toBe(before);
  });

  it('leave a current document as it is', () => {
    const doc = sampleDocument();
    expect(loadDocument(JSON.parse(JSON.stringify(doc)))).toEqual({
      doc,
      loadedVersion: FORMAT_VERSION,
      migrated: false,
      dropped: [],
    });
  });
});

describe('reading what a newer Extrudo wrote (P3-13)', () => {
  /** A sample document with keys this version doesn't know, as a newer one might add. */
  function withUnknownKeys(formatVersion = FORMAT_VERSION) {
    const raw = JSON.parse(JSON.stringify(sampleDocument()));
    raw.formatVersion = formatVersion;
    raw.newTop = { anything: 1 };
    raw.settings.snapAngle = 15;
    raw.parameters[0].locked = true;
    raw.features[0].color = '#ff0000';
    raw.features[0].inputs.distance.tolerance = 0.1;
    return raw;
  }

  it('leaves out unknown keys of the same format version and lists them', () => {
    const result = loadDocument(withUnknownKeys());
    expect(result.doc).toEqual(sampleDocument());
    expect(result.dropped.sort()).toEqual([
      'features.0.color',
      'features.0.inputs.distance.tolerance',
      'newTop',
      'parameters.0.locked',
      'settings.snapAngle',
    ]);
    expect(loadNotice(result, 'drops')).toBe(
      "This design was saved by a newer Extrudo. 5 settings this version doesn't know were left out. Saving here loses them; reload to update Extrudo first if you need them.",
    );
  });

  it('does not change the input', () => {
    const raw = withUnknownKeys();
    const before = JSON.stringify(raw);
    loadDocument(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('reads a newer format version as far as it understands it, and says so', () => {
    const result = loadDocument(withUnknownKeys(FORMAT_VERSION + 1));
    expect(result.doc).toEqual(sampleDocument());
    expect(result.loadedVersion).toBe(FORMAT_VERSION + 1);
    expect(result.migrated).toBe(false);
    expect(loadNotice(result, 'copy')).toBe(
      `This design was saved by a newer Extrudo (file format ${FORMAT_VERSION + 1}; this version reads ${FORMAT_VERSION}). 5 settings this version doesn't know were left out. The file itself is unchanged.`,
    );
    const plain = loadDocument({ ...sampleDocument(), formatVersion: FORMAT_VERSION + 1 });
    expect(plain.doc).toEqual(sampleDocument());
    expect(loadNotice(plain, 'drops')).toMatch(
      /newer Extrudo \(file format 2; this version reads 1\)\. Everything in it is known here\. Saving here writes it in this version’s format\.$/,
    );
  });

  it('says nothing for an ordinary document', () => {
    expect(loadNotice(loadDocument(sampleDocument()), 'drops')).toBeUndefined();
  });

  it('still refuses a damaged document that also has unknown keys', () => {
    const raw = withUnknownKeys();
    raw.timelineMarker = -1;
    const error = loadError(raw);
    expect(error.code).toBe('invalid');
    expect(error.issues.map((i) => i.path.join('.'))).toEqual(['timelineMarker']);
  });
});

describe('loadDocument errors', () => {
  it('reject things that are not Extrudo documents', () => {
    for (const raw of [
      null,
      [],
      'extrudo',
      { format: 'other', formatVersion: 1 },
      { format: 'extrudo' },
    ]) {
      expect(loadError(raw).code).toBe('not-a-document');
    }
  });

  it('refuse documents from a newer version that changed more than keys, with a readable message', () => {
    // A newer format that reshaped something: here the parameters became an object.
    const error = loadError({
      ...sampleDocument(),
      formatVersion: FORMAT_VERSION + 1,
      parameters: {},
    });
    expect(error.code).toBe('too-new');
    expect(error.message).toMatch(/newer Extrudo.*Update Extrudo/);
    expect(error.issues.map((i) => i.path.join('.'))).toEqual(['parameters']);
  });

  it('report where a damaged document is invalid', () => {
    const error = loadError({ ...sampleDocument(), timelineMarker: -1, name: '' });
    expect(error.code).toBe('invalid');
    expect(error.issues.map((i) => i.path.join('.'))).toEqual(['name', 'timelineMarker']);
    expect(error.message).toMatch(/^The document is damaged: name .*; timelineMarker .*\.$/);
  });
});

describe('an older reader and components (P6-05, ADR-0081 §2)', () => {
  /** DocumentSchema as it was before components: no `components`, no `component` keys. */
  const { components: _, ...shape } = DocumentSchema.shape;
  const olderSchema = z.strictObject({
    ...shape,
    features: z.array(FeatureSchema.omit({ component: true })),
    bodies: z.record(BodyIdSchema, BodyMetaSchema.omit({ component: true })),
  }) as unknown as z.ZodType<ExtrudoDocument>;

  it('drops exactly the three keys and keeps everything else', () => {
    const plain = sampleDocument();
    const raw = JSON.parse(
      JSON.stringify({
        ...plain,
        components: [{ id: 'lid', name: 'Lid', visible: true }],
        features: plain.features.map((f, i) => (i === 1 ? { ...f, component: 'lid' } : f)),
        bodies: {
          'f2:0': { name: 'Body1', visible: true, component: 'lid' },
          'f2:1': { name: 'Body2', visible: true },
        },
      }),
    );
    const parsed = parseLeniently(raw, olderSchema);
    if (!parsed.ok) throw new Error('the older reader refused the file');
    expect(parsed.dropped.sort()).toEqual([
      'bodies.f2:0.component',
      'components',
      'features.1.component',
    ]);
    expect(parsed.doc).toEqual({
      ...plain,
      bodies: {
        'f2:0': { name: 'Body1', visible: true },
        'f2:1': { name: 'Body2', visible: true },
      },
    });
  });
});

describe('an older reader and joints (P6-05, ADR-0081 §4)', () => {
  /** DocumentSchema as it was before joints. */
  const { joints: _, ...shape } = DocumentSchema.shape;
  const olderSchema = z.strictObject(shape) as unknown as z.ZodType<ExtrudoDocument>;

  it('drops `joints` and keeps everything else', () => {
    const plain = {
      ...sampleDocument(),
      components: [
        { id: 'base', name: 'Base', visible: true },
        { id: 'leaf', name: 'Leaf', visible: true },
      ],
    };
    const raw = JSON.parse(
      JSON.stringify({
        ...plain,
        joints: [
          {
            id: 'j1',
            name: 'Hinge',
            type: 'revolute',
            a: { component: 'leaf', ref: { kind: 'face', id: 'f' } },
            b: { component: 'base', ref: { kind: 'face', id: 'g' } },
          },
        ],
      }),
    );
    const parsed = parseLeniently(raw, olderSchema);
    if (!parsed.ok) throw new Error('the older reader refused the file');
    expect(parsed.dropped).toEqual(['joints']);
    expect(parsed.doc).toEqual(plain);
  });
});
