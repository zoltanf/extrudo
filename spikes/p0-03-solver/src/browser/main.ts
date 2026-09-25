// P0-03 browser page: drag a sketch point under the cursor with planegcs on
// the main thread, show DOF and conflicts, and expose hooks for measure.ts.
//   ?build=npm (default), growth, modern or fast (our own builds, see README)
// Generated sketches are split into independent components, one planegcs
// system each (src/components.ts); a drag re-solves only the dragged one.
import {
  Algorithm,
  DebugMode,
  GcsWrapper,
  init_planegcs_module,
  type SketchParam,
  type SketchPrimitive,
} from '@salusoft89/planegcs';
import npmWasm from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import fastWasm from '../../builds/fast/planegcs.wasm?url';
import growthWasm from '../../builds/growth/planegcs.wasm?url';
import modernWasm from '../../builds/modern/planegcs.wasm?url';
import { splitComponents } from '../components.ts';
import { generate, type Layout } from '../sketches.ts';

type Prims = (SketchPrimitive | SketchParam)[];
const build = new URLSearchParams(location.search).get('build') ?? 'npm';

async function initModule() {
  if (build === 'growth') {
    const glue = await import('../../builds/growth/planegcs.js');
    return glue.default({ locateFile: () => growthWasm });
  }
  if (build === 'modern') {
    const glue = await import('../../builds/modern/planegcs.js');
    return glue.default({ locateFile: () => modernWasm });
  }
  if (build === 'fast') {
    const glue = await import('../../builds/fast/planegcs.js');
    return glue.default({ locateFile: () => fastWasm });
  }
  return init_planegcs_module({ locateFile: () => npmWasm });
}

// ---------------------------------------------------------------- sketches --

const P = (id: string, x: number, y: number): SketchPrimitive => ({ id, type: 'point', x, y, fixed: false });

/** The task's rectangle: own endpoints joined by coincidents, H/V, a width dimension, corner at the origin. */
function rectangle(): { prims: Prims; drag: string } {
  return {
    drag: 'c1',
    prims: [
      { type: 'param', name: 'W', value: 60 },
      P('a1', 0, 0), P('a2', 60, 0), P('b1', 60, 0), P('b2', 60, 40),
      P('c1', 60, 40), P('c2', 0, 40), P('d1', 0, 40), P('d2', 0, 0),
      { id: 'bottom', type: 'line', p1_id: 'a1', p2_id: 'a2' },
      { id: 'right', type: 'line', p1_id: 'b1', p2_id: 'b2' },
      { id: 'top', type: 'line', p1_id: 'c1', p2_id: 'c2' },
      { id: 'left', type: 'line', p1_id: 'd1', p2_id: 'd2' },
      { id: 'k1', type: 'p2p_coincident', p1_id: 'a2', p2_id: 'b1' },
      { id: 'k2', type: 'p2p_coincident', p1_id: 'b2', p2_id: 'c1' },
      { id: 'k3', type: 'p2p_coincident', p1_id: 'c2', p2_id: 'd1' },
      { id: 'k4', type: 'p2p_coincident', p1_id: 'd2', p2_id: 'a1' },
      { id: 'h1', type: 'horizontal_l', l_id: 'bottom' },
      { id: 'h2', type: 'horizontal_l', l_id: 'top' },
      { id: 'v1', type: 'vertical_l', l_id: 'right' },
      { id: 'v2', type: 'vertical_l', l_id: 'left' },
      { id: 'width', type: 'p2p_distance', p1_id: 'a1', p2_id: 'a2', distance: 'W' },
      { id: 'ox', type: 'coordinate_x', p_id: 'a1', x: 0 },
      { id: 'oy', type: 'coordinate_y', p_id: 'a1', y: 0 },
    ],
  };
}

// ------------------------------------------------------------------ solver --

const mod = await initModule();
let gcs: GcsWrapper; // the system holding the dragged point
let statics: GcsWrapper[] = []; // other components: solved once, drawn as is
let current: { prims: Prims; drag: string } = rectangle();
let conflict = false;
let components = 1;

