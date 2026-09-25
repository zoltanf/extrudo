import type { BodyId, BodyMeta, OriginPlaneId, SketchFrame } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DirectionalLight } from 'three';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { useShortcuts } from '../commands/shortcuts';
import { Bodies } from './Bodies';
import { CameraRig } from './CameraRig';
import { basis, orbit, pan, type View, zoomAt } from './camera';
import { type Rgba, type SceneColors, useSceneColors } from './colors';
import { Grid, XY_FRAME } from './Grid';
import { NavBar } from './NavBar';
import { dragAction, dragZoomFactor, type NavAction, ORBIT_RATE, wheelAction } from './navigation';
import { Origin } from './Origin';
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
}

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
}: ViewportProps) {
  const section = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const colors = useSceneColors();
  const tool = useStore(viewport, (s) => s.tool);
  const [dragging, setDragging] = useState<NavAction>();
  const [ready, setReady] = useState(false);

  useShortcuts(
    useMemo(
      () => [
        { keys: 'F6', run: () => viewport.getState().fit() },
        ...(tool ? [{ keys: 'Escape', run: () => viewport.getState().setTool(undefined) }] : []),
      ],
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

  useNavigation(surface, viewport, setDragging);

  const cursor = dragging
    ? 'cursor-grabbing'
    : tool
      ? 'cursor-grab'
      : planePicker?.hover
        ? 'cursor-pointer'
        : '';

  return (
    <section
      ref={section}
      aria-label="Viewport"
      data-ready={ready || undefined}
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
        </Canvas>
      </div>
      <ViewCube store={viewport} />
      <NavBar store={viewport} />
      <ViewStatus viewport={viewport} />
    </section>
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
        sketch={colors.sketch}
        construction={colors.sketchConstruction}
        showPoints={sketchPoints}
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

/** Mouse, wheel and trackpad navigation on the canvas wrapper. */
function useNavigation(
  surface: RefObject<HTMLDivElement | null>,
  viewport: ViewportStore,
  onDrag: (action: NavAction | undefined) => void,
) {
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    let drag:
      | { action: NavAction; x: number; y: number; ndc: [number, number]; id: number }
      | undefined;
    let lastMiddle = { time: -Infinity, x: 0, y: 0 };

    const ndcOf = (e: { clientX: number; clientY: number }): [number, number] => {
      const r = el.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
    };

    const onPointerDown = (e: PointerEvent) => {
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
      const { view, aspect, setView } = viewport.getState();
      if (drag.action === 'orbit') setView(orbit(view, -dx * ORBIT_RATE, -dy * ORBIT_RATE));
      else if (drag.action === 'pan') setView(pan(view, dx, dy, el.clientHeight));
      else setView(zoomAt(view, dragZoomFactor(dy), drag.ndc, aspect));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = undefined;
      onDrag(undefined);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { view, aspect, preset, setView } = viewport.getState();
      const result = wheelAction(preset, e);
      if (result.action === 'zoom') setView(zoomAt(view, result.factor, ndcOf(e), aspect));
      else setView(pan(view, result.dx, result.dy, el.clientHeight));
    };

    // No context menu on the canvas yet; the right button can orbit (Onshape preset).
    const onContextMenu = (e: MouseEvent) => e.preventDefault();

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
  }, [surface, viewport, onDrag]);
}
