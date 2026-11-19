// @vitest-environment jsdom
/**
 * Counted renders for a batch of profile results (ADR-0156's amendment of
 * 2026-11-19): only the viewport's sketch layer, the sketches whose results
 * arrived, and the status bar's note when its counts change.
 */
import {
  emptySketchData,
  originPlaneRef,
  planeFrame,
  type SketchData,
  type SketchFrame,
} from '@extrudo/core';
import { act, cleanup, render } from '@testing-library/react';
import { memo, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { FlatRegions } from '../sketch/flatRegions';
import type { RegionsClient, RegionsEntry, RegionsState } from '../sketch/regionsClient';
import type { ProfileFill } from '../viewport/profileFills';
import type { SketchDrawing } from '../viewport/sketchGeometry';
import {
  type ShownSketchBase,
  ShownSketchesProvider,
  useShownDrawings,
  useSketchShading,
  withResults,
} from './shownSketches';

afterEach(cleanup);

const frame = planeFrame(originPlaneRef('origin:xy')) as SketchFrame;

/** Thirty closed sketches with profiles shown, each its own data object. */
function base30(): ShownSketchBase {
  return {
    items: Array.from({ length: 30 }, (_, i) => {
      const data = Object.freeze({ ...emptySketchData() }) as SketchData;
      const drawing: SketchDrawing = {
        id: `sk${i}`,
        frame,
        data,
        active: false,
        selectedEntities: [],
        selectedProfiles: [],
      };
      return {
        drawing,
        kind: 'closed' as const,
        job: { key: `sk${i}`, data, version: 0, text: false },
      };
    }),
    fontsVersion: 0,
    activeSketchId: undefined,
  };
}

/** A client whose results the test sets, one batch at a time. */
function fakeClient() {
  const store = createStore<RegionsState>()(() => ({ version: 0, fallback: false }));
  const entries = new Map<SketchData, RegionsEntry>();
  const asked: unknown[] = [];
  const client = {
    store,
    get: (data: SketchData) => entries.get(data),
    want: (jobs: unknown) => {
      asked.push(jobs);
    },
    keep: () => {},
    addFont: () => {},
    prefer: () => {},
  } as unknown as RegionsClient;
  const done = (fill = true): RegionsEntry => ({
    state: 'done',
    version: 0,
    text: false,
    regions: { ids: [] } as unknown as FlatRegions,
    ...(fill && { fill: {} as ProfileFill }),
    regionBytes: 100,
    fillBytes: 100,
    fillable: true,
  });
  const batch = (results: [SketchData, RegionsEntry][]) =>
    act(() => {
      for (const [data, entry] of results) entries.set(data, entry);
      store.setState((s) => ({ version: s.version + 1 }));
    });
  return { client, batch, done, asked };
}

const renders: Record<string, number> = {};
const count = (name: string) => {
  renders[name] = (renders[name] ?? 0) + 1;
};
// Stand-ins for the shell's other parts: elements the shell made, as children.
function Part({ name }: { name: string }) {
  count(name);
  return null;
}
const Item = memo(function Item({ drawing }: { drawing: SketchDrawing }) {
  count(`sketch ${drawing.id}`);
  return null;
});
function Layer() {
  count('sketch layer');
  return useShownDrawings().map((d) => <Item key={d.id} drawing={d} />);
}
function Note() {
  count('note');
  const { unshaded, unpickable } = useSketchShading();
  return <output data-unshaded={unshaded} data-unpickable={unpickable} />;
}

describe('ShownSketchesProvider renders', () => {
  it('a batch for 3 of 30 sketches renders the sketch layer and those 3, nothing else', () => {
    const base = base30();
    const { client, batch, done } = fakeClient();
    for (const k of Object.keys(renders)) delete renders[k];
    const shell: ReactNode = (
      <>
        <Part name="timeline" />
        <Part name="browser" />
        <Part name="toolbar" />
        <Part name="panels" />
        <Layer />
        <Note />
      </>
    );
    const view = render(
      <ShownSketchesProvider base={base} client={client}>
        {shell}
      </ShownSketchesProvider>,
    );
    const before = { ...renders };
    const data = (i: number) => base.items[i]?.drawing.data as SketchData;
    batch([
      [data(0), done()],
      [data(1), done()],
      [data(2), done()],
    ]);
    const after = (name: string) => (renders[name] ?? 0) - (before[name] ?? 0);
    for (const part of ['timeline', 'browser', 'toolbar', 'panels']) expect(after(part)).toBe(0);
    expect(after('sketch layer')).toBe(1);
    const sketches = Object.keys(renders).filter((k) => k.startsWith('sketch sk'));
    expect(sketches.filter((k) => after(k) > 0).sort()).toEqual([
      'sketch sk0',
      'sketch sk1',
      'sketch sk2',
    ]);
    // No count changed: the note didn't render.
    expect(after('note')).toBe(0);

    // A batch that makes one sketch unshaded (stopped at the deadline) renders the note.
    const mid = { ...renders };
    batch([[data(3), { ...done(), state: 'stopped' }]]);
    expect((renders.note ?? 0) - (mid.note ?? 0)).toBe(1);
    expect(view.container.querySelector('output')?.dataset.unshaded).toBe('1');
    expect(view.container.querySelector('output')?.dataset.unpickable).toBe('1');
    expect((renders['sketch sk3'] ?? 0) - (mid['sketch sk3'] ?? 0)).toBe(1);
    expect((renders['sketch sk0'] ?? 0) - (mid['sketch sk0'] ?? 0)).toBe(0);

    // A batch whose result changes nothing shown renders nothing at all.
    const still = { ...renders };
    batch([]);
    expect(renders).toEqual(still);
  });

  it('keeps a drawing while its results stay, and makes fresh jobs every time', () => {
    const base = base30();
    const { client, done } = fakeClient();
    const memoOf = new WeakMap();
    const first = withResults(base, client, undefined, memoOf);
    // Nothing found yet: every sketch is asked for, and the drawings are the shell's.
    expect(first.jobs).toHaveLength(30);
    expect(first.drawings).toEqual(base.items.map((i) => i.drawing));
    first.drawings.forEach((d, i) => {
      expect(d).toBe(base.items[i]?.drawing);
    });
    // The jobs are copies: their allowance never lands on the shell's objects.
    for (const item of base.items)
      if (item.kind === 'closed') expect(item.job.allowance).toBe(undefined);
    const results = new Map<SketchData, RegionsEntry>(
      base.items.slice(0, 5).map((i) => [i.drawing.data, done()]),
    );
    const withSome = { ...client, get: (d: SketchData) => results.get(d) } as RegionsClient;
    const second = withResults(base, withSome, undefined, memoOf);
    const third = withResults(base, withSome, undefined, memoOf);
    expect(second.drawings[0]).not.toBe(base.items[0]?.drawing);
    expect(second.drawings[0]?.fill).toBeDefined();
    second.drawings.forEach((d, i) => {
      expect(third.drawings[i]).toBe(d);
    });
    expect(second.jobs).toHaveLength(25);
    expect(second.jobs[0]).not.toBe(third.jobs[0]);
  });
});
