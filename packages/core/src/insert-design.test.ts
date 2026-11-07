import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands';
import { evaluateParameters } from './expr/parameters';
import type { AttachmentId, ComponentId, DimensionId } from './ids';
import {
  INSERT_DESIGN_TYPE,
  insertDesign,
  insertDesignPayload,
  insertDesignProblem,
  insertedFeatures,
  prefixIds,
} from './insert-design';
import { loadDocument } from './migrations';
import { type Attachment, DocumentSchema, type ExtrudoDocument, type Feature } from './schema';
import { emptySketchData, sketchInputs } from './sketch/feature';
import { createDocumentStore } from './stores';
import { fid, parameter, sampleDocument } from './testing';

const INSERT = fid('ins');
const COMPONENT = 'cmp-1' as ComponentId;
const FONT: Attachment = {
  name: 'Comic',
  fileName: 'comic.ttf',
  mediaType: 'font/ttf',
  sha256: 'a'.repeat(64),
  size: 10,
};

/**
 * A source design as the API writes one (`f1`, `f12`: short IDs that a
 * substring rewrite would confuse), with a parameter `width` the host has too,
 * a model parameter `d1`, a named sketch dimension, a projection and a text font.
 */
function source(): ExtrudoDocument {
  const sketch = emptySketchData();
  sketch.entities = {
    s1: { type: 'point', x: 0, y: 0 },
    s2: { type: 'point', x: 40, y: 0 },
    s3: { type: 'line', start: 's1', end: 's2', construction: false },
    s5: { type: 'point', x: 0, y: 5 },
    s6: { type: 'point', x: 0, y: 0 },
    s4: {
      type: 'text',
      anchor: 's6',
      top: 's5',
      text: 'Hi',
      font: 'attachment:font-1',
      align: 'left',
      construction: false,
    },
  } as unknown as typeof sketch.entities;
  sketch.dimensions = {
    d1: {
      type: 'distance',
      orientation: 'aligned',
      a: 's1',
      b: 's2',
      expr: 'width',
      paramName: 'len',
      driven: false,
    },
  } as unknown as typeof sketch.dimensions;
  const f1: Feature = {
    id: fid('f1'),
    type: 'sketch',
    name: 'Sketch1',
    suppressed: false,
    inputs: sketchInputs({ kind: 'plane', id: 'origin:xy' }, sketch),
  };
  const f12: Feature = {
    id: fid('f12'),
    type: 'extrude',
    name: 'Extrude1',
    suppressed: false,
    component: 'cmp-src' as ComponentId,
    inputs: {
      profiles: { kind: 'ref', refs: [{ kind: 'profile', id: 'f1/r1' }] },
      distance: { kind: 'expr', expr: 'width / 2', paramName: 'd1' },
      taper: { kind: 'expr', expr: '5', unit: 'angle' },
    },
  };
  const f2: Feature = {
    id: fid('f2'),
    type: 'fillet',
    name: 'Fillet1',
    suppressed: false,
    inputs: {
      edges: {
        kind: 'ref',
        refs: [
          {
            kind: 'edge',
            id: 'e[extrude:f12:cap:end|extrude:f12:side:f1/s3]',
            fingerprint: { type: 'line', at: [0, 0, 0], adj: ['extrude:f12:cap:end'] },
          },
        ],
      },
      radius: { kind: 'expr', expr: 'd1 / 10' },
    },
  };
  return {
    ...sampleDocument(),
    id: 'doc-src' as ExtrudoDocument['id'],
    name: 'Bracket',
    parameters: [parameter('p1', 'width', '40 mm')],
    features: [f1, f12, f2, { ...f2, id: fid('f9'), name: 'Rolled back' }],
    timelineMarker: 3,
    components: [{ id: 'cmp-src' as ComponentId, name: 'Inner', visible: true }],
    bodies: {
      ['f12:0' as never]: {
        name: 'Bracket body',
        color: '#ff0000',
        visible: true,
        component: 'cmp-src' as ComponentId,
      },
    },
    attachments: { ['font-1' as AttachmentId]: FONT },
  };
}

/** The host: the sample document, which has a parameter `width` too. */
function host(): ExtrudoDocument {
  return sampleDocument();
}

const ids = { feature: INSERT, component: COMPONENT, attachment: () => 'font-new' as AttachmentId };

function insert(into: ExtrudoDocument, from = source(), name = 'bracket') {
  return applyCommand(into, insertDesign(insertDesignPayload(into, from, ids, name))).doc;
}

