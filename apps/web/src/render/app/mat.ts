/**
 * The workbench's cutting mat (owner, 2026-10-24): a green mat under the
 * model with light lines every 10 mm, brighter ones every 50 mm, and numbers
 * in its border counting millimetres from the design's origin. The grid sits
 * on the design's own coordinates, so a line runs through its origin; the
 * mat covers the model's footprint and a margin. Drawn to a canvas at
 * runtime, like the other textures: no image files.
 */
import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Texture,
} from 'three';
import type { Placement } from './scenes';

/** The mat's colours (sRGB). */
export const MAT_COLORS = { mat: '#1d6b52', minor: '#4fbf9a', major: '#8fe3c6', text: '#b8f0dc' };

/** The mat's thickness (mm): its top is z = 0, where the model stands. */
export const MAT_THICKNESS = 2;

/** Cells across the mat's larger side above which the grid steps up (10 → 50 → 100 mm …). */
const MAX_CELLS = 60;

export interface MatLayout {
  /** The grid's area in design millimetres: [x0, x1] × [y0, y1], multiples of `step`. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** The plain border around the grid, holding the numbers (mm). */
  border: number;
  /** Grid lines every `step` mm, brighter every `major` mm. */
  step: number;
  major: number;
  /** A number every `label` mm along the front (x) and right (y) edges. */
  label: number;
  /** Design → scene: the placement's x/y offset. */
  dx: number;
  dy: number;
}

/** 10, 50, 100, 500, 1000 … mm: the first whose cells fit `span` in MAX_CELLS (pure). */
export function gridStep(span: number): number {
  for (let step = 10; ; step *= step.toString().startsWith('1') ? 5 : 2) {
    if (span / step <= MAX_CELLS) return step;
  }
}

/** The mat for a placed model (pure). */
export function matLayout(placement: Placement): MatLayout {
  const { offset, extent, size } = placement;
  // Small enough that the automatic camera sees the numbered front and right edges.
  const margin = Math.max(15, 0.25 * size);
  // The footprint in design coordinates, grown by the margin.
  const lo = { x: -extent.x - offset.x - margin, y: -extent.y - offset.y - margin };
  const hi = { x: extent.x - offset.x + margin, y: extent.y - offset.y + margin };
  const step = gridStep(Math.max(hi.x - lo.x, hi.y - lo.y));
  const major = step * 5;
  const snapDown = (value: number) => Math.floor(value / step) * step;
  const snapUp = (value: number) => Math.ceil(value / step) * step;
  const x0 = snapDown(lo.x);
  const x1 = snapUp(hi.x);
  const y0 = snapDown(lo.y);
  const y1 = snapUp(hi.y);
  const span = Math.max(x1 - x0, y1 - y0);
  // Every line numbered while there are few; on a busy mat, every major line.
  const label = span / step <= 30 ? step : major;
  return {
    x0,
    x1,
    y0,
    y1,
    border: Math.max(12, span / 25),
    step,
    major,
    label,
    dx: offset.x,
    dy: offset.y,
  };
}

/** The mat's outer edges in design millimetres. */
function outer(layout: MatLayout) {
  const b = layout.border;
  return { x0: layout.x0 - b, x1: layout.x1 + b, y0: layout.y0 - b, y1: layout.y1 + b };
}

/** "−20", "0", "150": numbers as on a mat, with a real minus sign. */
export function matNumber(mm: number): string {
  const value = Math.round(mm);
  return value < 0 ? `−${-value}` : `${value}`;
}

/** The mat's picture: grid, border and numbers; undefined without a 2D context (unit tests). */
export function matCanvas(layout: MatLayout, maxSide = 4096): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  const o = outer(layout);
  const width = o.x1 - o.x0;
  const height = o.y1 - o.y0;
  const scale = Math.min(maxSide / width, maxSide / height, 16);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  // Design mm → canvas px; the canvas's top row is the mat's back edge (+y).
  const px = (x: number) => (x - o.x0) * scale;
  const py = (y: number) => (o.y1 - y) * scale;
  ctx.fillStyle = MAT_COLORS.mat;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const line = (major: boolean) => {
    ctx.strokeStyle = major ? MAT_COLORS.major : MAT_COLORS.minor;
    ctx.lineWidth = Math.max(1, layout.step * scale * (major ? 0.05 : 0.025));
  };
  const isMajor = (mm: number) =>
    Math.abs(mm / layout.major - Math.round(mm / layout.major)) < 1e-6;
  for (let x = layout.x0; x <= layout.x1 + 1e-6; x += layout.step) {
    line(isMajor(x));
    ctx.beginPath();
    ctx.moveTo(px(x), py(layout.y0));
    ctx.lineTo(px(x), py(layout.y1));
    ctx.stroke();
  }
  for (let y = layout.y0; y <= layout.y1 + 1e-6; y += layout.step) {
    line(isMajor(y));
    ctx.beginPath();
    ctx.moveTo(px(layout.x0), py(y));
    ctx.lineTo(px(layout.x1), py(y));
    ctx.stroke();
  }
  // The numbers: along the front edge (x, below the grid) and the right edge (y), the
  // two edges that face the automatic camera.
  ctx.fillStyle = MAT_COLORS.text;
  // Small enough that "−20" fits between two numbers.
  const textSize = Math.min(layout.border * 0.5, layout.label * 0.38) * scale;
  ctx.font = `600 ${Math.max(6, textSize)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const first = (from: number) => Math.ceil(from / layout.label) * layout.label;
  for (let x = first(layout.x0); x <= layout.x1 + 1e-6; x += layout.label) {
    ctx.fillText(matNumber(x), px(x), py(layout.y0 - layout.border / 2));
  }
  for (let y = first(layout.y0); y <= layout.y1 + 1e-6; y += layout.label) {
    ctx.save();
    ctx.translate(px(layout.x1 + layout.border / 2), py(y));
    // Read from the front, like the numbers along x: turned a quarter.
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(matNumber(y), 0, 0);
    ctx.restore();
  }
  return canvas;
}

/** The mat's texture, or a plain one without a 2D context. */
export function matTexture(layout: MatLayout): CanvasTexture {
  const texture = new CanvasTexture(matCanvas(layout) as HTMLCanvasElement);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** The mat as a thin box, top at z = 0, placed where the design's grid lands in the scene. */
export function cuttingMat(layout: MatLayout, texture: Texture = matTexture(layout)): Mesh {
  const o = outer(layout);
  const material = new MeshStandardMaterial({ map: texture, roughness: 0.75 });
  const mesh = new Mesh(new BoxGeometry(o.x1 - o.x0, o.y1 - o.y0, MAT_THICKNESS), material);
  mesh.position.set(
    (o.x0 + o.x1) / 2 + layout.dx,
    (o.y0 + o.y1) / 2 + layout.dy,
    -MAT_THICKNESS / 2,
  );
  mesh.name = 'Cutting mat';
  mesh.receiveShadow = true;
  return mesh;
}
