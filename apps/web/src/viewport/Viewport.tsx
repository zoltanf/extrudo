import {
  type BodyId,
  type BodyMeta,
  type FeatureId,
  ORIGIN_AXES,
  projectedEntities,
  type SelectionItem,
  type SketchFrame,
  type Vec2,
  type Vec3,
  worldToSketch,
} from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DirectionalLight } from 'three';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { isEditable, useShortcuts } from '../commands/shortcuts';
import { type MarkingEntry, MarkingMenu, MenuItem, MenuLabel, PointMenu } from '../design-system';
import { previewSummary, type ViewPreview } from '../features/preview';
import type { OverhangView } from '../print/overhang';
import { clipSummary, type SectionClip, sectionSummary } from '../section/clip';
import { combineFilters } from '../selection/filter';
import { itemLabel, type LabelContext, selectionKey } from '../selection/items';
import {
  type PickAxis,
  type PickHit,
  type PickScene,
  pickBox,
  pickStack,
  pickTop,
} from '../selection/pick';
import { sketchTargetAt } from '../sketch/facePick';
import type { PlanePointer, SketchBox } from '../sketch/tools/host';
import { Bodies, clipPlanes } from './Bodies';
import { CameraRig } from './CameraRig';
import { Construction } from './Construction';
import { basis, orbit, pan, rayPlane, type View, viewRay, worldPerPixel, zoomAt } from './camera';
import { type Rgba, type SceneColors, useSceneColors } from './colors';
import {
  type ConstructionDrawing,
  constructionPick,
  constructionState,
  constructionSummary,
} from './constructionGeometry';
import { navCursor } from './cursors';
import { GRID_RADIUS, Grid, XY_FRAME } from './Grid';
import { NavBar } from './NavBar';
import { dragAction, dragZoomFactor, type NavAction, ORBIT_RATE, wheelAction } from './navigation';
import { Origin } from './Origin';
import { PreviewShapes } from './Preview';
import {
  type PointerHandlers,
  type ScreenBox,
  type ScreenPointer,
  usePointerInput,
} from './pointer';
import { createRenderMeter } from './renderMeter';
import { Sketches } from './Sketches';
import { type SketchDrawing, sketchSegments, unionBounds } from './sketchGeometry';
import {
  type Bounds,
  type OriginItem,
  shownOrigin,
  type ViewportStore,
  type VisualStyle,
} from './store';
import { ViewCube } from './ViewCube';
import { namedDirection } from './viewcube';
import type { ViewMenu, ViewMenuContent, ViewMenuRequest } from './viewMenu';

export interface ViewportProps {
  viewport: ViewportStore;
  /** Body meshes from the model store. */
  bodies?: Record<BodyId, BodyMesh>;
  /** Body names, colours and visibility from the document. */
  meta?: Record<BodyId, BodyMeta>;
  /** Sketches to draw (P1-01). */
  sketches?: readonly SketchDrawing[];
  /** The plane of the sketch being edited: the grid lies on it. */
  sketchPlane?: SketchFrame;
  /** Present while Create Sketch waits for a plane: the origin planes become pickable. */
  planePicker?: PlanePicker;
  /** Present while a sketch tool draws: the pointer on the sketch plane goes to it (P1-02). */
  sketchInput?: SketchInput;
  /** Drawn over the 3D view (the sketch tool overlay). */
  children?: ReactNode;
  /**
   * A command owns the pointer (a sketch tool, the plane pick), so the nav
   * bar's Select isn't the active mode; pressing Select calls `onStopCommand`.
   */
  commandRunning?: boolean;
  onStopCommand?(): void;
  /** The item under the pointer (session hover): bodies highlight it (P2-03). */
  hover?: SelectionItem;
  /** The session's selection: bodies highlight it (P2-03). */
  selection?: readonly SelectionItem[];
  /** Present in model mode while nothing else takes the pointer: picking selects (P2-03). */
  modelSelect?: ModelSelect;
  /** A feature dialog's live preview, drawn over the bodies (P2-05). */
  preview?: ViewPreview;
  /** Construction planes, axes and points to draw and pick (P3-05). */
  construction?: readonly ConstructionDrawing[];
  /**
   * The right-click marking menu (P3-11): present while the pointer is free to select (model
   * mode with no dialog or tool, sketch mode). Without it, a right click without movement
   * opens "Select other…" directly, as it did before.
   */
  viewMenu?: ViewMenu;
  /**
   * The section analysis' clipping plane while it is on (P3-09, ADR-0045): bodies and their
   * edges are clipped and capped, and picking ignores what is clipped away.
   */
  sectionClip?: SectionClip;
  /**
   * The overhang analysis (P3-10, ADR-0048): `view` is what the bodies are shaded with (absent
   * while it is off), `summary` the counts for `data-overhang`.
   */
  overhang?: { view: OverhangView | undefined; summary: string };
}

/**
 * Model-mode selection (P2-03, ADR-0026): the viewport picks, the owner
 * (the shell) changes the session. Items are session `SelectionItem`s
 * (topology items as `selection/items.ts` encodes them, profiles,
 * `<sketch>/<entity>` sketch curves).
 */
export interface ModelSelect {
  /** The item under the pointer, or `undefined` over empty space or when it leaves. */
  onHover(item: SelectionItem | undefined): void;
  /** A click on an item (`undefined`: empty space). `toggle` with Shift, Ctrl or ⌘. */
  onClick(item: SelectionItem | undefined, toggle: boolean): void;
  /** A box selected `items`; `add` with Shift, Ctrl or ⌘. */
  onBox(items: SelectionItem[], add: boolean): void;
}

export interface SketchInput {
  frame: SketchFrame;
  onMove(pointer: PlanePointer): void;
  /** A left click that didn't turn into a drag. */
  onClick(pointer: PlanePointer): void;
  /**
   * A left press that turned into a drag, at the press position. Returns
   * true if the drag is taken (it then ends with `onDragEnd`); one nobody
   * takes draws a selection box when there is `onBox`.
   */
  onDragStart?(pointer: PlanePointer): boolean;
  /** The end of that drag. */
  onDragEnd?(pointer: PlanePointer): void;
  /** A selection box was drawn (P1-09). */
  onBox?(box: SketchBox): void;
  onLeave(): void;
  /** The cursor over the view: a crosshair for drawing, the arrow for picking and selecting. */
  cursor?: 'crosshair' | 'default';
}

