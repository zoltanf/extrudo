/**
 * A box from two corners (P4-12, ADR-0032's second amendment): the Box
 * dialog's **Two corners** button arms a small session store, and the next
 * two clicks on the box's plane are opposite corners of its footprint
 * (`placeAt` in `primitives.ts` feeds them to `markCorner`). Like a canvas's
 * calibration (ADR-0066 §5) the marks live in a store the view draws from
 * and the panel clears when the dialog closes; Esc disarms the button
 * instead of cancelling the dialog.
 */
import { type SketchFrame, type Vec3, worldToSketch } from '@extrudo/core';
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { Button } from '../design-system';
import type { DialogExtraProps } from './spec';

/** The corners armed for the open dialog and the ones marked, in world mm. */
export interface Corners {
  /** The dialog the corners belong to; they end when it closes. */
  dialog: string | undefined;
  /** The first corner, while the second is awaited (zero or one). */
  points: Vec3[];
  /** Why the last pair made no box. */
  error: string | undefined;
}

export const cornersStore = createStore<Corners>()(() => ({
  dialog: undefined,
  points: [],
  error: undefined,
}));

/** The corners as they are, for code outside the component. */
export function corners(): Corners {
  return cornersStore.getState();
}

export function armCorners(dialog: string): void {
  cornersStore.setState({ dialog, points: [], error: undefined });
}

export function disarmCorners(): void {
  cornersStore.setState({ dialog: undefined, points: [], error: undefined });
}

/** A box footprint as the box's own fields: centre and sides in the plane's frame, mm. */
export interface Footprint {
  x: number;
  y: number;
  length: number;
  width: number;
}

const round2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/**
 * The footprint of two opposite corners (world points on the plane), in any
 * order: the centre between them and the side lengths, each to 0.01 mm. A
 * pair with a side under 0.01 mm gives the reason instead.
 */
export function footprintOf(
  a: Vec3,
  b: Vec3,
  frame: SketchFrame,
): { footprint: Footprint } | { error: string } {
  const [ax, ay] = worldToSketch(frame, a);
  const [bx, by] = worldToSketch(frame, b);
  const footprint: Footprint = {
    x: round2((ax + bx) / 2),
    y: round2((ay + by) / 2),
    length: round2(Math.abs(bx - ax)),
    width: round2(Math.abs(by - ay)),
  };
  if (footprint.length < 0.01 || footprint.width < 0.01) {
    return { error: 'The two corners must differ in both directions: pick opposite corners.' };
  }
  return { footprint };
}

/**
 * Marks a corner on the plane `frame`: the first is kept, the second makes
 * the footprint (and disarms); a degenerate pair keeps the button armed, with
 * the reason, and starts over.
 */
export function markCorner(world: Vec3, frame: SketchFrame): Footprint | undefined {
  const { points } = corners();
  const first = points[0];
  if (!first) {
    cornersStore.setState({ points: [world], error: undefined });
    return undefined;
  }
  const made = footprintOf(first, world, frame);
  if ('error' in made) {
    cornersStore.setState({ points: [], error: made.error });
    return undefined;
  }
  disarmCorners();
  return made.footprint;
}

/** The dialog's **Two corners** button (`spec.extra` of the Box). */
export function BoxCorners({ open, controller }: DialogExtraProps) {
  const state = useStore(cornersStore);
  const armed = state.dialog === open.id;
  // A closed dialog takes its corners with it.
  useEffect(() => {
    return () => {
      if (cornersStore.getState().dialog === open.id) disarmCorners();
    };
  }, [open.id]);
  const onKeyDown = (event: KeyboardEvent | React.KeyboardEvent) => {
    // Esc disarms, not the dialog (a text field keeps its own Esc).
    if (event.key !== 'Escape' || !armed) return;
    event.preventDefault();
    disarmCorners();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: forwards Escape for the armed corners.
    <div className="flex flex-col gap-1.5" onKeyDown={onKeyDown}>
      <Button
        data-corners={armed ? state.points.length : 'off'}
        aria-pressed={armed}
        onClick={() => {
          if (armed) {
            disarmCorners();
            return;
          }
          armCorners(open.id);
          // The plane's pick field takes the clicks (they are corners, not planes).
          controller.pickInto('plane');
        }}
      >
        {armed ? 'Picking corners…' : 'Two corners'}
      </Button>
      {armed && (
        <p className="text-xs text-muted" role="status">
          Click {state.points.length === 0 ? 'the first' : 'the opposite'} corner on the plane.
        </p>
      )}
      {state.error && (
        <p className="text-xs text-error" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