const newSystem = () => {
  const system = new GcsWrapper(new mod.GcsSystem());
  system.debug_mode = DebugMode.NoDebug;
  return system;
};

function load(base: { prims: Prims; drag: string }, withConflict = conflict) {
  current = base;
  gcs?.destroy_gcs_module();
  for (const system of statics) system.destroy_gcs_module();
  statics = [];
  const groups = splitComponents([
    ...base.prims,
    ...(withConflict ? [{ id: 'culprit', type: 'p2p_distance', p1_id: 'a1', p2_id: 'a2', distance: 45 } as SketchPrimitive] : []),
  ]);
  components = groups.length;
  const holdsDrag = (g: Prims) => g.some((p) => 'id' in p && p.id === base.drag);
  for (const group of groups.filter((g) => !holdsDrag(g))) {
    const system = newSystem();
    system.push_primitives_and_params(group);
    system.solve(Algorithm.DogLeg);
    system.apply_solution();
    statics.push(system);
  }
  gcs = newSystem();
  const start = base.prims.find((p) => 'id' in p && p.id === base.drag) as { x: number; y: number };
  gcs.push_primitives_and_params([
    ...(groups.find(holdsDrag) ?? []),
    { type: 'param', name: 'drag_x', value: start.x },
    { type: 'param', name: 'drag_y', value: start.y },
    { id: 'drag_tx', type: 'coordinate_x', p_id: base.drag, x: 'drag_x', temporary: true },
    { id: 'drag_ty', type: 'coordinate_y', p_id: base.drag, y: 'drag_y', temporary: true },
  ]);
  solve();
  fit();
}

let lastSolveMs = 0;
let status = 0;
function solve() {
  const t = performance.now();
  status = gcs.solve(Algorithm.DogLeg);
  gcs.apply_solution();
  lastSolveMs = performance.now() - t;
}

function dragTo(x: number, y: number) {
  gcs.set_sketch_param('drag_x', x);
  gcs.set_sketch_param('drag_y', y);
  solve();
}

// ------------------------------------------------------------------ drawing --

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
let view = { scale: 1, ox: 0, oy: 0 };
const toScreen = (x: number, y: number) => [view.ox + x * view.scale, view.oy - y * view.scale] as const;
const toModel = (sx: number, sy: number) => [(sx - view.ox) / view.scale, (view.oy - sy) / view.scale] as const;

const systems = () => [...statics, gcs];
function points() {
  const map = new Map<string, { x: number; y: number }>();
  for (const system of systems()) {
    for (const p of system.sketch_index.get_primitives()) if (p.type === 'point') map.set(p.id, p);
  }
  return map;
}

function fit() {
  const pts = [...points().values()];
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((canvas.width - 80) / Math.max(1, x1 - x0), (canvas.height - 80) / Math.max(1, y1 - y0 + 20));
  view = { scale, ox: 40 - x0 * scale, oy: canvas.height - 40 + y0 * scale };
}

