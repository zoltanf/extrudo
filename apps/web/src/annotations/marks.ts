/**
 * Annotation badges on a snapshot (ADR-0126 §5, S4): the agent's `screenshot` with
 * `annotations` gets each note's number at its anchor, the callout's default offset away, with
 * a leader, projected through the snapshot's own camera. No text: `list_annotations` has it.
 */
import { ANNOTATION_OFFSET } from '@extrudo/core';
import { type Projection, type View, viewProject } from '../viewport/camera';

/** One badge: where, which number, and how it looks (as the callout's badge). */
export interface AnnotationMark {
  at: readonly [number, number, number];
  number: number;
  look: 'solid' | 'muted' | 'hollow';
}

const RADIUS = 9;

/** The marks as they land on a square picture of `size` px seen through `view`. */
export function markPositions(
  marks: readonly AnnotationMark[],
  view: View,
  projection: Projection,
  size: number,
): { mark: AnnotationMark; anchor: [number, number]; badge: [number, number] }[] {
  return marks.flatMap((mark) => {
    const ndc = viewProject(view, projection, 1, mark.at);
    if (!ndc) return [];
    const anchor: [number, number] = [((ndc[0] + 1) / 2) * size, ((1 - ndc[1]) / 2) * size];
    const [dx, dy] = ANNOTATION_OFFSET;
    // Mirrored, as a callout is, when the badge would leave the picture.
    const x = anchor[0] + dx + RADIUS > size ? anchor[0] - dx : anchor[0] + dx;
    const y = anchor[1] + dy - RADIUS < 0 ? anchor[1] - dy : anchor[1] + dy;
    return [{ mark, anchor, badge: [x, y] as [number, number] }];
  });
}

/** Draws the badges over the picture already on `ctx`. */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly AnnotationMark[],
  view: View,
  projection: Projection,
  size: number,
): void {
  const style =
    typeof document === 'undefined' ? undefined : getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    style?.getPropertyValue(name).trim() || fallback;
  const accent = token('--x-accent', '#e8590c');
  const muted = token('--x-muted', '#8a8a8a');
  const line = token('--x-line', '#d0d0d0');
  for (const { mark, anchor, badge } of markPositions(marks, view, projection, size)) {
    const colour = mark.look === 'muted' ? muted : accent;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(anchor[0], anchor[1]);
    ctx.lineTo(badge[0], badge[1]);
    ctx.stroke();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(anchor[0], anchor[1], 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(badge[0], badge[1], RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = mark.look === 'solid' ? accent : mark.look === 'muted' ? line : '#ffffff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = mark.look === 'solid' ? '#ffffff' : colour;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(mark.number), badge[0], badge[1] + 0.5);
  }
}