/**
 * Marks elements over the view that the camera moves through (the
 * constraint glyphs, P1-06): the wheel and the middle and right buttons
 * navigate over them; left clicks stay theirs.
 */
export const VIEW_PASSTHROUGH = 'data-view-passthrough';

export interface PlanePicker {
  /** An origin plane (`origin:xy`) or a construction plane (its feature's ID, P3-05). */
  hover: string | undefined;
  /** The planes already picked (a feature dialog's Plane field, P2-10): drawn highlighted. */
  selected?: readonly string[];
  onHover(plane: string): void;
  onLeave(plane: string): void;
  /** `at`: where the click met the plane, world mm (a hole's clicked point, P3-04). */
  onPick(plane: string, at?: Vec3): void;
  /**
   * Flat body faces can be picked too (P2-09): the view then picks origin
   * planes and faces itself, and the nearer one under the pointer wins
   * (`sketchTargetAt`). Items are session face items.
   */
  faces?: {
    onHover(item: SelectionItem | undefined): void;
    /** `at`: where the click met the face, world mm. */
    onPick(item: SelectionItem, at?: Vec3): void;
  };
}

const NO_BODIES: Record<BodyId, BodyMesh> = {};
const NO_META: Record<BodyId, BodyMeta> = {};
const NO_SKETCHES: readonly SketchDrawing[] = [];
const NO_SELECTION: readonly SelectionItem[] = [];
const NO_CONSTRUCTION: readonly ConstructionDrawing[] = [];

/**
 * The drawn bodies for tests (`data-bodies`): name, face count and the
 * bounding box's size in mm to 0.1 mm, "Body1:7:60,40,15 Body2:3:10,10,5";
 * hidden bodies are left out, unnamed ones show their ID.
 */
export function bodiesSummary(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  meta: Readonly<Record<BodyId, BodyMeta>>,
): string | undefined {
  const drawn = (Object.entries(bodies) as [BodyId, BodyMesh][])
    .filter(([id]) => meta[id]?.visible ?? true)
    .map(([id, mesh]) => {
      const p = mesh.positions;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i++) {
        const k = i % 3;
        const v = p[i] ?? 0;
        if (v < (lo[k] ?? 0)) lo[k] = v;
        if (v > (hi[k] ?? 0)) hi[k] = v;
      }
      const size = [0, 1, 2].map((k) => Math.round(((hi[k] ?? 0) - (lo[k] ?? 0)) * 10) / 10 + 0);
      return `${meta[id]?.name ?? id}:${mesh.faceRanges.length / 2}:${size.join(',')}`;
    });
  return drawn.length > 0 ? drawn.join(' ') : undefined;
}

/**
 * How the drawn bodies look, for tests (`data-body-appearance`): name,
 * colour (`default` for the theme's) and opacity, "Body1:#5b7cff:0.5
 * Body2:default:1"; hidden bodies are left out.
 */
export function bodyAppearanceSummary(
  bodies: Readonly<Record<BodyId, BodyMesh>>,
  meta: Readonly<Record<BodyId, BodyMeta>>,
): string | undefined {
  const drawn = (Object.keys(bodies) as BodyId[])
    .filter((id) => meta[id]?.visible ?? true)
    .map(
      (id) => `${meta[id]?.name ?? id}:${meta[id]?.color ?? 'default'}:${meta[id]?.opacity ?? 1}`,
    );
  return drawn.length > 0 ? drawn.join(' ') : undefined;
}

/** A middle double-click within this many ms fits the view (Fusion). */
const DOUBLE_CLICK_MS = 400;

/**
 * The 3D viewport (P0-05, FR-VP-01..04): an R3F canvas over the brand's
 * glowing background, with the grid, the origin, bodies, the ViewCube and
 * the nav bar. Navigation input is handled here, on the canvas's wrapper,
 * and turned into view changes in the viewport store.
 */
