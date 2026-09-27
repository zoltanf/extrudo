/**
 * Viewport state (P0-05, ADR-0008): the camera view, its animation, and the
 * display settings. A vanilla Zustand store like the core stores, one per
 * open document. Nothing here is saved in the document or undoable; the
 * display settings are user preferences.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Preferences } from '../platform';
import {
  easeCamera,
  fitBox,
  fitSphere,
  homeView,
  interpolate,
  orientationFor,
  type Projection,
  sameView,
  type Vec3,
  type View,
} from './camera';
import type { NavAction, NavPreset } from './navigation';
import type { RenderStats } from './renderMeter';

export type VisualStyle = 'shaded' | 'shadedEdges' | 'wireframe' | 'hiddenEdges';

export const VISUAL_STYLES: readonly { value: VisualStyle; label: string }[] = [
  { value: 'shaded', label: 'Shaded' },
  { value: 'shadedEdges', label: 'Shaded with edges' },
  { value: 'hiddenEdges', label: 'Shaded with hidden edges' },
  { value: 'wireframe', label: 'Wireframe' },
];

export type OriginItem = 'point' | 'xy' | 'xz' | 'yz' | 'x' | 'y' | 'z';

export const ORIGIN_ITEMS: readonly { value: OriginItem; label: string }[] = [
  { value: 'point', label: 'Origin point' },
  { value: 'xy', label: 'XY plane' },
  { value: 'xz', label: 'XZ plane' },
  { value: 'yz', label: 'YZ plane' },
  { value: 'x', label: 'X axis' },
  { value: 'y', label: 'Y axis' },
  { value: 'z', label: 'Z axis' },
];

/** Display settings, kept in the user's preferences. */
export interface ViewportSettings {
  projection: Projection;
  visualStyle: VisualStyle;
  grid: boolean;
  preset: NavPreset;
  origin: Record<OriginItem, boolean>;
  /** Show the points of the sketch being edited (sketch palette). */
  sketchPoints: boolean;
  /** Show the constraint glyphs of the sketch being edited (sketch palette, P1-06). */
  sketchConstraints: boolean;
  /** Show the dimensions of the sketch being edited (sketch palette, P1-07). */
  sketchDimensions: boolean;
  /** Shade sketch profiles and let them be picked (sketch palette, P1-11). */
  sketchProfiles: boolean;
  /** Snap sketch points to the grid while drawing (sketch palette). */
  snap: boolean;
}

export const DEFAULT_SETTINGS: ViewportSettings = {
  projection: 'perspective',
  visualStyle: 'shadedEdges',
  grid: true,
  // Right-drag orbits (2026-09-27, the owner's choice over Fusion's Shift+middle-drag).
  preset: 'onshape',
  // Like Fusion, the origin planes stay hidden until something needs them.
  origin: { point: true, xy: false, xz: false, yz: false, x: true, y: true, z: true },
  sketchPoints: true,
  sketchConstraints: true,
  sketchDimensions: true,
  sketchProfiles: true,
  snap: true,
};

/** The part of the scene that "fit" frames. */
export interface Bounds {
  center: Vec3;
  radius: number;
  /** The axis-aligned box of what's shown, when known: "Fit" frames it tightly. */
  box?: { min: Vec3; max: Vec3 };
}

/** What "fit" frames in an empty document: the origin and a print-bed-sized area around it. */
export const EMPTY_BOUNDS: Bounds = { center: [0, 0, 0], radius: 60 };

/** Camera transitions (ViewCube, fit, home) take 350 ms (docs/05-brand.md §5). */
export const TRANSITION_MS = 350;

interface Transition {
  from: View;
  to: View;
  start: number;
  duration: number;
}

export interface ViewportState extends ViewportSettings {
  view: View;
  /** The running camera animation, if any. `view` follows it on each `step`. */
  transition: Transition | undefined;
  /** Width / height of the viewport, for fitting. */
  aspect: number;
  /** Visible content, or `undefined` for an empty scene. */
  bounds: Bounds | undefined;
  /** The nav-bar tool that turns a left-drag into orbit, pan or zoom. */
  tool: NavAction | undefined;
  /** Renders the view to a thumbnail PNG; set while the canvas is mounted. */
  snapshot: (() => Promise<Blob | null>) | undefined;
  /** Frames per second and frame time while the canvas is mounted (the status bar shows them). */
  renderStats: RenderStats | undefined;

  /** Moves the camera at once (drags, wheel) and stops any animation. */
  setView(view: View): void;
  /** Animates the camera to `view` (instant under reduced motion). */
  animateTo(view: View): void;
  /** Advances the animation to time `now` (ms, `performance.now()` clock). */
  step(now: number): void;
  /** Looks from `direction` (target → camera) and fits the scene. `up` defaults as in `orientationFor`. */
  lookFrom(direction: Vec3, up?: Vec3): void;
  fit(): void;
  /** The home view (front, right, top), fitted. `instant` skips the animation. */
  home(instant?: boolean): void;
  setAspect(aspect: number): void;
  setBounds(bounds: Bounds | undefined): void;
  setTool(tool: NavAction | undefined): void;
  setProjection(projection: Projection): void;
  setVisualStyle(style: VisualStyle): void;
  setGrid(grid: boolean): void;
  setPreset(preset: NavPreset): void;
  setOrigin(item: OriginItem, visible: boolean): void;
  setSketchPoints(visible: boolean): void;
  setSketchConstraints(visible: boolean): void;
  setSketchDimensions(visible: boolean): void;
  setSketchProfiles(visible: boolean): void;
  setSnap(snap: boolean): void;
  setSnapshot(snapshot: (() => Promise<Blob | null>) | undefined): void;
  setRenderStats(stats: RenderStats | undefined): void;
}

