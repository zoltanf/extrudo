// A look at hidden-line spans (P6-24 S0, ADR-0143's amendment): four views
// (front, top, right, isometric) of some benchmark fixtures, drawn from
// `Kernel.hlrSpans` with visible lines solid and hidden ones dashed, one A3
// page per fixture through `writePdf`. Gated; writes the file it is given:
//   HLR_PDF=/some/dir/views.pdf pnpm vitest run packages/kernel/src/hlr-views
import { type BodyId, type ExtrudoDocument, loadDocument } from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import { type Contour, type PdfItem, type PdfPage, writePdf } from '@extrudo/io';
import { loadFont } from '@extrudo/sketch/text';
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, it } from 'vitest';
import b4 from '../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url&inline';
import b5 from '../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url&inline';
import b7 from '../../../fixtures/benchmarks/b7-knurled-knob.extrudo?url&inline';
import b10 from '../../../fixtures/benchmarks/b10-chain-link.extrudo?url&inline';
import interRegular from '../../fonts/fonts/inter-regular.ttf?url&inline';
import { kernelFeatures } from './features';
import { type EdgeGeometry, type HlrEdge, Kernel, type ShapeHandle, type Vec3 } from './kernel';
import { loadOcct } from './occt/load';
import { RecomputeEngine } from './recompute/engine';

function bytesOf(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
function load(dataUrl: string): ExtrudoDocument {
  const json = unzipSync(bytesOf(dataUrl))['document.json'];
  if (!json) throw new Error('no document.json');
  return loadDocument(JSON.parse(strFromU8(json))).doc;
}

const ENV =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const s3 = 1 / Math.sqrt(3);
/** View direction (towards the eye) and up, first-angle placement is not the point here. */
const VIEWS: [string, Vec3, Vec3][] = [
  ['front', [0, -1, 0], [0, 0, 1]],
  ['top', [0, 0, 1], [0, 1, 0]],
  ['right', [1, 0, 0], [0, 0, 1]],
  ['iso', [s3, -s3, s3], [0, 0, 1]],
];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Points of a curve between parameters t0 and t1 of its range. */
function along(g: EdgeGeometry, range: [number, number], t0: number, t1: number, n = 48): Vec3[] {
  if (g.type === 'degenerate') return [];
  const at = (t: number): Vec3 => {
    const c = g.conic;
    if (c && (g.type === 'circle' || g.type === 'ellipse')) {
      const y = cross(c.axis, c.xDirection);
      const a = c.radius * Math.cos(t);
      const b = (c.minor ?? c.radius) * Math.sin(t);
      const x = c.xDirection;
      return [
        c.center[0] + a * x[0] + b * y[0],
        c.center[1] + a * x[1] + b * y[1],
        c.center[2] + a * x[2] + b * y[2],
      ];
    }
    // Lines and other curves: by fraction of the range along the sampled points.
    const f = (t - range[0]) / (range[1] - range[0] || 1);
    const pts = g.points;
    const x = Math.min(Math.max(f, 0), 1) * (pts.length - 1);
    const i = Math.min(Math.floor(x), pts.length - 2);
    const p = pts[i] as Vec3;
    const q = pts[i + 1] as Vec3;
    const u = x - i;
    return [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
  };
  const k = g.type === 'line' ? 1 : n;
  return Array.from({ length: k + 1 }, (_, i) => at(t0 + ((t1 - t0) * i) / k));
}

describe.runIf(ENV.HLR_PDF)('hidden-line views drawn', () => {
  beforeAll(() => loadFont(DEFAULT_FONT, bytesOf(interRegular)));

  it('draws four views per fixture', { timeout: 600_000 }, async () => {
    const pages: PdfPage[] = [];
    for (const [name, dataUrl] of [
      ['B4', b4],
      ['B5', b5],
      ['B7', b7],
      ['B10', b10],
    ] as const) {
      const kernel = new Kernel(await loadOcct());
      const doc = load(dataUrl);
      const engine = new RecomputeEngine(kernel, kernelFeatures());
      const result = await engine.recompute({ doc });
      if (result.status !== 'done') throw new Error(result.status);
      const held = engine.hold(result.bodies.map((b) => b.id as BodyId));
      const shapes = held.shapes.filter((x): x is ShapeHandle => x !== undefined);
      const all = kernel.compound(shapes);
      const geometry = new Map<number, EdgeGeometry>();
      const items: PdfItem[] = [];
      VIEWS.forEach(([, d, up], v) => {
        const right = unit(cross(up, d));
        const top = cross(d, right);
        const lines: { pts: [number, number][]; hidden: boolean }[] = [];
        for (const e of kernel.hlrSpans(all, d, 64) as HlrEdge[]) {
          if (e.kind === 'seam') continue;
          let g = e.curve;
          if (!g && e.edge !== undefined) {
            g = geometry.get(e.edge) ?? kernel.edgeGeometry(all, e.edge, 96);
            geometry.set(e.edge, g);
          }
          if (!g) continue;
          for (const [list, hidden] of [
            [e.visible, false],
            [e.hidden, true],
          ] as const) {
            for (const [t0, t1] of list) {
              const pts = along(g, e.range, t0, t1).map((p): [number, number] => [
                dot(p, right),
                dot(p, top),
              ]);
              lines.push({ pts, hidden });
            }
          }
        }
        // Fit the view into its quarter of an A3 landscape page.
        const xs = lines.flatMap((l) => l.pts.map((p) => p[0]));
        const ys = lines.flatMap((l) => l.pts.map((p) => p[1]));
        const [x0, x1, y0, y1] = [
          Math.min(...xs),
          Math.max(...xs),
          Math.min(...ys),
          Math.max(...ys),
        ];
        const scale = Math.min(170 / (x1 - x0 || 1), 115 / (y1 - y0 || 1));
        const cx = 20 + (v % 2) * 200 + 90;
        const cy = 297 - (20 + Math.floor(v / 2) * 135 + 70);
        for (const l of lines) {
          const map = (p: [number, number]): [number, number] => [
            cx + (p[0] - (x0 + x1) / 2) * scale,
            cy + (p[1] - (y0 + y1) / 2) * scale,
          ];
          const [first, ...rest] = l.pts.map(map);
          if (!first) continue;
          const contour: Contour = {
            start: first,
            segments: rest.map((to) => ({ type: 'line', to })),
            closed: false,
          };
          items.push({
            type: 'path',
            contours: [contour],
            stroke: l.hidden
              ? { width: 0.18, dash: [1.5, 0.8], color: '#555555' }
              : { width: 0.35 },
          });
        }
      });
      pages.push({ width: 420, height: 297, items });
      held.release();
      kernel.dispose();
      expect(items.length, name).toBeGreaterThan(0);
    }
    const fs = (
      globalThis as {
        process?: {
          getBuiltinModule(id: string): { writeFileSync(p: string, d: Uint8Array): void };
        };
      }
    ).process?.getBuiltinModule('node:fs');
    fs?.writeFileSync(ENV.HLR_PDF as string, writePdf(pages, { title: 'S0 hidden-line views' }));
  });
});
