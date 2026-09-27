/**
 * Test features for the recompute engine: small real OCCT operations with
 * call counters. Not registered in the app. The shapes are real so the
 * memory and caching tests exercise the kernel, not a mock.
 */
import {
  type BodyId,
  createDocument,
  type DocumentId,
  ExprInputSchema,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  type FeatureInputs,
  type FeatureRegistry,
  type Parameter,
  type ParameterId,
  RefInputSchema,
} from '@extrudo/core';
import { z } from 'zod';
import { kernelFeatures } from '../features';
import { KernelError, type ShapeHandle } from '../kernel';
import type { KernelFeatureDefinition } from './types';

export interface TestFeatures {
  registry: FeatureRegistry<KernelFeatureDefinition>;
  /** Feature IDs in the order their evaluators ran. */
  calls: FeatureId[];
}

const base = { category: 'create', icon: 'test' } as const;

/**
 * - `test-box`: a new body, a cube with edge `size`.
 * - `test-grow`: fuses a `height` × 2 × 2 mm block onto the first body.
 * - `test-hole`: cuts a cylinder of `radius` through the first body.
 * - `test-profile`: makes a square face (no body); a later feature uses it.
 * - `test-pad`: a new body the size of `test-profile`'s square (`profile` ref), `height` tall.
 * - `test-fail`: always fails. `test-leak`: leaves a box behind. `test-crash`: aborts the WASM.
 * The sketch evaluator is registered too.
 */
export function testFeatures(): TestFeatures {
  const calls: FeatureId[] = [];
  const registry = kernelFeatures();
  const define = <I extends FeatureInputs>(
    type: string,
    inputsSchema: z.ZodType<I>,
    evaluate: KernelFeatureDefinition<I>['evaluate'],
    bodyAccess?: KernelFeatureDefinition<I>['bodyAccess'],
  ) => {
    const definition: KernelFeatureDefinition<I> = {
      ...base,
      type,
      label: type,
      inputsSchema,
      ...(bodyAccess ? { bodyAccess } : {}),
      evaluate(ctx) {
        calls.push(ctx.feature.id);
        return evaluate(ctx);
      },
    };
    registry.register(definition as unknown as KernelFeatureDefinition);
  };
  const first = (bodies: ReadonlyMap<BodyId, ShapeHandle>): [BodyId, ShapeHandle] => {
    const entry = bodies.entries().next().value;
    if (!entry) throw new KernelError('There is no body to change.');
    return entry;
  };

  define(
    'test-box',
    z.strictObject({ size: ExprInputSchema }),
    ({ kernel, bodies, bodyId, value }) => {
      const size = value('size');
      const box = kernel.box([size, size, size]);
      return { bodies: new Map(bodies).set(bodyId(), box) };
    },
  );

  define('test-grow', z.strictObject({ height: ExprInputSchema }), ({ kernel, bodies, value }) => {
    const [id, body] = first(bodies);
    const { max } = kernel.measure(body).bbox;
    using scope = kernel.scope();
    const block = scope.track(kernel.box([2, 2, value('height')], [0, 0, max[2]]));
    const fused = kernel.fuse(body, block).shape;
    return { bodies: new Map(bodies).set(id, fused) };
  });

  define('test-hole', z.strictObject({ radius: ExprInputSchema }), ({ kernel, bodies, value }) => {
    const [id, body] = first(bodies);
    const { min, max } = kernel.measure(body).bbox;
    const center: [number, number, number] = [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      min[2] - 1,
    ];
    using scope = kernel.scope();
    const tool = scope.track(kernel.cylinder(value('radius'), max[2] - min[2] + 2, center));
    return { bodies: new Map(bodies).set(id, kernel.cut(body, tool).shape) };
  });

  define(
    'test-profile',
    z.strictObject({ size: ExprInputSchema }),
    ({ kernel, value }) => {
      const size = value('size');
      return { shapes: { square: kernel.box([size, size, 0.001]) }, data: { size } };
    },
    () => 'none',
  );

  define(
    'test-pad',
    z.strictObject({ profile: RefInputSchema, height: ExprInputSchema }),
    ({ kernel, inputs, bodies, bodyId, output, value }) => {
      const ref = inputs.profile.refs[0]?.id ?? '';
      const source = output(ref.slice(0, ref.indexOf('/')) as FeatureId);
      const { size } = source.data as { size: number };
      const pad = kernel.box([size, size, value('height')], [0, 0, 10]);
      return { bodies: new Map(bodies).set(bodyId(), pad) };
    },
  );

  define('test-fail', z.strictObject({}), () => {
    throw new KernelError('This feature always fails.');
  });

  define('test-crash', z.strictObject({}), ({ kernel }) => kernel.debugAbort());

  define('test-leak', z.strictObject({}), ({ kernel }) => {
    kernel.box([1, 1, 1]);
    return {};
  });

  return { registry, calls };
}

let counter = 0;

/** A feature with readable ID `id`; `exprs` become `expr` inputs. */
export function testFeature(
  id: string,
  type: string,
  exprs: Record<string, string> = {},
  more: Feature['inputs'] = {},
): Feature {
  const inputs: Feature['inputs'] = { ...more };
  for (const [name, expr] of Object.entries(exprs)) {
    inputs[name] = { kind: 'expr', expr, paramName: `d${++counter}` };
  }
  return { id: id as FeatureId, type, name: id, suppressed: false, inputs };
}

export function testDocument(
  features: Feature[],
  parameters: Record<string, string> = {},
): ExtrudoDocument {
  return {
    ...createDocument({
      id: 'doc-test' as DocumentId,
      name: 'Test',
      now: '2026-09-27T10:00:00.000Z',
    }),
    parameters: Object.entries(parameters).map(
      ([name, expression]): Parameter => ({
        id: `p-${name}` as ParameterId,
        name,
        expression,
        unit: 'length',
      }),
    ),
    features,
    timelineMarker: features.length,
  };
}

/** A box and `n - 1` blocks fused on top: `n` features in a chain, `f1` … `fn`. */
export function chainDocument(n: number, parameters: Record<string, string> = {}): ExtrudoDocument {
  const features = [testFeature('f1', 'test-box', { size: '10 mm' })];
  for (let i = 2; i <= n; i++) features.push(testFeature(`f${i}`, 'test-grow', { height: '1 mm' }));
  return testDocument(features, parameters);
}

/** A copy of `doc` with feature `id`'s expression `input` set to `expr`. */
export function withExpr(
  doc: ExtrudoDocument,
  id: string,
  input: string,
  expr: string,
): ExtrudoDocument {
  return {
    ...doc,
    features: doc.features.map((f) => {
      const current = f.inputs[input];
      if (f.id !== id || current?.kind !== 'expr') return f;
      return { ...f, inputs: { ...f.inputs, [input]: { ...current, expr } } };
    }),
  };
}
