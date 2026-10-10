/**
 * Viewport state (P0-05, ADR-0008): the camera view, its animation, and the
 * display settings. A vanilla Zustand store like the core stores, one per
 * open document. Nothing here is saved in the document or undoable; the
 * display settings are user preferences.
 */
import type { JointId } from '@extrudo/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { JointCheckState } from '../joints/clearance';
import type { Preferences } from '../platform';
import type { OverhangState } from '../print/overhang';
import type { ThicknessState } from '../print/thickness';
import { MAX_SECTIONS, type SectionBoxState, type SectionState } from '../section/clip';
import { DEFAULT_FILTER, type FilterKind, type SelectionFilter } from '../selection/filter';
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
  withShift,
} from './camera';
import type { NavAction, NavPreset } from './navigation';
import type { RenderStats } from './renderMeter';

/** A joint posed in the view (P6-05 J2, ADR-0081 §4): degrees for a revolute, mm for a slider. */
export interface JointPose {
  joint: JointId;
  value: number;
}

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

/**
 * The origin items as drawn and picked: the browser's choice, with the three axes shown while a
 * dialog's pick field takes axes (`pickAxes`, P3-17).
 */
export function shownOrigin(
  origin: Record<OriginItem, boolean>,
  pickAxes: boolean,
): Record<OriginItem, boolean> {
  if (!pickAxes || (origin.x && origin.y && origin.z)) return origin;
  return { ...origin, x: true, y: true, z: true };
}

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
  /**
   * Auto-project (P6-07, ADR-0074): a body edge or vertex a drawing tool snaps
   * to is projected into the sketch on the fly. On by default.
   */
  autoProject: boolean;
  /** Also project a flat face's outline when a sketch starts on it (off by default). */
  autoProjectFace: boolean;
  /**
   * Slice (P4-12, ADR-0031 §5): while a sketch is open, cut the bodies away
   * on the camera's side of the sketch plane. Off by default; a display
   * setting like the rest of the palette.
   */
  sketchSlice: boolean;
}

