/**
 * The Dimension tool on the sheet (P6-24 S3, plan §4.5, mock-up 3): the shared pick tool
 * (`usePickTool`) with the dimension's spec: edges, vertices at a line's end, circles and
 * outlines are taken, up to two in one view; once they make a dimension it follows the
 * pointer in the preview colour with its value and a click places it ("Dimension").
 */

import type { LengthUnit, Sheet, SheetAnchors, SheetItem, SheetViewId, Vec2 } from '@extrudo/core';
import { layoutSheetDimension, measureSheetDimension } from '@extrudo/sheets';
import { useMemo } from 'react';
import {
  type DimensionChoices,
  dimensionItem,
  type SheetHit,
  type SheetPickable,
} from './dimensionTool';
import type { SheetModeStores } from './mode';
import {
  type PickKernel,
  type PickToolSpec,
  type PickToolState,
  pickOf,
  usePickTool,
} from './usePickTool';

export { pickOf };
/** What the Dimension tool needs of the kernel (the pick tools' kernel). */
export type DimensionKernel = PickKernel;
export type DimensionToolState = PickToolState;

/** The Dimension tool's spec: what it takes and what the picks make. */
export function dimensionSpec(choices: DimensionChoices, units: LengthUnit): PickToolSpec {
  return {
    accepts: (hit) => hit.pickable.kind !== 'face',
    most: 2,
    placed: 'click',
    label: 'Dimension',
    item: (id, picks, at) => dimensionItem(id, picks, at, choices),
    preview: (sheet, item, anchors) => {
      if (item.kind !== 'dimension') return { items: [] };
      return {
        items: layoutSheetDimension(sheet, item, anchors, { units }),
        text: measureSheetDimension(sheet, item, anchors, { units }).text,
      };
    },
  };
}

export interface DimensionToolArgs {
  active: boolean;
  sheet: Sheet | undefined;
  units: LengthUnit;
  hitAt(point: Vec2, tolerance: number, only?: SheetViewId): SheetHit | undefined;
  pickables: readonly SheetPickable[];
  scaleOf(view: SheetViewId): number;
  kernel: DimensionKernel | undefined;
  stores: SheetModeStores;
  choices: DimensionChoices;
  notify(tone: 'info' | 'error', text: string): void;
  merge(reports: SheetAnchors): void;
  onPlaced?(item: SheetItem, reports: SheetAnchors): void;
}

export function useDimensionTool({ choices, units, ...args }: DimensionToolArgs): PickToolState {
  const spec = useMemo(() => dimensionSpec(choices, units), [choices, units]);
  return usePickTool({ ...args, units, spec });
}
