import {
  type BodyId,
  type BodyMeta,
  type OriginPlaneId,
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
import { useShortcuts } from '../commands/shortcuts';
import type { PlanePointer, SketchBox } from '../sketch/tools/host';
import { Bodies } from './Bodies';
import { CameraRig } from './CameraRig';
import { basis, orbit, pan, rayPlane, type View, viewRay, worldPerPixel, zoomAt } from './camera';
import { type Rgba, type SceneColors, useSceneColors } from './colors';
import { Grid, XY_FRAME } from './Grid';
import { NavBar } from './NavBar';
import { dragAction, dragZoomFactor, type NavAction, ORBIT_RATE, wheelAction } from './navigation';
import { Origin } from './Origin';
import { createRenderMeter } from './renderMeter';
import { Sketches } from './Sketches';
import { type SketchDrawing, sketchSegments, unionBounds } from './sketchGeometry';
import type { Bounds, OriginItem, ViewportStore } from './store';
import { ViewCube } from './ViewCube';
import { namedDirection } from './viewcube';

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
  hover: OriginPlaneId | undefined;
  onHover(plane: OriginPlaneId): void;
  onLeave(plane: OriginPlaneId): void;
  onPick(plane: OriginPlaneId): void;
}

const NO_BODIES: Record<BodyId, BodyMesh> = {};
const NO_META: Record<BodyId, BodyMeta> = {};
const NO_SKETCHES: readonly SketchDrawing[] = [];

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
}: ViewportProps) {
  const section = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const colors = useSceneColors();
  const tool = useStore(viewport, (s) => s.tool);
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
      viewport.getState().setAspect(width / height);
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
    };
    apply(viewport.getState().view);
    return viewport.subscribe((s, prev) => {
      if (s.view !== prev.view) apply(s.view);
    });
  }, [viewport]);

  useNavigation(section, surface, viewport, setDragging);
  const [box, setBox] = useState<ScreenBox>();
  useSketchInput(surface, viewport, sketchInput, setBox);

  const cursor = dragging
    ? 'cursor-grabbing'
    : tool
      ? 'cursor-grab'
      : planePicker?.hover
        ? 'cursor-pointer'
        : sketchInput && sketchInput.cursor !== 'default'
          ? 'cursor-crosshair'
          : '';

  return (
    <section
      ref={section}
      aria-label="Viewport"
      data-ready={ready || undefined}
      data-sketch-status={sketchStatusSummary(sketches)}
      data-sketch-profiles={sketchProfilesSummary(sketches)}
      data-sketches={sketches.map((s) => s.id).join(' ')}
      data-highlight={sketches.find((s) => s.highlight)?.id}
      className="relative isolate min-w-0 flex-1 overflow-hidden"
      style={{ background: 'var(--x-viewport-glow)' }}
    >
      <div ref={surface} className={`absolute inset-0 touch-none ${cursor}`}>
        <Canvas
          frameloop="demand"
          flat
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
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
            onFirstFrame={() => setReady(true)}
          />
          <RenderMeterProbe viewport={viewport} />
        </Canvas>
      </div>
      {children}
      {box && <SelectionBox box={box} />}
      <ViewCube store={viewport} />
      <NavBar store={viewport} />
      <ViewStatus viewport={viewport} />
    </section>
  );
}

/** A selection box being drawn, in viewport pixels: from the press to the pointer. */
interface ScreenBox {
  from: readonly [number, number];
  to: readonly [number, number];
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
  onFirstFrame,
}: {
  viewport: ViewportStore;
  colors: SceneColors;
  bodies: Record<BodyId, BodyMesh>;
  meta: Record<BodyId, BodyMeta>;
  sketches: readonly SketchDrawing[];
  sketchPlane: SketchFrame | undefined;
  planePicker: PlanePicker | undefined;
  onFirstFrame(): void;
}) {
  const { projection, visualStyle, grid, origin, sketchPoints } = useStore(
    viewport,
    useShallow(({ projection, visualStyle, grid, origin, sketchPoints }) => ({
      projection,
      visualStyle,
      grid,
      origin,
      sketchPoints,
    })),
  );
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
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
        onBounds={setBodyBounds}
      />
      <Sketches
        store={viewport}
        sketches={sketches}
        colors={sketchColors}
        construction={colors.sketchConstruction}
        showPoints={sketchPoints}
        profileColors={profileColors}
        highlight={colors.preselect}
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
        highlight={{ ...colors.preselect, a: 1 }}
        onHover={planePicker?.onHover}
        onLeave={planePicker?.onLeave}
        onPick={planePicker?.onPick}
      />
    </>
  );
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

