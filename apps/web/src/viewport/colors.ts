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
  /** Closed sketch profiles (P1-11): `sketch` at 12–14 %. */
  profile: Rgba;
  /** Hover highlight; drawn at 45 % (docs/05-brand.md §3.4). */
  preselect: Rgba;
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
  profile: '--x-profile-fill',
  preselect: '--x-accent',
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
