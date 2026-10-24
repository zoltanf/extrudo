/**
 * Render Picture (P6-15, ADR-0101): the choices the Render dialog offers and
 * a design's `render` section stores. Core owns the words (labels and hints)
 * so the dialog, the CLI and the docs say the same thing.
 */
import type { RenderSettings } from './schema';

export const RENDER_PRESETS = ['studio', 'table', 'workbench', 'outdoor'] as const;
export type RenderPreset = (typeof RENDER_PRESETS)[number];

export const RENDER_FINISHES = [
  'matte',
  'glossy',
  'translucent',
  'resin',
  'metal',
  'wood',
] as const;
export type RenderFinish = (typeof RENDER_FINISHES)[number];

/** Who renders the picture (ADR-0101 §6): the app itself (the default; absent means `app`) or Blender. */
export const RENDER_ENGINES = ['app', 'blender'] as const;
export type RenderEngine = (typeof RENDER_ENGINES)[number];

export const RENDER_QUALITIES = ['draft', 'standard', 'high'] as const;
export type RenderQuality = (typeof RENDER_QUALITIES)[number];

/** The dialog's size choices, [width, height] in pixels. */
export const RENDER_SIZES: readonly (readonly [number, number])[] = [
  [1280, 720],
  [1920, 1080],
  [2560, 1440],
  [1080, 1080],
];
export const RENDER_MIN_SIDE = 256;
export const RENDER_MAX_SIDE = 8192;

/** The finish of a body the `finishes` record doesn't name. */
export const DEFAULT_FINISH: RenderFinish = 'matte';

/** What a design without a `render` section renders with: what the viewport shows (owner, 2026-10-23). */
export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  preset: 'studio',
  camera: { kind: 'current' },
  width: 1920,
  height: 1080,
  quality: 'standard',
};

/** Labels and one-line hints for the dialog's preset choices. */
export const RENDER_PRESET_INFO: Record<RenderPreset, { label: string; hint: string }> = {
  studio: { label: 'Studio', hint: 'A white sweep and soft light: clean product shot.' },
  table: { label: 'Wooden table', hint: 'On a wooden table top, warm light from the side.' },
  workbench: { label: 'Workbench', hint: 'A cutting mat with a 10 mm grid, cool light.' },
  outdoor: { label: 'Outdoor', hint: 'On the ground under a sunny sky.' },
};

/** Labels and one-line hints for the dialog's finish choices. */
export const RENDER_FINISH_INFO: Record<RenderFinish, { label: string; hint: string }> = {
  matte: { label: 'Matte', hint: 'Matte PLA.' },
  glossy: { label: 'Glossy', hint: 'Glossy PLA or PETG.' },
  translucent: { label: 'Translucent', hint: 'Clear PETG or resin, light passes through.' },
  resin: { label: 'Resin', hint: 'Smooth, slightly waxy.' },
  metal: { label: 'Metal', hint: 'Brushed metal.' },
  wood: { label: 'Wood', hint: 'Wood grain, tinted with the body colour.' },
};
