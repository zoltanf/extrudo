// @vitest-environment jsdom
/**
 * The real `Sketches` under a batch of profile results (ADR-0156's amendment of
 * 2026-11-19): a batch for 3 of 30 shown sketches renders those 3 sketches and
 * their fills, no other. A sketch counts a render through `useFrame` (it calls it
 * once a render; the view's own loop is mocked away); a fill through a counting
 * stand-in, which `Sketches` memoises like the real one.
 */
import {
  emptySketchData,
  originPlaneRef,
  planeFrame,
  type SketchData,
  type SketchFrame,
} from '@extrudo/core';
import { act, cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { memoryPreferences } from '../platform';
import {
  type ShownSketchBase,
  ShownSketchesProvider,
  useShownDrawings,
} from '../shell/shownSketches';
import type { FlatRegions } from '../sketch/flatRegions';
import type { RegionsClient, RegionsEntry, RegionsState } from '../sketch/regionsClient';
import type { Rgba } from './colors';
import type { ProfileFill } from './profileFills';
import type { SketchDrawing } from './sketchGeometry';
import { createViewportStore } from './store';

const renders = vi.hoisted(() => ({ sketches: 0, fills: new Map<string, number>() }));
vi.mock('@react-three/fiber', () => ({
  useThree: (pick: (s: { size: { height: number } }) => unknown) => pick({ size: { height: 600 } }),
  useFrame: () => {
    renders.sketches++;
  },
}));
vi.mock('./SketchFill', () => ({
  SketchFill: ({ drawing }: { drawing: SketchDrawing }) => {
    renders.fills.set(drawing.id, (renders.fills.get(drawing.id) ?? 0) + 1);
    return null;
  },
}));
const { Sketches } = await import('./Sketches');

// react-dom doesn't know three's elements (`group`, `primitive`): it says so, once each.
let quiet: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => quiet.mockRestore());
afterEach(cleanup);

const frame = planeFrame(originPlaneRef('origin:xy')) as SketchFrame;
const ink: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const colors = { free: ink, fixed: ink, conflict: ink };
const shades = { normal: ink, hover: ink, selected: ink };
const store = createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true });

function View() {
  return (
    <Sketches
      store={store}
      sketches={useShownDrawings()}
      colors={colors}
      construction={ink}
      showPoints={false}
      profileColors={shades}
      highlight={ink}
      projected={ink}
    />
  );
}

describe('Sketches renders', () => {
  it('a batch for 3 of 30 sketches renders those 3 sketches and fills only', () => {
    const items: ShownSketchBase['items'] = Array.from({ length: 30 }, (_, i) => {
      const data = Object.freeze({ ...emptySketchData() }) as SketchData;
      return {
        drawing: {
          id: `sk${i}`,
          frame,
          data,
          active: false,
          selectedEntities: [],
          selectedProfiles: [],
        },
        kind: 'closed' as const,
        job: { key: `sk${i}`, data, version: 0, text: false },
      };
    });
    const entries = new Map<SketchData, RegionsEntry>();
    const regions = createStore<RegionsState>()(() => ({ version: 0, fallback: false }));
    const client = {
      store: regions,
      get: (data: SketchData) => entries.get(data),
      want: () => {},
      keep: () => {},
      addFont: () => {},
    } as unknown as RegionsClient;
    render(
      <ShownSketchesProvider
        base={{ items, fontsVersion: 0, activeSketchId: undefined }}
        client={client}
      >
        <View />
      </ShownSketchesProvider>,
    );
    expect(renders.sketches).toBe(30);
    expect(renders.fills.size).toBe(30);
    renders.sketches = 0;
    renders.fills.clear();
    act(() => {
      for (const i of [4, 11, 27]) {
        entries.set(items[i]?.drawing.data as SketchData, {
          state: 'done',
          version: 0,
          text: false,
          regions: { ids: [] } as unknown as FlatRegions,
          fill: {} as ProfileFill,
          regionBytes: 10,
          fillBytes: 10,
          fillable: true,
        });
      }
      regions.setState((s) => ({ version: s.version + 1 }));
    });
    expect(renders.sketches).toBe(3);
    expect([...renders.fills.keys()].sort()).toEqual(['sk11', 'sk27', 'sk4']);
  });

  it('a document change in one of 30 sketches renders that sketch only (ADR-0159 §2)', () => {
    const regions = createStore<RegionsState>()(() => ({ version: 0, fallback: false }));
    const client = {
      store: regions,
      get: () => undefined,
      want: () => {},
      keep: () => {},
      addFont: () => {},
    } as unknown as RegionsClient;
    // What the shell makes for a document: every drawing, frame and list a new object.
    const shell = (datas: readonly SketchData[]): ShownSketchBase => ({
      items: datas.map((data, i) => ({
        drawing: {
          id: `sk${i}`,
          frame: JSON.parse(JSON.stringify(frame)) as SketchFrame,
          data,
          active: false,
          selectedEntities: [],
          selectedProfiles: [],
        },
        kind: 'closed' as const,
        job: { key: `sk${i}`, data, version: 0, text: false },
      })),
      fontsVersion: 0,
      activeSketchId: undefined,
    });
    const datas = Array.from(
      { length: 30 },
      () => Object.freeze({ ...emptySketchData() }) as SketchData,
    );
    const tree = (base: ShownSketchBase) => (
      <ShownSketchesProvider base={base} client={client}>
        <View />
      </ShownSketchesProvider>
    );
    const view = render(tree(shell(datas)));
    renders.sketches = 0;
    renders.fills.clear();
    // An edit in sketch 9 (a dragged point): new data for it, the same for the others.
    const edited = datas.map((d, i) => (i === 9 ? (Object.freeze({ ...d }) as SketchData) : d));
    view.rerender(tree(shell(edited)));
    expect(renders.sketches).toBe(1);
    expect([...renders.fills.keys()]).toEqual(['sk9']);
  });
});
