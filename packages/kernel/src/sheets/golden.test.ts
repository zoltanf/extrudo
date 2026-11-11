// The four standard views (front, top, right, isometric; first angle, as a
// new sheet gets) of the templates' fixtures (B2, B4, B5) and of the S0 view
// fixtures (B7, B10) through `RecomputeEngine.sheetView`, as golden SVGs
// (P6-24 S2, ADR-0143's S2 amendment): one file per fixture, the four views
// at one scale, visible lines solid, outlines solid, tangent edges thin,
// hidden lines dashed. Open them in a browser to review. Rewrite with
//   pnpm vitest run packages/kernel/src/sheets/golden --update
// and look at the diff and the pictures. `SHEET_TIMES=1` prints each view's
// time, exact and quick; `SHEET_QUICK=<dir>` writes the quick placeholders
// there to compare.
import {
  type ExtrudoDocument,
  loadDocument,
  type SheetViewFrame,
  sheetBaseFrame,
  sheetProjectedFrame,
  sheetStandardFrom,
} from '@extrudo/core';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import b2 from '../../../../fixtures/benchmarks/b2-storage-box.extrudo?url&inline';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import b7 from '../../../../fixtures/benchmarks/b7-knurled-knob.extrudo?url&inline';
import b10 from '../../../../fixtures/benchmarks/b10-chain-link.extrudo?url&inline';
import { kernelFeatures } from '../features';
import { Kernel } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import type { ViewCurve, ViewGeometry, ViewPiece } from './geometry';

const ENV =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

