// @vitest-environment jsdom
/**
 * Counted renders of the browser's rows (ADR-0159 §8): the browser renders on every document
 * change and every selection change, and a row renders only when what it shows does. Renders
 * are counted the way React's devtools see them: a component counts once per commit in which
 * it did work (a hook installed before React loads).
 */
import {
  type BodyId,
  createDocument,
  createDocumentStore,
  type Feature,
  type FeatureId,
  type FeatureStatus,
  originPlaneRef,
  sketchInputs,
} from '@extrudo/core';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const renders = vi.hoisted(() => {
  const counts = new Map<string, number>();
  const seen = new WeakMap<object, Set<object>>();
  // biome-ignore lint/suspicious/noExplicitAny: a React fiber, walked generically.
  type Fiber = any;
  const name = (t: Fiber): string =>
    (t && (t.displayName || t.name || t.type?.displayName || t.type?.name)) || '?';
  (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    isDisabled: false,
    inject() {
      return 1;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot(_id: number, root: Fiber) {
      const before = seen.get(root) ?? new Set();
      const now = new Set<object>();
      const stack: Fiber[] = [root.current];
      while (stack.length) {
        const f = stack.pop();
        now.add(f);
        // Function, forwardRef and simple memo components that did work in this commit (a memo
        // with a comparator, tag 14, wraps a fiber of its own component, which is counted).
        if ([0, 1, 11, 15].includes(f.tag) && f.flags & 1 && !before.has(f)) {
          const n = name(f.type);
          counts.set(n, (counts.get(n) ?? 0) + 1);
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      seen.set(root, now);
    },
  };
  return counts;
});

const { TooltipProvider } = await import('../design-system');
const { createViewportStore } = await import('../viewport/store');
const { memoryPreferences } = await import('../platform');
const { bodyEntries } = await import('./bodies');
const { BrowserPanel } = await import('./BrowserPanel');

afterEach(cleanup);

/** Every action a no-op, `canEdit` true (the test watches renders). */
const stub = <T,>(answers: Record<string, unknown> = {}) =>
  new Proxy({}, { get: (_, key) => answers[key as string] ?? (() => undefined) }) as T;

function design() {
  const doc = createDocument();
  const features: Feature[] = Array.from({ length: 30 }, (_, i) => ({
    id: `sk${i}` as FeatureId,
    type: 'sketch',
    name: `Sketch${i + 1}`,
    suppressed: false,
    inputs: sketchInputs(originPlaneRef('origin:xy')),
  }));
  // Every body named: an unnamed body's name is its place among the unnamed ones.
  const bodies = Object.fromEntries(
    Array.from({ length: 30 }, (_, i) => [
      `b${i}` as BodyId,
      { name: `Plate ${i + 1}`, visible: true },
    ]),
  );
  return { ...doc, features, bodies, timelineMarker: features.length };
}
const live = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`b${i}`, {}]));

function view() {
  const store = createDocumentStore(design());
  const viewport = createViewportStore({
    preferences: memoryPreferences(),
    reducedMotion: () => true,
  });
  const actions = stub({ canEdit: () => true });
  const bodyActions = stub();
  const removed: BodyId[][] = [];
  const bodyActionsWithRemove = new Proxy(bodyActions as object, {
    get: (target, key) =>
      key === 'remove' ? (ids: BodyId[]) => removed.push(ids) : Reflect.get(target as object, key),
  });
  const fixed = {
    store,
    viewport,
    width: 248,
    collapsed: false,
    actions,
    bodyActions: bodyActionsWithRemove,
    componentActions: stub(),
    viewActions: stub(),
  } as const;
  type Props = Parameters<typeof BrowserPanel>[0];
  const tree = (more: Partial<Props>) => (
    <TooltipProvider>
      <BrowserPanel
        {...(fixed as unknown as Props)}
        bodies={bodyEntries(store.getState().doc, live)}
        {...more}
      />
    </TooltipProvider>
  );
  const out = render(tree({}));
  return {
    out,
    removed,
    /**
     * Rows rendered by a document edit (if any) and the shell's next render of the browser with
     * these props, which hands it new body entries as the shell does on every render.
     */
    change(more: Partial<Props> = {}, edit?: (doc: Doc) => Doc) {
      renders.clear();
      if (edit) act(() => store.setState((s) => ({ doc: edit(s.doc) })));
      out.rerender(tree(more));
      return {
        sketches: renders.get('SketchLeaf') ?? 0,
        bodies: renders.get('BodyRow') ?? 0,
      };
    },
  };
}

