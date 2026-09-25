import { describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { basis, orientationFor, sameView, type View } from './camera';
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
    const again = createViewportStore({ preferences });
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
    expect(store.getState().origin).toEqual({ ...DEFAULT_SETTINGS.origin, z: false });
  });
});
