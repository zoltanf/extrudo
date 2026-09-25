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
  'extrude',
  'revolve',
  'fillet',
  'chamfer',
  'shell',
  'box',
  'hole',
  'rectangular-pattern',
  'parameters',
  'offset-plane',
  'axis',
  'measure',
  'insert-svg',
  'export',
  'place-on-bed',
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
  /** 24 toolbar · 18 timeline chips, dialog titles · 16 menus, browser tree. */
  size?: 16 | 18 | 24;
  className?: string;
}

/** A two-tone tool icon in its category colour. Decorative: label the control, not the icon. */
export function ToolIcon({ name, category, size = 24, className = '' }: ToolIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      className={`x-tool-icon shrink-0 ${className}`}
      style={{ color: `var(--x-cat-${category})` }}
      // Our own build-time sources (svg/*.svg), checked by icons.test.ts.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted, bundled SVG.
      dangerouslySetInnerHTML={{ __html: ICON_MARKUP[name] ?? '' }}
    />
  );
}
