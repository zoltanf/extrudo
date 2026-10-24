/**
 * Render Picture against a real Blender (P6-15, ADR-0101): a cube in every
 * preset at draft quality and once at standard, through `nodeBlenderEnv`.
 * Runs only with `EXTRUDO_BLENDER=1` and a `blender` on PATH; the pictures
 * stay in `<tmp>/extrudo-pictures/` for a look.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RenderJob, RenderProgress } from '@extrudo/web/platform/render';
import { describe, expect, it } from 'vitest';
import {
  blenderStatus,
  findBlender,
  nodeBlenderEnv,
  RENDER_PREFIX,
  renderInBlender,
} from './blender';

const env = nodeBlenderEnv(tmpdir(), process.env.EXTRUDO_BLENDER_PATH);
const found = process.env.EXTRUDO_BLENDER ? findBlender(env) : undefined;
const outDir = join(tmpdir(), 'extrudo-pictures');

/** A 20 mm cube as `writeObj` writes it: 8 nodes, 12 triangles, one material. */
const CUBE_OBJ = [
  '# Extrudo test',
  'mtllib model.mtl',
  'o Cube',
  'v -10 -10 0',
  'v 10 -10 0',
  'v 10 10 0',
  'v -10 10 0',
  'v -10 -10 20',
  'v 10 -10 20',
  'v 10 10 20',
  'v -10 10 20',
  'usemtl m0',
  'f 1 3 2',
  'f 1 4 3',
  'f 5 6 7',
  'f 5 7 8',
  'f 1 2 6',
  'f 1 6 5',
  'f 2 3 7',
  'f 2 7 6',
  'f 3 4 8',
  'f 3 8 7',
  'f 4 1 5',
  'f 4 5 8',
  '',
].join('\n');
const CUBE_MTL = '# Extrudo test\nnewmtl m0\nKd 0.2314 0.5098 0.9647\n';

const job = (over: Partial<RenderJob>): RenderJob => ({
  project: 'Cube',
  obj: CUBE_OBJ,
  mtl: CUBE_MTL,
  objects: [{ name: 'Cube', finish: 'glossy', color: '#3b82f6' }],
  preset: 'studio',
  width: 320,
  height: 180,
  quality: 'draft',
  ...over,
});

describe.skipIf(!found)('Blender renders a cube', () => {
  it('is a supported version', () => {
    expect(blenderStatus(env).state).toBe('found');
  });

  for (const preset of ['studio', 'table', 'workbench', 'outdoor'] as const) {
    it(`in the ${preset} preset at draft quality`, { timeout: 120_000 }, async () => {
      const seen: RenderProgress[] = [];
      const result = await renderInBlender(
        env,
        found as NonNullable<typeof found>,
        job({ preset }),
        (p) => seen.push(p),
        { cancelled: false },
      );
      if (!result.ok) throw new Error(result.message);
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, `${preset}-draft.png`), result.png);
      expect([...result.png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(result.png.byteLength).toBeGreaterThan(2048);
      expect(seen.map((p) => p.phase)).toContain('rendering');
      expect(env.glob(tmpdir(), RENDER_PREFIX)).toEqual([]);
    });
  }

  it('in the table preset at standard quality with a wood finish and a named view', {
    timeout: 300_000,
  }, async () => {
    const result = await renderInBlender(
      env,
      found as NonNullable<typeof found>,
      job({
        preset: 'table',
        quality: 'standard',
        objects: [{ name: 'Cube', finish: 'wood', color: '#b07c3a' }],
        camera: {
          projection: 'perspective',
          position: [60, -60, 50],
          target: [0, 0, 10],
          up: [0, 0, 1],
        },
      }),
      () => {},
      { cancelled: false },
    );
    if (!result.ok) throw new Error(result.message);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'table-standard.png'), result.png);
    expect(result.png.byteLength).toBeGreaterThan(2048);
  });
});
