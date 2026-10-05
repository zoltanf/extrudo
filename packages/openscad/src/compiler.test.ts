/**
 * The OpenSCAD compiler with the real WASM in a `worker_threads` worker
 * (ADR-0071): models, the wording of every failure the spike met, overrides,
 * the customizer list, the time limit and the memory ceiling.
 */

import { readFileSync } from 'node:fs';
import { checkManifold, read3mf } from '@extrudo/io';
import { afterAll, describe, expect, it } from 'vitest';
import { type CompileReply, WorkerCompiler } from './compiler';
import type { ScadRequest, ScadResult } from './index';
import { parseLog } from './messages';
import { createNodeCompiler } from './node';

const compiler = createNodeCompiler();
afterAll(() => compiler.dispose());

const scad = (source: string, extra: Partial<ScadRequest> = {}): ScadRequest => ({
  fileName: 'part.scad',
  source: new TextEncoder().encode(source),
  ...extra,
});

function model(result: ScadResult) {
  if (!result.ok) throw new Error(result.error);
  const file = read3mf(result.model);
  return file.objects.map((object) => checkManifold(object.mesh));
}

describe('the OpenSCAD compiler', { timeout: 30_000 }, () => {
  it('compiles a cube less a cylinder into a closed 3MF', { timeout: 30_000 }, async () => {
    const result = await compiler.compile(
      scad(
        'difference() { cube([20, 20, 10]); translate([10, 10, -1]) cylinder(d = 8, h = 12, $fn = 64); }',
      ),
    );
    const [check] = model(result);
    expect(check?.ok).toBe(true);
    // A 64-gon inscribed in the Ø8 circle.
    const hole = 0.5 * 64 * 16 * Math.sin((2 * Math.PI) / 64) * 10;
    // 3MF keeps 6 decimals (1 µm), so the volume is good to about 1e-5 mm³.
    expect(check?.volume).toBeCloseTo(4000 - hole, 3);
    expect(result.ok && result.warnings).toEqual([]);
  });

  it('gives the same model twice', async () => {
    const source = 'minkowski() { cube([20, 20, 10]); sphere(r = 2, $fn = 32); }';
    const a = await compiler.compile(scad(source));
    const b = await compiler.compile(scad(source));
    expect(model(a)).toEqual(model(b));
  });

  it('overrides top-level variables and lists the customizer', async () => {
    const source =
      'width = 20; // [10:100]\nheight = 10; // [5:1:50]\ncube([width, width, height]);\n';
    const result = await compiler.compile(
      scad(source, {
        defines: [
          { name: 'width', value: 30 },
          { name: 'height', value: 2.5 },
        ],
        parameters: true,
      }),
    );
    expect(model(result)[0]?.volume).toBeCloseTo(30 * 30 * 2.5, 6);
    expect(result.parameters).toEqual([
      expect.objectContaining({ name: 'width', type: 'number', initial: 20, min: 10, max: 100 }),
      expect.objectContaining({ name: 'height', initial: 10, min: 5, max: 50, step: 1 }),
    ]);
  });

  it('words a syntax error with its file and line', async () => {
    const result = await compiler.compile(scad('cube(10);\n\ntranslate([1, 2, 3) sphere(2);\n'));
    expect(result).toMatchObject({ ok: false, error: 'part.scad, line 3: syntax error.' });
  });

  it('words a failed assertion', async () => {
    const result = await compiler.compile(scad('assert(false, "too thin");\ncube(1);'));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe(
      `part.scad, line 1: assertion 'false' failed: "too thin".`,
    );
  });

  it('refuses a 2D result and an empty one', async () => {
    expect(await compiler.compile(scad('square(10);'))).toMatchObject({
      ok: false,
      error:
        'part.scad makes a 2D shape: Extrudo imports 3D solids (extrude it with linear_extrude or rotate_extrude).',
    });
    expect(await compiler.compile(scad('// nothing\n'))).toMatchObject({
      ok: false,
      error: 'part.scad makes nothing: its top level is empty.',
    });
  });

  it('names a missing include, use or import', async () => {
    expect(await compiler.compile(scad('include <MCAD/gears.scad>\ncube(1);'))).toMatchObject({
      ok: false,
      error:
        "part.scad, line 1: can't find MCAD/gears.scad. Extrudo compiles one .scad file on its own, without libraries or other files.",
    });
    const use = await compiler.compile(scad('cube(1);\nuse <lib.scad>\n'));
    expect(!use.ok && use.error).toMatch(/^part\.scad, line 2: can't find lib\.scad\./);
    const imported = await compiler.compile(scad('import("part.stl");'));
    expect(!imported.ok && imported.error).toMatch(/^part\.scad, line 1: can't find part\.stl\./);
  });

  it('turns echoes and warnings into at most five warnings', async () => {
    const echoes = Array.from({ length: 7 }, (_, i) => `echo("step", ${i});`).join('\n');
    const result = await compiler.compile(scad(`${echoes}\nx = undef + 1;\ncube(1);`));
    expect(result.ok).toBe(true);
    // OpenSCAD evaluates the assignments before the statements.
    expect(result.warnings).toEqual([
      'part.scad, line 8: undefined operation (undefined + number).',
      'part.scad echoes "step", 0.',
      'part.scad echoes "step", 1.',
      'part.scad echoes "step", 2.',
      'part.scad echoes "step", 3.',
      '… and 3 more messages from OpenSCAD.',
    ]);
  });

  it('compiles fifty files in fresh instances without growing', { timeout: 120_000 }, async () => {
    // The worker is a thread of this process: its WASM memory is in the rss.
    const rss = () => process.memoryUsage().rss / 2 ** 20;
    const plate = (size: number) =>
      scad(
        `difference() { cube([${size}, 20, 10]); translate([5, 10, -1]) cylinder(d = 6, h = 12, $fn = 64); }`,
      );
    for (let i = 0; i < 10; i++) expect((await compiler.compile(plate(20 + i))).ok).toBe(true);
    const after10 = rss();
    for (let i = 10; i < 50; i++) expect((await compiler.compile(plate(20 + i))).ok).toBe(true);
    const grown = rss() - after10;
    console.info(`40 more compiles: rss ${grown >= 0 ? '+' : ''}${grown.toFixed(0)} MB`);
    expect(grown).toBeLessThan(64);
  });

  it('stops a compile that runs past its time limit, then compiles again', {
    timeout: 60_000,
  }, async () => {
    const quick = createNodeCompiler({ timeoutMs: 1500 });
    try {
      const looping = await quick.compile(
        scad('function f(n, a = 0) = n == 0 ? a : f(n - 1, a + 1);\necho(f(1e9));\ncube(1);'),
      );
      expect(looping).toMatchObject({
        ok: false,
        error:
          'part.scad took longer than 2 s to compile, so Extrudo stopped it: simplify the model (a lower $fn, fewer minkowski steps).',
      });
      const after = await quick.compile(scad('cube(2);'));
      expect(model(after)[0]?.volume).toBeCloseTo(8, 9);
    } finally {
      quick.dispose();
    }
  });

  it('stops a compile at its memory ceiling', { timeout: 60_000 }, async () => {
    const small = createNodeCompiler({ heapMaxBytes: 64 * 1024 * 1024 });
    try {
      const result = await small.compile(
        scad(
          'minkowski() { sphere(20, $fn = 300); rotate([10, 20, 30]) cube(10, center = true); }',
        ),
      );
      expect(result).toMatchObject({
        ok: false,
        error:
          'part.scad needed more than 64 MB of memory to compile, so Extrudo stopped it: simplify the model (a lower $fn, fewer minkowski steps).',
      });
    } finally {
      small.dispose();
    }
  });
});

describe('the customizer list (P5-04 slice 2)', { timeout: 30_000 }, () => {
  it("lists a file's variables without compiling its model", async () => {
    const source = readFileSync(
      new URL('../../../fixtures/imports/customizer-plate.scad', import.meta.url),
    );
    const result = await compiler.parameters({ fileName: 'customizer-plate.scad', source });
    expect(result.ok).toBe(true);
    const parameters = result.ok ? result.parameters : [];
    expect(parameters.map((p) => [p.name, p.type, p.initial, p.group, p.caption])).toEqual([
      ['width', 'number', 40, 'Size', 'Plate width'],
      ['depth', 'number', 30, 'Size', 'Plate depth'],
      ['holes', 'number', 2, 'Holes', 'Number of holes'],
      ['hole', 'number', 4, 'Holes', "The holes' diameter"],
      ['label', 'string', 'plate', 'Holes', undefined],
      ['rounded', 'boolean', false, 'Holes', undefined],
    ]);
    expect(parameters[0]).toMatchObject({ min: 10, max: 100, step: 1 });
  });

  it('says why a file has no list', async () => {
    const result = await compiler.parameters(scad('cube(10);\nwidth = ;'));
    expect(result).toEqual({ ok: false, error: 'part.scad, line 2: syntax error.' });
  });
});

describe('a compiler whose worker could not download the WASM (ADR-0071 §4)', () => {
  it('says OpenSCAD is not downloaded yet, and tries again next time', async () => {
    let online = false;
    const compiler = new WorkerCompiler(({ reply }) => ({
      post: (message) =>
        queueMicrotask(() =>
          reply(
            (online
              ? {
                  id: message.id,
                  raw: { code: 0, lines: [], model: new Uint8Array(3), heapBytes: 0, ms: 1 },
                }
              : { id: message.id, failure: 'Failed to fetch', offline: true }) as CompileReply,
          ),
        ),
      busy: () => {},
      terminate: () => {},
    }));
    expect(await compiler.compile(scad('cube(1);', { fileName: 'gear.scad' }))).toMatchObject({
      ok: false,
      error: "OpenSCAD isn't downloaded yet: connect to the internet once to compile gear.scad.",
    });
    online = true;
    expect((await compiler.compile(scad('cube(1);'))).ok).toBe(true);
  });
});

describe('parseLog', () => {
  it('reads levels, files and lines, and leaves the noise out', () => {
    expect(
      parseLog([
        "Could not initialize localization (application path is '/').",
        'ERROR: Parser error: syntax error in file /work/gear.scad, line 12',
        "WARNING: Can't open import file '/work/part.stl', import() at line 3",
        'ECHO: "hello", 3',
        'Geometries in cache: 6',
      ]),
    ).toEqual([
      { level: 'error', text: 'syntax error', file: 'gear.scad', line: 12 },
      { level: 'warning', text: "Can't open import file '/work/part.stl'", line: 3 },
      { level: 'echo', text: '"hello", 3' },
    ]);
  });
});