describe('insertDesignPayload and insertDesign (ADR-0140)', () => {
  it('adds one feature stamped with a new component named after the file, at the marker', () => {
    const doc = insert({ ...host(), timelineMarker: 2 });
    expect(doc.features.map((f) => f.id)).toEqual(['f1', 'f2', 'ins', 'f3']);
    expect(doc.timelineMarker).toBe(3);
    const feature = doc.features[2] as Feature;
    expect(feature).toMatchObject({
      type: INSERT_DESIGN_TYPE,
      name: 'bracket',
      component: COMPONENT,
    });
    expect(doc.components).toEqual([{ id: COMPONENT, name: 'bracket', visible: true }]);
  });

  it('copies the features before the marker, without their components', () => {
    const feature = insert(host()).features.at(-1) as Feature;
    const design =
      feature.inputs.design?.kind === 'design' ? feature.inputs.design.design : undefined;
    expect(design?.name).toBe('Bracket');
    expect(design?.features.map((f) => f.id)).toEqual(['f1', 'f12', 'f2']);
    expect(design?.features.some((f) => 'component' in f)).toBe(false);
    expect(design?.parameters.map((p) => p.name)).toEqual(['width']);
  });

  it("keeps the copied bodies' metadata under their new IDs, in the new component", () => {
    expect(insert(host()).bodies).toEqual({
      'ins.f12:0': { name: 'Bracket body', color: '#ff0000', visible: true, component: COMPONENT },
    });
  });

  it('names a second insert of the same file "(2)"', () => {
    const once = insert(host());
    const payload = insertDesignPayload(
      once,
      source(),
      { ...ids, feature: fid('ins2'), component: 'cmp-2' as ComponentId },
      'bracket',
    );
    const twice = applyCommand(once, insertDesign(payload)).doc;
    expect(twice.components?.map((c) => c.name)).toEqual(['bracket', 'bracket (2)']);
    expect(twice.features.at(-1)?.name).toBe('bracket (2)');
  });

  it("brings the copy's files along, sharing bytes the host has and renaming an ID it gives other bytes", () => {
    expect(insert(host()).attachments).toEqual({ 'font-1': FONT });
    const same = insert({ ...host(), attachments: { ['other' as AttachmentId]: FONT } });
    expect(Object.keys(same.attachments ?? {})).toEqual(['other']);
    expect(JSON.stringify(same.features.at(-1))).toContain('attachment:other');
    const clash = insert({
      ...host(),
      attachments: { ['font-1' as AttachmentId]: { ...FONT, sha256: 'b'.repeat(64) } },
    });
    expect(Object.keys(clash.attachments ?? {}).sort()).toEqual(['font-1', 'font-new']);
    expect(JSON.stringify(clash.features.at(-1))).toContain('attachment:font-new');
  });

  it('refuses a design with nothing to insert, or a Script before its marker', () => {
    expect(insertDesignProblem({ ...source(), timelineMarker: 0 })).toBe(
      'Bracket has no features to insert.',
    );
    const scripted = {
      ...source(),
      features: [{ ...(source().features[0] as Feature), type: 'script' }],
    };
    expect(insertDesignProblem({ ...scripted, timelineMarker: 1 })).toMatch(/Sketch1 is a Script/);
    const nested = {
      ...source(),
      features: [
        { ...(source().features[0] as Feature), type: INSERT_DESIGN_TYPE, suppressed: true },
      ],
    };
    expect(insertDesignProblem({ ...nested, timelineMarker: 1 })).toMatch(/is an inserted design/);
    expect(() => insertDesignPayload(host(), { ...scripted, timelineMarker: 1 }, ids, 'x')).toThrow(
      /Script/,
    );
  });

  it('undoes and redoes as one step', () => {
    const store = createDocumentStore(host());
    const before = store.getState().doc;
    store.getState().dispatch(insertDesign(insertDesignPayload(before, source(), ids, 'bracket')));
    const after = store.getState().doc;
    store.getState().undo();
    expect(store.getState().doc).toEqual(before);
    store.getState().redo();
    expect(store.getState().doc).toEqual(after);
  });

  it('survives a save and reload: the document round-trips through the schema and the loader', () => {
    const doc = insert(host());
    expect(DocumentSchema.safeParse(doc).error?.issues).toBeUndefined();
    expect(loadDocument(JSON.parse(JSON.stringify(doc))).doc).toEqual(doc);
  });

  it("leaves the host's parameter table as it was: no name of the copy joins it", () => {
    const names = (doc: ExtrudoDocument) => [...evaluateParameters(doc).parameters.keys()];
    expect(names(insert(host()))).toEqual(names(host()));
  });
});

