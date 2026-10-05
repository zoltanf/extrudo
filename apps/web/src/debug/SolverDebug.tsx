import type { SketchData } from '@extrudo/core';
import { loadSketchSolver, type SketchSolver } from '@extrudo/sketch/browser';
import { plate, type SketchBuilder } from '@extrudo/sketch/fixtures';
import { useEffect, useState } from 'react';

interface Row {
  name: string;
  entities: number;
  components: number;
  dof: number;
  /** Median solve time per drag frame, ms. */
  drag: number;
  fps: number;
}

const FRAMES = 90;

/**
 * Solver debug page (P1-03), at `#/debug/solver`: loads the planegcs WASM
 * from the production bundle, drags a point in generated sketches for 90
 * animation frames on the main thread, and reports a conflict, like the
 * P0-03 spike's page. The sketches come from `@extrudo/sketch/fixtures`.
 */
export function SolverDebug() {
  const [solver, setSolver] = useState<SketchSolver>();
  const [loadMs, setLoadMs] = useState(0);
  const [message, setMessage] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [conflict, setConflict] = useState<string[]>();
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let alive = true;
    let loaded: SketchSolver | undefined;
    const start = performance.now();
    loadSketchSolver()
      .then((s) => {
        loaded = s;
        if (!alive) return s.dispose();
        setLoadMs(performance.now() - start);
        setSolver(s);
      })
      .catch((error: unknown) => setMessage(`The solver didn't load: ${String(error)}`));
    return () => {
      alive = false;
      loaded?.dispose();
    };
  }, []);

  const run = async () => {
    if (!solver) return;
    setRunning(true);
    setRows([]);
    setConflict(undefined);
    try {
      const cases = [
        {
          name: 'Rectangle, hole, slot',
          ...plate({ entities: 9, layout: 'anchored', freeLastHeight: true }),
        },
        {
          name: 'Anchored plate',
          ...plate({ entities: 200, layout: 'anchored', freeLastHeight: true }),
        },
        {
          name: 'Chained plate',
          ...plate({ entities: 100, layout: 'chained', freeLastHeight: true }),
        },
      ];
      for (const c of cases) {
        const row = await drag(solver, c.name, c.builder, c.entities, c.dragPoint);
        setRows((previous) => [...previous, row]);
      }
      setConflict(conflicting(solver));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <main className="kernel-debug">
      <header>
        <h1>Solver debug</h1>
        <p role="status" aria-label="Solver status">
          Solver: <strong>{solver ? 'ready' : message ? 'failed' : 'loading'}</strong>
          {solver && ` · loaded in ${loadMs.toFixed(0)} ms`}
        </p>
        <div className="actions">
          <button type="button" onClick={run} disabled={!solver || running}>
            Drag test
          </button>
        </div>
        {rows.length > 0 && (
          <table data-testid="solver-results">
            <thead>
              <tr>
                <th>Sketch</th>
                <th>Entities</th>
                <th>Components</th>
                <th>DOF</th>
                <th>Solve per frame</th>
                <th>Frame rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.entities}</td>
                  <td>{r.components}</td>
                  <td>DOF {r.dof}</td>
                  <td>{r.drag.toFixed(2)} ms</td>
                  <td>{r.fps.toFixed(0)} fps</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {conflict && (
          <p data-testid="solver-conflict">
            A second width conflicts: {conflict.length} constraints involved ({conflict.join(', ')})
          </p>
        )}
        {message && <p className="message">{message}</p>}
      </header>
    </main>
  );
}

/** Drags `point` along a sine (and off its path) for FRAMES animation frames. */
async function drag(
  solver: SketchSolver,
  name: string,
  builder: SketchBuilder,
  entities: number,
  point: string,
): Promise<Row> {
  const result = solver.solve(builder.sketch, builder.values);
  const start = result.solution.points[point] as { x: number; y: number };
  solver.beginDrag(point);
  const solves: number[] = [];
  const frames: number[] = [];
  let dof = result.dof;
  await new Promise<void>((resolve) => {
    let previous = 0;
    const frame = (now: number) => {
      if (previous) frames.push(now - previous);
      previous = now;
      const i = solves.length + 1;
      const t = performance.now();
      dof = solver.drag(start.x + 3, start.y + 10 * Math.sin(i / 10)).dof;
      solves.push(performance.now() - t);
      if (solves.length < FRAMES) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
  solver.endDrag();
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;
  return {
    name,
    entities,
    components: result.components.length,
    dof,
    drag: median(solves),
    fps: 1000 / median(frames),
  };
}

/** The rectangle with a second, different width: planegcs names both. */
function conflicting(solver: SketchSolver): string[] {
  const { builder } = plate({ entities: 9, layout: 'anchored' });
  const sketch = builder.sketch;
  const bottom = Object.entries(sketch.entities).find(([, e]) => e.type === 'line');
  if (bottom?.[1].type !== 'line') return [];
  const withSecond = {
    ...sketch,
    dimensions: {
      ...sketch.dimensions,
      width2: {
        type: 'distance',
        orientation: 'horizontal',
        a: bottom[1].start,
        b: bottom[1].end,
        expr: '60 mm',
        driven: false,
      },
    },
  } as SketchData;
  return solver.solve(withSecond, { ...builder.values, width2: 60 }).conflicting.sort();
}