/** A left press that moves less than this (px) before release is a click. */
const CLICK_SLOP = 5;

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
) {
  useEffect(() => {
    const el = surface.current;
    if (!el || !input) return;
    const { frame } = input;
    let last: { x: number; y: number; infer: boolean; toggle: boolean } | undefined;
    let press: { x: number; y: number; id: number; dragging: boolean; box: boolean } | undefined;

    const pointerAt = (
      x: number,
      y: number,
      infer: boolean,
      toggle: boolean,
    ): PlanePointer | undefined => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return undefined;
      const ndc: [number, number] = [
        ((x - r.left) / r.width) * 2 - 1,
        1 - ((y - r.top) / r.height) * 2,
      ];
      const { view, projection } = viewport.getState();
      const hit = rayPlane(
        viewRay(view, projection, r.width / r.height, ndc),
        frame.origin,
        frame.normal,
      );
      if (!hit) return undefined;
      const world: Vec3 = [hit.x, hit.y, hit.z];
      return {
        point: worldToSketch(frame, world),
        perPixel: worldPerPixel(view, projection, r.height, world),
        screen: [x - r.left, y - r.top],
        infer,
        toggle,
      };
    };
    const report = () => {
      const p = last && pointerAt(last.x, last.y, last.infer, last.toggle);
      if (p) input.onMove(p);
    };
    const local = (x: number, y: number): [number, number] => {
      const r = el.getBoundingClientRect();
      return [x - r.left, y - r.top];
    };
    /** Starts a drag at the press; one nobody takes becomes a selection box. */
    const startDrag = (x: number, y: number, infer: boolean, toggle: boolean): boolean => {
      const p = pointerAt(x, y, infer, toggle);
      const taken = p ? (input.onDragStart?.(p) ?? false) : false;
      return !taken && input.onBox !== undefined;
    };
    /** Selects with the box from the press to (x, y): its corners on the sketch plane. */
    const finishBox = (from: { x: number; y: number }, x: number, y: number, toggle: boolean) => {
      onBoxChange(undefined);
      const corners = [
        [from.x, from.y],
        [x, from.y],
        [x, y],
        [from.x, y],
      ].map(([cx, cy]) => pointerAt(cx as number, cy as number, false, toggle)?.point);
      if (corners.some((c) => !c)) return;
      input.onBox?.({
        corners: corners as Vec2[],
        mode: x >= from.x ? 'window' : 'crossing',
        add: toggle,
      });
    };

    const modifiers = (e: PointerEvent | KeyboardEvent) => ({
      infer: !(e.ctrlKey || e.metaKey),
      toggle: e.shiftKey || e.ctrlKey || e.metaKey,
    });
    const onPointerMove = (e: PointerEvent) => {
      last = { x: e.clientX, y: e.clientY, ...modifiers(e) };
      if (
        press &&
        !press.dragging &&
        e.pointerId === press.id &&
        Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_SLOP
      ) {
        press.dragging = true;
        press.box = startDrag(press.x, press.y, last.infer, last.toggle);
        // Keep the drag's events when the pointer leaves the view (synthetic pointers can't be captured).
        try {
          el.setPointerCapture(e.pointerId);
        } catch {}
      }
      if (press?.box) {
        onBoxChange({ from: local(press.x, press.y), to: local(e.clientX, e.clientY) });
        return;
      }
      report();
    };
    const onPointerDown = (e: PointerEvent) => {
      const s = viewport.getState();
      if (e.button !== 0 || dragAction(s.preset, e, s.tool)) return;
      press = { x: e.clientX, y: e.clientY, id: e.pointerId, dragging: false, box: false };
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      const current = press;
      press = undefined;
      const { infer, toggle } = modifiers(e);
      if (current.box) {
        finishBox(current, e.clientX, e.clientY, toggle);
        return;
      }
      const p = pointerAt(e.clientX, e.clientY, infer, toggle);
      if (!p) return;
      if (current.dragging) input.onDragEnd?.(p);
      else if (Math.hypot(e.clientX - current.x, e.clientY - current.y) > CLICK_SLOP) {
        // A drag whose moves were coalesced away: start and end it now.
        if (startDrag(current.x, current.y, infer, toggle)) {
          finishBox(current, e.clientX, e.clientY, toggle);
        } else input.onDragEnd?.(p);
      } else input.onClick(p);
    };
    const onPointerCancel = (e: PointerEvent) => {
      if (press?.box && e.pointerId === press.id) onBoxChange(undefined);
      if (press && e.pointerId === press.id) press = undefined;
    };
    const onPointerLeave = () => {
      last = undefined;
      input.onLeave();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!last || !['Control', 'Meta', 'Shift'].includes(e.key)) return;
      last = { ...last, ...modifiers(e) };
      report();
    };

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    const unsubscribe = viewport.subscribe((s, prev) => {
      if (s.view !== prev.view) report();
    });
    return () => {
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      unsubscribe();
      onBoxChange(undefined);
    };
  }, [surface, viewport, input, onBoxChange]);
}

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
      | { action: NavAction; x: number; y: number; ndc: [number, number]; id: number }
      | undefined;
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
      drag = { action, x: e.clientX, y: e.clientY, ndc: ndcOf(e), id: e.pointerId };
      onDrag(action);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
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

    // No context menu on the canvas yet; the right button can orbit (Onshape preset).
    const onContextMenu = (e: MouseEvent) => {
      if (inView(e) || passing(e)) e.preventDefault();
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', onContextMenu);
    return () => {
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
