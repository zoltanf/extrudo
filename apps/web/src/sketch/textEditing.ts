/**
 * Editing a text in a sketch (P4-03, ADR-0058 §6): the commands the selection
 * panel's fields write through `ToolHost.apply` (so each change is one undo
 * step and the sketch is solved again, ADR-0016), and what the text's height
 * is — its own dimension when the Text tool made one, measured otherwise.
 */
import {
  type Command,
  type DimensionId,
  type FeatureId,
  type SketchData,
  type SketchDimension,
  type SketchEntity,
  type SketchEntityId,
  setText,
} from '@extrudo/core';

/** What a text's panel fields may change (core's `setText`). */
export type TextPatch = Parameters<typeof setText>[0]['patch'];

/**
 * The command that changes a text's own string, font, alignment or
 * construction flag. The panel runs it through `ToolHost.apply`, which solves
 * the sketch and makes it one undo step.
 */
export function textPatch(
  feature: FeatureId,
  id: SketchEntityId,
  patch: TextPatch,
): Command<unknown> {
  return setText({ feature, id, patch });
}

/**
 * The distance dimension that gives a text its height (P4-03: the Text tool
 * makes one between the text's own two points), when it is the only
 * dimension between them. A second one means the user measures the height
 * their own way, and the panel leaves it be.
 */
export function textHeightDimension(
  data: SketchData,
  text: SketchEntity | undefined,
): { id: DimensionId; dimension: SketchDimension } | undefined {
  if (text?.type !== 'text') return undefined;
  const between = (d: SketchDimension) =>
    d.type === 'distance' &&
    ((d.a === text.anchor && d.b === text.top) || (d.a === text.top && d.b === text.anchor));
  const found = Object.entries(data.dimensions).filter(([, d]) => between(d));
  const [id, dimension] = found[0] ?? [];
  return found.length === 1 && id !== undefined && dimension
    ? { id: id as DimensionId, dimension }
    : undefined;
}

/** A text's height in mm: the distance between its own two points. */
export function textHeight(data: SketchData, id: SketchEntityId): number | undefined {
  const e = data.entities[id];
  if (e?.type !== 'text') return undefined;
  const at = (ref: SketchEntityId): [number, number] | undefined => {
    const p = data.entities[ref];
    return p?.type === 'point' ? [p.x, p.y] : undefined;
  };
  const anchor = at(e.anchor);
  const top = at(e.top);
  return anchor && top ? Math.hypot(top[0] - anchor[0], top[1] - anchor[1]) : undefined;
}
