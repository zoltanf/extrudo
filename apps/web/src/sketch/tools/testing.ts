/**
 * Test setup for the drawing tools (not shipped): a document with a sketch
 * on XY in sketch mode, a tool host with the real solver (or a fake), and
 * readers for what landed in the sketch.
 */
import {
  createDocument,
  createDocumentStore,
  createSessionStore,
  evaluateParameters,
  type FeatureId,
  originPlaneRef,
  readSketch,
  type SketchConstraint,
  type SketchData,
  type SketchEntityId,
  type Vec2,
} from '@extrudo/core';
import { loadPlanegcs, type PlanegcsModule, SketchSolver } from '@extrudo/sketch';
import { memoryPreferences } from '../../platform';
import { createViewportStore } from '../../viewport/store';
import { createSketchOn } from '../mode';
import { dimensionValues } from '../values';
import { createToolHost, type PlanePointer, type ToolHost } from './host';
import { LINE_TOOL } from './line';

let module: Promise<PlanegcsModule> | undefined;

const hosts: ToolHost[] = [];
/** Frees the hosts made since the last call (run it in `afterEach`). */
export function disposeHosts(): void {
  for (const host of hosts.splice(0)) host.dispose();
}

/** 0.1 mm per pixel: snapping reaches 0.8 mm. */
export const PER_PIXEL = 0.1;
export const at = (x: number, y: number, infer = true): PlanePointer => ({
  point: [x, y],
  perPixel: PER_PIXEL,
  screen: [0, 0],
  infer,
});

export interface Setup {
  solver?: 'real' | 'none' | Pick<SketchSolver, 'check' | 'solve' | 'dispose'>;
  /** The tool to start; the Line tool by default. */
  tool?: string;
}

export async function setup({ solver = 'real', tool = LINE_TOOL }: Setup = {}) {
  module ??= loadPlanegcs();
  const planegcs = await module;
  const stores = {
    store: createDocumentStore(createDocument()),
    session: createSessionStore(),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
  };
  stores.viewport.getState().setSnap(false);
  const id = createSketchOn(stores, originPlaneRef('origin:xy'));
  let n = 0;
  const host = createToolHost({
    ...stores,
    newId: () => `n${n++}`,
    loadSolver:
      solver === 'none'
        ? undefined
        : solver === 'real'
          ? async () => new SketchSolver(planegcs)
          : async () => solver as SketchSolver,
  });
  hosts.push(host);
  host.start(tool);
  // Let the solver load.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const data = (): SketchData => {
    const f = stores.store.getState().doc.features.find((x) => x.id === id);
    const sketch = f && readSketch(f);
    if (!sketch) throw new Error('no sketch');
    return sketch.data;
  };
  const byType = (type: string) => Object.values(data().entities).filter((e) => e.type === type);
  // Constraint shapes with IDs replaced by what they point at, for readable expectations.
  const summarize = (c: SketchConstraint) => {
    const name = (ref: unknown) => {
      if (typeof ref !== 'string') return ref === undefined ? undefined : String(ref);
      const e = data().entities[ref as SketchEntityId];
      return e?.type === 'point' ? `(${round(e.x)},${round(e.y)})` : e ? e.type : undefined;
    };
    return [
      c.type,
      ...Object.entries(c)
        .filter(([k]) => k !== 'type')
        .map(([, v]) => name(v)),
    ].join(' ');
  };
  const constraints = () => Object.values(data().constraints).map(summarize);
  const point = (id: SketchEntityId): Vec2 => {
    const p = data().entities[id];
    if (p?.type !== 'point') throw new Error(`${id} is not a point`);
    return [p.x, p.y];
  };
  /** Solves the sketch as it is now in a fresh solver: DOF, conflicts and redundancies. */
  const report = () => {
    const solver = new SketchSolver(planegcs);
    try {
      const { evaluate } = evaluateParameters(stores.store.getState().doc);
      return solver.solve(data(), dimensionValues(data(), evaluate));
    } finally {
      solver.dispose();
    }
  };
  return { ...stores, host, id: id as FeatureId, data, byType, constraints, point, report };
}

/** Rounds away solver noise for readable expectations. */
const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0;
