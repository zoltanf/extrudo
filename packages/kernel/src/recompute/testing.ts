/**
 * Test features for the recompute engine: small real OCCT operations with
 * call counters. Not registered in the app. The shapes are real so the
 * memory and caching tests exercise the kernel, not a mock.
 */
import {
  type BodyId,
  BoolInputSchema,
  createDocument,
  type DocumentId,
  EnumInputSchema,
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
import type { SketchOutputData } from '../features/sketch';
import { KernelError, type ShapeHandle, type Vec3 } from '../kernel';
import {
  compoundSources,
  type NamedShape,
  namedBoolean,
  namedPrism,
  namedRevolve,
  type SweepSource,
  withHistory,
} from '../naming/ops';
import type { ResolvedRef } from '../naming/resolve';
import type { EvalContext, FeatureOutput, KernelFeatureDefinition } from './types';

export interface TestFeatures {
  registry: FeatureRegistry<KernelFeatureDefinition>;
  /** Feature IDs in the order their evaluators ran. */
  calls: FeatureId[];
  /** The sketch outputs `test-sheet` read, in order. */
  seen: FeatureOutput[];
  /** What `test-probe` resolved (or failed to), in evaluation order. */
  probes: Probe[];
}

export interface Probe {
  feature: FeatureId;
  resolved?: ResolvedRef;
  error?: string;
}

const base = { category: 'create', icon: 'test' } as const;

/**
 * - `test-box`: a new body, a cube with edge `size`.
 * - `test-grow`: fuses a `height` × 2 × 2 mm block onto the first body.
 * - `test-hole`: cuts a cylinder of `radius` through the first body.
 * - `test-profile`: makes a square face (no body); a later feature uses it.
 * - `test-pad`: a new body the size of `test-profile`'s square (`profile` ref), `height` tall.
 * - `test-sheet`: a new body that is a sketch's profile face (`profile` ref `<sketch>/<region>`).
 * - `test-fail`: always fails. `test-leak`: leaves a box behind. `test-crash`: aborts the WASM.
 *
 * Topological naming (ADR-0005), with the naming operations a real feature uses:
 * - `test-extrude`: extrudes `profile` refs (`<sketch>/<region>`, several at once
 *   as a compound) by `distance` along the sketch normal (`symmetric`: centred on
 *   the plane); `operation` `new` (default), `join` (fuse into the first body,
 *   simplified) or `cut` (from the first body).
 * - `test-revolve`: revolves a `profile` about the sketch's `axis` (`x` or `y`)
 *   by `angle`; `operation` as for `test-extrude`.
 * - `test-fillet`: fillets the `edges` refs (one body) with `radius`.
 * - `test-combine`: fuses the second body into the first (simplified).
 * - `test-probe`: resolves its `target` refs and records them in `probes`.
 * - `test-bad-names`: a new box whose naming table doesn't fit it.
 * The sketch evaluator is registered too.
 */
export function testFeatures(): TestFeatures {
  const calls: FeatureId[] = [];
  const seen: FeatureOutput[] = [];
  const probes: Probe[] = [];
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

  define(
    'test-sheet',
    z.strictObject({ profile: RefInputSchema }),
    ({ inputs, bodies, bodyId, output }) => {
      const ref = inputs.profile.refs[0]?.id ?? '';
      const slash = ref.indexOf('/');
      const source = output(ref.slice(0, slash) as FeatureId);
      seen.push(source);
      const face = source.shapes?.[ref.slice(slash + 1)];
      if (face === undefined) throw new KernelError("Can't find this profile in the sketch.");
      return { bodies: new Map(bodies).set(bodyId(), face) };
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

  /** The sweep sources and sketch frame of a feature's `profile` refs. */
  const profiles = (ctx: EvalContext, refs: readonly { id: string }[]) => {
    const sources: SweepSource[] = [];
    let frame: SketchOutputData['frame'] | undefined;
    for (const ref of refs) {
      const slash = ref.id.indexOf('/');
      const sketch = ctx.output(ref.id.slice(0, slash) as FeatureId);
      const region = ref.id.slice(slash + 1);
      const data = sketch.data as SketchOutputData;
      const face = sketch.shapes?.[region];
      const info = data.profiles.find((p) => p.id === region);
      if (face === undefined || !info)
        throw new KernelError("Can't find this profile in the sketch.");
      sources.push({ shape: face, edgeSources: info.edges });
      frame = data.frame;
    }
    if (!frame) throw new KernelError('Pick a profile.');
    return { sources, frame };
  };

  /** A new body, or the first body joined with or cut by `made`. */
  const finish = (ctx: EvalContext, made: NamedShape, operation: string): FeatureOutput => {
    const { kernel, bodies } = ctx;
    if (operation === 'new') {
      const id = ctx.bodyId();
      return { bodies: new Map(bodies).set(id, made.shape), names: new Map([[id, made.names]]) };
    }
    using scope = kernel.scope();
    scope.track(made.shape);
    const [id, body] = first(bodies);
    const result = namedBoolean(
      kernel,
      operation === 'join' ? 'fuse' : 'cut',
      { shape: body, names: ctx.names(id) },
      made,
      { feature: ctx.feature.id, simplify: operation === 'join' },
    );
    return { bodies: new Map(bodies).set(id, result.shape), names: new Map([[id, result.names]]) };
  };

  const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];

  define(
    'test-extrude',
    z.strictObject({
      profile: RefInputSchema,
      distance: ExprInputSchema,
      operation: EnumInputSchema.optional(),
      symmetric: BoolInputSchema.optional(),
    }),
    (ctx) => {
      const { kernel, inputs, feature } = ctx;
      const { sources, frame } = profiles(ctx, inputs.profile.refs);
      const distance = ctx.value('distance');
      using scope = kernel.scope();
      let source = sources[0] as SweepSource;
      if (sources.length > 1) {
        const compound = scope.track(kernel.compound(sources.map((s) => s.shape)));
        source = { shape: compound, edgeSources: compoundSources(kernel, compound, sources) };
      }
      const made = namedPrism(kernel, {
        feature: feature.id,
        ...source,
        vector: scale(frame.normal, distance),
        shift: inputs.symmetric?.value ? scale(frame.normal, -distance / 2) : [0, 0, 0],
      });
      return finish(ctx, made, inputs.operation?.value ?? 'new');
    },
  );

  define(
    'test-revolve',
    z.strictObject({
      profile: RefInputSchema,
      axis: EnumInputSchema,
      angle: ExprInputSchema,
      operation: EnumInputSchema.optional(),
    }),
    (ctx) => {
      const { kernel, inputs, feature } = ctx;
      const { sources, frame } = profiles(ctx, inputs.profile.refs);
      const made = namedRevolve(kernel, {
        feature: feature.id,
        ...(sources[0] as SweepSource),
        axis: { origin: frame.origin, direction: inputs.axis.value === 'x' ? frame.x : frame.y },
        angle: (ctx.value('angle') * Math.PI) / 180,
      });
      return finish(ctx, made, inputs.operation?.value ?? 'new');
    },
  );

  define(
    'test-fillet',
    z.strictObject({ edges: RefInputSchema, radius: ExprInputSchema }),
    ({ kernel, inputs, bodies, resolve, names, value, feature }) => {
      const resolved = inputs.edges.refs.map((ref) => resolve(ref, { label: 'an edge to fillet' }));
      const body = resolved[0]?.body;
      const shape = body === undefined ? undefined : bodies.get(body);
      if (body === undefined || shape === undefined) throw new KernelError('Pick edges to fillet.');
      if (resolved.some((r) => r.body !== body)) {
        throw new KernelError('Pick edges of one body.');
      }
      const result = kernel.fillet(
        shape,
        resolved.map((r) => r.index),
        value('radius'),
      );
      const named = withHistory(kernel, result, [names(body)], {
        op: 'fillet',
        feature: feature.id,
      });
      return {
        bodies: new Map(bodies).set(body, named.shape),
        names: new Map([[body, named.names]]),
      };
    },
  );

  define('test-combine', z.strictObject({}), ({ kernel, bodies, names, feature }) => {
    const [one, two] = [...bodies];
    if (!one || !two) throw new KernelError('Needs two bodies.');
    const [a, b] = [one[0], two[0]];
    const result = namedBoolean(
      kernel,
      'fuse',
      { shape: one[1], names: names(a) },
      { shape: two[1], names: names(b) },
      { feature: feature.id, simplify: true },
    );
    const next = new Map(bodies).set(a, result.shape);
    next.delete(b);
    return { bodies: next, names: new Map([[a, result.names]]) };
  });

  define(
    'test-probe',
    z.strictObject({ target: RefInputSchema }),
    ({ inputs, resolve, feature }) => {
      for (const ref of inputs.target.refs) {
        try {
          probes.push({ feature: feature.id, resolved: resolve(ref) });
        } catch (error) {
          probes.push({ feature: feature.id, error: (error as Error).message });
          throw error;
        }
      }
      return {};
    },
    () => 'read',
  );

  define('test-bad-names', z.strictObject({}), ({ kernel, bodies, bodyId }) => {
    const id = bodyId();
    const box = kernel.box([1, 1, 1]);
    return {
      bodies: new Map(bodies).set(id, box),
      names: new Map([[id, { faces: ['a'], edges: [], vertices: [] }]]),
    };
  });

  return { registry, calls, seen, probes };
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