export function Viewport({
  viewport,
  bodies = NO_BODIES,
  meta = NO_META,
  sketches = NO_SKETCHES,
  sketchPlane,
  planePicker,
  sketchInput,
  children,
  commandRunning = false,
  onStopCommand,
  hover,
  selection = NO_SELECTION,
  modelSelect,
  preview,
  construction = NO_CONSTRUCTION,
  viewMenu,
  sectionClip,
  overhang,
}: ViewportProps) {
  const section = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const colors = useSceneColors();
  const tool = useStore(viewport, (s) => s.tool);
  const projection = useStore(viewport, (s) => s.projection);
  const sectionState = useStore(viewport, (s) => s.section);
  const [dragging, setDragging] = useState<NavAction>();
  const [ready, setReady] = useState(false);

  useShortcuts(
    useMemo(
      // F6 (Fit) is a shell command (P1-14); Esc leaves a nav-bar tool.
      () => (tool ? [{ keys: 'Escape', run: () => viewport.getState().setTool(undefined) }] : []),
      [viewport, tool],
    ),
  );

  // Track the aspect ratio; the first measurement frames the home view.
  useLayoutEffect(() => {
    const el = surface.current;
    if (!el) return;
    let first = true;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      viewport.getState().setAspect(width / height, width);
      if (first) viewport.getState().home(true);
      first = false;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [viewport]);

  // The camera orientation as data attributes, for tests and debugging.
  useLayoutEffect(() => {
    const apply = (view: View) => {
      const el = section.current;
      if (!el) return;
      const { back, up } = basis(view);
      el.dataset.cameraDirection = fmt([-back.x, -back.y, -back.z]);
      el.dataset.cameraUp = fmt([up.x, up.y, up.z]);
      el.dataset.cameraTarget = fmt([...view.target]);
      el.dataset.cameraSize = fmt([view.size]);
      // Where the target shows across the view (NDC), when a floating panel shifted the fit.
      el.dataset.cameraShift = fmt([view.shift ?? 0]);
    };
    apply(viewport.getState().view);
    return viewport.subscribe((s, prev) => {
      if (s.view !== prev.view) apply(s.view);
    });
  }, [viewport]);

  useNavigation(section, surface, viewport, setDragging);
  const [box, setBox] = useState<ScreenBox>();
  const [otherMenu, setOtherMenu] = useState<OtherMenu>();
  // Construction geometry, with a dialog's preview (P3-05); hover and selection highlight it.
  const drawnConstruction = useMemo(
    () => (preview?.construction ? [...construction, preview.construction] : construction),
    [construction, preview?.construction],
  );
  const modelScene = useMemo(
    () => ({ bodies, meta, sketches, construction, clip: sectionClip }),
    [bodies, meta, sketches, construction, sectionClip],
  );
  // The marking menu (P3-11): the shell fills it in when the view reports a right click.
  const [marking, setMarking] = useState<OpenViewMenu>();
  const viewMenuRef = useRef(viewMenu);
  viewMenuRef.current = viewMenu;
  const openViewMenu = useMemo(
    () => (at: { x: number; y: number }, request: ViewMenuRequest, hits: readonly PickHit[]) => {
      const content = viewMenuRef.current?.open(request, at);
      if (content) setMarking({ at, content, hits });
    },
    [],
  );
  const hasViewMenu = viewMenu !== undefined;
  useEffect(() => {
    if (!hasViewMenu) setMarking(undefined);
  }, [hasViewMenu]);
  useSketchInput(surface, viewport, sketchInput, setBox, hasViewMenu ? openViewMenu : undefined);
  const bodiesKey = useMemo(() => bodiesSummary(bodies, meta), [bodies, meta]);
  const appearanceKey = useMemo(() => bodyAppearanceSummary(bodies, meta), [bodies, meta]);
  // Silhouette segments drawn per body (wireframe and hidden edges), summed into
  // `data-silhouettes` for tests; written straight to the element, it changes with the camera.
  const silhouettes = useMemo(() => new Map<BodyId, number>(), []);
  const onSilhouettes = useMemo(
    () => (body: BodyId, segments: number) => {
      if (segments > 0) silhouettes.set(body, segments);
      else silhouettes.delete(body);
      const el = section.current;
      if (!el) return;
      if (silhouettes.size === 0) delete el.dataset.silhouettes;
      else el.dataset.silhouettes = String([...silhouettes.values()].reduce((a, b) => a + b, 0));
    },
    [silhouettes],
  );
  useModelInput(
    surface,
    viewport,
    modelSelect,
    modelScene,
    setBox,
    setOtherMenu,
    hasViewMenu ? openViewMenu : undefined,
  );
  useSketchTargetInput(surface, viewport, planePicker, modelScene, setBox);
  // The menu belongs to model mode: it closes when that ends (a sketch opens, a tool starts).
  useEffect(() => {
    if (!modelSelect) setOtherMenu(undefined);
  }, [modelSelect]);

  // The pointer says what a left-drag does: a nav tool's own cursor (also while any
  // navigation drag runs), a hand on a pickable plane, a crosshair while drawing.
  const cursor = dragging
    ? navCursor(dragging, true)
    : tool
      ? navCursor(tool, false)
      : planePicker?.hover || (planePicker?.faces && hover?.kind === 'face')
        ? 'pointer'
        : sketchInput && sketchInput.cursor !== 'default'
          ? 'crosshair'
          : undefined;

  return (
    <section
      ref={section}
      aria-label="Viewport"
      data-ready={ready || undefined}
      data-camera-projection={projection}
      data-sketch-status={sketchStatusSummary(sketches)}
      data-sketch-profiles={sketchProfilesSummary(sketches)}
      data-sketches={sketches.map((s) => s.id).join(' ')}
      data-sketch-frames={sketchFramesSummary(sketches)}
      data-sketch-projected={sketchProjectedSummary(sketches)}
      data-highlight={sketches.find((s) => s.highlight)?.id}
      data-model-selection={modelSelect ? selectionKey(selection) : undefined}
      data-model-hover={modelSelect ? selectionKey([hover]) : undefined}
      data-bodies={bodiesKey}
      data-body-appearance={appearanceKey}
      data-construction={constructionSummary(drawnConstruction)}
      data-section={sectionSummary(sectionState)}
      data-section-clip={clipSummary(sectionClip)}
      data-overhang={overhang?.summary}
      data-preview={previewSummary(preview)}
      data-preview-dimmed={preview?.dimmed || undefined}
      className="relative isolate min-w-0 flex-1 overflow-hidden"
      style={{ background: 'var(--x-viewport-glow)' }}
    >
      <div
        ref={surface}
        data-cursor={dragging ?? tool}
        className="absolute inset-0 touch-none"
        style={cursor ? { cursor } : undefined}
      >
        <Canvas
          frameloop="demand"
          flat
          dpr={[1, 2]}
          // The stencil buffer caps a section analysis' cut (P3-09).
          gl={{ antialias: true, alpha: true, stencil: true }}
          // A label needs a role (axe, P3-13): the canvas is a picture of the model.
          role="img"
          aria-label="3D view"
        >
          <Scene
            viewport={viewport}
            colors={colors}
            bodies={bodies}
            meta={meta}
            sketches={sketches}
            sketchPlane={sketchPlane}
            planePicker={planePicker}
            hover={hover}
            selection={selection}
            preview={preview}
            construction={drawnConstruction}
            sectionClip={sectionClip}
            overhang={overhang?.view}
            onSilhouettes={onSilhouettes}
            onFirstFrame={() => setReady(true)}
          />
          <RenderMeterProbe viewport={viewport} />
        </Canvas>
      </div>
      {children}
      {box && <SelectionBox box={box} />}
      <SelectOtherMenu
        menu={otherMenu}
        scene={modelScene}
        select={modelSelect}
        onClose={() => setOtherMenu(undefined)}
      />
      <ViewMarkingMenu
        menu={marking}
        onClose={() => setMarking(undefined)}
        onSelectOther={(hits, at) => setOtherMenu({ hits: [...hits], at, toggle: false })}
      />
      <ViewCube store={viewport} />
      <NavBar store={viewport} commandRunning={commandRunning} onStopCommand={onStopCommand} />
      <ViewStatus viewport={viewport} />
    </section>
  );
}

/**
 * The selection box (UI spec §3.2): solid for a window (dragged left to
 * right), dashed for a crossing box.
 */
function SelectionBox({ box: { from, to } }: { box: ScreenBox }) {
  const crossing = to[0] < from[0];
  return (
    <div
      data-selection-box={crossing ? 'crossing' : 'window'}
      className="pointer-events-none absolute z-[6] border border-accent"
      style={{
        left: Math.min(from[0], to[0]),
        top: Math.min(from[1], to[1]),
        width: Math.abs(to[0] - from[0]),
        height: Math.abs(to[1] - from[1]),
        borderStyle: crossing ? 'dashed' : 'solid',
        background: 'color-mix(in srgb, var(--x-accent) 10%, transparent)',
      }}
    />
  );
}

const fmt = (v: number[]) => v.map((c) => `${Math.round(c * 1000) / 1000 + 0}`).join(',');

/** Tells screen readers which view is showing once the camera comes to rest. */
function ViewStatus({ viewport }: { viewport: ViewportStore }) {
  const name = useStore(viewport, (s) => {
    if (s.transition) return undefined;
    const b = basis(s.view).back;
    return namedDirection([b.x, b.y, b.z])?.name ?? 'Custom';
  });
  return (
    <div role="status" aria-label="Current view" className="sr-only">
      {name && `${name} view`}
    </div>
  );
}

/**
 * Counts and times the frames the renderer draws (every `renderer.render`
 * call, wrapped while mounted) and publishes the stats to the viewport store
 * twice a second, only when they change, for the status bar.
 */
function RenderMeterProbe({ viewport }: { viewport: ViewportStore }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const meter = createRenderMeter();
    const render = gl.render;
    gl.render = (scene, camera) => {
      const start = performance.now();
      render.call(gl, scene, camera);
      meter.frame(start, performance.now() - start);
    };
    const timer = setInterval(() => {
      const next = meter.sample(performance.now());
      const current = viewport.getState().renderStats;
      if (
        next &&
        (current?.fps !== next.fps || Math.abs((current?.frameMs ?? 0) - next.frameMs) >= 0.05)
      ) {
        viewport.getState().setRenderStats(next);
      }
    }, 500);
    return () => {
      clearInterval(timer);
      gl.render = render;
      viewport.getState().setRenderStats(undefined);
    };
  }, [gl, viewport]);
  return null;
}

