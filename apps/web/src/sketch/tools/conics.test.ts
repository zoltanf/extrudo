import { afterEach, describe, expect, it } from 'vitest';
import { CONIC_TOOL, SPLINE_CONTROL_TOOL } from './conics';
import { at, disposeHosts, setup } from './testing';

// P4-05: the Control Point Spline and Conic tools (ADR-0063 §4).

afterEach(disposeHosts);

type Tested = Awaited<ReturnType<typeof setup>>;

/** A clean solve: converged, nothing conflicting or redundant, `dof` left. */
function clean(t: Tested, dof: number) {
  const r = t.report();
  expect(r.ok).toBe(true);
  expect(r.conflicting).toEqual([]);
  expect(r.redundant).toEqual([]);
  expect(r.dof).toBe(dof);
}

/** The spline a tool made, with its points' positions. */
function splineOf(t: Tested) {
  const [spline] = t.byType('spline');
  if (spline?.type !== 'spline') throw new Error('no spline');
  return spline;
}

describe('control-point spline tool', () => {
  it('draws a spline through the clicked poles; Enter finishes', async () => {
    const t = await setup({ tool: SPLINE_CONTROL_TOOL });
    t.host.click(at(0, 10));
    t.host.click(at(10, 20));
    expect(t.host.state.getState().tool?.preview().polylines).toHaveLength(1);
    t.host.click(at(20, 5));
    t.host.escape(); // takes back (20, 5)
    expect(t.byType('spline')).toHaveLength(0);
    t.host.click(at(25, 12));
    t.host.enter();
    const spline = splineOf(t);
    expect(spline.mode).toBe('control');
    expect(spline.points.map((p) => t.point(p))).toEqual([
      [0, 10],
      [10, 20],
      [25, 12],
    ]);
    clean(t, 6);
  });

  it('needs two poles, and a second click on the last one finishes', async () => {
    const t = await setup({ tool: SPLINE_CONTROL_TOOL });
    t.host.click(at(0, 0));
    t.host.enter();
    expect(t.byType('spline')).toHaveLength(0);
    t.host.click(at(10, 0));
    t.host.click(at(10, 0));
    expect(t.byType('spline')).toHaveLength(1);
    expect(splineOf(t).mode).toBe('control');
  });
});

describe('conic tool', () => {
  it('draws a conic of its two ends and the shoulder, in that order', async () => {
    const t = await setup({ tool: CONIC_TOOL });
    t.host.click(at(0, 0));
    t.host.click(at(20, 0));
    // The head-up field is there from the first click, and remembers its value.
    expect(t.host.state.getState().tool?.fields()).toEqual([
      { name: 'rho', label: 'Rho', kind: 'unitless', value: 0.5, locked: undefined },
    ]);
    t.host.click(at(10, 12));
    const spline = splineOf(t);
    expect(spline.mode).toBe('conic');
    expect(spline.rho).toBe(0.5);
    expect(spline.points.map((p) => t.point(p))).toEqual([
      [0, 0],
      [10, 12],
      [20, 0],
    ]);
    // Three points, with the starts and ends on one line and the shoulder square
    // to their middle (what the clicks inferred).
    clean(t, 3);
  });

  it('takes a typed rho, and the next conic starts at it', async () => {
    const t = await setup({ tool: CONIC_TOOL });
    t.host.lock('rho', { expr: '0.3', value: 0.3 });
    t.host.click(at(0, 0));
    t.host.click(at(20, 0));
    t.host.click(at(10, 8));
    expect(splineOf(t).rho).toBe(0.3);
    t.host.click(at(0, 30));
    t.host.click(at(20, 30));
    t.host.click(at(10, 38));
    expect(t.byType('spline')[1]).toMatchObject({ mode: 'conic', rho: 0.3 });
    // A rho outside 0.05 to 0.95 is refused, as the polygon's sides are: the
    // field goes back to the default.
    t.host.click(at(0, -30));
    t.host.lock('rho', { expr: '2', value: 2 });
    expect(t.host.state.getState().tool?.fields()[0]?.value).toBe(0.5);
    t.host.click(at(20, -30));
    t.host.click(at(10, -22));
    expect(t.byType('spline')[2]).toMatchObject({ rho: 0.5 });
  });

  it('needs a shoulder away from its ends, and Esc takes a click back', async () => {
    const t = await setup({ tool: CONIC_TOOL });
    t.host.click(at(0, 0));
    t.host.click(at(20, 0));
    t.host.escape();
    t.host.escape();
    expect(t.byType('spline')).toHaveLength(0);
    t.host.click(at(0, 0));
    t.host.click(at(0, 0)); // the same place as the start
    expect(t.byType('spline')).toHaveLength(0);
    t.host.click(at(20, 0));
    t.host.click(at(10, 0)); // the shoulder on the chord: a line, not a conic
    expect(t.byType('spline')).toHaveLength(0);
    t.host.click(at(10, 10));
    expect(t.byType('spline')).toHaveLength(1);
  });
});
