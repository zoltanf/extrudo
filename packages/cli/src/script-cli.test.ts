// A design with a Script feature through the headless library and the binary
// (P5-02 slice 2, ADR-0070 §2; ADR-0069): the CLI loads the runner in Node
// when a design has a script, `--param` changes what the script makes, and the
// file loads and saves unchanged.
//
// The design is `fixtures/scripts/plate-holes.extrudo`: a parameter `count`,
// a script that makes an 80 × 20 × 5 mm plate with `count` through holes, and a
// stored Fillet after it on one of the plate's edges, named through the
// script's own IDs (`box:f1.f1:…`). `WRITE_FIXTURES=1` rewrites it from
// `plateDesign()`; otherwise the first test checks the file still is that.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Design, edgeName } from '@extrudo/api';
import { type AttachmentId, addAttachment, loadDocument } from '@extrudo/core';
import { checkManifold, readStl } from '@extrudo/io';
import { readArchive, sha256Hex, writeArchive } from '@extrudo/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDesign } from './headless';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/extrudo.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'fixtures/scripts/plate-holes.extrudo');
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** Spawns Node with OCCT and QuickJS: a minute each. */
const SPAWNING = { timeout: 60_000 } as const;

/** The plate's volume with `count` Ø4 mm through holes. */
const plateVolume = (count: number) => 80 * 20 * 5 - count * Math.PI * 2 * 2 * 5;

const PLATE = `
const plate = design.box({ length: '80 mm', width: '20 mm', height: '5 mm' });
for (let i = 0; i < params.count; i++) {
  design.hole({ plane: plate.face('cap:end'), x: -30 + i * 10, diameter: '4 mm', extent: 'through' });
}
console.log(\`\${params.count} holes\`);
`;