export const DEFAULT_SETTINGS: ViewportSettings = {
  projection: 'perspective',
  visualStyle: 'shadedEdges',
  grid: true,
  // Middle-drag orbits, right-drag pans (2026-09-28, the owner's choice; Onshape's buttons
  // swapped). Onshape / SolidWorks, the default before, stays in the menu.
  preset: 'extrudo',
  // Like Fusion, the origin planes stay hidden until something needs them.
  origin: { point: true, xy: false, xz: false, yz: false, x: true, y: true, z: true },
  sketchPoints: true,
  sketchConstraints: true,
  sketchDimensions: true,
  sketchProfiles: true,
  snap: true,
  autoProject: true,
  autoProjectFace: false,
  sketchSlice: false,
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
  /** The viewport's width in CSS px (0 until measured). */
  width: number;
  /**
   * How much of the view's left edge a floating panel covers, in CSS px (the
   * browser, ADR-0007 amendment): fitting frames the rest of the view.
   */
  cover: number;
  /** Visible content, or `undefined` for an empty scene. */
  bounds: Bounds | undefined;
  /** The nav-bar tool that turns a left-drag into orbit, pan or zoom. */
  tool: NavAction | undefined;
  /** Renders the view to a thumbnail PNG; set while the canvas is mounted. */
  snapshot: (() => Promise<Blob | null>) | undefined;
  /** Frames per second and frame time while the canvas is mounted (the status bar shows them). */
  renderStats: RenderStats | undefined;
  /**
   * What model-mode picking may take (P2-03, the nav bar's Select menu).
   * For the session only: not a saved preference.
   */
  selectionFilter: SelectionFilter;
  /**
   * A feature dialog's selection field narrows picking to what it takes
   * while it is the pick field (P2-05). Not shown in the filter menu.
   */
  fieldFilter: SelectionFilter | undefined;
  /**
   * A feature dialog's pick field takes axes (P3-17): the origin axes are drawn and pickable
   * even where the browser hides them, as Create Sketch shows the origin planes.
   */
  pickAxes: boolean;
  /**
   * The section analysis (P3-09, ADR-0045): up to three clipping planes over the model, in the
   * order added (P4-12). View state for the open project: not in the document, not undoable,
   * not a preference; it survives recomputes and lasts until it is removed or the project
   * closes. Empty for none.
   */
  section: readonly SectionState[];
  /**
   * The section box (P4-12): six planes as one object. Exclusive with `section`'s planes
   * (starting one removes the other).
   */
  sectionBox: SectionBoxState | undefined;
  /**
   * The overhang analysis (P3-10, ADR-0048): faces steeper than an angle shaded in the view.
   * View state like the section: not in the document, not undoable, lasts while the project is
   * open.
   */
  overhang: OverhangState | undefined;
  /**
   * The wall-thickness check (P5-06, ADR-0072): walls below a minimum shaded in the view.
   * View state like the overhang's: not in the document, not undoable, lasts while the
   * project is open.
   */
  thickness: ThicknessState | undefined;
  /**
   * A joint's clearance check (P6-05 J3, ADR-0081 §4): which joint, its minimum gap and
   * whether the view draws its marks. View state like the wall-thickness check's; the result
   * lives with the check (`joints/useJointCheck.ts`).
   */
  jointCheck: JointCheckState | undefined;
  /**
   * A joint posed in the view (P6-05 J2, ADR-0081 §4): the moving components are drawn through
   * the pose's matrix and can't be picked. View state like the section: not saved, not
   * undoable, recomputes nothing; any tool, dialog or sketch clears it.
   */
  jointPose: JointPose | undefined;

  /** Moves the camera at once (drags, wheel) and stops any animation. */
  setView(view: View): void;
  /** Animates the camera to `view` (instant under reduced motion). */
  animateTo(view: View): void;
  /** Advances the animation to time `now` (ms, `performance.now()` clock). */
  step(now: number): void;
  /** Looks from `direction` (target → camera) and fits the scene. `up` defaults as in `orientationFor`. */
  lookFrom(direction: Vec3, up?: Vec3): void;
  /**
   * Frames a box instead of the scene (Look at Selection, UI spec §3.1): the target moves to its
   * middle and the view fits it. With a `direction` (target → camera) the camera turns to it
   * first; without one the orientation stays.
   */
  lookAtBox(box: { min: Vec3; max: Vec3 }, direction?: Vec3): void;
  fit(): void;
  /** The home view (front, right, top), fitted. `instant` skips the animation. */
  home(instant?: boolean): void;
  /** The viewport's shape; `width` (CSS px) lets fitting leave out what `cover` covers. */
  setAspect(aspect: number, width?: number): void;
  /** How many CSS px at the view's left edge a floating panel covers. */
  setCover(cover: number): void;
  setBounds(bounds: Bounds | undefined): void;
  setTool(tool: NavAction | undefined): void;
  setProjection(projection: Projection): void;
  setVisualStyle(style: VisualStyle): void;
  setGrid(grid: boolean): void;
  setPreset(preset: NavPreset): void;
  setPickAxes(on: boolean): void;
  setOrigin(item: OriginItem, visible: boolean): void;
  setSketchPoints(visible: boolean): void;
  setSketchConstraints(visible: boolean): void;
  setSketchDimensions(visible: boolean): void;
  setSketchProfiles(visible: boolean): void;
  setSnap(snap: boolean): void;
  /** Turns auto-project on or off (P6-07). */
  setAutoProject(autoProject: boolean): void;
  /** Whether starting a sketch on a face projects the face's outline (P6-07). */
  setAutoProjectFace(autoProjectFace: boolean): void;
  /** Turns the sketch palette's Slice on or off (P4-12). */
  setSketchSlice(sketchSlice: boolean): void;
  setSnapshot(snapshot: (() => Promise<Blob | null>) | undefined): void;
  setRenderStats(stats: RenderStats | undefined): void;
  setSelectionFilter(kind: FilterKind, on: boolean): void;
  resetSelectionFilter(): void;
  setFieldFilter(filter: SelectionFilter | undefined): void;
  /**
   * Replaces the planes: one state is a list of one, `undefined` removes them all. The box goes
   * when planes are set.
   */
  setSection(section: SectionState | readonly SectionState[] | undefined): void;
  /** Adds a plane (nothing past `MAX_SECTIONS`, nothing beside a box). */
  addSection(section: SectionState): void;
  /** Changes part of plane `index` (the first by default); nothing while there is none. */
  updateSection(patch: Partial<SectionState>, index?: number): void;
  /** Removes plane `index`. */
  removeSection(index: number): void;
  /** Starts, replaces or (`undefined`) removes the section box; planes go when it starts. */
  setSectionBox(box: SectionBoxState | undefined): void;
  /** Changes part of the box; nothing while there is none. */
  updateSectionBox(patch: Partial<SectionBoxState>): void;
  /** Starts, replaces or (`undefined`) removes the overhang analysis. */
  setOverhang(overhang: OverhangState | undefined): void;
  /** Changes part of the overhang analysis; nothing while there is none. */
  updateOverhang(patch: Partial<OverhangState>): void;
  /** Starts, replaces or (`undefined`) removes the wall-thickness check. */
  setThickness(thickness: ThicknessState | undefined): void;
  /** Changes part of the wall-thickness check; nothing while there is none. */
  updateThickness(patch: Partial<ThicknessState>): void;
  /** Starts, replaces or (`undefined`) removes the clearance check. */
  setJointCheck(check: JointCheckState | undefined): void;
  /** Changes part of the clearance check; nothing while there is none. */
  updateJointCheck(patch: Partial<JointCheckState>): void;
  /** Poses a joint, or (`undefined`) puts everything back as built. */
  setJointPose(pose: JointPose | undefined): void;
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

export function loadSettings(preferences: Preferences): ViewportSettings {
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
    const fitted = (view: View, only?: Bounds) => {
      const { bounds: all, aspect, width, cover } = get();
      const bounds = only ?? all;
      // The part of the view a floating panel doesn't cover (at least a fifth of it).
      const covered = width > 0 ? Math.min(Math.max(cover / width, 0), 0.8) : 0;
      const open = aspect * (1 - covered);
      // What's shown fills the open part; an empty document shows the area around the origin.
      const b = bounds ?? EMPTY_BOUNDS;
      const framed = bounds?.box
        ? fitBox(view, bounds.box.min, bounds.box.max, open, get().projection)
        : fitSphere(view, b.center, b.radius, open);
      // …centred in it: the open part's middle is `covered` right of the view's, in NDC.
      return withShift(framed, covered);
    };
    return {
      ...loadSettings(preferences),
      view: homeView(),
      transition: undefined,
      aspect: 1,
      width: 0,
      cover: 0,
      bounds: undefined,
      tool: undefined,
      snapshot: undefined,
      renderStats: undefined,
      selectionFilter: DEFAULT_FILTER,
      fieldFilter: undefined,
      pickAxes: false,
      section: [],
      sectionBox: undefined,
      overhang: undefined,
      thickness: undefined,
      jointCheck: undefined,
      jointPose: undefined,

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
      lookAtBox(box, direction) {
        const center: Vec3 = [
          (box.min[0] + box.max[0]) / 2,
          (box.min[1] + box.max[1]) / 2,
          (box.min[2] + box.max[2]) / 2,
        ];
        const radius = Math.hypot(
          box.max[0] - box.min[0],
          box.max[1] - box.min[1],
          box.max[2] - box.min[2],
        );
        const view = get().view;
        get().animateTo(
          fitted(direction ? { ...view, orientation: orientationFor(direction) } : view, {
            center,
            radius: radius / 2,
            box,
          }),
        );
      },
      fit() {
        get().animateTo(fitted(get().view));
      },
      home(instant = false) {
        if (instant) get().setView(fitted(homeView()));
        else get().animateTo(fitted(homeView()));
      },
      setAspect(aspect, width) {
        if (aspect > 0 && Number.isFinite(aspect) && aspect !== get().aspect) set({ aspect });
        if (width !== undefined && width > 0 && width !== get().width) set({ width });
      },
      setCover(cover) {
        if (Number.isFinite(cover) && cover !== get().cover) set({ cover: Math.max(0, cover) });
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
      setAutoProject(autoProject) {
        set({ autoProject });
      },
      setAutoProjectFace(autoProjectFace) {
        set({ autoProjectFace });
      },
      setSketchSlice(sketchSlice) {
        set({ sketchSlice });
      },
      setSnapshot(snapshot) {
        set({ snapshot });
      },
      setRenderStats(renderStats) {
        set({ renderStats });
      },
      setSelectionFilter(kind, on) {
        set({ selectionFilter: { ...get().selectionFilter, [kind]: on } });
      },
      resetSelectionFilter() {
        set({ selectionFilter: DEFAULT_FILTER });
      },
      setFieldFilter(fieldFilter) {
        if (fieldFilter !== get().fieldFilter) set({ fieldFilter });
      },
      setPickAxes(pickAxes) {
        if (pickAxes !== get().pickAxes) set({ pickAxes });
      },
      setSection(section) {
        const list = section === undefined ? [] : 'plane' in section ? [section] : section;
        set({ section: list.slice(0, MAX_SECTIONS), sectionBox: undefined });
      },
      addSection(section) {
        const { section: current, sectionBox } = get();
        if (sectionBox || current.length >= MAX_SECTIONS) return;
        set({ section: [...current, section] });
      },
      updateSection(patch, index = 0) {
        const current = get().section;
        const found = current[index];
        if (found)
          set({ section: current.map((s, i) => (i === index ? { ...found, ...patch } : s)) });
      },
      removeSection(index) {
        const current = get().section;
        if (index >= 0 && index < current.length)
          set({ section: current.filter((_, i) => i !== index) });
      },
      setSectionBox(sectionBox) {
        set({ sectionBox, section: [] });
      },
      updateSectionBox(patch) {
        const current = get().sectionBox;
        if (current) set({ sectionBox: { ...current, ...patch } });
      },
      setOverhang(overhang) {
        set({ overhang });
      },
      updateOverhang(patch) {
        const current = get().overhang;
        if (current) set({ overhang: { ...current, ...patch } });
      },
      setThickness(thickness) {
        set({ thickness });
      },
      updateThickness(patch) {
        const current = get().thickness;
        if (current) set({ thickness: { ...current, ...patch } });
      },
      setJointCheck(jointCheck) {
        set({ jointCheck });
      },
      updateJointCheck(patch) {
        const current = get().jointCheck;
        if (current) set({ jointCheck: { ...current, ...patch } });
      },
      setJointPose(jointPose) {
        const current = get().jointPose;
        if (current === jointPose) return;
        if (
          current &&
          jointPose &&
          current.joint === jointPose.joint &&
          current.value === jointPose.value
        )
          return;
        set({ jointPose });
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
      s.snap !== prev.snap ||
      s.autoProject !== prev.autoProject ||
      s.autoProjectFace !== prev.autoProjectFace ||
      s.sketchSlice !== prev.sketchSlice
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
        autoProject,
        autoProjectFace,
        sketchSlice,
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
        autoProject,
        autoProjectFace,
        sketchSlice,
      });
    }
  });

  return store;
}
