/**
 * Every sketch of a folder of real `.FCStd` files, when one is given
 * (`FCSTD_SAMPLES=<dir>`, searched recursively; none are checked in): each
 * is placed, drawn and vetted with the real solver, and nothing kept moves.
 * `FCSTD_REPORT=<file>` (outside the repository) writes the per-sketch
 * outcomes and the totals; `FCSTD_GT=<dir>` compares each sketch's stored
 * placement with FreeCAD's own numbers (`*.json` with `file` and `stored`).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Design } from '@extrudo/api';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { describe, expect, it } from 'vitest';
import { rotate } from './final-shapes';
import { type FcObject, readFcstd } from './model';
import { decodeSketch } from './sketch-decode';
import type { LeftOut } from './sketch-map';
import { placeSketch, type SketchPlacement, sketchFrame } from './sketch-place';
import { addSketch, type SketchOutcome, sketchObjects } from './sketches';

const root = process.env.FCSTD_SAMPLES;
const reportFile = process.env.FCSTD_REPORT;
const gtDir = process.env.FCSTD_GT;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (name.toLowerCase().endsWith('.fcstd')) yield path;
  }
}

interface GtObject {
  name: string;
  type: string;
  placement?: number[];
}

/** FreeCAD's own placements per file name and object, from the ground-truth folder. */
function groundTruth(dir: string): Map<string, Map<string, number[]>> {
  const out = new Map<string, Map<string, number[]>>();
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const d = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
      file: string;
      stored: GtObject[];
    };
    const per = new Map<string, number[]>();
    for (const o of d.stored) if (o.placement) per.set(o.name, o.placement);
    out.set(basename(d.file), per);
  }
  return out;
}