function Scene({
  viewport,
  colors,
  bodies,
  meta,
  sketches,
  sketchPlane,
  planePicker,
  hover,
  selection,
  preview,
  construction,
  sectionClip,
  overhang,
  onSilhouettes,
  onFirstFrame,
}: {
  viewport: ViewportStore;
  colors: SceneColors;
  bodies: Record<BodyId, BodyMesh>;
  meta: Record<BodyId, BodyMeta>;
  sketches: readonly SketchDrawing[];
  sketchPlane: SketchFrame | undefined;
  planePicker: PlanePicker | undefined;
  hover: SelectionItem | undefined;
  selection: readonly SelectionItem[];
  preview: ViewPreview | undefined;
  construction: readonly ConstructionDrawing[];
  sectionClip: SectionClip | undefined;
  overhang: OverhangView | undefined;
  onSilhouettes(body: BodyId, segments: number): void;
  onFirstFrame(): void;
}) {
  const {
    projection,
    visualStyle,
    grid,
    origin: chosenOrigin,
    pickAxes,
    sketchPoints,
  } = useStore(
    viewport,
    useShallow(({ projection, visualStyle, grid, origin, pickAxes, sketchPoints }) => ({
      projection,
      visualStyle,
      grid,
      origin,
      pickAxes,
      sketchPoints,
    })),
  );
  const origin = useMemo(() => shownOrigin(chosenOrigin, pickAxes), [chosenOrigin, pickAxes]);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  // Clipping planes on materials (a section analysis, P3-09) need this switched on.
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.localClippingEnabled = sectionClip !== undefined;
  }, [gl, sectionClip]);
  const previewPlanes = useMemo(() => clipPlanes(sectionClip) ?? null, [sectionClip]);
  // Uniforms change during render, which R3F doesn't see: ask for a frame after every render.
  useEffect(() => invalidate());

  useEffect(() => {
    viewport.getState().setSnapshot(() => {
      const { gl, scene, camera } = get();
      // Draw now: without preserveDrawingBuffer the canvas is only readable
      // in the task that rendered it.
      gl.render(scene, camera);
      return thumbnailOf(gl.domElement);
    });
    return () => viewport.getState().setSnapshot(undefined);
  }, [viewport, get]);

  // "Fit" frames the bodies and the sketches.
  const [bodyBounds, setBodyBounds] = useState<Bounds>();
  const sketchBounds = useMemo(
    () =>
      sketches.reduce<Bounds | undefined>(
        (bounds, s) => unionBounds(bounds, sketchSegments(s.data, s.frame).bounds),
        undefined,
      ),
    [sketches],
  );
  useEffect(
    () => viewport.getState().setBounds(unionBounds(bodyBounds, sketchBounds)),
    [viewport, bodyBounds, sketchBounds],
  );

  const sketchColors = useMemo(
    () => ({ free: colors.sketch, fixed: colors.sketchFixed, conflict: colors.sketchConflict }),
    [colors],
  );
  // Fills are big: the accent goes lighter than on curves (ADR-0020).
  const profileColors = useMemo(
    () => ({
      normal: colors.profile,
      hover: { ...colors.preselect, a: 0.22 },
      selected: { ...colors.preselect, a: 0.4 },
    }),
    [colors],
  );

  const constructionStates = useMemo(() => {
    const out = new Map<string, 'hover' | 'selected'>();
    for (const item of construction) {
      const state = constructionState(item, hover, selection);
      if (state) out.set(item.id, state);
    }
    return out;
  }, [construction, hover, selection]);

  const gridFrame = sketchPlane ?? XY_FRAME;
  const gridAxes = [gridFrame.x, gridFrame.y].map((axis) => worldAxis(axis, colors, origin));

  const first = useRef(true);
  useFrame(() => {
    if (!first.current) return;
    first.current = false;
    // The frame is drawn after this callback; report on the next one.
    requestAnimationFrame(onFirstFrame);
  });

  return (
    <>
      <CameraRig store={viewport} projection={projection} />
      <hemisphereLight args={['#ffffff', '#8a93a6', 1.4]} position={[0, 0, 1]} />
      <Headlight viewport={viewport} />
      <Bodies
        bodies={bodies}
        meta={meta}
        style={visualStyle}
        body={colors.body}
        edge={colors.edge}
        highlight={{ ...colors.preselect, a: 1 }}
        hover={hover}
        selection={selection}
        onBounds={setBodyBounds}
        onSilhouettes={onSilhouettes}
        {...(overhang && { overhang: { view: overhang, color: colors.overhang } })}
        {...(sectionClip && {
          section: { clip: sectionClip, color: colors.section, hatch: colors.sectionHatch },
        })}
      />
      <PreviewShapes preview={preview} colors={colors} planes={previewPlanes} />
      <Sketches
        store={viewport}
        sketches={sketches}
        colors={sketchColors}
        construction={colors.sketchConstruction}
        showPoints={sketchPoints}
        profileColors={profileColors}
        highlight={colors.preselect}
        projected={colors.sketchProjected}
        clip={previewPlanes}
      />
      <Grid
        store={viewport}
        frame={gridFrame}
        grid={colors.grid}
        axisX={gridAxes[0]?.color ?? colors.axisX}
        axisY={gridAxes[1]?.color ?? colors.axisY}
        showGrid={grid}
        showX={gridAxes[0]?.show ?? origin.x}
        showY={gridAxes[1]?.show ?? origin.y}
      />
      <Origin
        store={viewport}
        visible={origin}
        point={colors.origin}
        axisZ={colors.axisZ}
        construct={colors.construct}
        picking={planePicker !== undefined}
        hover={planePicker?.hover}
        selected={planePicker?.selected}
        highlight={{ ...colors.preselect, a: 1 }}
        onHover={planePicker?.faces ? undefined : planePicker?.onHover}
        onLeave={planePicker?.faces ? undefined : planePicker?.onLeave}
        onPick={planePicker?.faces ? undefined : planePicker?.onPick}
        axisHighlights={axisHighlights(hover, selection)}
      />
      <Construction
        store={viewport}
        items={construction}
        color={colors.construct}
        highlight={{ ...colors.preselect, a: 1 }}
        preview={{ ...colors.preview, a: 1 }}
        states={constructionStates}
      />
    </>
  );
}