type Doc = ReturnType<typeof design>;
const none = { sketches: 0, bodies: 0 };

describe('BrowserPanel rows (ADR-0159 §8)', () => {
  it('a render with nothing new renders no row', () => {
    expect(view().change()).toEqual(none);
  }, 30_000);

  it('a document edit inside one sketch renders that sketch row and no body row', () => {
    const v = view();
    const edit = (doc: Doc) => ({
      ...doc,
      features: doc.features.map((f, i) => (i === 7 ? { ...f, inputs: { ...f.inputs } } : f)),
    });
    expect(v.change({}, edit)).toEqual({ sketches: 1, bodies: 0 });
  }, 30_000);

  it('a selection change renders only the body rows it selects or clears', () => {
    const v = view();
    expect(v.change({ selectedBodies: new Set(['b3']) })).toEqual({ sketches: 0, bodies: 1 });
    expect(v.change({ selectedBodies: new Set(['b3', 'b5']) })).toEqual({ sketches: 0, bodies: 1 });
    expect(v.change({ selectedBodies: new Set(['b5']) })).toEqual({ sketches: 0, bodies: 1 });
  }, 30_000);

  it("a row's Delete takes the latest selection, although the row didn't render for it", () => {
    const v = view();
    v.change({ selectedBodies: new Set(['b3']) });
    // b4 joins the selection: b3's row doesn't render; its Delete still takes both.
    expect(v.change({ selectedBodies: new Set(['b3', 'b4']) })).toEqual({ sketches: 0, bodies: 1 });
    const row = v.out.container.querySelector(
      '[data-body="b3"] button[aria-pressed]',
    ) as HTMLElement;
    fireEvent.keyDown(row, { key: 'Delete' });
    expect(v.removed).toEqual([['b3', 'b4']]);
  }, 30_000);

  it("a body row renders when its entry's metadata changes, and only that row", () => {
    const v = view();
    const named = (doc: Doc) => ({
      ...doc,
      bodies: { ...doc.bodies, ['b2' as BodyId]: { name: 'Shelf', visible: true } },
    });
    expect(v.change({}, named)).toEqual({ sketches: 0, bodies: 1 });
    const hidden = (doc: Doc) => ({
      ...doc,
      bodies: { ...doc.bodies, ['b2' as BodyId]: { name: 'Shelf', visible: false } },
    });
    expect(v.change({}, hidden)).toEqual({ sketches: 0, bodies: 1 });
  }, 30_000);

  it('a sketch row renders when its problem, its being active or the marker changes', () => {
    const v = view();
    const error: FeatureStatus = { status: 'error', message: 'It failed.' };
    // A new status for one sketch: its row alone.
    expect(v.change({ statuses: { sk4: error } })).toEqual({ sketches: 1, bodies: 0 });
    // The same statuses again in a new object: no row.
    expect(v.change({ statuses: { sk4: error } })).toEqual(none);
    // The active sketch: its row alone.
    expect(v.change({ statuses: { sk4: error }, activeSketchId: 'sk9' as FeatureId })).toEqual({
      sketches: 1,
      bodies: 0,
    });
    // The marker moves: every sketch row shows it in its menu, and renders.
    const marker = (doc: Doc) => ({ ...doc, timelineMarker: 20 });
    expect(
      v.change({ statuses: { sk4: error }, activeSketchId: 'sk9' as FeatureId }, marker).sketches,
    ).toBe(30);
  }, 30_000);
});