export type ViewportStore = StoreApi<ViewportState>;

export interface ViewportStoreOptions {
  preferences: Preferences;
  /** Clock for animations. Defaults to `performance.now()`. */
  now?: () => number;
  /** Whether to skip camera animations. Defaults to `prefers-reduced-motion`. */
  reducedMotion?: () => boolean;
}

const PREFERENCES_KEY = 'viewport';

function loadSettings(preferences: Preferences): ViewportSettings {
  const stored = preferences.get<Partial<ViewportSettings>>(PREFERENCES_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    origin: { ...DEFAULT_SETTINGS.origin, ...stored.origin },
  };
}

const systemReducedMotion = () =>
  globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function createViewportStore(options: ViewportStoreOptions): ViewportStore {
  const { preferences } = options;
  const now = options.now ?? (() => performance.now());
  const reducedMotion = options.reducedMotion ?? systemReducedMotion;

  const store = createStore<ViewportState>()((set, get) => {
    const fitted = (view: View) => {
      const { bounds, aspect } = get();
      // What's shown fills the view; an empty document shows the area around the origin.
      if (bounds?.box)
        return fitBox(view, bounds.box.min, bounds.box.max, aspect, get().projection);
      const b = bounds ?? EMPTY_BOUNDS;
      return fitSphere(view, b.center, b.radius, aspect);
    };
    return {
      ...loadSettings(preferences),
      view: homeView(),
      transition: undefined,
      aspect: 1,
      bounds: undefined,
      tool: undefined,
      snapshot: undefined,
      renderStats: undefined,

      setView(view) {
        set({ view, transition: undefined });
      },
      animateTo(to) {
        const from = get().view;
        if (reducedMotion() || sameView(from, to)) {
          set({ view: to, transition: undefined });
          return;
        }
        set({ transition: { from, to, start: now(), duration: TRANSITION_MS } });
      },
      step(time) {
        const t = get().transition;
        if (!t) return;
        const progress = (time - t.start) / t.duration;
        if (progress >= 1) set({ view: t.to, transition: undefined });
        else set({ view: interpolate(t.from, t.to, easeCamera(Math.max(0, progress))) });
      },
      lookFrom(direction, up) {
        get().animateTo(fitted({ ...get().view, orientation: orientationFor(direction, up) }));
      },
      fit() {
        get().animateTo(fitted(get().view));
      },
      home(instant = false) {
        if (instant) get().setView(fitted(homeView()));
        else get().animateTo(fitted(homeView()));
      },
      setAspect(aspect) {
        if (aspect > 0 && Number.isFinite(aspect) && aspect !== get().aspect) set({ aspect });
      },
      setBounds(bounds) {
        set({ bounds });
      },
      setTool(tool) {
        set({ tool });
      },
      setProjection(projection) {
        set({ projection });
      },
      setVisualStyle(visualStyle) {
        set({ visualStyle });
      },
      setGrid(grid) {
        set({ grid });
      },
      setPreset(preset) {
        set({ preset });
      },
      setOrigin(item, visible) {
        set({ origin: { ...get().origin, [item]: visible } });
      },
      setSketchPoints(sketchPoints) {
        set({ sketchPoints });
      },
      setSketchConstraints(sketchConstraints) {
        set({ sketchConstraints });
      },
      setSketchDimensions(sketchDimensions) {
        set({ sketchDimensions });
      },
      setSketchProfiles(sketchProfiles) {
        set({ sketchProfiles });
      },
      setSnap(snap) {
        set({ snap });
      },
      setSnapshot(snapshot) {
        set({ snapshot });
      },
      setRenderStats(renderStats) {
        set({ renderStats });
      },
    };
  });

  store.subscribe((s, prev) => {
    if (
      s.projection !== prev.projection ||
      s.visualStyle !== prev.visualStyle ||
      s.grid !== prev.grid ||
      s.preset !== prev.preset ||
      s.origin !== prev.origin ||
      s.sketchPoints !== prev.sketchPoints ||
      s.sketchConstraints !== prev.sketchConstraints ||
      s.sketchDimensions !== prev.sketchDimensions ||
      s.sketchProfiles !== prev.sketchProfiles ||
      s.snap !== prev.snap
    ) {
      const {
        projection,
        visualStyle,
        grid,
        preset,
        origin,
        sketchPoints,
        sketchConstraints,
        sketchDimensions,
        sketchProfiles,
        snap,
      } = s;
      preferences.set(PREFERENCES_KEY, {
        projection,
        visualStyle,
        grid,
        preset,
        origin,
        sketchPoints,
        sketchConstraints,
        sketchDimensions,
        sketchProfiles,
        snap,
      });
    }
  });

  return store;
}
