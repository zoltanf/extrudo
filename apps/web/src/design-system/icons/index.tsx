/**
 * Tool icons (docs/05-brand.md §6). The sources are the SVG files in `svg/`,
 * drawn on a 24 × 24 grid with `currentColor` only; elements with class `f`
 * are the "subject" surface, filled at 22 %. Vite inlines the sources at
 * build time; `icons.test.ts` enforces the rules.
 *
 * The colour comes from the tool category (`--x-cat-*`) through `color`.
 */
const sources = import.meta.glob<string>('./svg/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const ICON_NAMES = [
  'create-sketch',
  'finish-sketch',
  'line',
  'rectangle',
  'rectangle-3-point',
  'rectangle-center',
  'circle',
  'circle-2-point',
  'circle-3-point',
  'arc',
  'arc-center',
  'arc-tangent',
  'point',
  'polygon',
  'polygon-circumscribed',
  'polygon-edge',
  'slot',
  'slot-overall',
  'ellipse',
  'spline',
  'spline-control',
  'conic',
  'text',
  'project',
  'intersect',
  'sketch-dimension',
  'trim',
  'sketch-offset',
  'extend',
  'break',
  'mirror',
  'move',
  'copy',
  'circular-pattern',
  'scale',
  'coincident',
  'parallel',
  'perpendicular',
  'tangent',
  'collinear',
  'concentric',
  'midpoint',
  'fix',
  'horizontal',
  'vertical',
  'smooth',
  'equal',
  'symmetric',
  'extrude',
  'revolve',
  'sweep',
  'loft',
  'coil',
  'emboss',
  'rib',
  'script',
  'record-macro',
  'stop-macro',
  'fillet',
  'chamfer',
  'shell',
  'press-pull',
  'offset-face',
  'split-body',
  'draft',
  'remove',
  'combine',
  'box',
  'cylinder',
  'sphere',
  'torus',
  'hole',
  'thread',
  'rectangular-pattern',
  'path-pattern',
  'parameters',
  'customizer',
  'offset-plane',
  'plane-angle',
  'midplane',
  'plane-3-points',
  'plane-tangent',
  'axis-cylinder',
  'axis-edge',
  'axis',
  'measure',
  'section',
  'insert-svg',
  'canvas',
  'export',
  'place-on-bed',
  'print-info',
  'tolerance',
  'overhang',
  'wall-thickness',
  'send-to-slicer',
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export type ToolCategory =
  | 'sketch'
  | 'create'
  | 'modify'
  | 'construct'
  | 'inspect'
  | 'insert'
  | 'export';

/** The markup inside the <svg> element of each source, by icon name. */
export const ICON_MARKUP: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(sources).map(([path, svg]) => [
    path.replace(/^.*\/(.+)\.svg$/, '$1'),
    svg
      .replace(/^[\s\S]*?<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
      .trim(),
  ]),
);

export interface ToolIconProps {
  name: IconName;
  category: ToolCategory;
  /** 24 toolbar · 18 timeline chips, dialog titles, compact toolbar groups · 16 menus, browser tree · 14 constraint glyphs. */
  size?: 14 | 16 | 18 | 24;
  /** Overrides the category colour: Finish Sketch is `success` green (UI spec §4). */
  color?: string;
  className?: string;
}

/** A two-tone tool icon in its category colour. Decorative: label the control, not the icon. */
export function ToolIcon({ name, category, size = 24, color, className = '' }: ToolIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={`x-tool-icon shrink-0 ${className}`}
      style={{ color: color ?? `var(--x-cat-${category})` }}
      // Our own build-time sources (svg/*.svg), checked by icons.test.ts.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, bundled SVG.
      dangerouslySetInnerHTML={{ __html: ICON_MARKUP[name] ?? '' }}
    />
  );
}