describe.skipIf(!root)("a folder of real .FCStd files' sketches", () => {
  it('places, draws and vets every sketch without moving it', async () => {
    const planegcs = await loadPlanegcs();
    const solver = new SketchSolver(planegcs);
    const gt = gtDir ? groundTruth(gtDir) : undefined;
    const rows: (SketchOutcome & {
      file: string;
      imported: boolean;
      reason?: string;
      ms: number;
      gtPlacement?: number;
    })[] = [];
    const sizes = { geometry: 0, constraints: 0, poles: 0 };
    let started = Date.now();
    let worstMap = 0;
    try {
      for (const path of walk(root as string)) {
        const doc = readFcstd(new Uint8Array(readFileSync(path)));
        const design = Design.create();
        const file = basename(path);
        for (const o of sketchObjects(doc)) {
          sizes.geometry = Math.max(sizes.geometry, recordCount(o, 'Geometry'));
          sizes.constraints = Math.max(sizes.constraints, recordCount(o, 'Constraints'));
          for (const g of decodeSketch(o).geometry)
            if (g?.kind === 'bspline') sizes.poles = Math.max(sizes.poles, g.poles.length);
          // The 2D map lands FreeCAD's sketch points where FreeCAD's frame puts them.
          const frame = sketchFrame(doc, o);
          const where = placeSketch(Design.create(), frame.global, o.name);
          if (where) worstMap = Math.max(worstMap, mapError(where));
          started = Date.now();
          const r = addSketch(design, doc, o, { solver });
          const ms = Date.now() - started;
          const fc = gt?.get(file)?.get(o.name);
          const stored = o.properties.Placement?.value;
          let gtPlacement: number | undefined;
          if (fc && stored?.kind === 'placement') {
            const p = stored.value;
            // q and −q are the same rotation.
            const q = p.rotation;
            const sign =
              q[0] * (fc[3] ?? 0) +
                q[1] * (fc[4] ?? 0) +
                q[2] * (fc[5] ?? 0) +
                q[3] * (fc[6] ?? 0) <
              0
                ? -1
                : 1;
            gtPlacement = Math.max(
              ...p.position.map((v, i) => Math.abs(v - (fc[i] ?? 0))),
              ...q.map((v, i) => Math.abs(sign * v - (fc[3 + i] ?? 0))),
            );
          }
          rows.push({
            file,
            imported: r.imported,
            ...(r.imported ? {} : { reason: r.reason }),
            ms,
            ...(gtPlacement !== undefined ? { gtPlacement } : {}),
            ...r.outcome,
          });
        }
      }
    } finally {
      solver.dispose();
    }
    const placed = rows.filter((r) => r.imported);
    const sum = (list: typeof rows, f: (r: (typeof rows)[number]) => number) =>
      list.reduce((a, r) => a + f(r), 0);
    const leftOut: Partial<Record<LeftOut, number>> = {};
    const byType: Record<
      string,
      { mapped: number; total: number; leftOut: Record<string, number> }
    > = {};
    for (const r of placed) {
      for (const [k, n] of Object.entries(r.constraints.leftOut))
        leftOut[k as LeftOut] = (leftOut[k as LeftOut] ?? 0) + (n ?? 0);
      for (const [t, e] of Object.entries(r.constraints.byType)) {
        const entry = byType[t] ?? { mapped: 0, total: 0, leftOut: {} };
        byType[t] = entry;
        entry.mapped += e.mapped;
        entry.total += e.mapped;
        for (const [k, n] of Object.entries(e.leftOut)) {
          entry.leftOut[k] = (entry.leftOut[k] ?? 0) + (n ?? 0);
          entry.total += n ?? 0;
        }
      }
    }
    const geometryLeftOut: Record<string, number> = {};
    const drawn: Record<string, number> = {};
    for (const r of placed) {
      for (const [k, n] of Object.entries(r.geometryLeftOut))
        geometryLeftOut[k] = (geometryLeftOut[k] ?? 0) + n;
      for (const [k, n] of Object.entries(r.drawn)) drawn[k] = (drawn[k] ?? 0) + n;
    }
    const totals = {
      sketches: rows.length,
      placed: placed.length,
      notPlaced: rows.filter((r) => !r.imported).map((r) => `${r.file} ${r.sketch}: ${r.reason}`),
      planes: placed.reduce<Record<string, number>>((a, r) => {
        a[r.plane as string] = (a[r.plane as string] ?? 0) + 1;
        return a;
      }, {}),
      mirrored: placed.filter((r) => r.mirrored).length,
      axes: placed.reduce<Record<string, number>>((a, r) => {
        a[r.axes as string] = (a[r.axes as string] ?? 0) + 1;
        return a;
      }, {}),
      inContainer: rows.filter((r) => r.containers > 0).length,
      inMovedContainer: rows.filter((r) => r.movedContainer).length,
      constraintsAll: sum(rows, (r) => r.constraints.total),
      constraintsPlaced: sum(placed, (r) => r.constraints.total),
      mapped: sum(placed, (r) => r.constraints.mapped),
      leftOut,
      byType,
      drawn,
      geometryLeftOut,
      bindings: sum(rows, (r) => r.bindings.length),
      bindingsOnDimensions: sum(rows, (r) => r.bindings.filter((b) => b.dimension).length),
      maxDisplacement: Math.max(0, ...placed.map((r) => r.maxDisplacement)),
      moved: placed.filter((r) => r.maxDisplacement > 1e-6).length,
      fullyConstrained: placed.filter((r) => r.dof === 0).length,
      slowest: Math.max(0, ...rows.map((r) => r.ms)),
      totalMs: sum(rows, (r) => r.ms),
      gtCompared: rows.filter((r) => r.gtPlacement !== undefined).length,
      gtWorst: Math.max(0, ...rows.map((r) => r.gtPlacement ?? 0)),
      gtOff: rows
        .filter((r) => (r.gtPlacement ?? 0) > 2e-6)
        .map((r) => `${r.file} ${r.sketch} ${r.gtPlacement}`),
      sizes,
      worstMap,
      problems: sum(rows, (r) => r.problems.length),
    };
    if (reportFile) writeFileSync(reportFile, `${JSON.stringify({ totals, rows }, null, 1)}\n`);
    expect(rows.length).toBeGreaterThan(0);
    // With vetting, nothing kept moves.
    expect(totals.moved).toBe(0);
    expect(worstMap).toBeLessThan(1e-6);
  }, 900_000);
});

function recordCount(o: FcObject, property: string): number {
  const v = o.properties[property]?.value;
  return v?.kind === 'geometry' || v?.kind === 'constraints' ? v.records.length : 0;
}

/** How far the 2D map puts a few sketch points from where FreeCAD's world frame does (mm). */
function mapError(p: SketchPlacement): number {
  let worst = 0;
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [137.5, -42.25],
  ] as const) {
    const fc = rotate(p.global.rotation, [u, v, 0]).map((x, i) => x + (p.global.position[i] ?? 0));
    const [x, y] = p.map(u, v);
    const f = p.frame;
    const ex = [0, 1, 2].map((i) => (f.origin[i] ?? 0) + x * (f.x[i] ?? 0) + y * (f.y[i] ?? 0));
    worst = Math.max(worst, Math.hypot(...fc.map((c, i) => c - (ex[i] ?? 0))));
  }
  return worst;
}