/** Origin axes the pointer is over or that are selected (P2-07): `x`, `y`, `z` → hover or selected. */
function axisHighlights(
  hover: SelectionItem | undefined,
  selection: readonly SelectionItem[],
): Partial<Record<'x' | 'y' | 'z', 'hover' | 'selected'>> {
  const out: Partial<Record<'x' | 'y' | 'z', 'hover' | 'selected'>> = {};
  const name = (item: SelectionItem) =>
    item.kind === 'axis' && ORIGIN_AXES.some((a) => a.id === item.id)
      ? (item.id.slice('origin:'.length) as 'x' | 'y' | 'z')
      : undefined;
  for (const item of selection) {
    const n = name(item);
    if (n) out[n] = 'selected';
  }
  const h = hover && name(hover);
  if (h) out[h] = 'hover';
  return out;
}

/**
 * The colour and visibility of a grid axis that runs along a world axis:
 * a sketch on the XZ plane has world X and Z as its axes. Other directions
 * (faces, P2) take the sketch colour and show with the grid.
 */
function worldAxis(
  axis: readonly [number, number, number],
  colors: SceneColors,
  origin: Record<OriginItem, boolean>,
): { color: Rgba; show: boolean } {
  const names = ['x', 'y', 'z'] as const;
  const index = axis.findIndex((c) => Math.abs(c) > 0.999999);
  const name = names[index];
  if (!name) return { color: colors.sketch, show: true };
  const color = { x: colors.axisX, y: colors.axisY, z: colors.axisZ }[name];
  return { color, show: origin[name] };
}

/** Thumbnail size in px (docs/02-architecture.md §6.2). */
export const THUMBNAIL_SIZE = 256;

/**
 * A square PNG of the canvas, cropped to its centre. The background stays
 * transparent: the home screen draws the viewport glow behind it, so the
 * thumbnail suits both themes.
 */
function thumbnailOf(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const out = document.createElement('canvas');
  out.width = THUMBNAIL_SIZE;
  out.height = THUMBNAIL_SIZE;
  const ctx = out.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return Promise.resolve(null);
  const side = Math.min(canvas.width, canvas.height);
  const sx = (canvas.width - side) / 2;
  const sy = (canvas.height - side) / 2;
  ctx.drawImage(canvas, sx, sy, side, side, 0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}

/** A key light that follows the camera, from above and to the left, so side faces read darker. */
function Headlight({ viewport }: { viewport: ViewportStore }) {
  const light = useRef<DirectionalLight>(null);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    const { view } = viewport.getState();
    const { right, up, back } = basis(view);
    const dir = back.multiplyScalar(1).addScaledVector(up, 0.6).addScaledVector(right, -0.4);
    l.position.set(...view.target).addScaledVector(dir, view.size * 10);
    l.target.position.set(...view.target);
    l.target.updateMatrixWorld();
  });
  return <directionalLight ref={light} intensity={1.6} />;
}

/**
 * Pointer input for a sketch tool (P1-02): the pointer's ray meets the
 * sketch plane, and the tool gets the point in sketch coordinates. Moves are
 * reported again when the camera moves (wheel zoom under a still pointer)
 * and when Ctrl/⌘, which turns inference off, is pressed or released.
 */
