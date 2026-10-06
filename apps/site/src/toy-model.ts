/**
 * The hero's parametric toy, the pure part (ADR-0057 amendment, 2026-10-05): an
 * isometric drawing of a tray from three numbers, and the weight Print Info would
 * give it. No DOM: `toy.ts` wires it to the sliders, and the build writes the
 * default tray into the page (`vite.config.ts`), so the hero is right before any
 * script runs and without one.
 */

export type P2 = [number, number];

export interface Wall {
  p: P2;
  q: P2;
  /** The outward normal of the wall in plan, a unit vector. */
  nx: number;
  ny: number;
  /** Whether the wall faces the viewer, who looks from +x and +y. */
  front: boolean;
}

/** The three numbers the sliders change, in mm. */
export interface TrayParams {
  width: number;
  height: number;
  fillet: number;
}

export const DEFAULTS: TrayParams = { width: 80, height: 28, fillet: 8 };
/** The tray's depth and wall thickness don't have sliders. */
export const DEPTH = 60;
export const WALL = 3;

const COS = Math.cos(Math.PI / 6);
const K = 2.3;
const CX = 270;
const CY = 235;

export const project = (x: number, y: number, z: number): P2 => [
  CX + (x - y) * COS * K,
  CY + (x + y) * 0.5 * K - z * K,
];

/** The corner radius that fits: under half the depth and half the width. */
export function cornerRadius(width: number, fillet: number): number {
  return Math.min(fillet, DEPTH / 2 - 0.5, width / 2 - 0.5);
}

