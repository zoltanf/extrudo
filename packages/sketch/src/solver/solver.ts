/**
 * The sketch solver (P1-03, ADR-0002, ADR-0011): planegcs behind one
 * persistent system per independent component.
 *
 * `solve()` takes the whole sketch every time and works out what to do per
 * component: nothing if its inputs are the same objects as last time (Immer
 * keeps unchanged ones), new values into the existing system if only values
 * changed (a dimension, an undo), a rebuild if its equations changed (a
 * constraint added or removed: this re-runs planegcs's diagnosis, so it's
 * kept to the one component). A drag binds temporary constraints on the
 * dragged point to two sketch parameters and only updates those per frame.
 */
import type { SketchData, SketchEllipse } from '@extrudo/core';
import {
  Algorithm,
  DebugMode,
  SolveStatus,
} from '@salusoft89/planegcs/dist/planegcs_dist/enums.js';
import { GcsWrapper } from '@salusoft89/planegcs/dist/sketch/gcs_wrapper.js';
import type { SketchPrimitive } from '@salusoft89/planegcs/dist/sketch/sketch_primitive.js';
import { type Component, splitComponents } from './components';
import {
  arcAngles,
  type DimensionValues,
  docId,
  ellipseParams,
  type Item,
  mapSketch,
} from './mapping';
import type { PlanegcsModule } from './module';

export interface Vec2 {
  x: number;
  y: number;
}

/** Solved geometry: point positions and circle radii (arcs follow from their points). */
export interface SketchSolution {
  points: Record<string, Vec2>;
  radii: Record<string, number>;
}

export interface ComponentReport {
  /** The entities with unknowns in this component. */
  entities: string[];
  /** Whether planegcs converged. On failure the geometry stays where it was. */
  ok: boolean;
  /** Degrees of freedom left (0: fully constrained). Temporary drag constraints don't count. */
  dof: number;
  /** Constraints and dimensions involved in a conflict. */
  conflicting: string[];
  /** Constraints and dimensions that remove no degree of freedom. */
  redundant: string[];
}

export interface SolveResult {
  /** Every component converged. */
  ok: boolean;
  /** Degrees of freedom left over the whole sketch. */
  dof: number;
  conflicting: string[];
  redundant: string[];
  components: ComponentReport[];
  /** Dimensions the solver didn't use: driven ones and those without a value. */
  skipped: string[];
  /** The solved geometry of every entity with unknowns. */
  solution: SketchSolution;
}

export interface DragResult {
  ok: boolean;
  dof: number;
  /** The dragged component's geometry. */
  solution: SketchSolution;
}

export interface CheckResult {
  /** The constraint can be added: it solves and is neither conflicting nor redundant. */
  accepted: boolean;
  ok: boolean;
  dof: number;
  /** Everything involved, the checked constraint included. */
  conflicting: string[];
  redundant: string[];
}

/** The primitive an entity item is named after (an ellipse's focus point comes first). */
const own = (item: Item): SketchPrimitive | undefined => item.prims.find((p) => p.id === item.id);

const DRAG_X = '#drag_x';
const DRAG_Y = '#drag_y';

/** One planegcs system for one component. */
class System {
  readonly gcs: GcsWrapper;
  component!: Component;
  /** The source objects and parameter values of the last solve, to skip unchanged components. */
  inputs: unknown[] = [];
  report!: ComponentReport;
  solution: SketchSolution = { points: {}, radii: {} };
  /** Set while the system holds drag constraints, or after: rebuild before the next solve. */
  stale = false;

  constructor(module: PlanegcsModule) {
    this.gcs = new GcsWrapper(new module.GcsSystem());
    this.gcs.debug_mode = DebugMode.NoDebug;
  }

  build(component: Component, fixedCurves: ReadonlySet<string>, extra: SketchPrimitive[] = []) {
    const { gcs } = this;
    gcs.clear_data();
    this.component = component;
    for (const item of component.items) {
      if (item.param) gcs.push_sketch_param(item.param.name, item.param.value);
    }
    if (extra.length > 0) {
      gcs.push_sketch_param(DRAG_X, 0);
      gcs.push_sketch_param(DRAG_Y, 0);
    }
    for (const item of component.items) for (const prim of item.prims) gcs.push_primitive(prim);
    for (const prim of extra) gcs.push_primitive(prim);
    // The wrapper only fixes points; a circle's radius, an arc's angles and an
    // ellipse's minor radius are fixed here.
    for (const item of component.items) {
      if (!fixedCurves.has(item.id)) continue;
      const addr = this.addr(item.id);
      const count = own(item)?.type === 'arc' ? 3 : 1;
      for (let i = 0; i < count; i++)
        gcs.gcs.set_p_param(addr + i, gcs.gcs.get_p_param(addr + i), true);
    }
    this.stale = extra.length > 0;
  }