describe('the schema of an inserted design', () => {
  it('refuses an inserted design inside an inserted design', () => {
    const doc = insert(host());
    const feature = doc.features.at(-1) as Feature;
    const nested = JSON.parse(JSON.stringify(doc)) as ExtrudoDocument;
    const design = (nested.features.at(-1) as Feature).inputs.design;
    if (design?.kind !== 'design') throw new Error('no design');
    (design.design.features[0] as { inputs: Record<string, unknown> }).inputs.inner =
      feature.inputs.design;
    expect(DocumentSchema.safeParse(nested).success).toBe(false);
  });

  it("checks the copy's fonts against the host's attachments", () => {
    const doc = insert(host());
    const { attachments: _files, ...bare } = doc;
    const parsed = DocumentSchema.safeParse(bare);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path.slice(0, 6)).toEqual([
      'features',
      3,
      'inputs',
      'design',
      'design',
      'features',
    ]);
  });
});

describe('insertedFeatures (ADR-0140 §3–4)', () => {
  const expand = () => {
    const doc = insert(host());
    const feature = doc.features.at(-1) as Feature;
    if (feature.inputs.design?.kind !== 'design') throw new Error('no design');
    const out = insertedFeatures(feature, feature.inputs.design.design);
    if (typeof out === 'string') throw new Error(out);
    return out;
  };

  it('puts every feature under the insert, named after it', () => {
    expect(expand().map((f) => [f.id, f.name])).toEqual([
      ['ins.f1', 'bracket › Sketch1'],
      ['ins.f12', 'bracket › Extrude1'],
      ['ins.f2', 'bracket › Fillet1'],
    ]);
  });

  it('rewrites references token by token: f1 and f12 never catch each other', () => {
    const [, extrude, fillet] = expand();
    expect(extrude?.inputs.profiles).toEqual({
      kind: 'ref',
      refs: [{ kind: 'profile', id: 'ins.f1/r1' }],
    });
    const edges = fillet?.inputs.edges;
    expect(edges?.kind === 'ref' && edges.refs[0]).toEqual({
      kind: 'edge',
      id: 'e[extrude:ins.f12:cap:end|extrude:ins.f12:side:ins.f1/s3]',
      fingerprint: { type: 'line', at: [0, 0, 0], adj: ['extrude:ins.f12:cap:end'] },
    });
    expect(prefixIds('origin:xy', new Set(['f1']), INSERT)).toBe('origin:xy');
  });

  it("replaces every number by its value from the copy's own parameters, without names", () => {
    const [sketch, extrude, fillet] = expand();
    expect(extrude?.inputs.distance).toEqual({ kind: 'expr', expr: '20 mm' });
    expect(extrude?.inputs.taper).toEqual({ kind: 'expr', expr: '5 deg', unit: 'angle' });
    expect(fillet?.inputs.radius).toEqual({ kind: 'expr', expr: '2 mm' });
    const data = sketch?.inputs.sketch;
    expect(
      data?.kind === 'sketchData' && data.sketch.dimensions['d1' as DimensionId],
    ).toMatchObject({
      expr: '40 mm',
      driven: false,
    });
    expect(JSON.stringify(expand())).not.toContain('paramName');
  });

  it("evaluates in the copy's own unit: a plain 10 in an inch design is 254 mm", () => {
    const doc = insert(host(), {
      ...source(),
      settings: { units: 'in', precision: 2 },
      parameters: [parameter('p1', 'width', '20')],
    });
    const feature = doc.features.at(-1) as Feature;
    if (feature.inputs.design?.kind !== 'design') throw new Error('no design');
    const out = insertedFeatures(feature, feature.inputs.design.design);
    if (typeof out === 'string') throw new Error(out);
    expect(out[1]?.inputs.distance).toEqual({ kind: 'expr', expr: '254 mm' });
  });

  it('says which expression of the copy has an error', () => {
    const broken = { ...source(), parameters: [] };
    const doc = insert(host(), broken);
    const feature = doc.features.at(-1) as Feature;
    if (feature.inputs.design?.kind !== 'design') throw new Error('no design');
    expect(insertedFeatures(feature, feature.inputs.design.design)).toMatch(
      /^Extrude1: distance: /,
    );
  });
});
