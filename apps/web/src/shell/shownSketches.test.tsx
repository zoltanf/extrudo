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
import { openSketchProfiles } from '../sketch/profiles';
import type { RegionsClient, RegionsEntry, RegionsState } from '../sketch/regionsClient';
import { fillFailed, noteUnbuiltFill, type ProfileFill } from '../viewport/profileFills';
import type { SketchDrawing } from '../viewport/sketchGeometry';
import {
  keepDrawings,
  NO_KEPT_DRAWINGS,
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

/**
 * The base the shell makes after a document change: every drawing, frame and list a new
 * object, the same values; `changed` sketches get new data (an edit).
 */
function remade(base: ShownSketchBase, changed: readonly number[] = []): ShownSketchBase {
  return {
    ...base,
    items: base.items.map((item, i) => {
      const { drawing } = item;
      const data = changed.includes(i)
        ? (Object.freeze({ ...drawing.data }) as SketchData)
        : drawing.data;
      return {
        ...item,
        drawing: {
          ...drawing,
          data,
          frame: JSON.parse(JSON.stringify(drawing.frame)) as SketchFrame,
          selectedEntities: [...(drawing.selectedEntities ?? [])],
          selectedProfiles: [...(drawing.selectedProfiles ?? [])],
        },
      } as typeof item;
    }),
  };
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

  it('a document change in one of 30 sketches renders that sketch only (ADR-0159 §2)', () => {
    const base = base30();
    const { client } = fakeClient();
    for (const k of Object.keys(renders)) delete renders[k];
    const tree = (b: ShownSketchBase) => (
      <ShownSketchesProvider base={b} client={client}>
        <Layer />
      </ShownSketchesProvider>
    );
    const view = render(tree(base));
    const before = { ...renders };
    const after = (name: string) => (renders[name] ?? 0) - (before[name] ?? 0);
    const edited = remade(base, [7]);
    view.rerender(tree(edited));
    const sketches = Object.keys(renders).filter((k) => k.startsWith('sketch sk'));
    expect(sketches.filter((k) => after(k) > 0)).toEqual(['sketch sk7']);
    // The same drawings again (a selection elsewhere, say): no sketch renders.
    const still = { ...renders };
    view.rerender(tree(remade(edited)));
    expect(Object.keys(renders).filter((k) => renders[k] !== still[k])).toEqual(['sketch layer']);
  });

  it('keeps a drawing that draws the same, by value, and never writes into the base', () => {
    const base = base30();
    const first = keepDrawings(base, NO_KEPT_DRAWINGS);
    // Nothing kept yet: the base itself.
    expect(first.base).toBe(base);
    expect(first.kept.drawings.size).toBe(30);
    // The same values in new objects: the old drawings, in a copy of the base.
    const again = remade(base);
    const frozen = JSON.stringify(again);
    const second = keepDrawings(again, first.kept);
    expect(second.base.items.map((i) => i.drawing)).toEqual(base.items.map((i) => i.drawing));
    second.base.items.forEach((item, i) => {
      expect(item.drawing).toBe(base.items[i]?.drawing);
    });
    expect(JSON.stringify(again)).toBe(frozen);
    expect(again.items[0]?.drawing).not.toBe(base.items[0]?.drawing);
    // A new base with the kept drawings comes back as itself.
    expect(keepDrawings(second.base, second.kept).base).toBe(second.base);
    // Anything drawn differently is the new drawing: data (by identity), a selection, a frame.
    const changes: ((d: SketchDrawing) => SketchDrawing)[] = [
      (d) => ({ ...d, data: Object.freeze({ ...d.data }) as SketchData }),
      (d) => ({ ...d, selectedEntities: ['e1'] }),
      (d) => ({ ...d, frame: { ...d.frame, origin: [0, 0, 1] } }),
      (d) => ({ ...d, showPoints: true }),
      (d) => ({ ...d, status: {} }),
    ];
    for (const change of changes) {
      const next = {
        ...base,
        items: base.items.map((item, i) =>
          i === 3 ? { ...item, drawing: change(item.drawing) } : item,
        ),
      } as ShownSketchBase;
      const out = keepDrawings(next, first.kept);
      expect(out.base.items[3]?.drawing).toBe(next.items[3]?.drawing);
      expect(out.base.items[4]?.drawing).toBe(base.items[4]?.drawing);
    }
    // Only the shown sketches are kept: a hidden one is let go.
    const fewer = { ...base, items: base.items.slice(0, 10) };
    expect([...keepDrawings(fewer, first.kept).kept.drawings.keys()]).toHaveLength(10);
    // A new fonts version keeps nothing: every drawing is the new one.
    const fonts = keepDrawings({ ...again, fontsVersion: 1 }, first.kept);
    fonts.base.items.forEach((item, i) => {
      expect(item.drawing).toBe(again.items[i]?.drawing);
    });
    // And from then on the drawings made for it are kept again.
    const fontsAgain = keepDrawings({ ...remade(again), fontsVersion: 1 }, fonts.kept);
    expect(fontsAgain.base.items[0]?.drawing).toBe(again.items[0]?.drawing);
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

describe('the open sketch whose fill fails to build', () => {
  it('goes unshaded, counts in the note and gives its fill bytes back, with no new base', () => {
    const data = Object.freeze({ ...emptySketchData() }) as SketchData;
    const profiles = openSketchProfiles(data, 0);
    const closed = Object.freeze({ ...emptySketchData() }) as SketchData;
    // What the shell's base holds: the open claim (fillable), and a closed sketch still asked for.
    const base: ShownSketchBase = {
      items: [
        {
          drawing: { id: 'open', frame, data, active: true, selectedProfiles: [] },
          kind: 'open',
          claim: { id: 'open', active: true, regionBytes: 10, fillBytes: 1_000, fillable: true },
        },
        {
          drawing: { id: 'closed', frame, data: closed, active: false, selectedProfiles: [] },
          kind: 'closed',
          job: { key: 'closed', data: closed, version: 0, text: false },
        },
      ],
      fontsVersion: 0,
      activeSketchId: 'open',
    };
    const { client, asked } = fakeClient();
    const view = render(
      <ShownSketchesProvider base={base} client={client}>
        <Note />
        <Layer />
      </ShownSketchesProvider>,
    );
    const note = () => view.container.querySelector('output')?.dataset.unshaded;
    const allowance = () => (asked.at(-1) as { allowance?: number }[])[0]?.allowance ?? 0;
    expect(note()).toBe('0');
    const before = allowance();
    act(() => noteUnbuiltFill(profiles));
    expect(fillFailed(profiles)).toBe(true);
    // The same base: only the provider looked again.
    expect(note()).toBe('1');
    expect(allowance() - before).toBe(1_000);
  });
});
