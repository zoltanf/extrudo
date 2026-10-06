// The command line of P5-03 (ADR-0069 §3) as a program: each test spawns
// `node packages/cli/bin/extrudo.mjs` on a fixture in a temporary directory
// and reads what it wrote and what it returned, so the binary, its exit codes
// and its `--json` are what is tested, not the library under them (that is
// `headless.test.ts`).

import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Design } from '@extrudo/api';
import { type AttachmentId, addAttachment } from '@extrudo/core';
import { checkManifold, read3mf, readStl } from '@extrudo/io';
import { sha256Hex, writeArchive } from '@extrudo/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/extrudo.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The benchmark fixtures, B1 to B10 (P2-17, P3-14, P4-11). */
const BENCHMARKS = [
  'b1-plate',
  'b2-storage-box',
  'b3-phone-stand',
  'b4-box-with-lid',
  'b5-pcb-enclosure',
  'b6-wall-hook',
  'b7-knurled-knob',
  'b8-name-tag',
  'b9-bottle-cap',
  'b10-chain-link',
];

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'extrudo-cli-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A copy of a fixture in the temporary directory, so nothing writes over it. */
async function fixture(name: string, as = name): Promise<string> {
  const path = join(dir, `${as}.extrudo`);
  await copyFile(join(ROOT, 'fixtures/benchmarks', `${name}.extrudo`), path);
  return path;
}

/**
 * Every case spawns Node processes that load the OCCT WASM, which is well over
 * Vitest's 5 s default when everything runs in parallel; each gets a minute.
 */
const SPAWNING = { timeout: 60_000 } as const;

/** Runs the CLI; the exit code is part of what the commands promise. */
async function extrudo(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run('node', [BIN, ...args], { maxBuffer: 32 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
    };
  }
}

describe('extrudo info', () => {
  it("lists B4's parameters, features and bodies, as text and as JSON", SPAWNING, async () => {
    const design = await fixture('b4-box-with-lid');
    const text = await extrudo(['info', design]);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain('B4 Box with lid');
    expect(text.stdout).toContain('clearance');
    expect(text.stdout).toContain('Shell1');
    expect(text.stdout).toMatch(/Box\s+60\.00 × 40\.00 × 30\.00 mm/);

    const json = await extrudo(['info', design, '--json']);
    expect(json.code).toBe(0);
    const report = JSON.parse(json.stdout);
    expect(report.name).toBe('B4 Box with lid');
    expect(report.units).toBe('mm');
    expect(
      report.parameters
        .filter((p: { owner: string }) => p.owner === 'user')
        .map((p: { name: string }) => p.name),
    ).toEqual([
      'length',
      'width',
      'height',
      'wall',
      'clearance',
      'lid',
      'lip',
      'bevel',
      'rounding',
    ]);
    expect(report.parameters.find((p: { name: string }) => p.name === 'clearance')).toEqual({
      name: 'clearance',
      expression: '0.2 mm',
      value: 0.2,
      unit: 'length',
      owner: 'user',
    });
    // The model's own parameters are listed too: `--param` takes them. B4 has
    // no sketches, so what it has are its features' own inputs.
    expect(
      report.parameters.filter((p: { owner: string }) => p.owner === 'feature').length,
    ).toBeGreaterThan(0);
    expect(report.errors).toBe(0);
    expect(report.features.map((f: { name: string }) => f.name)).toEqual([
      'Offset Plane1',
      'Box1',
      'Shell1',
      'Chamfer1',
      'Box2',
      'Box3',
      'Fillet1',
    ]);
    expect(report.bodies.map((b: { name: string }) => b.name)).toEqual(['Box', 'Lid']);
    expect(report.bodies[0].size).toEqual([60, 40, 30]);
  });

  it('computes with a changed parameter, and names what it did', SPAWNING, async () => {
    const design = await fixture('b2-storage-box');
    const json = await extrudo(['info', design, '--param', 'wall=5mm', '--json']);
    expect(json.code).toBe(0);
    const report = JSON.parse(json.stdout);
    expect(report.parameters.find((p: { name: string }) => p.name === 'wall')).toMatchObject({
      // The expression is stored as it was typed, as the app's field stores it.
      expression: '5mm',
      value: 5,
    });
    // Thicker walls are more matter: 80 x 60 x 40 less a 70 x 50 x 36 cavity.
    expect(report.bodies[0].volume).toBeCloseTo(80 * 60 * 40 - 70 * 50 * 36, 1);
  });
});