function useSketchInput(
  surface: RefObject<HTMLDivElement | null>,
  viewport: ViewportStore,
  input: SketchInput | undefined,
  onBoxChange: (box: ScreenBox | undefined) => void,
  onContext?: (
    at: { x: number; y: number },
    request: ViewMenuRequest,
    hits: readonly PickHit[],
  ) => void,
) {
  const handlers = useMemo<PointerHandlers | undefined>(() => {
    if (!input) return undefined;
    const { frame } = input;
    const toPlane = (p: ScreenPointer): PlanePointer | undefined => {
      if (p.width <= 0 || p.height <= 0) return undefined;
      const ndc: [number, number] = [(p.x / p.width) * 2 - 1, 1 - (p.y / p.height) * 2];
      const { view, projection } = viewport.getState();
      const hit = rayPlane(
        viewRay(view, projection, p.width / p.height, ndc),
        frame.origin,
        frame.normal,
      );
      if (!hit) return undefined;
      const world: Vec3 = [hit.x, hit.y, hit.z];
      return {
        point: worldToSketch(frame, world),
        perPixel: worldPerPixel(view, projection, p.height, world),
        screen: [p.x, p.y],
        infer: p.infer,
        toggle: p.toggle,
      };
    };
    const onPlane = (f: ((p: PlanePointer) => void) | undefined) => (p: ScreenPointer) => {
      const q = toPlane(p);
      if (q) f?.(q);
    };
    return {
      onMove: onPlane(input.onMove),
      onClick: onPlane(input.onClick),
      onDragStart: (p) => {
        const q = toPlane(p);
        return q ? (input.onDragStart?.(q) ?? false) : false;
      },
      onDragEnd: onPlane(input.onDragEnd),
      // The box's corners on the sketch plane, so a tilted view selects what it shows.
      ...(input.onBox && {
        onBox: (from, to) => {
          const corners = [
            [from.x, from.y],
            [to.x, from.y],
            [to.x, to.y],
            [from.x, to.y],
          ].map(
            ([x, y]) => toPlane({ ...to, x: x as number, y: y as number, infer: false })?.point,
          );
          if (corners.some((c) => !c)) return;
          input.onBox?.({
            corners: corners as Vec2[],
            mode: to.x >= from.x ? 'window' : 'crossing',
            add: to.toggle,
          });
        },
      }),
      onLeave: input.onLeave,
      // A right click without movement opens the marking menu (P3-11).
      ...(onContext && {
        onContextMenu: (p: ScreenPointer) => {
          const r = surface.current?.getBoundingClientRect();
          // The press moved pointer capture to the section, which made the tool host forget what
          // was under the pointer: point at it again before the menu asks.
          onPlane(input.onMove)(p);
          if (r) onContext({ x: r.left + p.x, y: r.top + p.y }, { mode: 'sketch', stack: [] }, []);
        },
      }),
    };
  }, [input, viewport, surface, onContext]);
  usePointerInput(surface, viewport, handlers, onBoxChange);
}

/** What model-mode picking sees: the scene as drawn. */
interface ModelScene {
  bodies: Record<BodyId, BodyMesh>;
  meta: Record<BodyId, BodyMeta>;
  sketches: readonly SketchDrawing[];
  construction: readonly ConstructionDrawing[];
  /** The section's clipping plane while it is on (P3-09). */
  clip?: SectionClip | undefined;
}

/** "Select other…": the stacked items under the pointer, and where the menu opens (client px). */
interface OtherMenu {
  hits: PickHit[];
  at: { x: number; y: number };
  toggle: boolean;
}

/**
 * Model-mode picking (P2-03, FR-VP-05): the pointer pre-highlights what it
 * is over, a click selects it, a drag nobody takes draws a box, and a long
 * press or a right click without movement lists the stack under it
 * ("Select other…"). Nothing is picked while a nav tool runs.
 */
function useModelInput(
  surface: RefObject<HTMLDivElement | null>,
  viewport: ViewportStore,
  select: ModelSelect | undefined,
  scene: ModelScene,
  onBoxChange: (box: ScreenBox | undefined) => void,
  onMenu: (menu: OtherMenu | undefined) => void,
  onContext?: (
    at: { x: number; y: number },
    request: ViewMenuRequest,
    hits: readonly PickHit[],
  ) => void,
) {
  // The latest scene without re-binding the listeners on every change.
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const handlers = useMemo<PointerHandlers | undefined>(() => {
    if (!select) return undefined;
    const context = (p: ScreenPointer) => {
      const { view, projection, visualStyle, selectionFilter, fieldFilter, origin, pickAxes } =
        viewport.getState();
      const made = constructionPick(sceneRef.current.construction, view.size);
      return {
        scene: {
          ...pickScene(sceneRef.current, visualStyle),
          axes: [...originAxes(shownOrigin(origin, pickAxes), view.size), ...made.axes],
          planes: made.planes,
          points: made.points,
        },
        camera: { view, projection, width: p.width, height: p.height },
        filter: combineFilters(selectionFilter, fieldFilter),
      };
    };
    const pick = (p: ScreenPointer) => {
      const c = context(p);
      return pickTop(c.scene, c.camera, [p.x, p.y], c.filter);
    };
    return {
      onMove: (p) => select.onHover(viewport.getState().tool ? undefined : pick(p)),
      onClick: (p) => select.onClick(pick(p), p.toggle),
      onDragStart: () => false,
      onBox: (from, to) => {
        const c = context(to);
        select.onBox(
          pickBox(c.scene, c.camera, [from.x, from.y], [to.x, to.y], c.filter),
          to.toggle,
        );
      },
      onLeave: () => select.onHover(undefined),
      onMenu: (p) => {
        const c = context(p);
        const hits = pickStack(c.scene, c.camera, [p.x, p.y], c.filter);
        const el = surface.current;
        if (hits.length === 0 || !el) return;
        const r = el.getBoundingClientRect();
        select.onHover(undefined);
        onMenu({ hits, at: { x: r.left + p.x, y: r.top + p.y }, toggle: p.toggle });
      },
      // A right click without movement opens the marking menu (P3-11), over empty space too.
      ...(onContext && {
        onContextMenu: (p: ScreenPointer) => {
          const el = surface.current;
          if (!el || viewport.getState().tool) return;
          const c = context(p);
          const top = pickTop(c.scene, c.camera, [p.x, p.y], c.filter);
          const hits = pickStack(c.scene, c.camera, [p.x, p.y], c.filter);
          const r = el.getBoundingClientRect();
          select.onHover(undefined);
          onContext(
            { x: r.left + p.x, y: r.top + p.y },
            { mode: 'model', ...(top && { top }), stack: hits.map((h) => h.item) },
            hits,
          );
        },
      }),
    };
  }, [select, viewport, surface, onMenu, onContext]);
  usePointerInput(surface, viewport, handlers, onBoxChange);
}

/**
 * Create Sketch's pick of an origin plane or a flat face (P2-09): with
 * `planePicker.faces`, the pointer hovers and a click picks whichever of
 * the two is nearer under it (`sketchTargetAt`).
 */