function draw() {
  const pts = points();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1.5;
  const color = gcs.has_gcs_conflicting_constraints() ? '#ff6b6b' : gcs.gcs.dof() === 0 ? '#e9edf3' : '#5aa9ff';
  ctx.strokeStyle = color;
  for (const p of systems().flatMap((system) => system.sketch_index.get_primitives())) {
    ctx.beginPath();
    if (p.type === 'line') {
      const a = pts.get(p.p1_id);
      const b = pts.get(p.p2_id);
      if (!a || !b) continue;
      ctx.moveTo(...toScreen(a.x, a.y));
      ctx.lineTo(...toScreen(b.x, b.y));
    } else if (p.type === 'circle' || p.type === 'arc') {
      const c = pts.get(p.c_id);
      if (!c) continue;
      const [sx, sy] = toScreen(c.x, c.y);
      const [a0, a1] = p.type === 'arc' ? [-p.end_angle, -p.start_angle] : [0, 2 * Math.PI];
      ctx.arc(sx, sy, p.radius * view.scale, a0, a1);
    }
    ctx.stroke();
  }
  const d = pts.get(current.drag);
  if (d) {
    ctx.fillStyle = '#ffb23e';
    ctx.beginPath();
    ctx.arc(...toScreen(d.x, d.y), 5, 0, 2 * Math.PI);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- interaction --

const frameTimes: number[] = [];
const solveTimes: number[] = [];
let target: [number, number] | undefined;
let dragging = false;
let lastFrame = 0;

function frame(now: number) {
  if (target) {
    dragTo(...target);
    solveTimes.push(lastSolveMs);
    target = undefined;
    draw();
    if (lastFrame) frameTimes.push(now - lastFrame);
  }
  lastFrame = now;
  updateStats();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', () => {
  dragging = false;
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging) target = [...toModel(e.offsetX, e.offsetY)] as [number, number];
});

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0;
function updateStats() {
  const conflicts = gcs.get_gcs_conflicting_constraints();
  const statusEl = document.getElementById('status') as HTMLElement;
  statusEl.textContent = conflicts.length
    ? `Conflict: ${conflicts.join(', ')}`
    : `DOF ${gcs.gcs.dof()} (drag excluded) · solve status ${status}`;
  statusEl.className = conflicts.length ? 'conflict' : '';
  const recent = frameTimes.slice(-60);
  const fps = recent.length ? 1000 / median(recent) : 0;
  (document.getElementById('stats') as HTMLElement).textContent =
    `build ${build} · ${components} component(s) · solve ${lastSolveMs.toFixed(2)} ms (median ${median(solveTimes.slice(-60)).toFixed(2)}) · ${fps.toFixed(0)} fps`;
}

const sketchSelect = document.getElementById('sketch') as HTMLSelectElement;
const layoutSelect = document.getElementById('layout') as HTMLSelectElement;
function reload() {
  frameTimes.length = 0;
  solveTimes.length = 0;
  const value = sketchSelect.value;
  if (value === 'rect') load(rectangle());
  else {
    const g = generate({ entities: Number(value), layout: layoutSelect.value as Layout, freeLastHeight: true });
    load({ prims: g.primitives, drag: g.dragPoint }, false);
  }
  draw();
}
sketchSelect.addEventListener('change', reload);
layoutSelect.addEventListener('change', reload);
(document.getElementById('conflict') as HTMLButtonElement).addEventListener('click', () => {
  conflict = !conflict;
  (document.getElementById('conflict') as HTMLButtonElement).textContent = conflict
    ? 'Remove conflicting dimension'
    : 'Add conflicting dimension';
  sketchSelect.value = 'rect';
  reload();
});
reload();

// ------------------------------------------------------------ measure hooks --

declare global {
  interface Window {
    spike: {
      build: string;
      /** Loads a sketch and drags its free corner for `frames` animation frames. */
      dragTest: (sketch: string, layout: Layout, frames: number) => Promise<unknown>;
      state: () => { dof: number; conflicts: string[]; status: number };
      toggleConflict: () => void;
    };
  }
}

window.spike = {
  build,
  state: () => ({ dof: gcs.gcs.dof(), conflicts: gcs.get_gcs_conflicting_constraints(), status }),
  toggleConflict: () => (document.getElementById('conflict') as HTMLButtonElement).click(),
  dragTest: (sketch, layout, frames) =>
    new Promise((resolve) => {
      sketchSelect.value = sketch;
      layoutSelect.value = layout;
      reload();
      const start = points().get(current.drag) as { x: number; y: number };
      frameTimes.length = 0;
      solveTimes.length = 0;
      let i = 0;
      const step = () => {
        if (i++ < frames) {
          target = [start.x, start.y + 8 * Math.sin(i / 8)];
          requestAnimationFrame(step);
        } else {
          resolve({
            sketch,
            layout,
            frames,
            solveMedian: median(solveTimes),
            solveP95: p95(solveTimes),
            frameMedian: median(frameTimes),
            frameP95: p95(frameTimes),
            fps: 1000 / median(frameTimes),
            framesOver16ms: frameTimes.filter((t) => t > 16.7 * 1.5).length,
            dof: gcs.gcs.dof(),
            components,
          });
        }
      };
      requestAnimationFrame(step);
    }),
};
