import {
  createDocument,
  createSessionStore,
  originPlaneRef,
  type SessionStore,
  type SketchFrame,
} from '@extrudo/core';
import { useMemo } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { orientationFor } from '../viewport/camera';
import { createViewportStore } from '../viewport/store';
import { clipsSummary, type SectionClip, type SectionState } from './clip';
import { clipsWithSlice, rowClip, useSection } from './useSection';

/**
 * The sketch slice's clip in `useSection` (P4-12, ADR-0031 §5). The sign
 * rule and its keeping live in `sketchSliceDecision` (clip.test.ts); here
 * are the render path and the list assembly. The server render reads each
 * store's initial state, so the palette's preference is seeded in it, and
 * the person's own planes are tested at `clipsWithSlice` directly.
 */

/** Turns the camera to below the sketch plane (under the plane at z = 20). */
function below(viewport: ReturnType<typeof createViewportStore>) {
  viewport
    .getState()
    .setView({ target: [0, 0, 0], orientation: orientationFor([0, 0, -1]), size: 100 });
}

function Probe({
  session,
  viewport,
  slice,
  model,
}: {
  session: SessionStore;
  viewport: ReturnType<typeof createViewportStore>;
  slice: SketchFrame | undefined;
  model: boolean;
}) {
  const section = useSection({
    session,
    viewport,
    doc: useMemo(() => createDocument(), []),
    bodies: {},
    construction: undefined,
    kernel: undefined,
    notify: () => {},
    active: false,
    model,
    slice,
    hover: undefined,
  });
  return <p data-clips={clipsSummary(section.clips)} />;
}

function render(
  session: SessionStore,
  viewport: ReturnType<typeof createViewportStore>,
  slice: SketchFrame | undefined,
  model: boolean,
) {
  return renderToStaticMarkup(
    <Probe session={session} viewport={viewport} slice={slice} model={model} />,
  );
}

describe('the sketch slice in useSection', () => {
  // The sketch plane 20 mm up, normal up.
  const slice: SketchFrame = {
    origin: [0, 0, 20],
    x: [1, 0, 0],
    y: [0, 1, 0],
    normal: [0, 0, 1],
  };
  const setup = (slicePreference: boolean) => {
    const session = createSessionStore();
    const viewport = createViewportStore({
      preferences: memoryPreferences({ viewport: { sketchSlice: slicePreference } }),
    });
    return { session, viewport };
  };

  it('cuts the side the camera is on while a sketch is open', () => {
    // The store's home view looks from above.
    const { session, viewport } = setup(true);
    const out = render(session, viewport, slice, false);
    expect(out).toContain('data-clips="0,0,20:0,0,1"');
  });

  it('takes the other side when the camera is below', () => {
    const { session, viewport } = setup(true);
    below(viewport);
    const out = render(session, viewport, slice, false);
    expect(out).toContain('data-clips="0,0,20:0,0,-1"');
  });

  it('goes away when the sketch closes', () => {
    const { session, viewport } = setup(true);
    const out = render(session, viewport, undefined, true);
    expect(out).not.toContain('data-clips');
  });

  it('cuts nothing with the palette option off: a sketch is drawn without the section (ADR-0045)', () => {
    const { session, viewport } = setup(false);
    const out = render(session, viewport, slice, false);
    expect(out).not.toContain('data-clips');
  });
});

describe('the clip list with a slice', () => {
  const own: SectionState = {
    plane: originPlaneRef('origin:xy'),
    offset: '30 mm',
    flip: false,
    on: true,
  };
  const rows = [
    {
      index: 0,
      state: own,
      frame: { origin: [0, 0, 0] as const, normal: [0, 0, 1] as const },
      offset: 30,
      clip: { origin: [0, 0, 30] as const, normal: [0, 0, 1] as const },
    },
  ];
  const sliceClip: SectionClip = { origin: [0, 0, 20], normal: [0, 0, 1] };

  it('lists the person’s planes first and the slice last', () => {
    // In sketch mode the slice brings the person's own planes along.
    expect(clipsSummary(clipsWithSlice(false, sliceClip, undefined, rows))).toBe(
      '0,0,30:0,0,1;0,0,20:0,0,1',
    );
    expect(clipsSummary(clipsWithSlice(true, sliceClip, undefined, rows))).toBe(
      '0,0,30:0,0,1;0,0,20:0,0,1',
    );
  });

  it('keeps the section out of a sketch with the Slice off, and in for the model', () => {
    expect(clipsSummary(clipsWithSlice(false, undefined, undefined, rows))).toBeUndefined();
    expect(clipsSummary(clipsWithSlice(true, undefined, undefined, rows))).toBe('0,0,30:0,0,1');
  });

  it('a row clips when it is on and wanted, with a place and an offset', () => {
    const frame = { origin: [0, 0, 0] as const, normal: [0, 0, 1] as const };
    expect(rowClip(own, frame, 30, true)).toEqual({ origin: [0, 0, 30], normal: [0, 0, 1] });
    expect(rowClip(own, frame, 30, false)).toBeUndefined();
    expect(rowClip({ ...own, on: false }, frame, 30, true)).toBeUndefined();
    expect(rowClip(own, undefined, 30, true)).toBeUndefined();
    expect(rowClip(own, frame, undefined, true)).toBeUndefined();
  });
});