  /** Writes geometry and dimension values into the system without rebuilding it. */
  setValues(component: Component, point: (id: string) => Vec2, radius: (id: string) => number) {
    const g = this.gcs.gcs;
    const set = (addr: number, value: number) => g.set_p_param(addr, value, g.get_is_fixed(addr));
    this.component = component;
    for (const item of component.items) {
      const prim = own(item);
      if (item.param) this.gcs.set_sketch_param(item.param.name, item.param.value);
      if (prim?.type === 'point') {
        const addr = this.addr(item.id);
        const p = point(item.id);
        set(addr, p.x);
        set(addr + 1, p.y);
      } else if (prim?.type === 'circle') {
        set(this.addr(item.id), radius(item.id));
      } else if (prim?.type === 'arc') {
        const addr = this.addr(item.id);
        const a = arcAngles(point(prim.c_id), point(prim.start_id), point(prim.end_id));
        set(addr, a.start);
        set(addr + 1, a.end);
        set(addr + 2, a.radius);
      } else if (prim?.type === 'ellipse') {
        const source = item.sources[0] as SketchEllipse;
        const e = ellipseParams(point(source.center), point(source.major), point(source.minor));
        const focus = this.addr(prim.focus1_id);
        set(focus, e.focus.x);
        set(focus + 1, e.focus.y);
        set(this.addr(item.id), e.radmin);
      }
    }
  }

  solve(): ComponentReport {
    const { gcs } = this;
    const status = gcs.solve(Algorithm.DogLeg);
    const ok = status === SolveStatus.Success || status === SolveStatus.Converged;
    if (ok) {
      gcs.gcs.apply_solution();
      this.solution = this.read();
    }
    const constraintIds = (ids: string[]) => {
      const out = new Set<string>();
      for (const id of ids) {
        const doc = docId(id);
        const item = this.component.items.find((i) => i.id === doc);
        if (item && (item.kind === 'constraint' || item.kind === 'dimension')) out.add(doc);
      }
      return [...out];
    };
    this.report = {
      entities: this.component.entities,
      ok,
      dof: gcs.gcs.dof(),
      conflicting: constraintIds(gcs.get_gcs_conflicting_constraints()),
      redundant: constraintIds(gcs.get_gcs_redundant_constraints()),
    };
    return this.report;
  }

  /** The geometry of the component's own (not fixed) entities, from the system. */
  read(): SketchSolution {
    const g = this.gcs.gcs;
    const solution: SketchSolution = { points: {}, radii: {} };
    const mine = new Set(this.component.entities);
    for (const item of this.component.items) {
      if (!mine.has(item.id)) continue;
      const type = own(item)?.type;
      if (type === 'point') {
        const addr = this.addr(item.id);
        solution.points[item.id] = { x: g.get_p_param(addr), y: g.get_p_param(addr + 1) };
      } else if (type === 'circle') {
        solution.radii[item.id] = g.get_p_param(this.addr(item.id));
      }
    }
    return solution;
  }

  addr(id: string): number {
    const addr = this.gcs.p_param_index.get(id);
    if (addr === undefined) throw new Error(`solver: "${id}" is not in the system`);
    return addr;
  }

  dispose() {
    this.gcs.destroy_gcs_module();
  }
}

/** Reads point positions and radii from a component's items (the document's values). */
function itemGeometry(component: Component) {
  const prims = new Map<string, SketchPrimitive>();
  for (const item of component.items) {
    const prim = own(item);
    if (prim) prims.set(item.id, prim);
  }
  const point = (id: string): Vec2 => {
    const p = prims.get(id);
    if (p?.type !== 'point') throw new Error(`solver: "${id}" is not a point`);
    return { x: p.x, y: p.y };
  };
  const radius = (id: string): number => {
    const c = prims.get(id);
    if (c?.type !== 'circle') throw new Error(`solver: "${id}" is not a circle`);
    return c.radius;
  };
  return { point, radius };
}

