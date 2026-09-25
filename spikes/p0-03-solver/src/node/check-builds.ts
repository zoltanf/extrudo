// Every build must solve the perturbed test sketches to the same geometry as
// the published npm build. `node src/node/check-builds.ts growth modern fast`
import { Algorithm, DebugMode, GcsWrapper, init_planegcs_module } from '@salusoft89/planegcs';
import { generate } from '../sketches.ts';

const load = async (build: string) =>
  build === 'npm'
    ? init_planegcs_module()
    : (await import(new URL(`../../builds/${build}/planegcs.js`, import.meta.url).href)).default();

function solvePoints(mod: unknown, layout: 'anchored' | 'chained') {
  // biome-ignore lint/suspicious/noExplicitAny: module type
  const gcs = new GcsWrapper(new (mod as any).GcsSystem());
  gcs.debug_mode = DebugMode.NoDebug;
  gcs.push_primitives_and_params(generate({ entities: 45, layout, noise: 2, seed: 7 }).primitives);
  const status = gcs.solve(Algorithm.DogLeg);
  gcs.apply_solution();
  const pts = gcs.sketch_index.get_primitives().filter((p) => p.type === 'point') as { x: number; y: number }[];
  return { status, dof: gcs.gcs.dof(), xy: pts.flatMap((p) => [p.x, p.y]) };
}

const reference = await load('npm');
for (const build of process.argv.slice(2)) {
  const mod = await load(build);
  for (const layout of ['anchored', 'chained'] as const) {
    const a = solvePoints(reference, layout);
    const b = solvePoints(mod, layout);
    const maxDiff = Math.max(...a.xy.map((v, i) => Math.abs(v - (b.xy[i] ?? Number.NaN))));
    console.log(`${build} ${layout}: status ${b.status} dof ${b.dof}, max point difference vs npm ${maxDiff.toExponential(2)} mm`);
  }
}
