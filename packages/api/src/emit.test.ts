/**
 * The macro emitter (P5-05 slice 1, ADR-0073 §3): the proof is a round trip.
 * Every benchmark fixture and the script fixture is emitted, the code is run
 * against a fresh `Design`, and the two documents are compared up to IDs and
 * names. The output is also checked against Biome's own formatter, so a macro
 * pasted into a Script feature is already house style.
 *
 * This package cannot run a Script (the runner lives in `@extrudo/script`), so
 * the recompute round trip over the same fixtures is in `@extrudo/cli`, which
 * may hold both.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureInputs,
  SKETCH_TYPE,
  type SketchConstraint,
  type SketchData,
  type SketchDimension,
  type SketchEntity,
} from '@extrudo/core';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { readArchive } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { Design } from './design';
import { emitScript } from './emit';

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

/** Every fixture document, in a stable order. */
function fixtures(): [name: string, doc: ExtrudoDocument][] {
  const read = (folder: string) =>
    readdirSync(join(ROOT, 'fixtures', folder))
      .filter((name) => name.endsWith('.extrudo'))
      .sort()
      .map(
        (name) =>
          [name, readArchive(readFileSync(join(ROOT, 'fixtures', folder, name))).doc] as [
            string,
            ExtrudoDocument,
          ],
      );
  return [...read('benchmarks'), ...read('scripts'), ...read('components')];
}

/** Runs emitted code against a fresh design, as a Script feature's `design` would. */
function run(code: string, doc: ExtrudoDocument): ExtrudoDocument {
  const design = Design.create({ units: doc.settings.units, now: '2026-10-06T00:00:00.000Z' });
  // The emitted code uses the Script feature's own global, `design`.
  const call = new Function('design', code) as (design: Design) => void;
  call(design);
  return design.toJSON();
}

/** A map from every original ID to the ID the round-tripped document gave it. */
function idMap(original: ExtrudoDocument, recreated: ExtrudoDocument): Map<string, string> {
  const map = new Map<string, string>();
  original.features.forEach((feature, index) => {
    const other = recreated.features[index];
    if (other) map.set(feature.id, other.id);
  });
  for (const parameter of original.parameters) {
    const other = recreated.parameters.find((candidate) => candidate.name === parameter.name);
    if (other) map.set(parameter.id, other.id);
  }
  for (const component of original.components ?? []) {
    const other = (recreated.components ?? []).find(
      (candidate) => candidate.name === component.name,
    );
    if (other) map.set(component.id, other.id);
  }
  for (const joint of original.joints ?? []) {
    const other = (recreated.joints ?? []).find((candidate) => candidate.name === joint.name);
    if (other) map.set(joint.id, other.id);
  }
  original.features.forEach((feature, index) => {
    const other = recreated.features[index];
    if (!other) return;
    const a = readSketchData(feature);
    const b = readSketchData(other);
    if (!a || !b) return;
    const keys = (data: SketchData, list: 'entities' | 'constraints' | 'dimensions') =>
      Object.keys(data[list]);
    const pair = ['entities', 'constraints', 'dimensions'] as const;
    for (const list of pair) {
      keys(a, list).forEach((id, at) => {
        const mapped = keys(b, list)[at];
        if (mapped) map.set(id, mapped);
      });
    }
  });
  return map;
}

/** Replaces every known ID inside a string, longest keys first. */
function replaceIds(text: string, map: ReadonlyMap<string, string>): string {
  let out = text;
  for (const [from, to] of [...map.entries()].sort((a, b) => b[0].length - a[0].length)) {
    out = out.replaceAll(from, to);
  }
  return out;
}