function useSketchTargetInput(
  surface: RefObject<HTMLDivElement | null>,
  viewport: ViewportStore,
  picker: PlanePicker | undefined,
  scene: ModelScene,
  onBoxChange: (box: ScreenBox | undefined) => void,
) {
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const pickerRef = useRef(picker);
  pickerRef.current = picker;
  const faces = picker?.faces !== undefined;
  const handlers = useMemo<PointerHandlers | undefined>(() => {
    if (!faces) return undefined;
    const target = (p: ScreenPointer) => {
      const { view, projection, visualStyle } = viewport.getState();
      const all = pickScene(sceneRef.current, visualStyle);
      const made = constructionPick(sceneRef.current.construction, view.size);
      return sketchTargetAt(
        { ...all, sketches: [], planes: made.planes },
        { view, projection, width: p.width, height: p.height },
        [p.x, p.y],
      );
    };
    const hover = (t: ReturnType<typeof target>) => {
      const current = pickerRef.current;
      if (!current?.faces) return;
      if (t?.kind === 'plane') {
        current.faces.onHover(undefined);
        current.onHover(t.plane);
        return;
      }
      if (current.hover) current.onLeave(current.hover);
      current.faces.onHover(t?.item);
    };
    return {
      onMove: (p) => hover(viewport.getState().tool ? undefined : target(p)),
      onClick: (p) => {
        const t = target(p);
        const current = pickerRef.current;
        if (t?.kind === 'plane') current?.onPick(t.plane, t.at);
        else if (t) current?.faces?.onPick(t.item, t.at);
      },
      onDragStart: () => false,
      onLeave: () => hover(undefined),
    };
  }, [faces, viewport]);
  usePointerInput(surface, viewport, handlers, onBoxChange);
}

/**
 * The origin axes as drawn (P2-07): X and Y along the grid, Z by the origin,
 * as far as the grid reaches; hidden ones aren't picked.
 */
export function originAxes(origin: Record<OriginItem, boolean>, size: number): PickAxis[] {
  return ORIGIN_AXES.filter((a) => origin[a.id.slice('origin:'.length) as OriginItem]).map((a) => ({
    id: a.id,
    origin: a.origin,
    direction: a.direction,
    half: size * GRID_RADIUS,
  }));
}

/** The pick scene: visible bodies, drawn sketches with their shaded profiles. */
function pickScene(scene: ModelScene, style: VisualStyle): PickScene {
  return {
    bodies: (Object.entries(scene.bodies) as [BodyId, BodyMesh][])
      .filter(([id]) => scene.meta[id]?.visible ?? true)
      .map(([id, mesh]) => ({ id, mesh })),
    sketches: scene.sketches
      .filter((s) => !s.active)
      .map((s) => ({
        id: s.id as FeatureId,
        frame: s.frame,
        data: s.data,
        ...(s.profiles && { profiles: s.profiles }),
      })),
    occluding: style !== 'wireframe',
    ...(scene.clip && { clip: scene.clip }),
  };
}

/** The marking menu while it is open: where, what the shell put in it, the stack under the pointer. */
interface OpenViewMenu {
  at: { x: number; y: number };
  content: ViewMenuContent;
  hits: readonly PickHit[];
}

/**
 * The marking menu (P3-11, ADR-0042). The view adds "Select other…" at the
 * top of the list when several things lie under the pointer; the shell's
 * content supplies the ring and the rest.
 */
function ViewMarkingMenu({
  menu,
  onClose,
  onSelectOther,
}: {
  menu: OpenViewMenu | undefined;
  onClose(): void;
  onSelectOther(hits: readonly PickHit[], at: { x: number; y: number }): void;
}) {
  const entries = useMemo<MarkingEntry[]>(() => {
    if (!menu) return [];
    const rest = menu.content.entries;
    if (menu.hits.length === 0) return [...rest];
    const other: MarkingEntry = {
      id: 'selectOther',
      label: 'Select other…',
      onSelect: () => onSelectOther(menu.hits, menu.at),
    };
    const [head, ...tail] = rest;
    return head ? [other, { ...head, separatorBefore: true }, ...tail] : [other];
  }, [menu, onSelectOther]);
  return (
    <MarkingMenu
      at={menu?.at}
      slots={menu?.content.slots ?? []}
      entries={entries}
      radial={menu?.content.radial ?? true}
      onClose={onClose}
    />
  );
}

/**
 * "Select other…" (UI spec §3.2): the stacked items under the pointer, the
 * hidden ones marked. The pointer or the arrow keys on a row pre-highlight
 * it; a click selects it (or toggles it, when the menu was opened with
 * Shift, Ctrl or ⌘).
 */
function SelectOtherMenu({
  menu,
  scene,
  select,
  onClose,
}: {
  menu: OtherMenu | undefined;
  scene: ModelScene;
  select: ModelSelect | undefined;
  onClose(): void;
}) {
  const close = () => {
    select?.onHover(undefined);
    onClose();
  };
  return (
    <PointMenu at={menu?.at} onClose={close} label="Select other">
      <MenuLabel>Select other</MenuLabel>
      {menu?.hits.map((hit) => (
        <MenuItem
          key={`${hit.item.kind}:${hit.item.id}`}
          onHighlight={() => select?.onHover(hit.item)}
          onSelect={() => {
            select?.onClick(hit.item, menu.toggle);
            close();
          }}
        >
          <span className={hit.occluded ? 'text-muted' : undefined}>
            {itemLabel(hit.item, labelContext(scene))}
            {hit.occluded && ' (hidden)'}
          </span>
        </MenuItem>
      ))}
    </PointMenu>
  );
}

function labelContext(scene: ModelScene): LabelContext {
  return {
    bodyName: (id) => scene.meta[id]?.name,
    feature: (id) => scene.construction.find((c) => c.id === id)?.name,
    sketch: (id) => {
      const s = scene.sketches.find((d) => d.id === id);
      return s && { name: s.name, data: s.data };
    },
  };
}

/** `PointerEvent.buttons` bit of each `button`: left 1, middle 4, right 2. */
const HELD: Record<number, number> = { 0: 1, 1: 4, 2: 2 };

/** How long (ms) after a right-button drag the browser's context menu stays shut. */
const QUIET_MS = 400;

/**
 * Mouse, wheel and trackpad navigation on the canvas wrapper, and through
 * the elements over it marked `VIEW_PASSTHROUGH`. The listeners sit on the
 * section, so they see events from both.
 */
