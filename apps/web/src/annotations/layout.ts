/**
 * Where a callout sits on the screen (ADR-0126 §6). An annotation's `offset` runs from its
 * anchor point to the callout's **bottom-left corner**, in screen px (y down), so the default
 * `[28, -28]` puts it above and to the right. A callout that keeps the default is mirrored to
 * the left or below when it would leave the view; a dragged one stays where it was put.
 */
import { ANNOTATION_OFFSET } from '@extrudo/core';

export type Screen = readonly [number, number];

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The callout's box for an anchor at `p`. `offset` undefined: the default, mirrored to fit. */
export function calloutBox(
  p: Screen,
  size: { width: number; height: number },
  offset: Screen | undefined,
  view: { width: number; height: number },
): Box {
  const { width, height } = size;
  if (offset) return { left: p[0] + offset[0], top: p[1] + offset[1] - height, width, height };
  const [dx, dy] = ANNOTATION_OFFSET;
  let left = p[0] + dx;
  let top = p[1] + dy - height;
  if (left + width > view.width && p[0] - dx - width >= 0) left = p[0] - dx - width;
  if (top < 0 && p[1] - dy + height <= view.height) top = p[1] - dy;
  return { left, top, width, height };
}

/** The offset that puts the callout at `box` (the inverse of `calloutBox` with an offset). */
export function boxOffset(p: Screen, box: Box): [number, number] {
  return [Math.round(box.left - p[0]), Math.round(box.top + box.height - p[1])];
}

/** The point of the box's edge nearest `p`: where the leader meets the callout. */
export function leaderEnd(p: Screen, box: Box): [number, number] {
  const x = Math.min(Math.max(p[0], box.left), box.left + box.width);
  const y = Math.min(Math.max(p[1], box.top), box.top + box.height);
  if (x !== p[0] || y !== p[1]) return [x, y];
  // Inside the box: the nearest side.
  const sides: [number, [number, number]][] = [
    [p[0] - box.left, [box.left, p[1]]],
    [box.left + box.width - p[0], [box.left + box.width, p[1]]],
    [p[1] - box.top, [p[0], box.top]],
    [box.top + box.height - p[1], [p[0], box.top + box.height]],
  ];
  sides.sort((a, b) => a[0] - b[0]);
  return (sides[0] as [number, [number, number]])[1];
}