function load(dataUrl: string): ExtrudoDocument {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const json = unzipSync(Uint8Array.from(binary, (c) => c.charCodeAt(0)))['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

const FIXTURES: [string, string][] = [
  ['b2-storage-box', b2],
  ['b4-box-with-lid', b4],
  ['b5-pcb-enclosure', b5],
  ['b7-knurled-knob', b7],
  ['b10-chain-link', b10],
];

const { direction, up } = sheetStandardFrom('front');
const front = sheetBaseFrame(direction, up);
/** First angle: the top view goes below the front, the right side's view to its left. */
const VIEWS: [string, SheetViewFrame][] = [
  ['front', front],
  ['right', sheetProjectedFrame(front, 'first', 'left')],
  ['top', sheetProjectedFrame(front, 'first', 'below')],
  ['iso', sheetProjectedFrame(front, 'first', 'iso-above-right')],
];

const n = (v: number) => {
  const r = Math.round(v * 100) / 100 + 0;
  return String(r);
};

/** SVG path data for a piece, y flipped (the SVG's y runs down). */
function path(p: ViewPiece, map: (x: number, y: number) => [number, number]): string {
  const at = (x: number, y: number) => {
    const [u, v] = map(x, y);
    return `${n(u)} ${n(v)}`;
  };
  switch (p.type) {
    case 'line':
      return `M${at(...p.a)}L${at(...p.b)}`;
    case 'polyline':
      return p.points.map((q, i) => `${i === 0 ? 'M' : 'L'}${at(...q)}`).join('');
    default: {
      const [rx, ry, rot] = p.type === 'arc' ? [p.radius, p.radius, 0] : [p.rx, p.ry, p.rotation];
      const [cx, cy] = p.center;
      const point = (s: number): [number, number] => {
        const [x, y] = [rx * Math.cos(s), ry * Math.sin(s)];
        return [
          cx + x * Math.cos(rot) - y * Math.sin(rot),
          cy + x * Math.sin(rot) + y * Math.cos(rot),
        ];
      };
      const [sx, sy] = map(1, 0);
      const [ox, oy] = map(0, 0);
      const scale = Math.hypot(sx - ox, sy - oy);
      // At most half a turn per SVG arc. Counter-clockwise with y up still
      // looks counter-clockwise once y is flipped: SVG's sweep flag 0.
      const steps = Math.ceil((p.end - p.start) / Math.PI - 1e-9);
      let d = `M${at(...point(p.start))}`;
      for (let i = 1; i <= steps; i++) {
        const s = p.start + ((p.end - p.start) * i) / steps;
        d += `A${n(rx * scale)} ${n(ry * scale)} ${n((-rot * 180) / Math.PI)} 0 0 ${at(...point(s))}`;
      }
      return d;
    }
  }
}

const STYLE: Record<ViewCurve['kind'], string> = {
  visible: 'stroke="#000" stroke-width="0.35"',
  outline: 'stroke="#000" stroke-width="0.35"',
  tangent: 'stroke="#666" stroke-width="0.18"',
  hidden: 'stroke="#555" stroke-width="0.18" stroke-dasharray="1.5 0.8"',
};

/** One A3-wide picture: the four views in a 2 × 2 grid at one scale, labelled. */
function svg(name: string, views: [string, ViewGeometry][]): string {
  const [cw, ch] = [200, 130];
  const sizes = views.map(([, g]): [number, number] =>
    g.bounds ? [g.bounds.max[0] - g.bounds.min[0], g.bounds.max[1] - g.bounds.min[1]] : [1, 1],
  );
  const scale = Math.min(...sizes.map(([w, h]) => Math.min((cw - 20) / w, (ch - 25) / h)));
  const body: string[] = [];
  views.forEach(([label, g], i) => {
    const [x0, y0] = [(i % 2) * cw, Math.floor(i / 2) * ch];
    const b = g.bounds ?? { min: [0, 0], max: [0, 0] };
    const [mx, my] = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
    const map = (x: number, y: number): [number, number] => [
      x0 + cw / 2 + (x - mx) * scale,
      y0 + (ch - 10) / 2 - (y - my) * scale,
    ];
    body.push(
      `<text x="${x0 + 4}" y="${y0 + ch - 4}" font-size="4" fill="#000" stroke="none">${label}</text>`,
    );
    // Hidden lines first, so the drawn ones lie over them.
    const order = [...g.curves].sort(
      (a, c) => Number(c.kind === 'hidden') - Number(a.kind === 'hidden'),
    );
    for (const c of order) {
      const d = c.pieces.map((p) => path(p, map)).join('');
      body.push(`<path ${STYLE[c.kind]} d="${d}"/>`);
    }
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * cw}mm" height="${2 * ch}mm" viewBox="0 0 ${2 * cw} ${2 * ch}">`,
    `<title>${name}: front, right, top, iso (first angle), 1:${n(1 / scale)}</title>`,
    `<rect width="${2 * cw}" height="${2 * ch}" fill="#fff"/>`,
    '<g fill="none" stroke-linecap="round" stroke-linejoin="round">',
    ...body,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}

let kernel: Kernel;
const times: string[] = [];
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});
afterAll(() => {
  if (ENV.SHEET_TIMES) console.log(times.join('\n'));
  kernel?.dispose();
});

describe('the standard views of the templates and the S0 fixtures', () => {
  for (const [name, dataUrl] of FIXTURES) {
    it(name, { timeout: 120_000 }, async () => {
      const engine = new RecomputeEngine(kernel, kernelFeatures(), { strictLeaks: true });
      const result = await engine.recompute({ doc: load(dataUrl) });
      if (result.status !== 'done') throw new Error(result.status);
      const views: [string, ViewGeometry][] = [];
      const quicks: [string, ViewGeometry][] = [];
      for (const [label, frame] of VIEWS) {
        const request = { id: label, direction: frame.direction, up: frame.up };
        const quick = engine.sheetView({ ...request, quick: true });
        const exact = engine.sheetView(request);
        if ('error' in exact) throw new Error(exact.error);
        if ('error' in quick) throw new Error(quick.error);
        expect(exact.geometry.status).toBe('ok');
        expect(exact.geometry.curves.length).toBeGreaterThan(0);
        // Every exact curve from a model edge or a face is named.
        for (const c of exact.geometry.curves) expect(c.edge ?? c.face).toBeDefined();
        times.push(
          `${name.padEnd(18)} ${label.padEnd(6)} exact ${exact.ms.toFixed(1).padStart(8)} ms  quick ${quick.ms.toFixed(1).padStart(6)} ms  curves ${exact.geometry.curves.length}`,
        );
        views.push([label, exact.geometry]);
        quicks.push([label, quick.geometry]);
      }
      engine.clear();
      // The quick placeholders beside them, for a look (not golden): SHEET_QUICK=<dir>.
      if (ENV.SHEET_QUICK) {
        const fs = (
          globalThis as {
            process?: {
              getBuiltinModule(id: string): { writeFileSync(p: string, d: string): void };
            };
          }
        ).process?.getBuiltinModule('node:fs');
        fs?.writeFileSync(`${ENV.SHEET_QUICK}/${name}-quick.svg`, svg(`${name} (quick)`, quicks));
      }
      await expect(svg(name, views)).toMatchFileSnapshot(`./golden/${name}.svg`);
    });
  }
});
