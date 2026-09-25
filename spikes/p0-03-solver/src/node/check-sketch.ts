// Sanity check: the generated sketch solves to the intended geometry with DOF 0.
import { Algorithm, DebugMode, GcsWrapper, init_planegcs_module } from '@salusoft89/planegcs';
import { generate } from '../sketches.ts';

const mod = await init_planegcs_module();
for (const join of ['coincident', 'shared'] as const) {
  for (const noise of [0, 2]) {
    const gcs = new GcsWrapper(new mod.GcsSystem());
    gcs.debug_mode = DebugMode.NoDebug;
    const sk = generate({ entities: 18, join, noise });
    gcs.push_primitives_and_params(sk.primitives);
    const status = gcs.solve(Algorithm.DogLeg);
    gcs.apply_solution();
    const byId = new Map(gcs.sketch_index.get_primitives().map((p: any) => [p.id, p]));
    const corner = sk.corners.map((c) => { const p: any = byId.get(c); return `(${p.x.toFixed(3)},${p.y.toFixed(3)})`; }).join(' ');
    console.log(join, 'noise', noise, 'status', status, 'dof', gcs.gcs.dof(), 'conflicting', gcs.get_gcs_conflicting_constraints().length, 'redundant', gcs.get_gcs_redundant_constraints(), 'partial', gcs.get_gcs_partially_redundant_constraints().length, 'corners', corner);
    const pts = gcs.sketch_index.get_primitives().filter((p: any) => p.type === 'point').slice(0, 22).map((p: any) => `${p.id}(${p.x.toFixed(2)},${p.y.toFixed(2)})`).join(' ');
    if (noise === 2 && join === 'coincident') console.log(pts);
    gcs.destroy_gcs_module();
  }
}
