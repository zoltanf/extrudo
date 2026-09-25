// The solver benchmark, shared by Node (src/node/bench.ts) and the browser
// page (src/browser/main.ts). Every number is milliseconds unless noted.
import {
  Algorithm,
  DebugMode,
  GcsWrapper,
  type SketchParam,
  type SketchPrimitive,
} from '@salusoft89/planegcs';
import { generate, type JoinMode, type Layout } from './sketches.ts';

// biome-ignore lint/suspicious/noExplicitAny: the module type isn't exported by planegcs
type PlanegcsModule = any;

export interface Stats {
  median: number;
  p95: number;
  max: number;
}

export interface SizeResult {
  entities: number;
  join: JoinMode;
  layout: Layout;
  /** Unknowns the solver sees (free parameters). */
  params: number;
  primitives: number;
  /** clear_data + push_primitives_and_params */
  build: number;
  /** First solve from a perturbed start (±2 mm on every point). */
  firstSolve: number;
  firstStatus: number;
  dof: number;
  /** apply_solution: copies the solved parameters back into the JS primitives. */
  apply: number;
  /** Solve again with nothing changed: the diagnosis (DOF/QR) floor. */
  noopSolve: Stats;
  /** Change the width parameter that drives every cell, re-solve and apply. */
  paramChange: Stats;
  /** Drag one free corner with temporary constraints on a persistent system: set params + solve + apply. */
  drag: Stats;
  dragDof: number;
  /** The same drag step, rebuilding the whole system each time. */
  dragRebuild: Stats;
  /** Add a conflicting dimension: solve time, status and how many constraints are reported. */
  conflict: { solve: number; status: number; reported: number; includesCulprit: boolean };
  /** First solve per algorithm (DogLeg is the default). */
  algorithms: Record<'DogLeg' | 'LevenbergMarquardt' | 'BFGS', { ms: number; status: number }>;
}

const stats = (samples: number[]): Stats => {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
  return { median: at(0.5), p95: at(0.95), max: s[s.length - 1] ?? 0 };
};

const time = (fn: () => void) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

function wrapper(mod: PlanegcsModule): GcsWrapper {
  const gcs = new GcsWrapper(new mod.GcsSystem());
  gcs.debug_mode = DebugMode.NoDebug;
  return gcs;
}

export function benchSize(
  mod: PlanegcsModule,
  entities: number,
  join: JoinMode,
  layout: Layout,
  maxSteps = 200,
): SizeResult {
  let steps = maxSteps;
  const sketch = generate({ entities, join, layout, noise: 2 });
  const gcs = wrapper(mod);

  // Build and first solve (fully constrained, perturbed start).
  const build = time(() => {
    gcs.clear_data();
    gcs.push_primitives_and_params(sketch.primitives);
  });
  let firstStatus = 0;
  const firstSolve = time(() => {
    firstStatus = gcs.solve(Algorithm.DogLeg);
  });
  const dof = gcs.gcs.dof();
  const params = gcs.gcs.params_size();
  const apply = time(() => gcs.apply_solution());
  // Keep slow configurations to a few repetitions: ~2 s per measurement.
  const reps = (n: number) => Math.max(3, Math.min(n, Math.round(2000 / Math.max(firstSolve, 0.01))));
  steps = reps(steps);

  const noop: number[] = [];
  for (let i = 0; i < reps(20); i++) noop.push(time(() => gcs.solve()));

  const param: number[] = [];
  for (let i = 0; i < reps(20); i++) {
    gcs.set_sketch_param('W', i % 2 === 0 ? 55 : 50);
    param.push(
      time(() => {
        gcs.solve();
        gcs.apply_solution();
      }),
    );
  }

  // Drag: the last cell's height is free; pull its top-right corner around.
  const drag = generate({ entities, join, layout, noise: 0, freeLastHeight: true });
  const target = (i: number) => ({ x: 0, y: 30 + 10 * Math.sin(i / 10) });
  const dragPrimitives = (i: number): (SketchPrimitive | SketchParam)[] => [
    ...drag.primitives,
    { type: 'param', name: 'drag_x', value: target(i).x },
    { type: 'param', name: 'drag_y', value: target(i).y },
    { id: 'drag_tx', type: 'coordinate_x', p_id: drag.dragPoint, x: 'drag_x', temporary: true },
    { id: 'drag_ty', type: 'coordinate_y', p_id: drag.dragPoint, y: 'drag_y', temporary: true },
  ];
  gcs.clear_data();
  gcs.push_primitives_and_params(dragPrimitives(0));
  gcs.solve();
  const dragDof = gcs.gcs.dof();
  gcs.apply_solution();
  const dragSteps: number[] = [];
  for (let i = 1; i <= steps; i++) {
    const { x, y } = target(i);
    dragSteps.push(
      time(() => {
        gcs.set_sketch_param('drag_x', x);
        gcs.set_sketch_param('drag_y', y);
        gcs.solve();
        gcs.apply_solution();
      }),
    );
  }
  const rebuildSteps: number[] = [];
  for (let i = 1; i <= Math.min(steps, 20); i++) {
    rebuildSteps.push(
      time(() => {
        gcs.clear_data();
        gcs.push_primitives_and_params(dragPrimitives(i));
        gcs.solve();
        gcs.apply_solution();
      }),
    );
  }

  // Conflict: a second, different height on the first cell's rectangle.
  const conflicting = generate({ entities, join, layout, noise: 0 });
  gcs.clear_data();
  gcs.push_primitives_and_params([
    ...conflicting.primitives,
    { id: 'culprit', type: 'p2p_distance', p1_id: 'p0', p2_id: 'p3', distance: 35 },
  ]);
  let conflictStatus = 0;
  const conflictSolve = time(() => {
    conflictStatus = gcs.solve();
  });
  const reported = gcs.get_gcs_conflicting_constraints();

  const algorithms = {} as SizeResult['algorithms'];
  for (const [name, algorithm] of [
    ['DogLeg', Algorithm.DogLeg],
    ['LevenbergMarquardt', Algorithm.LevenbergMarquardt],
    ['BFGS', Algorithm.BFGS],
  ] as const) {
    gcs.clear_data();
    gcs.push_primitives_and_params(sketch.primitives);
    let status = 0;
    const ms = time(() => {
      status = gcs.solve(algorithm);
    });
    algorithms[name] = { ms, status };
  }

  gcs.destroy_gcs_module();
  return {
    entities: sketch.entities,
    join,
    layout,
    params,
    primitives: sketch.primitives.length,
    build,
    firstSolve,
    firstStatus,
    dof,
    apply,
    noopSolve: stats(noop),
    paramChange: stats(param),
    drag: stats(dragSteps),
    dragDof,
    dragRebuild: stats(rebuildSteps),
    conflict: {
      solve: conflictSolve,
      status: conflictStatus,
      reported: reported.length,
      includesCulprit: reported.includes('culprit'),
    },
    algorithms,
  };
}

