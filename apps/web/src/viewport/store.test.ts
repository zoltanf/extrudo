import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { basis, orientationFor, sameView, type View, viewProject, viewRay } from './camera';
import { gridStep } from './grid';
import { createViewportStore, DEFAULT_SETTINGS, TRANSITION_MS } from './store';

function setup(options: { reducedMotion?: boolean; stored?: Record<string, unknown> } = {}) {
  let time = 1000;
  const preferences = memoryPreferences(options.stored);
  const store = createViewportStore({
    preferences,
    now: () => time,
    reducedMotion: () => options.reducedMotion ?? false,
  });
  return {
    store,
    preferences,
    advance(ms: number) {
      time += ms;
      store.getState().step(time);
    },
  };
}

const back = (view: View) => {
  const b = basis(view).back;
  return [b.x, b.y, b.z].map((c) => Math.round(c * 1e6) / 1e6 + 0);
};

describe('viewport store', () => {
  it('animates to a ViewCube direction in 350 ms and fits the scene', () => {
    const { store, advance } = setup();
    store.getState().home(true);
    store.getState().lookFrom([0, 0, 1]);
    expect(store.getState().transition).toBeDefined();

    advance(TRANSITION_MS / 2);
    const mid = store.getState().view;
    expect(back(mid)).not.toEqual([0, 0, 1]);

    advance(TRANSITION_MS / 2);
    expect(store.getState().transition).toBeUndefined();
    expect(back(store.getState().view)).toEqual([0, 0, 1]);
    expect(store.getState().view.target).toEqual([0, 0, 0]);
  });

  it('jumps straight there under reduced motion', () => {
    const { store } = setup({ reducedMotion: true });
    store.getState().lookFrom([1, 0, 0]);
    expect(store.getState().transition).toBeUndefined();
    expect(back(store.getState().view)).toEqual([1, 0, 0]);
  });

  it('stops the animation when the user drags', () => {
    const { store, advance } = setup();
    store.getState().lookFrom([0, 0, 1]);
    advance(50);
    const dragged: View = { target: [5, 0, 0], orientation: orientationFor([0, -1, 0]), size: 30 };
    store.getState().setView(dragged);
    advance(500);
    expect(store.getState().view).toEqual(dragged);
  });

  it('fits the scene bounds, or the origin area when the scene is empty', () => {
    const { store } = setup({ reducedMotion: true });
    store.getState().setAspect(1);
    store.getState().fit();
    const empty = store.getState().view.size;
    store.getState().setBounds({ center: [100, 0, 0], radius: 10 });
    store.getState().fit();
    expect(store.getState().view.target).toEqual([100, 0, 0]);
    expect(store.getState().view.size).toBeLessThan(empty);
  });

  it('fits into the part of the view a floating panel leaves open, centred there', () => {
    // A 40 × 20 plate seen from the top in a 1000 × 500 view, orthographic.
    const { store } = setup({ reducedMotion: true });
    store.getState().setProjection('orthographic');
    store.getState().setAspect(2, 1000);
    store.getState().setBounds({
      center: [0, 0, 0],
      radius: 23,
      box: { min: [-20, -10, 0], max: [20, 10, 0] },
    });
    store.getState().lookFrom([0, 0, 1]);
    const open = store.getState().view;
    // The browser covers the left 250 px: the plate fits the other 750.
    store.getState().setCover(250);
    store.getState().lookFrom([0, 0, 1]);
    const covered = store.getState().view;
    expect(covered.size).toBeGreaterThan(open.size);
    // Orbiting still turns about the plate's centre: the target stays on it.
    expect(covered.target).toEqual(open.target);
    // Where the plate's centre and ends land, in px from the view's left edge.
    const px = (x: number) =>
      (((viewProject(covered, 'orthographic', 2, [x, 0, 0])?.[0] ?? 0) + 1) / 2) * 1000;
    expect(px(0)).toBeCloseTo(250 + 750 / 2, 6);
    expect(px(-20)).toBeGreaterThan(250);
    expect(px(20)).toBeLessThan(1000);
    // A pick ray through that pixel finds the centre again.
    const ray = viewRay(covered, 'orthographic', 2, [(px(0) / 1000) * 2 - 1, 0]);
    expect(ray.origin.x).toBeCloseTo(0, 6);
    // Uncovered again, fitting centres on the target as before.
    store.getState().setCover(0);
    store.getState().lookFrom([0, 0, 1]);
    expect(store.getState().view).toEqual(open);
  });

  it('home keeps the size fitted and the direction front-right-top', () => {
    const { store } = setup({ reducedMotion: true });
    store
      .getState()
      .setView({ target: [9, 9, 9], orientation: orientationFor([0, 0, 1]), size: 3 });
    store.getState().home();
    const v = store.getState().view;
    const c = 1 / Math.sqrt(3);
    expect(back(v)).toEqual([c, -c, c].map((x) => Math.round(x * 1e6) / 1e6));
    expect(v.target).toEqual([0, 0, 0]);
  });

  it('does not animate to the view it already shows', () => {
    const { store } = setup();
    store.getState().home(true);
    const before = store.getState().view;
    store.getState().home();
    expect(store.getState().transition).toBeUndefined();
    expect(sameView(store.getState().view, before)).toBe(true);
  });

  it('keeps display settings in the preferences', () => {
    const { store, preferences } = setup();
    expect(store.getState().projection).toBe('perspective');
    store.getState().setProjection('orthographic');
    store.getState().setVisualStyle('wireframe');
    store.getState().setGrid(false);
    store.getState().setPreset('blender');
    store.getState().setOrigin('xy', true);
    store.getState().setSketchConstraints(false);
    const again = createViewportStore({ preferences });
    expect(again.getState().sketchConstraints).toBe(false);
    expect(again.getState().projection).toBe('orthographic');
    expect(again.getState().visualStyle).toBe('wireframe');
    expect(again.getState().grid).toBe(false);
    expect(again.getState().preset).toBe('blender');
    expect(again.getState().origin).toEqual({ ...DEFAULT_SETTINGS.origin, xy: true });
  });

  it('fills in settings missing from older preferences', () => {
    const { store } = setup({ stored: { viewport: { grid: false, origin: { z: false } } } });
    expect(store.getState().grid).toBe(false);
    expect(store.getState().visualStyle).toBe(DEFAULT_SETTINGS.visualStyle);
    expect(store.getState().sketchConstraints).toBe(true);
    expect(store.getState().origin).toEqual({ ...DEFAULT_SETTINGS.origin, z: false });
  });
});

describe('selection filter', () => {
  it('starts with everything, changes per kind, resets, and is not a preference', () => {
    const { store, preferences } = setup();
    expect(Object.values(store.getState().selectionFilter).every(Boolean)).toBe(true);
    store.getState().setSelectionFilter('faces', false);
    expect(store.getState().selectionFilter.faces).toBe(false);
    expect(store.getState().selectionFilter.edges).toBe(true);
    expect(JSON.stringify(preferences.get('viewport', {}))).not.toContain('faces');
    store.getState().resetSelectionFilter();
    expect(store.getState().selectionFilter.faces).toBe(true);
  });
});

describe('gridStep', () => {
  it('snaps to the finest grid level at least 12 px wide, never below 1 mm', () => {
    expect(gridStep(0.01)).toBe(1);
    expect(gridStep(0.1)).toBe(10);
    expect(gridStep(0.5)).toBe(10);
    expect(gridStep(1)).toBe(100);
  });
});
