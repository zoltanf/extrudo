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
import type { IntVector } from '@salusoft89/planegcs/dist/planegcs_dist/gcs_system.js';
import { emsc_vec_to_arr } from '@salusoft89/planegcs/dist/sketch/emsc_vectors.js';
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
  /** Constraints and dimensions that remove no degree of freedom: every equation of theirs is redundant. */
  redundant: string[];
  /**
   * Constraints with several equations of which only some are redundant: they
   * still remove freedom (collinear on two lines already parallel keeps one
   * of its two point-on-line equations). Informational, like FreeCAD's
   * "partially redundant".
   */
  partlyRedundant: string[];
  /**
   * The component's points and curves with a parameter that can still move
   * (P1-08): planegcs's dependent parameters, from its last diagnosis. A line
   * or spline has no parameters of its own; it is free if a point of it is.
   */
  free: string[];
}

export interface SolveResult {
  /** Every component converged. */
  ok: boolean;
  /** Degrees of freedom left over the whole sketch. */
  dof: number;
  conflicting: string[];
  redundant: string[];
  partlyRedundant: string[];
  /** Points and curves that can still move (see `ComponentReport.free`). */
  free: string[];
  components: ComponentReport[];
  /** Dimensions the solver didn't use: driven ones and those without a value. */
  skipped: string[];
  /** The solved geometry of every entity with unknowns. */
  solution: SketchSolution;
}

export interface DragResult {
  ok: boolean;
  dof: number;
  /** The dragged components' geometry. */
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
  partlyRedundant: string[];
}

/** Our build's addition to planegcs's `GcsSystem` (planegcs.patch). */
interface Dependent {
  get_dependent_params(): IntVector;
}

/** The primitive an entity item is named after (an ellipse's focus point comes first). */
const own = (item: Item): SketchPrimitive | undefined => item.prims.find((p) => p.id === item.id);