/** A rounded rectangle's outline, counter-clockwise, centred on the origin. */
export function ring(w: number, d: number, r: number): P2[] {
  const points: P2[] = [];
  const n = r < 0.05 ? 0 : 10;
  const corners: [number, number, number][] = [
    [w / 2 - r, d / 2 - r, 0],
    [-w / 2 + r, d / 2 - r, 90],
    [-w / 2 + r, -d / 2 + r, 180],
    [w / 2 - r, -d / 2 + r, 270],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= n; i++) {
      const a = ((start + (n ? (i * 90) / n : 0)) * Math.PI) / 180;
      points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return points;
}

/** An outward normal faces the viewer when it points towards +x + y. */
export const facesViewer = (nx: number, ny: number) => nx + ny > 1e-6;

/** The walls of a counter-clockwise outline, each with its outward normal. */
export function walls(points: P2[]): Wall[] {
  return points.map((p, i) => {
    const q = points[(i + 1) % points.length] as P2;
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nx = (q[1] - p[1]) / length;
    const ny = -(q[0] - p[0]) / length;
    return { p, q, nx, ny, front: facesViewer(nx, ny) };
  });
}

/** Grams of PLA in the tray (1.24 g/cm³), as Print Info would say it. */
export function grams({ width, height, fillet }: TrayParams): number {
  const r = cornerRadius(width, fillet);
  const ri = Math.max(r - WALL, 0);
  const area = (w: number, d: number, c: number) => w * d - (4 - Math.PI) * c * c;
  const volume =
    area(width, DEPTH, r) * height - area(width - 2 * WALL, DEPTH - 2 * WALL, ri) * (height - WALL);
  return (volume / 1000) * 1.24;
}

const f = (n: number) => n.toFixed(1);
const path = (points: P2[], closed = true) =>
  `M${points.map((p) => `${f(p[0])} ${f(p[1])}`).join('L')}${closed ? 'Z' : ''}`;
const at = (points: P2[], z: number) => points.map(([x, y]) => project(x, y, z));

const LIGHT = [244, 164, 56];
const DARK = [168, 102, 24];
/** The colour of a wall whose normal is (nx, ny): lighter to the right. */
export function shade(nx: number, ny: number, dim = 1): string {
  const t = Math.min(1, Math.max(0, (Math.atan2(ny, nx) + Math.PI / 4) / Math.PI));
  const c = LIGHT.map((l, i) => Math.round((l + ((DARK[i] ?? 0) - l) * t) * dim));
  return `rgb(${c.join(' ')})`;
}

function dimension(a: P2, b: P2, label: string, shift: P2 = [0, 0]): string {
  const mx = (a[0] + b[0]) / 2 + shift[0];
  const my = (a[1] + b[1]) / 2 + shift[1];
  const w = label.length * 7.4 + 14;
  return `<path d="M${f(a[0])} ${f(a[1])}L${f(b[0])} ${f(b[1])}" stroke="#5aa9ff" stroke-width="1.5"/>
    <circle cx="${f(a[0])}" cy="${f(a[1])}" r="3" fill="#5aa9ff"/><circle cx="${f(b[0])}" cy="${f(b[1])}" r="3" fill="#5aa9ff"/>
    <rect x="${f(mx - w / 2)}" y="${f(my - 11)}" width="${f(w)}" height="22" rx="6" fill="#1b1f27" stroke="#5aa9ff" stroke-opacity=".6"/>
    <text x="${f(mx)}" y="${f(my + 4.2)}" text-anchor="middle" fill="#a4cfff" font-family="ui-monospace,monospace" font-size="12">${label}</text>`;
}

/**
 * The drawing's content, SVG markup for the inside of the toy's `<g>`: the ground,
 * the walls that face the viewer, the cavity seen through the opening and the
 * dimensions as a sketch draws them. Every colour is an attribute: the site's
 * content policy allows no `style` attributes.
 */
export function trayMarkup({ width, height, fillet }: TrayParams): string {
  const r = cornerRadius(width, fillet);
  const outer = ring(width, DEPTH, r);
  const inner = ring(width - 2 * WALL, DEPTH - 2 * WALL, Math.max(r - WALL, 0));
  const out: string[] = [];
  // The ground: a faint isometric grid and the tray's shadow.
  const grid: string[] = [];
  for (let g = -100; g <= 100; g += 20) {
    grid.push(path([project(g, -100, 0), project(g, 100, 0)], false));
    grid.push(path([project(-100, g, 0), project(100, g, 0)], false));
  }
  out.push(`<path d="${grid.join('')}" stroke="rgb(255 255 255 / 7%)" mask="url(#toy-fade)"/>`);
  out.push(
    `<path d="${path(at(outer, 0))}" fill="rgb(0 0 0 / 45%)" filter="url(#toy-blur)" transform="translate(4 12)"/>`,
  );
  // The outside walls that face the viewer.
  const outside = walls(outer);
  for (const { p, q, nx, ny, front } of outside) {
    if (!front) continue;
    const quad = [project(...p, height), project(...q, height), project(...q, 0), project(...p, 0)];
    const fill = shade(nx, ny);
    out.push(`<path d="${path(quad)}" fill="${fill}" stroke="${fill}" stroke-width=".8"/>`);
  }
  // Vertical lines: the silhouette, and a corner that is still sharp.
  const lines: string[] = [];
  for (const [i, edge] of outside.entries()) {
    const before = outside[(i + outside.length - 1) % outside.length];
    if (!before) continue;
    const crease = edge.front && before.front && edge.nx * before.nx + edge.ny * before.ny < 0.9;
    if (edge.front !== before.front || crease) {
      lines.push(path([project(...edge.p, height), project(...edge.p, 0)], false));
    }
  }
  const base = outside
    .filter((e) => e.front)
    .map((e) => path([project(...e.p, 0), project(...e.q, 0)], false));
  // The rim, then the cavity seen through the opening.
  out.push(`<path d="${path(at(outer, height))}" fill="#ffc76a"/>`);
  out.push(`<clipPath id="toy-opening"><path d="${path(at(inner, height))}"/></clipPath>`);
  const cavity: string[] = [`<path d="${path(at(inner, WALL))}" fill="#c98326"/>`];
  for (const { p, q, nx, ny, front } of walls(inner)) {
    if (front) continue;
    const quad = [
      project(...p, height),
      project(...q, height),
      project(...q, WALL),
      project(...p, WALL),
    ];
    const fill = shade(-nx, -ny, 0.8);
    cavity.push(`<path d="${path(quad)}" fill="${fill}" stroke="${fill}" stroke-width=".8"/>`);
  }
  out.push(`<g clip-path="url(#toy-opening)">${cavity.join('')}</g>`);
  out.push(
    `<path d="${lines.join('')}${base.join('')}${path(at(outer, height))}${path(at(inner, height))}" fill="none" stroke="#6d4410" stroke-opacity=".75" stroke-width="1.1" stroke-linejoin="round"/>`,
  );
  // The dimensions.
  const off = 13;
  const ext = (a: P2, b: P2) =>
    `<path d="${path([a, b], false)}" stroke="#5aa9ff" stroke-opacity=".55" stroke-dasharray="3 3"/>`;
  out.push(ext(project(-width / 2, DEPTH / 2, 0), project(-width / 2, DEPTH / 2 + off + 3, 0)));
  out.push(ext(project(width / 2, DEPTH / 2, 0), project(width / 2, DEPTH / 2 + off + 3, 0)));
  out.push(
    dimension(
      project(-width / 2, DEPTH / 2 + off, 0),
      project(width / 2, DEPTH / 2 + off, 0),
      `width ${width}`,
    ),
  );
  out.push(ext(project(width / 2, -DEPTH / 2, 0), project(width / 2 + off + 3, -DEPTH / 2, 0)));
  out.push(
    ext(project(width / 2, -DEPTH / 2, height), project(width / 2 + off + 3, -DEPTH / 2, height)),
  );
  out.push(
    dimension(
      project(width / 2 + off, -DEPTH / 2, 0),
      project(width / 2 + off, -DEPTH / 2, height),
      `${height}`,
      [16, 0],
    ),
  );
  if (r > 0.5) {
    const k = r * (1 - Math.SQRT1_2);
    const corner = project(-width / 2 + k, DEPTH / 2 - k, height);
    const end: P2 = [corner[0] - 34, corner[1] - 30];
    out.push(`<path d="${path([corner, end], false)}" stroke="#5aa9ff" stroke-width="1.5"/>
      <circle cx="${f(corner[0])}" cy="${f(corner[1])}" r="3" fill="#5aa9ff"/>
      <text x="${f(end[0] - 4)}" y="${f(end[1] - 5)}" text-anchor="end" fill="#a4cfff" font-family="ui-monospace,monospace" font-size="12">R${Math.round(r)}</text>`);
  }
  return out.join('');
}
