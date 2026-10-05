/**
 * The generated feature methods (ADR-0068 §3).
 *
 * The staleness test: regenerating the file in memory gives the checked-in one
 * byte for byte, so a feature or an input added in core reaches the API by
 * running `pnpm api:generate` and nothing else. Every feature type in the
 * registry has a method, and one typed call per category compiles and makes a
 * valid feature.
 */

import {
  type Attachment,
  type AttachmentId,
  addAttachment,
  documentFeatures,
  type ExtrudoDocument,
  type FeatureInputs,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { methodName, SKETCH_TYPE } from './example-calls';
import { generate, generatedOnDisk } from './generate';
import { FEATURE_TYPES } from './generated/features';
import { Design, type FeatureType } from './index';
import type { FeatureInputValue } from './inputs';

describe('the generated file', () => {
  it('is what the generator writes today', () => {
    const onDisk = generatedOnDisk();
    expect(onDisk).toBeDefined();
    expect(generate()).toBe(onDisk);
  });

  it('says how to fix it when it is not', () => {
    // The message the failure above stands for, kept honest.
    const stale = 'export const FEATURE_TYPES = [] as const;\n';
    expect(generate() === stale).toBe(false);
  });

  it('lists every feature type in the registry, in its order', () => {
    expect([...FEATURE_TYPES]).toEqual(
      documentFeatures()
        .list()
        .map((d) => d.type),
    );
  });

  it('has a method for every type but the sketch, whose name is its own', () => {
    const text = generate();
    const declared = interfaceMethods(text);
    const implemented = [...text.matchAll(/^ {4}(\w+): \(/gm)].map((m) => m[1]);
    const named = documentFeatures()
      .list()
      .map((definition) => definition.type)
      .filter((type) => type !== SKETCH_TYPE)
      .map(methodName);
    expect(declared).toEqual(named);
    expect(implemented).toEqual(named);
    expect(FEATURE_TYPES).toContain(SKETCH_TYPE);
  });

  it('names a method for a type that collides with a Design member (ADR-0068 §2)', () => {
    expect(methodName('remove')).toBe('removeBodies');
    expect(methodName('move')).toBe('moveBodies');
    expect(methodName('box')).toBe('box');
  });
});

/** The method names declared by the generated `FeatureMethods` interface. */
function interfaceMethods(text: string): string[] {
  const block = text.slice(text.indexOf('export interface FeatureMethods {'));
  return [...block.matchAll(/^ {2}(\w+)\(/gm)].map((m) => m[1] as string);
}

describe('a call per category', () => {
  const d = () => Design.create({ now: '2026-10-05T00:00:00.000Z' });

  it('makes a primitive (create, P2-10)', () => {
    const design = d();
    const box = design.box({ length: '40 mm', width: '20 mm', height: '5 mm' });
    expect(box.feature?.inputs).toEqual({
      length: { kind: 'expr', expr: '40 mm', unit: 'length' },
      width: { kind: 'expr', expr: '20 mm', unit: 'length' },
      height: { kind: 'expr', expr: '5 mm', unit: 'length' },
    });
    expect(design.validate()).toEqual([]);
  });

  it('extrudes a stored reference, with plain values', () => {
    const design = d();
    const box = design.box();
    const face = box.face('side:front');
    const ext = design.extrude({ profiles: face, distance: '10 mm', taper: '5 deg' });
    expect(ext.feature?.inputs.distance).toEqual({
      kind: 'expr',
      expr: '10 mm',
      unit: 'length',
    });
    expect(ext.feature?.inputs.taper).toEqual({ kind: 'expr', expr: '5 deg', unit: 'angle' });
    expect(ext.feature?.inputs.profiles).toEqual({ kind: 'ref', refs: [face] });
    expect(design.validate()).toEqual([]);
  });

  it('fillets a named edge (modify, P3-01)', () => {
    const design = d();
    const box = design.box({ length: '20 mm' });
    const edge = box.edge([box.faceName('side:front'), box.faceName('side:front')]);
    const fillet = design.fillet({ edges: edge, radius: '2 mm' });
    expect(fillet.feature?.inputs.edges).toEqual({ kind: 'ref', refs: [edge] });
    expect(fillet.feature?.inputs.radius).toEqual({
      kind: 'expr',
      expr: '2 mm',
      unit: 'length',
    });
  });

  it('patterns bodies (modify, P3-07)', () => {
    const design = d();
    const box = design.box({ length: '10 mm' });
    const pattern = design.rectangularPattern({
      objects: 'bodies',
      bodies: [box.body()],
      count1: 3,
      distance1: '15 mm',
    });
    expect(pattern.feature?.inputs.count1).toEqual({
      kind: 'expr',
      expr: '3',
      unit: 'unitless',
    });
    expect(pattern.feature?.inputs.measure1).toBeUndefined();
    expect(design.validate()).toEqual([]);
  });

  it('makes a construction plane (construct, P3-05)', () => {
    const design = d();
    const plane = design.offsetPlane({ plane: design.origin.xy, distance: '12 mm' });
    expect(plane.feature?.inputs.distance).toEqual({
      kind: 'expr',
      expr: '12 mm',
      unit: 'length',
    });
    expect(plane.constructionRef()).toEqual({ kind: 'plane', id: plane.id });
  });

  it('threads a face and drills a hole (P4-02, P3-04)', () => {
    const design = d();
    const cylinder = design.cylinder({ diameter: '20 mm', height: '20 mm' });
    const thread = design.thread({ faces: cylinder.face('side:wall'), diameter: '20 mm' });
    expect(thread.feature?.inputs.faces).toEqual({
      kind: 'ref',
      refs: [{ kind: 'face', id: 'cylinder:f1:side:wall' }],
    });
    const hole = design.hole({ plane: design.origin.xy, x: '10 mm', y: '0 mm', diameter: '4 mm' });
    expect(hole.feature?.inputs.extent).toBeUndefined();
    expect(design.validate()).toEqual([]);
  });

  it('adds any type by name, and refuses one that does not exist', () => {
    const design = d();
    expect(design.add('sphere', { diameter: '8 mm' }).type).toBe('sphere');
    expect(design.add('constructionPoint', { at: design.origin.point }).type).toBe(
      'constructionPoint',
    );
    expect(() => design.add('bristle' as FeatureType)).toThrow(/no feature type "bristle"/);
  });

  it('keeps a stored input as it is, and plain values beside it', () => {
    const design = d();
    const box = design.box({
      length: { kind: 'expr', expr: '12 mm', unit: 'length' },
      width: 30,
      height: `${design.parameter('thick', '2 mm')}`,
    });
    expect(box.feature?.inputs).toEqual({
      length: { kind: 'expr', expr: '12 mm', unit: 'length' },
      width: { kind: 'expr', expr: '30', unit: 'length' },
      height: { kind: 'expr', expr: 'thick', unit: 'length' },
    });
  });
});

describe('the whole registry', () => {
  // What a type with required inputs needs (ADR-0068 §3: required inputs are
  // required in the method's signature too). Everything else takes none.
  const required = (design: Design) =>
    ({
      combine: { target: design.ref('body', 'f0'), tools: [design.ref('body', 'f1')] },
      draft: { faces: design.ref('face', 'f1:face#1'), plane: design.origin.xy, angle: '5 deg' },
      mirror: { plane: design.origin.yz },
      move: { bodies: [design.ref('body', 'f1')] },
      offsetFace: { faces: design.ref('face', 'f1:face#1'), distance: '1 mm' },
      placeOnBed: { face: design.ref('face', 'f1:face#1') },
      remove: { bodies: [design.ref('body', 'f1')] },
      scale: { bodies: [design.ref('body', 'f1')] },
      shell: { thickness: '2 mm' },
      splitBody: { bodies: [design.ref('body', 'f1')], plane: design.origin.yz },
      thread: { faces: design.ref('face', 'f1:wall') },
      // A file input names an attachment of the design (P4-06), which the
      // document schema checks, so the design needs one before it has any.
      import: { file: { kind: 'file', id: attachment(design, 'part.step', 'model/step') } },
      canvas: { image: { kind: 'file', id: attachment(design, 'plan.png', 'image/png') } },
    }) as Record<string, FeatureInputValue>;

  /** Adds a file to the design and returns its ID (ADR-0061 §1). */
  const attachment = (
    design: Design,
    fileName: string,
    mediaType: Attachment['mediaType'],
  ): AttachmentId => {
    const id = `att-${fileName}` as AttachmentId;
    design.state.dispatch(
      addAttachment({
        id,
        attachment: {
          name: fileName,
          fileName,
          mediaType,
          sha256: 'a'.repeat(64),
          size: 1024,
        },
      }),
    );
    return id;
  };

  it('makes a feature of every type, with its required inputs, and reads it back', () => {
    const design = Design.create({ now: '2026-10-05T00:00:00.000Z' });
    const needed = required(design);
    for (const type of FEATURE_TYPES) {
      if (type === SKETCH_TYPE) continue;
      const handle = design.add(type, needed[type] ?? {});
      expect(handle.type).toBe(type);
      expect(handle.name).toBe(`${documentFeatures().get(type)?.label}1`);
    }
    // Every feature is valid against its own schema; the ones without their
    // references report nothing until the kernel has geometry to give them.
    expect(design.doc.features).toHaveLength(FEATURE_TYPES.length - 1);
    const byType = new Map(design.doc.features.map((f) => [f.type, f.inputs]));
    for (const [type, inputs] of byType) {
      const definition = documentFeatures().get(type);
      const result = definition?.inputsSchema.safeParse(inputs as FeatureInputs);
      expect(result?.success, type).toBe(true);
    }
    expect(design.validate()).toEqual([]);
  });

  it('keeps the document valid through every call', () => {
    const design = Design.create({ now: '2026-10-05T00:00:00.000Z' });
    design.add('box');
    design.add('extrude', { distance: '5 mm' });
    const doc: ExtrudoDocument = design.toJSON();
    expect(doc.features.map((f) => f.name)).toEqual(['Box1', 'Extrude1']);
    expect(design.state.canUndo).toBe(true);
  });
});