describe('extrudo export', () => {
  it('writes one STL per body, and every one is closed and readable', SPAWNING, async () => {
    const design = await fixture('b4-box-with-lid');
    const result = await extrudo([
      'export',
      design,
      '--format',
      'stl',
      '--param',
      'clearance=0.4mm',
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('B4 Box with lid - Box.stl');
    expect(result.stdout).toContain('B4 Box with lid - Lid.stl');
    for (const body of ['Box', 'Lid']) {
      const bytes = await readFile(join(dir, `B4 Box with lid - ${body}.stl`));
      const mesh = readStl(new Uint8Array(bytes)).mesh;
      expect(checkManifold(mesh)).toMatchObject({ ok: true, boundaryEdges: 0 });
      expect(mesh.positions.length / 3).toBeGreaterThan(4);
    }
  });

  it('writes one file where --out names one, in the format asked for', SPAWNING, async () => {
    const design = await fixture('b2-storage-box');
    const out = join(dir, 'box.3mf');
    const result = await extrudo([
      'export',
      design,
      '--format',
      '3mf',
      '--bodies',
      'Body1',
      '--resolution',
      'coarse',
      '--out',
      out,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.files).toHaveLength(1);
    expect(report.files[0]).toMatchObject({ path: out, bodies: ['Body1'], closed: true });
    const bytes = await readFile(out);
    expect(bytes.length).toBe(report.files[0].bytes);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
  });

  it('writes a STEP file of the bodies, each a named product', SPAWNING, async () => {
    const design = await fixture('b4-box-with-lid');
    const out = join(dir, 'box-and-lid.step');
    const result = await extrudo(['export', design, '--format', 'step', '--out', out]);
    expect(result.code).toBe(0);
    const text = await readFile(out, 'utf8');
    expect(text).toContain('FILE_SCHEMA');
    expect(text).toContain('Box');
    expect(text).toContain('Lid');
  });

  it('is 2 about a body the design does not have', SPAWNING, async () => {
    const design = await fixture('b4-box-with-lid');
    const result = await extrudo(['export', design, '--format', 'stl', '--bodies', 'Nope']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('There is no body "Nope" in this design. It has: Box, Lid.');
  });

  it('is 2 about a design with nothing to export', SPAWNING, async () => {
    const design = await fixture('b1-plate');
    const result = await extrudo(['export', design, '--format', '3mf']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('no bodies to export');
  });
});

describe('extrudo set', () => {
  it('writes a design that opens with the change in it', SPAWNING, async () => {
    const design = await fixture('b2-storage-box');
    const out = join(dir, 'box-5mm.extrudo');
    const result = await extrudo(['set', design, '--param', 'wall=5mm', '--out', out]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(out);
    // The file the command wrote opens and computes, with the new value.
    const info = await extrudo(['info', out, '--json']);
    expect(info.code).toBe(0);
    expect(
      JSON.parse(info.stdout).parameters.find((p: { name: string }) => p.name === 'wall'),
    ).toMatchObject({ name: 'wall', expression: '5mm', value: 5, unit: 'length', owner: 'user' });
    // The design it came from is as it was.
    const before = await extrudo(['info', design, '--json']);
    expect(
      JSON.parse(before.stdout).parameters.find((p: { name: string }) => p.name === 'wall'),
    ).toMatchObject({ name: 'wall', expression: '3 mm', value: 3, unit: 'length' });
  });

  it('keeps what the file carried, and needs --out', SPAWNING, async () => {
    const design = await fixture('b8-name-tag');
    const out = join(dir, 'tag.extrudo');
    expect((await extrudo(['set', design, '--out', out])).code).toBe(0);
    const bytes = await readFile(out);
    // The thumbnail and the fonts of the design travel with it (ADR-0061).
    expect(bytes.length).toBeGreaterThan(1000);
    expect((await extrudo(['info', out, '--json'])).code).toBe(0);
    const missing = await extrudo(['set', design, '--param', 'length=70mm']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('extrudo set needs --out');
  });
});

describe('extrudo check', () => {
  it('is 0 for a design that computes', SPAWNING, async () => {
    const design = await fixture('b1-plate');
    const result = await extrudo(['check', design]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('no errors');
  });

  it('is 2 for a design with a feature in error, and says which', SPAWNING, async () => {
    // A fillet with no edges: the app's own "Pick at least one edge to round".
    const design = Design.create({ name: 'Broken' });
    design.box({ length: '20 mm', width: '10 mm', height: '5 mm' });
    design.fillet({ edges: [], radius: '2 mm' });
    const path = join(dir, 'broken.extrudo');
    await writeFile(path, writeArchive(design.doc));

    const result = await extrudo(['check', path]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('1 errors');
    expect(result.stderr).toContain('Fillet1:');

    const json = await extrudo(['check', path, '--json']);
    expect(json.code).toBe(2);
    const report = JSON.parse(json.stdout);
    expect(report.ok).toBe(false);
    expect(report.errors).toBe(1);
    expect(report.features.find((f: { name: string }) => f.name === 'Fillet1').status).toBe(
      'error',
    );
  });

  it('checks the design as the parameters ask for it', SPAWNING, async () => {
    const design = await fixture('b4-box-with-lid');
    const result = await extrudo(['check', design, '--param', 'clearance=0.4mm', '--json']);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.bodies.map((b: { name: string }) => b.name)).toEqual(['Box', 'Lid']);
  });
});

describe('a design with an OpenSCAD import (P5-04, ADR-0071)', () => {
  it(
    'exports it with an override bound to a parameter, set from the command line',
    SPAWNING,
    async () => {
      // plate.scad's `size` follows the design's `width`.
      const source = new Uint8Array(await readFile(join(ROOT, 'fixtures/imports/plate.scad')));
      const hash = sha256Hex(source);
      const design = Design.create({ name: 'Plate' });
      design.parameter('width', '30 mm');
      design.state.dispatch(
        addAttachment({
          id: 'a1sc' as AttachmentId,
          attachment: {
            name: 'Plate',
            fileName: 'plate.scad',
            mediaType: 'application/x-openscad',
            sha256: hash,
            size: source.length,
          },
        }),
      );
      design.import({
        file: 'a1sc' as AttachmentId,
        scadName: 'size',
        scadValue: { kind: 'expr', expr: 'width', unit: 'length' },
      });
      const path = join(dir, 'plate.extrudo');
      await writeFile(path, writeArchive(design.doc, undefined, [], new Map([[hash, source]])));

      const out = join(dir, 'plate.3mf');
      const result = await extrudo([
        'export',
        path,
        '--format',
        '3mf',
        '--param',
        'width=50mm',
        '--out',
        out,
      ]);
      expect(result.code).toBe(0);
      const [object] = read3mf(new Uint8Array(await readFile(out))).objects;
      const check = checkManifold(object?.mesh as Parameters<typeof checkManifold>[0]);
      expect(check.ok).toBe(true);
      // 50 × 50 × 10 less the Ø8 hole's 64-gon.
      const hole = 0.5 * 64 * 16 * Math.sin((2 * Math.PI) / 64) * 10;
      expect(check.volume).toBeCloseTo(50 * 50 * 10 - hole, 1);
    },
  );
});

describe('the command line itself', () => {
  it('is 1 about a usage mistake, with the usage', SPAWNING, async () => {
    const design = await fixture('b1-plate');
    const cases: [readonly string[], string][] = [
      [[], 'needs a command and a design file'],
      [['frobnicate', design], 'There is no "frobnicate" command'],
      [['info'], 'extrudo info needs a design file'],
      [['export', design], 'needs --format'],
      [['export', design, '--format', 'obj'], '--format takes stl, 3mf or step'],
      [['export', design, '--format', 'stl', '--param', 'width'], '--param takes name=expression'],
      [['export', design, '--format', 'stl', '--resolution', 'smooth'], '--resolution takes'],
      [['check', design, '--format', 'stl'], '--format is for extrudo export'],
      [['info', design, '--nonsense'], 'nonsense'],
    ];
    for (const [args, expected] of cases) {
      const result = await extrudo(args);
      expect(result.code, `extrudo ${args.join(' ')}`).toBe(1);
      expect(result.stderr, `extrudo ${args.join(' ')}`).toContain(expected);
      expect(result.stderr).toContain('Usage:');
    }
  });

  it('is 1 about a parameter the design does not have or cannot read', SPAWNING, async () => {
    const design = await fixture('b4-box-with-lid');
    const unknown = await extrudo(['info', design, '--param', 'clearence=0.4mm']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('There is no parameter "clearence" in this design.');
    const bad = await extrudo(['info', design, '--param', 'clearance=wide']);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/^extrudo: clearance: /m);
  });

  it("sets a driving dimension's own parameter, and refuses a feature's", SPAWNING, async () => {
    // B2 holds both kinds: d1 is Sketch1's width dimension and d3 is Extrude1's
    // own distance (ADR-0016's three parameter owners).
    const design = await fixture('b2-storage-box');
    const dimension = await extrudo(['info', design, '--param', 'd1=40mm', '--json']);
    expect(dimension.code).toBe(0);
    const report = JSON.parse(dimension.stdout);
    expect(report.parameters.find((p: { name: string }) => p.name === 'd1')).toMatchObject({
      owner: 'dimension',
      of: "Sketch1's dimension",
    });
    // The sketch followed: the block is 40 mm wide now.
    expect(report.bodies[0].size).toEqual([40, 60, 40]);

    // A feature input's own parameter is not a parameter a person sets.
    const plain = await extrudo(['info', design, '--json']);
    const input = JSON.parse(plain.stdout).parameters.find(
      (p: { owner: string }) => p.owner === 'feature',
    );
    expect(input?.of).toBe("Extrude1's distance");
    const refused = await extrudo(['check', design, '--param', `${input?.name}=40mm`]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('own parameter for "distance"');
  });

  it('is 3 about a file it cannot read or write', SPAWNING, async () => {
    const missing = await extrudo(['info', join(dir, 'nothing.extrudo')]);
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain('There is no file at');
    const notADesign = join(dir, 'notes.extrudo');
    await writeFile(notADesign, 'this is not a design');
    const broken = await extrudo(['info', notADesign]);
    expect(broken.code).toBe(3);
    expect(broken.stderr).toContain('Extrudo');
    const design = await fixture('b1-plate');
    // `set` writes the file it is given and says so when it can't.
    const refused = await extrudo([
      'set',
      design,
      '--out',
      join(dir, 'no-folder', 'design.extrudo'),
    ]);
    expect(refused.code).toBe(3);
    expect(refused.stderr).toContain('no-folder');
    // `export` makes the folder it writes into, but not one under a file.
    const box = await fixture('b4-box-with-lid', 'with-bodies');
    const made = join(dir, 'made', 'design.3mf');
    expect((await extrudo(['export', box, '--format', '3mf', '--out', made])).code).toBe(0);
    const notADirectory = await extrudo([
      'export',
      box,
      '--format',
      '3mf',
      '--out',
      join(dir, 'notes.extrudo', 'design.3mf'),
    ]);
    expect(notADirectory.code).toBe(3);
    expect(notADirectory.stderr).toContain('notes.extrudo');
  });

  it('prints its version and its usage', SPAWNING, async () => {
    const version = await extrudo(['--version']);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    const usage = await extrudo(['--help']);
    expect(usage.code).toBe(0);
    expect(usage.stdout).toContain('extrudo export <design.extrudo>');
    expect(usage.stdout).toContain('Exit codes:');
  });
});

describe('the time an export takes', { timeout: 600_000 }, () => {
  it('computes every benchmark design and writes a 3MF', SPAWNING, async () => {
    const times: [string, number][] = [];
    for (const name of BENCHMARKS) {
      const design = await fixture(name);
      const out = join(dir, `${name}.3mf`);
      const started = Date.now();
      const result = await extrudo(['export', design, '--format', '3mf', '--out', out, '--json']);
      const seconds = (Date.now() - started) / 1000;
      times.push([name, seconds]);
      // B1 is a sketch with nothing to extrude: it computes, and there is
      // nothing to write, which says so.
      if (name === 'b1-plate') {
        expect(result.code).toBe(2);
        expect(result.stderr).toContain('no bodies to export');
        continue;
      }
      expect(result.code, `${name}: ${result.stderr}`).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.files[0].closed, `${name} is not closed`).toBe(true);
      expect(report.files[0].bodies.length).toBeGreaterThan(0);
    }
    const table = times.map(([name, seconds]) => `${name} ${seconds.toFixed(1)}s`).join(', ');
    console.log(`export times: ${table}`);
  });
});