/** The parameters of the temporary constraints that pull the `i`th dragged point of a system. */
const dragX = (i: number) => `#drag_x${i}`;
const dragY = (i: number) => `#drag_y${i}`;
const DRAG_RADIUS = '#drag_r';

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
    for (const prim of extra) {
      if (prim.type === 'coordinate_x' && typeof prim.x === 'string')
        gcs.push_sketch_param(prim.x, 0);
      if (prim.type === 'coordinate_y' && typeof prim.y === 'string')
        gcs.push_sketch_param(prim.y, 0);
      if (prim.type === 'circle_radius' && typeof prim.radius === 'string')
        gcs.push_sketch_param(prim.radius, 0);
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
    // planegcs names equations; a constraint or dimension may have several (`c7#0`, `c7#1`).
    const byItem = (ids: string[]) => {
      const out = new Map<string, { item: Item; equations: Set<string> }>();
      for (const id of ids) {
        const doc = docId(id);
        const item = this.component.items.find((i) => i.id === doc);
        if (!item || (item.kind !== 'constraint' && item.kind !== 'dimension')) continue;
        const entry = out.get(doc) ?? { item, equations: new Set<string>() };
        entry.equations.add(id);
        out.set(doc, entry);
      }
      return out;
    };
    const redundant: string[] = [];
    const partlyRedundant: string[] = [];
    for (const [doc, { item, equations }] of byItem(gcs.get_gcs_redundant_constraints())) {
      (equations.size >= item.prims.length ? redundant : partlyRedundant).push(doc);
    }
    this.report = {
      entities: this.component.entities,
      ok,
      dof: gcs.gcs.dof(),
      conflicting: [...byItem(gcs.get_gcs_conflicting_constraints()).keys()],
      redundant,
      partlyRedundant,
      free: this.free(),
    };
    return this.report;
  }

  /** The component's own points and curves with a parameter the last diagnosis left free. */
  free(): string[] {
    const loose = new Set(
      emsc_vec_to_arr((this.gcs.gcs as unknown as Dependent).get_dependent_params()),
    );
    if (loose.size === 0) return [];
    const mine = new Set(this.component.entities);
    const out: string[] = [];
    for (const item of this.component.items) {
      if (!mine.has(item.id)) continue;
      const prim = own(item);
      const addrs: number[] = [];
      const add = (id: string, count: number) => {
        const addr = this.gcs.p_param_index.get(id);
        if (addr !== undefined) for (let i = 0; i < count; i++) addrs.push(addr + i);
      };
      if (prim?.type === 'point') add(item.id, 2);
      else if (prim?.type === 'circle') add(item.id, 1);
      else if (prim?.type === 'arc') add(item.id, 3);
      else if (prim?.type === 'ellipse') {
        add(item.id, 1);
        add(prim.focus1_id, 2);
      }
      if (addrs.some((a) => loose.has(a))) out.push(item.id);
    }
    return out;
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

interface DragSystem {
  system: System;
  /** The dragged points in this system, in the order of their drag parameters. */
  points: string[];
}

export class SketchSolver implements Disposable {
  readonly #module: PlanegcsModule;
  /** Systems by the first entity of their component (stable while the component exists). */
  #systems = new Map<string, System>();
  #fixedCurves: ReadonlySet<string> = new Set();
  #drag?: { systems: DragSystem[]; lead: string; starts: Map<string, Vec2> };
  /** A circle's rim being dragged: its system carries a temporary radius constraint. */
  #radiusDrag?: { system: System; circle: string };
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
      partlyRedundant: reports.flatMap((r) => r.partlyRedundant),
      free: reports.flatMap((r) => r.free),
      components: reports,
      skipped: mapped.skipped,
      solution,
    };
  }

  /**
   * Starts dragging points of the last solved sketch (P1-03; several at once
   * since P1-09: a line's ends, a selection). Each point is pulled by
   * temporary constraints; the rest of its component follows. Points with no
   * unknowns (fixed, or not in the sketch) are left out. Returns false if
   * none is left.
   */
  beginDrag(pointIds: string | readonly string[]): boolean {
    this.endDrag();
    const ids = typeof pointIds === 'string' ? [pointIds] : [...new Set(pointIds)];
    const bySystem = new Map<System, string[]>();
    for (const id of ids) {
      const system = [...this.#systems.values()].find((s) =>
        s.component.items.some(
          (i) => i.id === id && i.kind === 'point' && s.component.entities.includes(id),
        ),
      );
      if (!system) continue;
      const list = bySystem.get(system) ?? [];
      list.push(id);
      bySystem.set(system, list);
    }
    const lead = ids.find((id) => [...bySystem.values()].some((list) => list.includes(id)));
    if (!lead) return false;
    const starts = new Map<string, Vec2>();
    const systems: DragSystem[] = [];
    for (const [system, points] of bySystem) {
      system.build(
        system.component,
        this.#fixedCurves,
        points.flatMap((p, i) => [
          { id: dragX(i), type: 'coordinate_x', p_id: p, x: dragX(i), temporary: true },
          { id: dragY(i), type: 'coordinate_y', p_id: p, y: dragY(i), temporary: true },
        ]),
      );
      // Start from the solved geometry, which the document may not have caught up with.
      const geometry = itemGeometry(system.component);
      system.setValues(
        system.component,
        (id) => system.solution.points[id] ?? geometry.point(id),
        (id) => system.solution.radii[id] ?? geometry.radius(id),
      );
      points.forEach((p, i) => {
        const start = system.solution.points[p] ?? geometry.point(p);
        starts.set(p, start);
        system.gcs.set_sketch_param(dragX(i), start.x);
        system.gcs.set_sketch_param(dragY(i), start.y);
      });
      systems.push({ system, points });
    }
    this.#drag = { systems, lead, starts };
    return true;
  }

  /**
   * Moves the first draggable point toward (x, y), the other dragged points
   * by the same offset, and re-solves their components. Call at most once
   * per frame.
   */
  drag(x: number, y: number): DragResult {
    const drag = this.#drag;
    if (!drag) throw new Error('solver: drag() without beginDrag()');
    const from = drag.starts.get(drag.lead) as Vec2;
    return this.dragBy(x - from.x, y - from.y);
  }

  /** Moves every dragged point toward its start plus (dx, dy) and re-solves their components. */
  dragBy(dx: number, dy: number): DragResult {
    const drag = this.#drag;
    if (!drag) throw new Error('solver: dragBy() without beginDrag()');
    const solution: SketchSolution = { points: {}, radii: {} };
    let ok = true;
    let dof = 0;
    for (const { system, points } of drag.systems) {
      points.forEach((p, i) => {
        const start = drag.starts.get(p) as Vec2;
        system.gcs.set_sketch_param(dragX(i), start.x + dx);
        system.gcs.set_sketch_param(dragY(i), start.y + dy);
      });
      const report = system.solve();
      ok &&= report.ok;
      dof += report.dof;
      Object.assign(solution.points, system.solution.points);
      Object.assign(solution.radii, system.solution.radii);
    }
    return { ok, dof, solution };
  }

  /**
   * Starts dragging a circle's rim (resizing it): a temporary constraint
   * pulls its radius toward the value `dragRadius` sets, and the rest of its
   * component follows. Returns false if the circle isn't in the last solve
   * or is fixed as a whole. A radius that other constraints hold (a
   * dimension, an equal to a fixed circle) simply doesn't change.
   */
  beginRadiusDrag(circleId: string): boolean {
    this.endDrag();
    if (this.#fixedCurves.has(circleId)) return false;
    const system = [...this.#systems.values()].find((s) =>
      s.component.items.some((i) => i.id === circleId && own(i)?.type === 'circle'),
    );
    if (!system) return false;
    system.build(system.component, this.#fixedCurves, [
      {
        id: DRAG_RADIUS,
        type: 'circle_radius',
        c_id: circleId,
        radius: DRAG_RADIUS,
        temporary: true,
      },
    ]);
    const geometry = itemGeometry(system.component);
    system.setValues(
      system.component,
      (id) => system.solution.points[id] ?? geometry.point(id),
      (id) => system.solution.radii[id] ?? geometry.radius(id),
    );
    system.gcs.set_sketch_param(
      DRAG_RADIUS,
      system.solution.radii[circleId] ?? geometry.radius(circleId),
    );
    this.#radiusDrag = { system, circle: circleId };
    return true;
  }

  /** Pulls the dragged circle's radius toward `radius` and re-solves its component. */
  dragRadius(radius: number): DragResult {
    const drag = this.#radiusDrag;
    if (!drag) throw new Error('solver: dragRadius() without beginRadiusDrag()');
    drag.system.gcs.set_sketch_param(DRAG_RADIUS, radius);
    const report = drag.system.solve();
    return {
      ok: report.ok,
      dof: report.dof,
      solution: {
        points: { ...drag.system.solution.points },
        radii: { ...drag.system.solution.radii },
      },
    };
  }

  /** Ends the drag. The components are rebuilt without the drag constraints on the next solve. */
  endDrag(): void {
    const systems = [
      ...(this.#drag?.systems.map((d) => d.system) ?? []),
      ...(this.#radiusDrag ? [this.#radiusDrag.system] : []),
    ];
    for (const system of systems) {
      system.stale = true;
      system.inputs = [];
    }
    this.#drag = undefined;
    this.#radiusDrag = undefined;
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
      return {
        accepted: false,
        ok: true,
        dof: 0,
        conflicting: [],
        redundant: [id],
        partlyRedundant: [],
      };
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
      partlyRedundant: [],
    };
    for (const component of affected) {
      this.#scratch.build(component, mapped.fixedCurves);
      const report = this.#scratch.solve();
      result.ok &&= report.ok;
      result.dof += report.dof;
      result.conflicting.push(...report.conflicting);
      result.redundant.push(...report.redundant);
      result.partlyRedundant.push(...report.partlyRedundant);
    }
    const involved = [...result.conflicting, ...result.redundant];
    if (fixed !== undefined) {
      // A fix adds no equation planegcs could name; any conflict it causes counts against it.
      result.accepted = result.ok && involved.length === 0;
    } else {
      result.accepted = result.ok && !involved.includes(id);
      // Redundancy that names other constraints, or only some of this one's
      // equations, leaves the question open: planegcs spreads redundant
      // equations over whichever constraints it likes. The constraint is
      // needed if it removes a degree of freedom.
      if (result.accepted && (result.redundant.length > 0 || result.partlyRedundant.length > 0)) {
        if (this.#dofWithout(sketch, values, id, affected) <= result.dof) {
          result.accepted = false;
          result.redundant.push(id);
          result.partlyRedundant = result.partlyRedundant.filter((r) => r !== id);
        }
      }
    }
    return result;
  }

  /**
   * The degrees of freedom of the entities in `affected` once constraint or
   * dimension `id` is taken out again, solved in the scratch system.
   */
  #dofWithout(
    sketch: SketchData,
    values: DimensionValues,
    id: string,
    affected: readonly Component[],
  ): number {
    const { [id]: _c, ...constraints } = sketch.constraints as Record<string, unknown>;
    const { [id]: _d, ...dimensions } = sketch.dimensions as Record<string, unknown>;
    const without = { ...sketch, constraints, dimensions } as SketchData;
    const mapped = mapSketch(without, values);
    const entities = new Set(affected.flatMap((c) => c.entities));
    let dof = 0;
    for (const component of splitComponents(mapped).components) {
      if (!component.entities.some((e) => entities.has(e))) continue;
      this.#scratch ??= new System(this.#module);
      this.#scratch.build(component, mapped.fixedCurves);
      dof += this.#scratch.solve().dof;
    }
    return dof;
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
