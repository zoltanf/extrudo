/**
 * Construction geometry as the view draws and picks it (P3-05, ADR-0040):
 * pure helpers over the kernel's `ConstructionReport`s, in world mm, with no
 * three.js so they run in Vitest. A plane is a square around its anchor, an
 * axis a line through its origin point, a point a dot; all keep a steady
 * size on screen, as a share of the view size, like the origin planes.
 */
import type { ConstructionReport, SelectionItem } from '@extrudo/core';
import type { PickAxis, PickPlane, PickPoint } from '../selection/pick';

/** Half the side of a plane's square, as a share of the view size (the origin planes' `PLANE_HALF`). */
export const CONSTRUCTION_PLANE_HALF = 0.16;
/** Half the length of an axis line, as a share of the view size. */
export const CONSTRUCTION_AXIS_HALF = 0.32;

/** One construction feature to draw. */
export interface ConstructionDrawing {
  /** The feature's ID: the reference ID (`{ kind: 'plane' | 'axis' | 'point', id }`). */
  id: string;
  name: string;
  report: ConstructionReport;
  /** A feature dialog's preview: drawn in the preview colour, never picked. */
  preview?: boolean;
  /** A preview that is out of date (invalid input): fainter. */
  dimmed?: boolean;
}

export type ConstructionState = 'hover' | 'selected';

/** Whether the session's hover or selection names this drawing. */
export function constructionState(
  item: Pick<ConstructionDrawing, 'id' | 'report'>,
  hover: SelectionItem | undefined,
  selection: readonly SelectionItem[],
): ConstructionState | undefined {
  const kind = item.report.kind;
  // A browser row's hover names the feature; a pick names the plane, axis or point.
  const names = (s: SelectionItem | undefined) =>
    (s?.kind === kind || s?.kind === 'feature') && s.id === item.id;
  if (selection.some(names)) return 'selected';
  return names(hover) ? 'hover' : undefined;
}

/** What the pointer can pick of the drawn features, at a view size (`size`, mm). */
export function constructionPick(
  items: readonly ConstructionDrawing[],
  size: number,
): { planes: PickPlane[]; axes: PickAxis[]; points: PickPoint[] } {
  const planes: PickPlane[] = [];
  const axes: PickAxis[] = [];
  const points: PickPoint[] = [];
  for (const { id, report, preview } of items) {
    if (preview) continue;
    if (report.kind === 'plane') {
      planes.push({
        id,
        frame: report.frame,
        anchor: report.anchor,
        half: size * CONSTRUCTION_PLANE_HALF,
      });
    } else if (report.kind === 'axis') {
      axes.push({
        id,
        origin: report.origin,
        direction: report.direction,
        half: size * CONSTRUCTION_AXIS_HALF,
      });
    } else {
      points.push({ id, at: report.point });
    }
  }
  return { planes, axes, points };
}

const num = (x: number) => `${Math.round(x * 1000) / 1000 + 0}`;
const vec = (v: readonly number[]) => v.map(num).join(',');

/**
 * The drawn construction geometry for tests (`data-construction`), space
 * separated: `Name:plane:<origin>:<normal>`, `Name:axis:<origin>:<direction>`,
 * `Name:point:<x,y,z>`; a preview reads `preview:` first.
 */
export function constructionSummary(items: readonly ConstructionDrawing[]): string | undefined {
  if (items.length === 0) return undefined;
  return items
    .map(({ name, report, preview }) => {
      const name_ = `${preview ? 'preview:' : ''}${name.replace(/\s+/g, '_')}`;
      switch (report.kind) {
        case 'plane':
          return `${name_}:plane:${vec(report.frame.origin)}:${vec(report.frame.normal)}`;
        case 'axis':
          return `${name_}:axis:${vec(report.origin)}:${vec(report.direction)}`;
        default:
          return `${name_}:point:${vec(report.point)}`;
      }
    })
    .join(' ');
}