/** The fixture's design. */
function plateDesign(): Design {
  const d = Design.create({
    name: 'Script plate',
    id: 'script-plate' as never,
    now: '2026-10-05T00:00:00.000Z',
  });
  d.parameter('count', '4', { comment: 'How many holes the script drills' });
  d.script({ code: PLATE });
  const box = 'box:f1.f1';
  d.fillet({
    edges: d.ref('edge', edgeName([`${box}:cap:end`, `${box}:side:front`])),
    radius: '1 mm',
  });
  return d;
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'extrudo-script-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

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

describe('a design with a script', () => {
  it('prepares a script-generated OpenSCAD import from the design’s attachment', {
    timeout: 120_000,
  }, async () => {
    const source = new TextEncoder().encode('width = 10; cube([width, 4, 5]);');
    const hash = sha256Hex(source);
    const file = 'script-scad' as AttachmentId;
    const design = Design.create();
    design.state.dispatch(
      addAttachment({
        id: file,
        attachment: {
          name: 'Block',
          fileName: 'block.scad',
          mediaType: 'application/x-openscad',
          sha256: hash,
          size: source.length,
        },
      }),
    );
    design.parameter('width', '12 mm');
    const script = design.script({
      code: `design.import({ file: '${file}', scadName: 'width', scadValue: params.width });`,
    });
    const { job } = await openDesign(
      writeArchive(design.doc, undefined, [], new Map([[hash, source]])),
    );
    try {
      const first = await job.compute();
      expect(first.errors).toBe(0);
      expect(first.features).toHaveLength(1);
      expect(first.features[0]?.script?.generated).toMatchObject([
        { type: 'import', status: 'ok' },
      ]);
      expect(first.bodies).toMatchObject([
        { id: `${script.id}.f1:0`, mesh: true, size: [12, 4, 5], volume: 240 },
      ]);
      // The warm path reuses the generated feature; a parameter edit prepares a new compile.
      expect((await job.compute()).evaluated).toBe(0);
      await job.setParameters({ width: '18 mm' });
      const changed = await job.compute();
      expect(changed.errors).toBe(0);
      expect(changed.bodies).toMatchObject([{ mesh: true, size: [18, 4, 5], volume: 360 }]);
    } finally {
      expect(await job.dispose()).toEqual({ liveShapes: 0 });
    }
  });

  it('is the fixture (WRITE_FIXTURES=1 rewrites it)', async () => {
    const bytes = await plateDesign().toFile();
    if (env.WRITE_FIXTURES === '1') {
      await mkdir(join(ROOT, 'fixtures/scripts'), { recursive: true });
      await writeFile(FIXTURE, bytes);
    }
    expect(readArchive(await readFile(FIXTURE)).doc).toEqual(readArchive(bytes).doc);
  });

  it('loads and saves round trip, through the document reader and the archive', async () => {
    const doc = readArchive(await readFile(FIXTURE)).doc;
    // As JSON, through core's reader (migrations, the schema with the `code` kind).
    const loaded = loadDocument(JSON.parse(JSON.stringify(doc)));
    expect(loaded.doc).toEqual(doc);
    expect(loaded.dropped).toEqual([]);
    // As a file, written and read again.
    expect(readArchive(writeArchive(doc)).doc).toEqual(doc);
    // Through the CLI's own job: opened, saved, opened again.
    const { job } = await openDesign(FIXTURE);
    try {
      const out = join(dir, 'saved.extrudo');
      await job.save(out);
      expect(readArchive(await readFile(out)).doc.features).toEqual(doc.features);
    } finally {
      await job.dispose();
    }
  });

  it('computes in the headless library, and a parameter changes what the script makes', {
    timeout: 60_000,
  }, async () => {
    const { job } = await openDesign(FIXTURE);
    try {
      const four = await job.compute();
      expect(four.features.map((f) => [f.name, f.status])).toEqual([
        ['Script1', 'ok'],
        ['Fillet1', 'ok'],
      ]);
      expect(four.features[0]?.script?.generated).toHaveLength(5);
      expect(four.features[0]?.script?.log).toEqual(['4 holes']);
      expect(four.bodies).toHaveLength(1);
      // The fillet takes a little off: less than the plate, more than a bare one less 2 mm³.
      const volume = four.bodies[0]?.volume ?? 0;
      expect(volume).toBeLessThan(plateVolume(4));
      expect(volume).toBeGreaterThan(plateVolume(4) - 80);

      await job.setParameters({ count: '6' });
      const six = await job.compute();
      expect(six.features.map((f) => f.status)).toEqual(['ok', 'ok']);
      expect(six.features[0]?.script?.generated).toHaveLength(7);
      expect(volume - (six.bodies[0]?.volume ?? 0)).toBeCloseTo(2 * Math.PI * 4 * 5, 6);
    } finally {
      const { liveShapes } = await job.dispose();
      expect(liveShapes).toBe(0);
    }
  });
});

describe('the binary on a design with a script', () => {
  it('lists the script and what it made', SPAWNING, async () => {
    const text = await extrudo(['info', FIXTURE]);
    expect(text.code).toBe(0);
    expect(text.stdout).toMatch(/ok\s+Script1 \(made 5 features\)/);
    expect(text.stdout).toMatch(/ok\s+Fillet1/);

    const json = await extrudo(['info', FIXTURE, '--param', 'count=2', '--json']);
    expect(json.code).toBe(0);
    const report = JSON.parse(json.stdout);
    expect(report.errors).toBe(0);
    expect(report.features[0].script.generated.map((g: { name: string }) => g.name)).toEqual([
      'Script1 › Box1',
      'Script1 › Hole1',
      'Script1 › Hole2',
    ]);
    expect(report.bodies).toHaveLength(1);
    expect(report.bodies[0].size).toEqual([80, 20, 5]);
  });

  it('exports what the script makes, as the parameter asks', SPAWNING, async () => {
    const out = join(dir, 'plate.stl');
    const result = await extrudo([
      'export',
      FIXTURE,
      '--param',
      'count=7',
      '--format',
      'stl',
      '--out',
      out,
    ]);
    expect(result.code).toBe(0);
    const mesh = readStl(new Uint8Array(await readFile(out))).mesh;
    expect(checkManifold(mesh)).toMatchObject({ ok: true, boundaryEdges: 0 });
    // The volume the triangles enclose: the plate less seven holes and the fillet.
    let volume = 0;
    const p = mesh.positions;
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map(
        (i) => (i ?? 0) * 3,
      ) as [number, number, number];
      volume +=
        ((p[a] ?? 0) * ((p[b + 1] ?? 0) * (p[c + 2] ?? 0) - (p[b + 2] ?? 0) * (p[c + 1] ?? 0)) +
          (p[a + 1] ?? 0) * ((p[b + 2] ?? 0) * (p[c] ?? 0) - (p[b] ?? 0) * (p[c + 2] ?? 0)) +
          (p[a + 2] ?? 0) * ((p[b] ?? 0) * (p[c + 1] ?? 0) - (p[b + 1] ?? 0) * (p[c] ?? 0))) /
        6;
    }
    expect(volume).toBeLessThan(plateVolume(7));
    expect(volume).toBeGreaterThan(plateVolume(7) - 100);
  });

  it('is 2 for a script that fails, with its line', SPAWNING, async () => {
    const d = Design.create({ name: 'Broken script', now: '2026-10-05T00:00:00.000Z' });
    d.script({ code: 'design.box({});\nnull.length;\n', language: 'js' });
    const path = join(dir, 'broken.extrudo');
    await writeFile(path, await d.toFile());
    const result = await extrudo(['check', path, '--json']);
    expect(result.code).toBe(2);
    const report = JSON.parse(result.stdout);
    expect(report.features[0].status).toBe('error');
    expect(report.features[0].message).toMatch(/^Line 2: /);
    expect(report.features[0].script.line).toBe(2);
  });
});
