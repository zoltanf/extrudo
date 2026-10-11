import { describe, expect, it } from 'vitest';
import {
  dragAction,
  dragZoomFactor,
  NAV_PRESETS,
  type NavAction,
  type NavPreset,
  type PointerInput,
  RENAMED_PRESETS,
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
    // Spindle, the default (UI spec §3.1): middle orbits, right pans; Shift swaps them (R3-04)
    ['spindle', input(MIDDLE), 'orbit'],
    ['spindle', input(MIDDLE, { ctrlKey: true }), 'pan'],
    ['spindle', input(MIDDLE, { metaKey: true }), 'pan'],
    ['spindle', input(MIDDLE, { shiftKey: true }), 'pan'],
    ['spindle', input(RIGHT), 'pan'],
    ['spindle', input(RIGHT, { shiftKey: true }), 'orbit'],
    ['spindle', input(LEFT), undefined],
    // Shift + a left-click stays add-to-selection.
    ['spindle', input(LEFT, { shiftKey: true }), undefined],
    // Crank: right orbits, middle pans; the same Shift swap
    ['crank', input(RIGHT), 'orbit'],
    ['crank', input(RIGHT, { ctrlKey: true }), 'pan'],
    ['crank', input(RIGHT, { shiftKey: true }), 'pan'],
    ['crank', input(MIDDLE), 'pan'],
    ['crank', input(MIDDLE, { shiftKey: true }), 'orbit'],
    ['crank', input(LEFT), undefined],
    ['crank', input(LEFT, { shiftKey: true }), undefined],
    // Glide (was "Shift orbit")
    ['glide', input(MIDDLE), 'pan'],
    ['glide', input(MIDDLE, { shiftKey: true }), 'orbit'],
    ['glide', input(LEFT), undefined],
    ['glide', input(RIGHT), undefined],
    // Blender
    ['blender', input(MIDDLE), 'orbit'],
    ['blender', input(MIDDLE, { shiftKey: true }), 'pan'],
    ['blender', input(MIDDLE, { ctrlKey: true }), 'zoom'],
    ['blender', input(LEFT), undefined],
    // Trackpad
    ['trackpad', input(LEFT, { altKey: true }), 'orbit'],
    ['trackpad', input(LEFT, { altKey: true, shiftKey: true }), 'pan'],
    ['trackpad', input(LEFT), undefined],
  ])('%s: %o → %s', (preset, pointer, expected) => {
    expect(dragAction(preset, pointer)).toBe(expected);
  });

  it('names no preset after another CAD product, and says what each does (R3-04)', () => {
    expect(NAV_PRESETS.map((p) => p.label)).toEqual([
      'Spindle',
      'Crank',
      'Glide',
      'Blender',
      'Trackpad',
    ]);
    for (const p of NAV_PRESETS) {
      expect(p.label + p.summary).not.toMatch(/onshape|solidworks|fusion|freecad|inventor/i);
      // Orbit and pan are always named, and zoom.
      expect(p.summary).toMatch(/orbit/);
      expect(p.summary).toMatch(/pan/);
      expect(p.summary).toMatch(/zoom/);
    }
    expect(RENAMED_PRESETS).toEqual({
      extrudo: 'spindle',
      onshape: 'crank',
      'shift-orbit': 'glide',
    });
  });

  it('turns a left-drag into the active nav-bar tool in every preset', () => {
    for (const preset of ['spindle', 'crank', 'glide', 'blender', 'trackpad'] as const) {
      expect(dragAction(preset, input(LEFT), 'zoom')).toBe('zoom');
      expect(dragAction(preset, input(LEFT), 'pan')).toBe('pan');
    }
    // Other buttons keep their mapping.
    expect(dragAction('glide', input(MIDDLE), 'orbit')).toBe('pan');
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
    const out = wheelAction('glide', wheel(100));
    const into = wheelAction('glide', wheel(-100));
    if (out.action !== 'zoom' || into.action !== 'zoom') throw new Error('expected zoom');
    expect(out.factor).toBeGreaterThan(1);
    expect(into.factor).toBeLessThan(1);
    expect(out.factor * into.factor).toBeCloseTo(1, 12);
  });

  it('counts line-mode deltas as 16 px', () => {
    const lines = wheelAction('glide', wheel(3, { deltaMode: 1 }));
    const pixels = wheelAction('glide', wheel(48));
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