export const SIZES = [50, 100, 200, 500];

export type Outcome = SizeResult | { entities: number; join: JoinMode; layout: Layout; error: string };

/**
 * Runs every size, layout and join mode, each on a fresh module: a planegcs
 * abort (out of memory) poisons its instance.
 */
export async function benchAll(
  init: () => Promise<PlanegcsModule>,
  onResult?: (r: Outcome) => void,
): Promise<Outcome[]> {
  benchSize(await init(), 50, 'coincident', 'chained', 50); // warm-up
  const results: Outcome[] = [];
  for (const layout of ['anchored', 'chained'] as const) {
    for (const join of ['coincident', 'shared'] as const) {
      for (const size of SIZES) {
        try {
          const r = benchSize(await init(), size, join, layout);
          results.push(r);
          onResult?.(r);
        } catch (error) {
          const r = { entities: size, join, layout, error: String(error).slice(0, 80) };
          results.push(r);
          onResult?.(r);
        }
      }
    }
  }
  return results;
}

export interface ComponentResult {
  entities: number;
  join: JoinMode;
  components: number;
  largestUnknowns: number;
  /** Build + first solve of every component (what opening the sketch costs). */
  firstSolveAll: number;
  /** Drag step in the one component that holds the dragged point. */
  drag: Stats;
  /** Rebuild + solve of that component, as after adding or deleting a constraint (re-diagnosis). */
  constraintEdit: Stats;
  /** Change the parameter used by every component: re-solve and apply all. */
  paramChange: Stats;
}

/** The anchored sketch solved as one planegcs system per independent component. */
export function benchComponents(
  mod: PlanegcsModule,
  entities: number,
  join: JoinMode,
  split: (prims: (SketchPrimitive | SketchParam)[]) => (SketchPrimitive | SketchParam)[][],
): ComponentResult {
  const sketch = generate({ entities, join, layout: 'anchored', noise: 2, freeLastHeight: true });
  const groups = split(sketch.primitives);
  const hasDrag = (g: (SketchPrimitive | SketchParam)[]) => g.some((p) => 'id' in p && p.id === sketch.dragPoint);
  const systems: GcsWrapper[] = [];
  let largestUnknowns = 0;
  const firstSolveAll = time(() => {
    for (const group of groups) {
      const gcs = wrapper(mod);
      gcs.push_primitives_and_params(group);
      gcs.solve();
      gcs.apply_solution();
      largestUnknowns = Math.max(largestUnknowns, gcs.gcs.params_size());
      systems.push(gcs);
    }
  });

  const dragGroup = groups.find(hasDrag) ?? [];
  const dragIndex = groups.indexOf(dragGroup);
  const withDrag = (): (SketchPrimitive | SketchParam)[] => [
    ...dragGroup,
    { type: 'param', name: 'drag_x', value: 0 },
    { type: 'param', name: 'drag_y', value: 30 },
    { id: 'drag_tx', type: 'coordinate_x', p_id: sketch.dragPoint, x: 'drag_x', temporary: true },
    { id: 'drag_ty', type: 'coordinate_y', p_id: sketch.dragPoint, y: 'drag_y', temporary: true },
  ];
  const edits: number[] = [];
  for (let i = 0; i < 20; i++) {
    edits.push(
      time(() => {
        const gcs = systems[dragIndex] as GcsWrapper;
        gcs.clear_data();
        gcs.push_primitives_and_params(withDrag());
        gcs.solve();
        gcs.apply_solution();
      }),
    );
  }
  const dragSystem = systems[dragIndex] as GcsWrapper;
  const dragSteps: number[] = [];
  for (let i = 1; i <= 200; i++) {
    dragSteps.push(
      time(() => {
        dragSystem.set_sketch_param('drag_x', 0);
        dragSystem.set_sketch_param('drag_y', 30 + 10 * Math.sin(i / 10));
        dragSystem.solve();
        dragSystem.apply_solution();
      }),
    );
  }
  const params: number[] = [];
  for (let i = 0; i < 20; i++) {
    params.push(
      time(() => {
        for (const gcs of systems) {
          gcs.set_sketch_param('W', i % 2 === 0 ? 55 : 50);
          gcs.solve();
          gcs.apply_solution();
        }
      }),
    );
  }
  for (const gcs of systems) gcs.destroy_gcs_module();
  return {
    entities: sketch.entities,
    join,
    components: groups.length,
    largestUnknowns,
    firstSolveAll,
    drag: stats(dragSteps),
    constraintEdit: stats(edits),
    paramChange: stats(params),
  };
}
