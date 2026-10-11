import { describe, expect, it } from 'vitest';
import {
  dragAction,
  dragZoomFactor,
  type NavAction,
  type NavPreset,
  type PointerInput,
  wheelAction,
} from './navigation';

const LEFT = 0;
const MIDDLE = 1;
const RIGHT = 2;

const input = (button: number, mods: Partial<PointerInput> = {}): PointerInput => ({
  button,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe('dragAction', () => {
  it.each<[NavPreset, PointerInput, NavAction | undefined]>([
    // Extrudo, the default (UI spec §3.1): Onshape's buttons swapped
    ['extrudo', input(MIDDLE), 'orbit'],
    ['extrudo', input(MIDDLE, { ctrlKey: true }), 'pan'],
    ['extrudo', input(RIGHT), 'pan'],
    ['extrudo', input(LEFT), undefined],
    // Shift orbit
    ['shift-orbit', input(MIDDLE), 'pan'],
    ['shift-orbit', input(MIDDLE, { shiftKey: true }), 'orbit'],
    ['shift-orbit', input(LEFT), undefined],
    ['shift-orbit', input(RIGHT), undefined],
    // Blender
    ['blender', input(MIDDLE), 'orbit'],
    ['blender', input(MIDDLE, { shiftKey: true }), 'pan'],
    ['blender', input(MIDDLE, { ctrlKey: true }), 'zoom'],
    ['blender', input(LEFT), undefined],
    // Onshape / SolidWorks
    ['onshape', input(RIGHT), 'orbit'],
    ['onshape', input(RIGHT, { ctrlKey: true }), 'pan'],
    ['onshape', input(MIDDLE), 'pan'],
    ['onshape', input(LEFT), undefined],
    // Trackpad
    ['trackpad', input(LEFT, { altKey: true }), 'orbit'],
    ['trackpad', input(LEFT, { altKey: true, shiftKey: true }), 'pan'],
    ['trackpad', input(LEFT), undefined],
  ])('%s: %o → %s', (preset, pointer, expected) => {
    expect(dragAction(preset, pointer)).toBe(expected);
  });

  it('turns a left-drag into the active nav-bar tool in every preset', () => {
    for (const preset of ['extrudo', 'shift-orbit', 'blender', 'onshape', 'trackpad'] as const) {
      expect(dragAction(preset, input(LEFT), 'zoom')).toBe('zoom');
      expect(dragAction(preset, input(LEFT), 'pan')).toBe('pan');
    }
    // Other buttons keep their mapping.
    expect(dragAction('shift-orbit', input(MIDDLE), 'orbit')).toBe('pan');
  });
});

describe('wheelAction', () => {
  const wheel = (
    deltaY: number,
    mods: { ctrlKey?: boolean; deltaMode?: number; deltaX?: number } = {},
  ) => ({
    deltaX: mods.deltaX ?? 0,
    deltaY,
    deltaMode: mods.deltaMode ?? 0,
    ctrlKey: mods.ctrlKey ?? false,
  });

  it('zooms out on scroll down and in on scroll up', () => {
    const out = wheelAction('shift-orbit', wheel(100));
    const into = wheelAction('shift-orbit', wheel(-100));
    if (out.action !== 'zoom' || into.action !== 'zoom') throw new Error('expected zoom');
    expect(out.factor).toBeGreaterThan(1);
    expect(into.factor).toBeLessThan(1);
    expect(out.factor * into.factor).toBeCloseTo(1, 12);
  });

  it('counts line-mode deltas as 16 px', () => {
    const lines = wheelAction('shift-orbit', wheel(3, { deltaMode: 1 }));
    const pixels = wheelAction('shift-orbit', wheel(48));
    expect(lines).toEqual(pixels);
  });

  it('pans on a two-finger scroll and zooms on a pinch with the trackpad preset', () => {
    expect(wheelAction('trackpad', wheel(10, { deltaX: 4 }))).toEqual({
      action: 'pan',
      dx: -4,
      dy: -10,
    });
    expect(wheelAction('trackpad', wheel(10, { ctrlKey: true })).action).toBe('zoom');
    // Other presets zoom on a pinch too.
    expect(wheelAction('blender', wheel(10, { ctrlKey: true })).action).toBe('zoom');
  });
});

describe('dragZoomFactor', () => {
  it('zooms out when dragging down', () => {
    expect(dragZoomFactor(20)).toBeGreaterThan(1);
    expect(dragZoomFactor(-20)).toBeLessThan(1);
    expect(dragZoomFactor(0)).toBe(1);
  });
});