function useNavigation(
  section: RefObject<HTMLElement | null>,
  surface: RefObject<HTMLDivElement | null>,
  viewport: ViewportStore,
  onDrag: (action: NavAction | undefined) => void,
) {
  useEffect(() => {
    const el = section.current;
    const view = surface.current;
    if (!el || !view) return;
    const inView = (e: Event) => e.target instanceof Node && view.contains(e.target);
    const passing = (e: Event) =>
      e.target instanceof Element && e.target.closest(`[${VIEW_PASSTHROUGH}]`) !== null;
    let drag:
      | {
          action: NavAction;
          x: number;
          y: number;
          ndc: [number, number];
          id: number;
          button: number;
        }
      | undefined;
    // After a right-button drag (Onshape's orbit) the browser's menu stays shut for a moment,
    // wherever the button came up: some platforms open it on release.
    let quietUntil = -Infinity;
    let lastMiddle = { time: -Infinity, x: 0, y: 0 };

    const ndcOf = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = view.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!inView(e) && !(passing(e) && e.button !== 0)) return;
      const s = viewport.getState();
      if (e.button === 1) {
        // No autoscroll or paste on the middle button.
        e.preventDefault();
        const now = performance.now();
        const near = Math.hypot(e.clientX - lastMiddle.x, e.clientY - lastMiddle.y) < 6;
        if (now - lastMiddle.time < DOUBLE_CLICK_MS && near) {
          lastMiddle = { time: -Infinity, x: 0, y: 0 };
          s.fit();
          return;
        }
        lastMiddle = { time: now, x: e.clientX, y: e.clientY };
      }
      const action = dragAction(s.preset, e, s.tool);
      if (!action) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      drag = {
        action,
        x: e.clientX,
        y: e.clientY,
        ndc: ndcOf(e),
        id: e.pointerId,
        button: e.button,
      };
      onDrag(action);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      // The button came up where we didn't hear it: the navigation drag is over.
      if ((e.buttons & (HELD[drag.button] ?? 0)) === 0) {
        drag = undefined;
        onDrag(undefined);
        return;
      }
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (dx === 0 && dy === 0) return;
      const { view: current, aspect, setView } = viewport.getState();
      const height = el.clientHeight;
      if (drag.action === 'orbit') setView(orbit(current, -dx * ORBIT_RATE, -dy * ORBIT_RATE));
      else if (drag.action === 'pan') setView(pan(current, dx, dy, height));
      else setView(zoomAt(current, dragZoomFactor(dy), drag.ndc, aspect));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.button === 2) quietUntil = performance.now() + QUIET_MS;
      drag = undefined;
      onDrag(undefined);
    };

    const onWheel = (e: WheelEvent) => {
      if (!inView(e) && !passing(e)) return;
      e.preventDefault();
      const { view: current, aspect, preset, setView } = viewport.getState();
      const result = wheelAction(preset, e);
      if (result.action === 'zoom') setView(zoomAt(current, result.factor, ndcOf(e), aspect));
      else setView(pan(current, result.dx, result.dy, view.clientHeight));
    };

    // The right button can orbit (Onshape preset), so the browser's own menu never opens
    // over the view or anything on it (nav bar, ViewCube, overlays), except in a text field.
    const onContextMenu = (e: MouseEvent) => {
      if (!isEditable(e.target)) e.preventDefault();
    };
    const onWindowContextMenu = (e: MouseEvent) => {
      if (performance.now() < quietUntil) e.preventDefault();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('contextmenu', onWindowContextMenu, true);
    return () => {
      window.removeEventListener('contextmenu', onWindowContextMenu, true);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('contextmenu', onContextMenu);
    };
  }, [section, surface, viewport, onDrag]);
}

/**
 * Where each drawn sketch lies, for tests (P2-09): "<id>:<origin>:<normal>"
 * per sketch, numbers to 0.001 mm: "s1:0,0,15:0,0,1 s2:0,0,0:0,-1,0".
 */
function sketchFramesSummary(sketches: readonly SketchDrawing[]): string | undefined {
  if (sketches.length === 0) return undefined;
  return sketches
    .map((s) => `${s.id}:${fmt([...s.frame.origin])}:${fmt([...s.frame.normal])}`)
    .join(' ');
}

/**
 * The projected curves of each drawn sketch that has some, for tests
 * (P2-09): "<id>:curves=4:x=0..60:y=0..40", the curves' count and the
 * extent of their points in sketch mm.
 */
function sketchProjectedSummary(sketches: readonly SketchDrawing[]): string | undefined {
  const r = (v: number) => Math.round(v * 1000) / 1000 + 0;
  const span = (v: number[]) => `${r(Math.min(...v))}..${r(Math.max(...v))}`;
  const out: string[] = [];
  for (const { id, data } of sketches) {
    let curves = 0;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const entity of projectedEntities(data)) {
      const e = data.entities[entity];
      if (e?.type === 'point') {
        xs.push(e.x);
        ys.push(e.y);
      } else if (e) curves++;
    }
    if (curves > 0) out.push(`${id}:curves=${curves}:x=${span(xs)}:y=${span(ys)}`);
  }
  return out.length > 0 ? out.join(' ') : undefined;
}

/**
 * How many entities of the sketch being edited are drawn in each status
 * colour (P1-08), for tests: "free=3 fixed=0 conflict=0". Undefined without
 * a status.
 */
/** "profiles=3 holes=1" for the sketch being edited (e2e tests read it), while profiles show. */
function sketchProfilesSummary(sketches: readonly SketchDrawing[]): string | undefined {
  const profiles = sketches.find((s) => s.active)?.profiles;
  if (!profiles) return undefined;
  const holes = profiles.reduce((n, p) => n + p.holes.length, 0);
  return `profiles=${profiles.length} holes=${holes}`;
}

function sketchStatusSummary(sketches: readonly SketchDrawing[]): string | undefined {
  const status = sketches.find((s) => s.active)?.status;
  if (!status) return undefined;
  const count = { free: 0, fixed: 0, conflict: 0 };
  for (const s of Object.values(status)) count[s]++;
  return `free=${count.free} fixed=${count.fixed} conflict=${count.conflict}`;
}