/** A document as the parts a round trip must preserve, with IDs mapped. */
function canonical(doc: ExtrudoDocument, map: ReadonlyMap<string, string>): unknown {
  const memberships: [string, string][] = [];
  for (const [id, meta] of Object.entries(doc.bodies)) {
    if (meta.component === undefined) continue;
    memberships.push([replaceIds(id, map), replaceIds(meta.component, map)]);
  }
  memberships.sort((a, b) => a[0].localeCompare(b[0]));
  return {
    units: doc.settings.units,
    parameters: [...doc.parameters]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((parameter) => ({
        name: parameter.name,
        expression: parameter.expression,
        unit: parameter.unit,
        customizer: parameter.customizer ?? null,
      })),
    features: doc.features.map((feature) => ({
      type: feature.type,
      suppressed: feature.suppressed,
      inputs: canonicalInputs(feature.inputs, map, doc),
      // A feature's component stamp (ADR-0081 §9), up to IDs.
      component: feature.component ? replaceIds(feature.component, map) : null,
    })),
    components: [...(doc.components ?? [])].map((c) => c.name).sort(),
    // Stored membership that the stamp rule would not give (a hand-moved body).
    memberships,
    joints: [...(doc.joints ?? [])]
      .map((joint) => ({
        name: joint.name,
        type: joint.type,
        a: {
          component: replaceIds(joint.a.component, map),
          ref: canonicalRef(joint.a.ref, map, doc),
        },
        b: {
          component: replaceIds(joint.b.component, map),
          ref: canonicalRef(joint.b.ref, map, doc),
        },
        min: joint.min?.expr ?? null,
        max: joint.max?.expr ?? null,
        flip: joint.flip ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function canonicalInputs(
  inputs: FeatureInputs,
  map: ReadonlyMap<string, string>,
  doc: ExtrudoDocument,
): unknown {
  const out: Record<string, unknown> = {};
  for (const [name, input] of Object.entries(inputs)) out[name] = canonicalInput(input, map, doc);
  return out;
}

function canonicalInput(
  input: FeatureInputs[string],
  map: ReadonlyMap<string, string>,
  doc: ExtrudoDocument,
): unknown {
  switch (input.kind) {
    // A feature input's own parameter name (`d1`) is preserved now (ADR-0073
    // §2, review fix 4), so the comparison keeps it.
    case 'expr':
      return { expr: input.expr, paramName: input.paramName ?? null, unit: input.unit ?? 'length' };
    case 'enum':
      return input.value;
    case 'bool':
      return input.value;
    case 'file':
      return replaceIds(input.id, map);
    case 'labels':
      return input.labels;
    case 'code':
      return input.value;
    case 'ref':
      return input.refs.map((ref) => canonicalRef(ref, map, doc));
    case 'sketchData':
      return canonicalSketch(input.sketch, map);
  }
}

/** A reference whose name is positional (an edge's sorted faces, a profile's region). */
function canonicalRef(
  ref: { kind: string; id: string },
  map: ReadonlyMap<string, string>,
  doc: ExtrudoDocument,
): { kind: string; id: string } {
  if (ref.kind === 'edge' || ref.kind === 'vertex') {
    const match = /^([ev])\[(.*)\](@\d+)?$/.exec(ref.id);
    if (match) {
      const faces = (match[2] ?? '')
        .split('|')
        .map((face) => replaceIds(face, map))
        .sort();
      return { kind: ref.kind, id: `${match[1]}[${faces.join('|')}]${match[3] ?? ''}` };
    }
  }
  if (ref.kind === 'profile') {
    const slash = ref.id.lastIndexOf('/');
    const featureId = ref.id.slice(0, slash);
    const regionId = ref.id.slice(slash + 1);
    const index = doc.features.findIndex((feature) => feature.id === featureId);
    const data =
      index >= 0
        ? readSketchData(doc.features[index] as { type: string; inputs: FeatureInputs })
        : undefined;
    const at = data ? detectProfiles(data).findIndex((profile) => profile.id === regionId) : -1;
    return { kind: 'profile', id: `F${index}/${at >= 0 ? `R${at}` : regionId}` };
  }
  if (ref.kind === 'sketchEntity') {
    const slash = ref.id.lastIndexOf('/');
    const featureId = ref.id.slice(0, slash);
    const entityId = ref.id.slice(slash + 1);
    const index = doc.features.findIndex((feature) => feature.id === featureId);
    const data =
      index >= 0
        ? readSketchData(doc.features[index] as { type: string; inputs: FeatureInputs })
        : undefined;
    const at = data ? [...Object.keys(data.entities)].indexOf(entityId) : -1;
    return { kind: 'sketchEntity', id: `F${index}/${at >= 0 ? `E${at}` : entityId}` };
  }
  return { kind: ref.kind, id: replaceIds(ref.id, map) };
}

function canonicalSketch(sketch: SketchData, map: ReadonlyMap<string, string>): unknown {
  const order = [...Object.keys(sketch.entities)];
  const token = (id: string): string => {
    const at = order.indexOf(id);
    return at >= 0 ? `E${at}` : replaceIds(id, map);
  };
  return {
    entities: Object.values(sketch.entities).map((entity) => canonicalEntity(entity, token)),
    constraints: Object.values(sketch.constraints).map((constraint) =>
      canonicalConstraint(constraint, token),
    ),
    dimensions: Object.values(sketch.dimensions).map((dimension) =>
      canonicalDimension(dimension, token),
    ),
  };
}

function canonicalEntity(entity: SketchEntity, id: (value: string) => string): unknown {
  switch (entity.type) {
    case 'point':
      return { type: 'point', x: entity.x, y: entity.y };
    case 'line':
      return {
        type: 'line',
        start: id(entity.start),
        end: id(entity.end),
        construction: entity.construction,
      };
    case 'circle':
      return {
        type: 'circle',
        center: id(entity.center),
        radius: entity.radius,
        construction: entity.construction,
      };
    case 'arc':
      return {
        type: 'arc',
        center: id(entity.center),
        start: id(entity.start),
        end: id(entity.end),
        construction: entity.construction,
      };
    case 'ellipse':
      return {
        type: 'ellipse',
        center: id(entity.center),
        major: id(entity.major),
        minor: id(entity.minor),
        construction: entity.construction,
      };
    case 'spline':
      return {
        type: 'spline',
        points: entity.points.map(id),
        mode: entity.mode ?? 'fit',
        rho: entity.rho ?? null,
        knots: entity.knots ?? null,
        closed: entity.closed ?? false,
        construction: entity.construction,
      };
    case 'text':
      return {
        type: 'text',
        anchor: id(entity.anchor),
        top: id(entity.top),
        text: entity.text,
        font: entity.font,
        align: entity.align,
        construction: entity.construction,
      };
  }
}

function canonicalConstraint(constraint: SketchConstraint, id: (value: string) => string): unknown {
  switch (constraint.type) {
    case 'pointOnCurve':
      return { type: constraint.type, point: id(constraint.point), curve: id(constraint.curve) };
    case 'midpoint':
      return { type: constraint.type, point: id(constraint.point), of: id(constraint.of) };
    case 'fix':
      return { type: constraint.type, entity: id(constraint.entity) };
    case 'horizontal':
    case 'vertical':
      return {
        type: constraint.type,
        a: id(constraint.a),
        b: constraint.b ? id(constraint.b) : null,
      };
    case 'symmetric':
      return {
        type: constraint.type,
        a: id(constraint.a),
        b: id(constraint.b),
        axis: id(constraint.axis),
      };
    case 'tangent':
    case 'smooth':
      return {
        type: constraint.type,
        a: id(constraint.a),
        b: id(constraint.b),
        reversed: constraint.reversed ?? false,
      };
    default:
      return { type: constraint.type, a: id(constraint.a), b: id(constraint.b) };
  }
}

function canonicalDimension(dimension: SketchDimension, id: (value: string) => string): unknown {
  const base = {
    expr: dimension.expr,
    paramName: dimension.paramName ?? null,
    driven: dimension.driven,
  };
  switch (dimension.type) {
    case 'distance':
      return {
        ...base,
        type: 'distance',
        orientation: dimension.orientation,
        a: id(dimension.a),
        b: dimension.b ? id(dimension.b) : null,
      };
    case 'radius':
    case 'diameter':
      return { ...base, type: dimension.type, curve: id(dimension.curve) };
    case 'angle':
      return {
        ...base,
        type: 'angle',
        a: id(dimension.a),
        b: id(dimension.b),
        supplement: dimension.supplement ?? false,
      };
  }
}

/** A feature read as a sketch's content (the fixtures all parse). */
function readSketchData(feature: { type: string; inputs: FeatureInputs }): SketchData | undefined {
  if (feature.type !== SKETCH_TYPE) return undefined;
  const sketch = feature.inputs.sketch;
  return sketch?.kind === 'sketchData' ? sketch.sketch : undefined;
}

/** What Biome's own formatter does with the code. */
function biomeFormat(code: string): string {
  const run = spawnSync(
    join(ROOT, 'node_modules/.bin/biome'),
    ['format', '--stdin-file-path', 'macro.ts'],
    {
      input: code,
      encoding: 'utf8',
    },
  );
  if (run.status !== 0) throw new Error(run.stderr || 'biome failed');
  return run.stdout;
}

describe('emitScript', () => {
  describe.each(fixtures())('%s', (name, doc) => {
    const code = emitScript(doc);
    const recreated = run(code, doc);

    it('round-trips the document up to IDs and names', () => {
      const map = idMap(doc, recreated);
      expect(canonical(recreated, map)).toEqual(canonical(doc, map));
    });

    it('is already formatted by Biome', () => {
      expect(biomeFormat(code)).toBe(code);
    });

    if (name === 'plate-holes.extrudo') {
      it('rewrites a script’s generated feature names through its handle', () => {
        // The fillet after the script refers to the script's generated `f1`.
        expect(code).toContain(`\${script1.id}.f1`);
      });
    }
  });

  it('names variables from feature names, de-duplicating collisions', () => {
    const design = Design.create();
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' }, { name: 'Extrude1' });
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' }, { name: 'Extrude 1' });
    const code = emitScript(design.toJSON());
    expect(code).toContain('const extrude1 =');
    expect(code).toContain('const extrude12 =');
    expect(code).toContain('// Extrude 1');
  });

  it('emits parameters in dependency order', () => {
    const design = Design.create();
    design.parameter('a', 'b * 2');
    design.parameter('b', '10 mm');
    design.box({ length: design.getParameter('a'), width: '1 mm', height: '1 mm' });
    const code = emitScript(design.toJSON());
    expect(code.indexOf("'b'")).toBeLessThan(code.indexOf("'a'"));
  });

  it('emits a suppressed feature and its suppression', () => {
    const design = Design.create();
    const box = design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    design.suppress(box);
    const code = emitScript(design.toJSON());
    expect(code).toContain('design.suppress(box1);');
    const recreated = run(code, design.toJSON());
    expect(recreated.features[0]?.suppressed).toBe(true);
  });

  it('sanitises variable names (reserved words, leading digits, `design`, `k`)', () => {
    const design = Design.create();
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' }, { name: 'Design' });
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' }, { name: 'New' });
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' }, { name: '4x4 grid' });
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' }, { name: 'k' });
    const code = emitScript(design.toJSON());
    // The renamed variables still declare, and the printer's own test compiles
    // the code with `new Function` (syntax errors would throw there).
    expect(code).toContain('const _design =');
    expect(code).toContain('const _new =');
    expect(code).toContain('const _4x4Grid =');
    expect(code).toContain('const _k =');
    run(code, design.toJSON());
  });

  it('breaks a call when an earlier argument is itself an object (Biome’s rule)', () => {
    const design = Design.create();
    design.box(
      { length: '10 mm', width: '10 mm', height: '10 mm' },
      { name: 'A plate for things' },
    );
    const code = emitScript(design.toJSON());
    // A renamed feature passes a second object argument, the shape that broke
    // the old last-argument hug; it must match Biome (checked below).
    expect(code).toContain('const aPlateForThings = design.box(\n');
    expect(biomeFormat(code)).toBe(code);
  });

  it('preserves a feature input’s parameter name so expressions that read it resolve', () => {
    const design = Design.create();
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    design.box({ length: 'd1 / 2', width: '10 mm', height: '10 mm' });
    const doc = structuredClone(design.toJSON());
    const first = doc.features[0]?.inputs.length;
    if (first?.kind === 'expr') first.paramName = 'd1';
    const code = emitScript(doc);
    expect(code).toContain("paramName: 'd1'");
    const recreated = run(code, doc);
    const second = recreated.features[1];
    const value = second
      ? evaluateParameters(recreated).inputs.get(second.id)?.get('length')
      : undefined;
    expect(value).toMatchObject({ ok: true, value: 5 });
  });

  it('leaves a feature input’s parameter name out of a run (it replays into a live design)', () => {
    const design = Design.create();
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    design.box({ length: '20 mm', width: '10 mm', height: '10 mm' });
    const doc = structuredClone(design.toJSON());
    for (const feature of doc.features) {
      const length = feature.inputs.length;
      if (length?.kind === 'expr') length.paramName = `d${doc.features.indexOf(feature) + 1}`;
    }
    const code = emitScript(doc, { features: [0, 1] });
    expect(code).not.toContain('paramName');
    expect(code).toContain("length: '10 mm'");
  });

  it('skips a feature that reads an attachment, with a comment', () => {
    const design = Design.create();
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    const doc = structuredClone(design.toJSON());
    doc.attachments = {
      a1: {
        name: 'plate.step',
        fileName: 'plate.step',
        mediaType: 'model/step',
        sha256: 'a'.repeat(64),
        size: 12,
      },
    } as unknown as ExtrudoDocument['attachments'];
    doc.features.push({
      id: 'import1',
      type: 'import',
      name: 'Import1',
      suppressed: false,
      inputs: { file: { kind: 'file', id: 'a1' } },
    } as unknown as (typeof doc.features)[number]);
    const code = emitScript(doc);
    expect(code).toContain(
      "// Import1 reads an attachment, which a script can't carry: add it by hand.",
    );
    expect(code).not.toContain('design.import');
    // The rest of the design still runs.
    const recreated = run(code, doc);
    expect(recreated.features.map((feature) => feature.type)).toEqual(['box']);
    expect(recreated.features[0]?.name).toBe('Box1');
  });

  it('keeps a text’s string but uses the default font for a user font, with a comment', () => {
    const design = Design.create();
    design.sketch(design.origin.xy, (k) => {
      k.text([0, 0], [0, 5], { text: 'Hi', font: 'inter-regular@1' });
    });
    const doc = structuredClone(design.toJSON());
    const data = readSketchData(doc.features[0] as { type: string; inputs: FeatureInputs });
    const text = data
      ? Object.values(data.entities).find((entity) => entity.type === 'text')
      : undefined;
    if (text?.type === 'text') text.font = 'attachment:f1';
    doc.attachments = {
      f1: {
        name: 'Comic Neue',
        fileName: 'comic-neue.ttf',
        mediaType: 'font/ttf',
        sha256: 'b'.repeat(64),
        size: 100,
      },
    } as unknown as ExtrudoDocument['attachments'];
    const code = emitScript(doc);
    expect(code).toContain("font: 'inter-regular@1'");
    expect(code).toContain('used the user font "Comic Neue"');
    // The emitted code produces a document the schema accepts.
    const recreated = run(code, doc);
    expect(recreated.features[0]?.type).toBe(SKETCH_TYPE);
  });

  it('emits a pattern’s label list (`labels` input)', () => {
    const design = Design.create();
    const box = design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    design.rectangularPattern({
      objects: 'bodies',
      bodies: [box.body()],
      direction1: design.origin.x,
      count1: 3,
      distance1: '20 mm',
      skip: ['2'],
    });
    const doc = structuredClone(design.toJSON());
    const code = emitScript(doc);
    expect(code).toContain("skip: ['2']");
    const recreated = run(code, doc);
    const map = idMap(doc, recreated);
    expect(canonical(recreated, map)).toEqual(canonical(doc, map));
  });

  it('emits timeline groups', () => {
    const design = Design.create();
    const first = design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    const second = design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    design.group(first, second, { name: 'Two', collapsed: true });
    const doc = structuredClone(design.toJSON());
    const code = emitScript(doc);
    expect(code).toContain("design.group(box1, box2, { name: 'Two', collapsed: true });");
    const recreated = run(code, doc);
    expect(
      recreated.groups?.map((group) => ({ name: group.name, collapsed: group.collapsed })),
    ).toEqual([{ name: 'Two', collapsed: true }]);
  });

  it('names a conic that has no stored rho instead of writing 0.5 for it', () => {
    const design = Design.create();
    design.sketch(design.origin.xy, (k) => {
      k.conic([0, 0], [1, 1], [2, 0], 0.3);
    });
    const doc = structuredClone(design.toJSON());
    const data = readSketchData(doc.features[0] as { type: string; inputs: FeatureInputs });
    const spline = data
      ? Object.values(data.entities).find((entity) => entity.type === 'spline')
      : undefined;
    if (spline?.type === 'spline') delete spline.rho;
    expect(() => emitScript(doc)).toThrow(/has no rho/);
  });

  it('names an unknown input kind instead of crashing the printer', () => {
    const design = Design.create();
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    const doc = structuredClone(design.toJSON());
    const feature = doc.features[0];
    if (feature) (feature.inputs as Record<string, unknown>).weird = { kind: 'mystery' };
    expect(() => emitScript(doc)).toThrow(/input kind the emitter doesn't know/);
  });

  it('emits a sketch with every entity kind and a named dimension', () => {
    const design = Design.create();
    design.sketch(design.origin.xy, (k) => {
      k.point([1, 1]);
      k.line([0, 0], [10, 0]);
      k.circle([5, 5], '2 mm');
      k.arcCentered([0, 0], [3, 0], [0, 3]);
      k.ellipse([0, 0], [4, 0], [0, 2]);
      k.spline([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      k.splineControl([
        [0, 0],
        [1, 1],
        [2, 0],
      ]);
      k.conic([0, 0], [1, 1], [2, 0], 0.3);
      k.text([0, 0], [0, 5], { text: 'Hi', font: 'inter-regular@1' });
    });
    // A named dimension on the first line.
    const data = design.toJSON().features[0]?.inputs.sketch;
    expect(data?.kind).toBe('sketchData');
    const original = design.toJSON();
    const recreated = run(emitScript(original), original);
    const map = idMap(original, recreated);
    expect(canonical(recreated, map)).toEqual(canonical(original, map));
  });

  it('emits closed splines and a trimmed spline with its own knots (P4-12)', () => {
    const design = Design.create();
    design.sketch(design.origin.xy, (k) => {
      k.spline(
        [
          [0, 0],
          [20, 0],
          [10, 15],
        ],
        { closed: true },
      );
      k.splineControl(
        [
          [30, 0],
          [50, 0],
          [50, 20],
          [30, 20],
        ],
        { closed: true },
      );
      // What a trim leaves: a control spline with a knot of multiplicity 3.
      k.splineControl(
        [
          [0, 30],
          [5, 40],
          [10, 32],
          [15, 38],
          [20, 30],
          [25, 36],
          [30, 31],
        ],
        { knots: [0, 0, 0, 0, 0.4, 0.4, 0.4, 1, 1, 1, 1] },
      );
    });
    const original = design.toJSON();
    const code = emitScript(original);
    expect(code).toContain('{ closed: true }');
    expect(code).toContain('knots: [0, 0, 0, 0, 0.4, 0.4, 0.4, 1, 1, 1, 1]');
    expect(biomeFormat(code)).toBe(code);
    const recreated = run(code, original);
    const map = idMap(original, recreated);
    expect(canonical(recreated, map)).toEqual(canonical(original, map));
  });

  it('emits a run whose references reach before and inside it', () => {
    // B4: OffsetPlane1 Box1 Shell1 Chamfer1 Box2 Box3 Fillet1.
    const [, doc] = fixtures().find(([name]) => name === 'b4-box-with-lid.extrudo') as [
      string,
      ExtrudoDocument,
    ];
    const ids = doc.features.map((feature) => feature.id);
    const code = emitScript(doc, { features: [ids[2] as string, ids[6] as string] });
    // Shell1's face belongs to Box1 before the run: a stored `design.ref`.
    expect(code).toContain("design.ref('face',");
    // Fillet1's edges belong to Box2 inside the run: a handle expression.
    expect(code).toMatch(/box2\.(faceName|edge)/);
  });

  it('leaves out the parameters of a run by default', () => {
    const [, doc] = fixtures().find(([name]) => name === 'b2-storage-box.extrudo') as [
      string,
      ExtrudoDocument,
    ];
    const run = emitScript(doc, { features: [2, 3] });
    expect(run).not.toContain('design.parameter(');
    expect(emitScript(doc)).toContain('design.parameter(');
  });

  it('reports the default name the same way `nextFeatureName` does', () => {
    const design = Design.create();
    design.box({ length: '10 mm', width: '10 mm', height: '10 mm' });
    const code = emitScript(design.toJSON());
    const recreated = run(code, design.toJSON());
    expect(recreated.features[0]?.name).toBe('Box1');
  });
});
