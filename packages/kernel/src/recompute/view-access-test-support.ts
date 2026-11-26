/**
 * Test support for `view` body access (ADR-0024's amendment on `view` access): plates and slots,
 * a document of them, and the `test-twin` feature (two bodies with the same names). Used by
 * `view-access.test.ts`, `view-access-features-test-support.ts` and the feature files over it.
 * Not part of the app.
 */
import {
  createDocument,
  type EnumInput,
  EnumInputSchema,
  ExprInputSchema,
  type ExtrudoDocument,
  extrudeInputs,
  type Feature,
  type FeatureId,
  originPlaneRef,
  profileRefId,
  sketchInputs,
  z,
} from '@extrudo/core';
import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { detectProfiles } from '@extrudo/sketch/profiles';
import { kernelFeatures } from '../features/index';
import { positionalNames } from '../naming/names';
import { choice, length } from './add-access-test-support';
import type { EvalContext, KernelFeatureDefinition } from './types';

/**
 * A 60 × 40 mm plate at `x`, `y` with two holes of radius `r`: its sketch `sk<i>`, its extrude
 * `ex<i>`.
 */
export function plate(i: number | string, x: number, distance: string, r = 5, y = 0): Feature[] {
  const b = new SketchBuilder();
  b.line(x, y, x + 60, y);
  b.line(x + 60, y, x + 60, y + 40);
  b.line(x + 60, y + 40, x, y + 40);
  b.line(x, y + 40, x, y);
  b.circle(x + 15, y + 20, r);
  b.circle(x + 45, y + 20, r);
  const regions = detectProfiles(b.sketch);
  const outer = regions.reduce((a, g) => ((g.holes?.length ?? 0) > (a.holes?.length ?? 0) ? g : a));
  const sketch = `sk${i}` as FeatureId;
  return [
    {
      id: sketch,
      type: 'sketch',
      name: `Sketch ${i}`,
      suppressed: false,
      inputs: sketchInputs(originPlaneRef('origin:xy'), b.sketch),
    },
    {
      id: `ex${i}` as FeatureId,
      type: 'extrude',
      name: `Extrude ${i}`,
      suppressed: false,
      inputs: extrudeInputs([{ kind: 'profile', id: profileRefId(sketch, outer.id) }], {
        distance,
      }),
    },
  ];
}

/** A rectangle's sketch and its extrude doing `operation` symmetric about XY (20 mm). */
export function slot(
  id: string,
  [x0, y0, x1, y1]: [number, number, number, number],
  operation: 'cut' | 'new-body' = 'cut',
): Feature[] {
  const b = new SketchBuilder();
  b.line(x0, y0, x1, y0);
  b.line(x1, y0, x1, y1);
  b.line(x1, y1, x0, y1);
  b.line(x0, y1, x0, y0);
  const [region] = detectProfiles(b.sketch);
  const sketch = `sk-${id}` as FeatureId;
  return [
    {
      id: sketch,
      type: 'sketch',
      name: `Sketch ${id}`,
      suppressed: false,
      inputs: sketchInputs(originPlaneRef('origin:xy'), b.sketch),
    },
    {
      id: id as FeatureId,
      type: 'extrude',
      name: `Cut ${id}`,
      suppressed: false,
      inputs: extrudeInputs([{ kind: 'profile', id: profileRefId(sketch, region?.id ?? '') }], {
        distance: '20 mm',
        direction: 'symmetric',
        operation,
      }),
    },
  ];
}

export const document = (name: string, features: Feature[], more: Partial<ExtrudoDocument> = {}) =>
  ({
    ...createDocument({ name }),
    parameters: [{ id: 'p-t', name: 't', expression: '4 mm', unit: 'length' }],
    ...more,
    features,
    timelineMarker: features.length,
  }) as ExtrudoDocument;

/** `n` plates (`gap` apart; under 60 they overlap), every other one `t` thick. */
export const platesOf = (n: number, gap = 80) =>
  Array.from({ length: n }, (_, i) => plate(i, i * gap, i % 2 ? 't' : `${3 + i} mm`)).flat();

/**
 * `test-twin`: a new box (`size`, its corner at `x`, -50, 0) whose naming table comes from its
 * `tag` instead of its feature ID (`positionalNames`, as the engine names a body given none). Two
 * of them with one tag are bodies with the same exact names: no kernel feature makes such bodies
 * (ADR-0024's amendment on `view` access), but `resolveRef` tells them apart (`closest`).
 */
export function twinRegistry() {
  return () => {
    const registry = kernelFeatures();
    registry.register({
      type: 'test-twin',
      label: 'test-twin',
      category: 'create',
      icon: 'test',
      inputsSchema: z.strictObject({
        size: ExprInputSchema,
        x: ExprInputSchema,
        tag: EnumInputSchema,
      }),
      evaluate(ctx: EvalContext) {
        const size = ctx.value('size');
        const box = ctx.kernel.box([size, size, size], [ctx.value('x'), -50, 0]);
        const id = ctx.bodyId();
        const tag = (ctx.inputs.tag as EnumInput).value;
        return {
          bodies: new Map(ctx.bodies).set(id, box),
          names: new Map([[id, positionalNames('twin', tag, ctx.describe(box))]]),
        };
      },
    } as unknown as KernelFeatureDefinition);
    return registry;
  };
}

export const twin = (id: string, x: string): Feature => ({
  id: id as FeatureId,
  type: 'test-twin',
  name: `Twin ${id}`,
  suppressed: false,
  inputs: {
    size: length('10 mm'),
    x: length(x),
    tag: choice('T'),
  },
});
