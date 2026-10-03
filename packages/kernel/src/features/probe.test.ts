import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';

it('probe', async () => {
  const kernel = new Kernel(await loadOcct());
  const out: string[] = [];
  for (const left of [false, true]) {
    for (const tri of ['in', 'out']) {
      const s = 1;
      const h = Math.sqrt(3) / 2;
      const c = 10;
      const [u0, u1] = [c - h, c + h];
      const curves =
        tri === 'in'
          ? [
              { kind: 'line' as const, a: [u1, -s] as [number, number], b: [u1, s] as [number, number] },
              { kind: 'line' as const, a: [u1, s] as [number, number], b: [u0, 0] as [number, number] },
              { kind: 'line' as const, a: [u0, 0] as [number, number], b: [u1, -s] as [number, number] },
            ]
          : [
              { kind: 'line' as const, a: [u0, -s] as [number, number], b: [u1, 0] as [number, number] },
              { kind: 'line' as const, a: [u1, 0] as [number, number], b: [u0, s] as [number, number] },
              { kind: 'line' as const, a: [u0, s] as [number, number], b: [u0, -s] as [number, number] },
            ];
      const { faces } = kernel.planarFaces(curves, { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, -1, 0] }, 1e-7);
      const face = faces[0]?.shape;
      const helix = kernel.helix({ origin: [0, 0, 0], axis: [0, 0, 1], start: [1, 0, 0], radius: 10, pitch: 4, turns: 2.5, left });
      try {
        const r = kernel.sweep(face as never, helix, { orientation: { binormal: [0, 0, 1] }, verify: false });
        out.push(`${left} ${tri}: ok ${kernel.measure(r.shape).volume} valid ${kernel.isValid(r.shape)}`);
      } catch (e) {
        out.push(`${left} ${tri}: ${(e as Error).message}`);
      }
      // without OrientClosedSolid-related checks: does the turn-by-turn version work?
    }
  }
  writeFileSync('/tmp/claude-1000/-home-zoltanf-Development-extrudo/ed8c2d2c-61f3-474d-adcd-f46b9de946d7/scratchpad/probe.txt', out.join('\n'));
});
