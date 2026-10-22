/**
 * A test host for the agent tools over the real kernel (Node): every change to
 * the document is recomputed by a `RecomputeEngine`, and the model store gets
 * what the app's `Recomputer` gives it (statuses, bodies, sketch and
 * construction reports), so the tools see the kernel's body IDs and frames;
 * `apply` re-solves the sketches as the shell's does (a parameter that drives a
 * dimension moves the geometry). Test-only: it loads OCCT and planegcs.
 */
import type { BodyId, Command, ExtrudoDocument, FeatureId, SketchReport } from '@extrudo/core';
import { isConstructionType, setSketchGeometry } from '@extrudo/core';
import { interferences, Kernel } from '@extrudo/kernel';
import { kernelFeatures, loadOcct, RecomputeEngine } from '@extrudo/kernel/node';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { settleSketches } from '@extrudo/sketch/inference';
import { bodyEntries } from '../shell/bodies';
import type { AgentBody } from './host';
import { fakeHost } from './testing';

let shared: Promise<Kernel> | undefined;

/** One kernel for the test file: loading OCCT takes a while. */
const kernelOnce = () => {
  shared ??= loadOcct().then((occt) => new Kernel(occt));
  return shared;
};

export async function kernelHost(doc: ExtrudoDocument, designId = doc.id) {
  const kernel = await kernelOnce();
  const engine = new RecomputeEngine(kernel, kernelFeatures());
  const fake = fakeHost(doc, designId);
  const { store, model, host } = fake;
  const solver = new SketchSolver(await loadPlanegcs());

  host.apply = (commands: readonly Command<unknown>[]) => {
    const before = store.getState().doc;
    store.getState().beginTransaction(commands[0]?.label ?? '');
    for (const command of commands) store.getState().dispatch(command);
    for (const { feature, points, radii } of settleSketches({
      solver,
      before,
      after: store.getState().doc,
    })) {
      store.getState().dispatch(setSketchGeometry({ feature, points, radii }));
    }
    store.getState().commitTransaction();
  };

  const recompute = async () => {
    const current = store.getState().doc;
    model.getState().computing();
    const result = await engine.recompute({ doc: current });
    if (result.status !== 'done') return;
    const sketches: Record<string, SketchReport> = {};
    const construction: Record<string, unknown> = {};
    for (const [id, report] of Object.entries(result.reports)) {
      const type = current.features.find((f) => f.id === id)?.type;
      if (type === 'sketch') sketches[id] = report as SketchReport;
      else if (type !== undefined && isConstructionType(type)) construction[id] = report;
    }
    model.getState().computed({
      features: result.features,
      bodies: Object.fromEntries(result.bodies.map((b) => [b.id, {}])),
      sketches: sketches as Record<FeatureId, SketchReport>,
      construction: construction as never,
      origins: result.origins,
      doc: current,
    });
  };

  // One recompute at a time, each of the document as it is when it starts.
  let queue = recompute();
  store.subscribe((state, previous) => {
    if (state.doc !== previous.doc) queue = queue.then(recompute);
  });
  await queue;

  host.bodies = async (): Promise<AgentBody[]> => {
    const state = model.getState();
    return bodyEntries(store.getState().doc, state.bodies, state.origins).map((entry) => {
      const shape = engine.latestBody(entry.id);
      const measured = shape ? kernel.measure(shape) : undefined;
      return {
        id: entry.id,
        name: entry.meta.name,
        ...(entry.meta.color !== undefined && { color: entry.meta.color }),
        ...(entry.meta.opacity !== undefined && { opacity: entry.meta.opacity }),
        volume: measured ? Math.round(measured.volume * 1000) / 1000 : Number.NaN,
        box: measured ? { min: measured.bbox.min, max: measured.bbox.max } : undefined,
        visible: entry.display !== 'hidden',
      };
    });
  };

  host.interference = async (ids) =>
    interferences(
      kernel,
      ids.map((id) => {
        const shape = engine.latestBody(id as BodyId);
        if (shape === undefined) throw new Error(`no body ${id}`);
        return { id: id as BodyId, shape };
      }),
    );

  return { ...fake, dispose: () => engine.clear() };
}
