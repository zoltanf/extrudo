/**
 * Scene colours from the design tokens (docs/05-brand.md §3.4), so the 3D
 * view follows the theme like the rest of the UI.
 */
import { useEffect, useState } from 'react';

export interface Rgba {
  /** sRGB, 0…1. */
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface SceneColors {
  grid: Rgba;
  axisX: Rgba;
  axisY: Rgba;
  axisZ: Rgba;
  origin: Rgba;
  construct: Rgba;
  body: Rgba;
  edge: Rgba;
  /** Under-constrained sketch geometry. */
  sketch: Rgba;
  /** Fully constrained sketch geometry (`ink`, docs/05-brand.md §3.4). */
  sketchFixed: Rgba;
  /** Over-constrained sketch geometry (`error`). */
  sketchConflict: Rgba;
  /** Construction sketch geometry, drawn dashed. */
  sketchConstruction: Rgba;
  /** Projected sketch geometry (P2-09): the construct colour. */
  sketchProjected: Rgba;
  /** Closed sketch profiles (P1-11): `sketch` at 12–14 %. */
  profile: Rgba;
  /** Hover highlight; drawn at 45 % (docs/05-brand.md §3.4). */
  preselect: Rgba;
  /** Feature dialog previews (P2-05): a new body, a join, a cut, an intersection. */
  preview: Rgba;
  previewJoin: Rgba;
  previewCut: Rgba;
  previewIntersect: Rgba;
  /** The cap on a section analysis' cut (P3-09): the Inspect category's teal. */
  section: Rgba;
  /** The hatch lines on the cap: `ink`, which contrasts with the fill in both themes. */
  sectionHatch: Rgba;
  /** The overhang analysis' shading (P3-10). */
  overhang: Rgba;
  /** The wall-thickness check's shading (P5-06): the error colour, as the overhang's. */
  thickness: Rgba;
}

const TOKENS: Record<keyof SceneColors, string> = {
  grid: '--x-grid',
  axisX: '--x-axis-x',
  axisY: '--x-axis-y',
  axisZ: '--x-axis-z',
  origin: '--x-ink',
  construct: '--x-cat-construct',
  body: '--x-body-default',
  edge: '--x-edge',
  sketch: '--x-sketch',
  sketchFixed: '--x-ink',
  sketchConflict: '--x-error',
  sketchConstruction: '--x-muted',
  sketchProjected: '--x-cat-construct',
  profile: '--x-profile-fill',
  preselect: '--x-accent',
  preview: '--x-preview',
  previewJoin: '--x-preview-join',
  previewCut: '--x-preview-cut',
  previewIntersect: '--x-preview-intersect',
  section: '--x-cat-inspect',
  sectionHatch: '--x-ink',
  overhang: '--x-error',
  thickness: '--x-error',
};

const FALLBACK: Rgba = { r: 0.5, g: 0.5, b: 0.5, a: 1 };

/**
 * Parses a colour as a canvas normalises it: `#rrggbb` or
 * `rgba(r, g, b, a)` (also `rgb(r g b / a%)`, the token syntax).
 */
export function parseCssColor(text: string): Rgba | undefined {
  const s = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
    const a = hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1;
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(s);
  if (!fn?.[1]) return undefined;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const channel = (p: string) =>
    p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p) / 255;
  const alpha = (p: string | undefined) =>
    p === undefined ? 1 : p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p);
  const [r, g, b, a] = [...parts.slice(0, 3).map(channel), alpha(parts[3])];
  if ([r, g, b, a].some((x) => x === undefined || Number.isNaN(x))) return undefined;
  return { r: r as number, g: g as number, b: b as number, a: a as number };
}

/**
 * The cap of a section on a body (P3-09): the body's own colour pulled towards the section
 * teal, so caps tell the bodies apart and still read as one kind of thing, and the hatch
 * lines in `ink` over it at a fraction of their strength. sRGB, 0…1.
 */
export function capColors(body: Rgba, section: Rgba, ink: Rgba): { fill: Rgba; hatch: Rgba } {
  const mix = (a: Rgba, b: Rgba, t: number): Rgba => ({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: 1,
  });
  const fill = mix(body, section, 0.55);
  return { fill, hatch: mix(fill, ink, 0.45) };
}

/** Reads the scene colours from the tokens on <html>. */
export function readSceneColors(root: HTMLElement = document.documentElement): SceneColors {
  const style = getComputedStyle(root);
  const entries = Object.entries(TOKENS).map(([key, token]) => [
    key,
    parseCssColor(style.getPropertyValue(token)) ?? FALLBACK,
  ]);
  return Object.fromEntries(entries) as SceneColors;
}

/** The scene colours, read again whenever the theme changes. */
export function useSceneColors(): SceneColors {
  const [colors, setColors] = useState(readSceneColors);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setColors(readSceneColors(root)));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return colors;
}