const inputsOf = (component: Component): unknown[] =>
  component.items.flatMap((item) => [...item.sources, item.param?.value]);

const sameInputs = (a: unknown[], b: unknown[]) =>
  a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

export class SketchSolver implements Disposable {
  readonly #module: PlanegcsModule;
  /** Systems by the first entity of their component (stable while the component exists). */
  #systems = new Map<string, System>();
  #fixedCurves: ReadonlySet<string> = new Set();
  #drag?: { system: System; point: string };
  #scratch?: System;
  /** What `solve()` did per component since the solver was made: for tests and the benchmark. */
  readonly stats = { builds: 0, updates: 0, unchanged: 0 };

  constructor(module: PlanegcsModule) {
    this.#module = module;
  }

  /**
   * Solves `sketch` with the driving dimension values (mm, degrees). Only
   * components whose inputs changed since the last call are solved again.
   */
  solve(sketch: SketchData, values: DimensionValues = {}): SolveResult {
    this.endDrag();
    const mapped = mapSketch(sketch, values);
    const { components, overdetermined } = splitComponents(mapped);
    this.#fixedCurves = mapped.fixedCurves;

    // Match components to the existing systems: same structure first, then any spare system.
    const spare = new Map(this.#systems);
    const next = new Map<string, System>();
    const unmatched: Component[] = [];
    const byStructure = new Map<string, System[]>();
    for (const system of spare.values()) {
      const list = byStructure.get(system.component.structure) ?? [];
      list.push(system);
      byStructure.set(system.component.structure, list);
    }
    const reports: ComponentReport[] = [];
    const solution: SketchSolution = { points: {}, radii: {} };

    const run = (component: Component, system: System, reuse: boolean) => {
      const inputs = inputsOf(component);
      if (reuse && !system.stale && sameInputs(inputs, system.inputs)) {
        system.component = component;
        this.stats.unchanged++;
      } else {
        const geometry = itemGeometry(component);
        if (reuse && !system.stale) {
          system.setValues(component, geometry.point, geometry.radius);
          this.stats.updates++;
        } else {
          system.build(component, mapped.fixedCurves);
          this.stats.builds++;
        }
        system.solve();
        if (!system.report.ok) {
          // Keep the geometry where it was.
          system.setValues(component, geometry.point, geometry.radius);
          system.solution = system.read();
        }
        system.inputs = inputs;
      }
      next.set(component.entities[0] as string, system);
      reports.push(system.report);
      Object.assign(solution.points, system.solution.points);
      Object.assign(solution.radii, system.solution.radii);
    };

    for (const component of components) {
      const system = byStructure.get(component.structure)?.pop();
      if (system) {
        spare.delete(system.component.entities[0] as string);
        run(component, system, true);
      } else unmatched.push(component);
    }
    const leftovers = [...spare.values()];
    for (const component of unmatched) {
      const system = leftovers.pop() ?? new System(this.#module);
      run(component, system, false);
    }
    for (const system of leftovers) system.dispose();
    this.#systems = next;

    const conflicting = reports.flatMap((r) => r.conflicting);
    const redundant = [...reports.flatMap((r) => r.redundant), ...overdetermined];
    return {
      ok: reports.every((r) => r.ok),
      dof: reports.reduce((sum, r) => sum + r.dof, 0),
      conflicting,
      redundant,
      components: reports,
      skipped: mapped.skipped,
      solution,
    };
  }

  /**
   * Starts dragging a point of the last solved sketch. Returns false if the
   * point has no unknowns (fixed, or not in the sketch).
   */
  beginDrag(pointId: string): boolean {
    this.endDrag();
    const system = [...this.#systems.values()].find((s) => s.component.entities.includes(pointId));
    const item = system?.component.items.find((i) => i.id === pointId);
    if (!system || item?.kind !== 'point') return false;
    const start = system.solution.points[pointId] ?? { x: 0, y: 0 };
    system.build(system.component, this.#fixedCurves, [
      { id: DRAG_X, type: 'coordinate_x', p_id: pointId, x: DRAG_X, temporary: true },
      { id: DRAG_Y, type: 'coordinate_y', p_id: pointId, y: DRAG_Y, temporary: true },
    ]);
    // Start from the solved geometry, which the document may not have caught up with.
    const geometry = itemGeometry(system.component);
    system.setValues(
      system.component,
      (id) => system.solution.points[id] ?? geometry.point(id),
      (id) => system.solution.radii[id] ?? geometry.radius(id),
    );
    system.gcs.set_sketch_param(DRAG_X, start.x);
    system.gcs.set_sketch_param(DRAG_Y, start.y);
    this.#drag = { system, point: pointId };
    return true;
  }

  /** Moves the dragged point toward (x, y) and re-solves its component. Call at most once per frame. */
  drag(x: number, y: number): DragResult {
    const drag = this.#drag;
    if (!drag) throw new Error('solver: drag() without beginDrag()');
    const { system } = drag;
    system.gcs.set_sketch_param(DRAG_X, x);
    system.gcs.set_sketch_param(DRAG_Y, y);
    const report = system.solve();
    return { ok: report.ok, dof: report.dof, solution: system.solution };
  }

  /** Ends the drag. The component is rebuilt without the drag constraints on the next solve. */
  endDrag(): void {
    if (!this.#drag) return;
    this.#drag.system.stale = true;
    this.#drag.system.inputs = [];
    this.#drag = undefined;
  }

  /**
   * Test-solves `sketch` (which already contains the constraint or dimension
   * `id`) without touching the solver's systems: the components that `id`
   * affects are built in a scratch system. `accepted` is false if the new
   * constraint conflicts, is redundant, or makes the solve fail.
   */
  check(sketch: SketchData, values: DimensionValues, id: string): CheckResult {
    const mapped = mapSketch(sketch, values);
    const { components, overdetermined } = splitComponents(mapped);
    if (overdetermined.includes(id)) {
      return { accepted: false, ok: true, dof: 0, conflicting: [], redundant: [id] };
    }
    const fix = sketch.constraints[id as keyof typeof sketch.constraints];
    const fixed = fix?.type === 'fix' ? fix.entity : undefined;
    const affected = components.filter((c) =>
      c.items.some((i) => i.id === id || (fixed !== undefined && i.uses.includes(fixed))),
    );
    this.#scratch ??= new System(this.#module);
    const result: CheckResult = {
      accepted: true,
      ok: true,
      dof: 0,
      conflicting: [],
      redundant: [],
    };
    for (const component of affected) {
      this.#scratch.build(component, mapped.fixedCurves);
      const report = this.#scratch.solve();
      result.ok &&= report.ok;
      result.dof += report.dof;
      result.conflicting.push(...report.conflicting);
      result.redundant.push(...report.redundant);
    }
    const involved = [...result.conflicting, ...result.redundant];
    // A fix adds no equation planegcs could name; any conflict it causes counts against it.
    result.accepted =
      result.ok && (fixed !== undefined ? involved.length === 0 : !involved.includes(id));
    return result;
  }

  /** Frees every planegcs system. */
  dispose(): void {
    for (const system of this.#systems.values()) system.dispose();
    this.#systems.clear();
    this.#scratch?.dispose();
    this.#scratch = undefined;
    this.#drag = undefined;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  /** How many planegcs systems are alive (for tests). */
  get systemCount(): number {
    return this.#systems.size + (this.#scratch ? 1 : 0);
  }
}

/** Returns `sketch` with the solved geometry written in; unchanged entities keep their identity. */
export function applySolution(sketch: SketchData, solution: SketchSolution): SketchData {
  let entities: SketchData['entities'] | undefined;
  const write = (id: string, entity: SketchData['entities'][keyof SketchData['entities']]) => {
    entities ??= { ...sketch.entities };
    (entities as Record<string, typeof entity>)[id] = entity;
  };
  const all = sketch.entities as Record<
    string,
    SketchData['entities'][keyof SketchData['entities']]
  >;
  for (const [id, p] of Object.entries(solution.points)) {
    const e = all[id];
    if (e?.type === 'point' && (e.x !== p.x || e.y !== p.y)) write(id, { ...e, x: p.x, y: p.y });
  }
  for (const [id, radius] of Object.entries(solution.radii)) {
    const e = all[id];
    if (e?.type === 'circle' && e.radius !== radius) write(id, { ...e, radius });
  }
  return entities ? { ...sketch, entities } : sketch;
}

export type { DimensionValues, Item };
