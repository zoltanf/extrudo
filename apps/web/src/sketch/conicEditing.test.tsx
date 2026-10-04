/**
 * Editing a conic in a sketch (P4-05, ADR-0063 §4): the command the selection
 * panel's Rho field writes, and the panel's own fields. The panel is React and
 * this project has no DOM in tests, so the command it runs is tested here and
 * the field is checked with `renderToStaticMarkup`.
 */
import {
  addToSketch,
  CommandError,
  createDocument,
  createDocumentStore,
  createSessionStore,
  type FeatureId,
  originPlaneRef,
  readSketch,
  type SketchEntityId,
  type SketchSpline,
  setSplineRho,
} from '@extrudo/core';
import { loadPlanegcs, SketchSolver } from '@extrudo/sketch';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryPreferences } from '../platform';
import { createViewportStore } from '../viewport/store';
import { createSketchOn } from './mode';
import { SplineFields } from './panels';
import { inRhoRange } from './tools/conics';
import { createToolHost, type ToolHost } from './tools/host';

const eid = (id: string) => id as SketchEntityId;
const hosts: ToolHost[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.dispose();
});

/** A sketch in sketch mode holding a conic, a control-point spline and a fit spline. */
async function setup() {
  const stores = {
    store: createDocumentStore(createDocument()),
    session: createSessionStore(),
    viewport: createViewportStore({ preferences: memoryPreferences(), reducedMotion: () => true }),
  };
  const sketch = createSketchOn(stores, originPlaneRef('origin:xy'));
  const points = (y: number) =>
    [
      { type: 'point', x: 0, y },
      { type: 'point', x: 15, y: y + 12 },
      { type: 'point', x: 30, y },
    ] as const;
  stores.store.getState().dispatch(
    addToSketch({
      feature: sketch,
      entities: {
        [eid('a')]: points(0)[0],
        [eid('b')]: points(0)[1],
        [eid('c')]: points(0)[2],
        [eid('conic')]: {
          type: 'spline',
          points: [eid('a'), eid('b'), eid('c')],
          mode: 'conic',
          rho: 0.4,
          construction: false,
        },
        [eid('p')]: points(20)[0],
        [eid('q')]: points(20)[1],
        [eid('r')]: points(20)[2],
        [eid('poles')]: {
          type: 'spline',
          points: [eid('p'), eid('q'), eid('r')],
          mode: 'control',
          construction: false,
        },
      },
    }),
  );
  const planegcs = await loadPlanegcs();
  const host = createToolHost({ ...stores, loadSolver: async () => new SketchSolver(planegcs) });
  hosts.push(host);
  const data = () => {
    const feature = stores.store.getState().doc.features.find((f) => f.id === sketch);
    const view = feature && readSketch(feature);
    if (!view) throw new Error('no sketch');
    return view.data;
  };
  const entity = (id: string): SketchSpline => {
    const e = data().entities[eid(id)];
    if (e?.type !== 'spline') throw new Error(`${id} is not a spline`);
    return e;
  };
  return { ...stores, host, sketch: sketch as FeatureId, data, entity };
}

describe('setSplineRho in the app', () => {
  it('changes a conic as one undo step through the host', async () => {
    const t = await setup();
    t.host.apply(setSplineRho({ feature: t.sketch, id: eid('conic'), rho: 0.75 }));
    expect(t.entity('conic').rho).toBe(0.75);
    expect(t.entity('conic').mode).toBe('conic');
    t.store.getState().undo();
    expect(t.entity('conic').rho).toBe(0.4);
    t.store.getState().redo();
    expect(t.entity('conic').rho).toBe(0.75);
  });

  it('refuses a rho the schema will not take, changing nothing', async () => {
    // The schema takes 0 < rho < 1; the tools and the panel keep to the tighter
    // 0.05 to 0.95 (`inRhoRange`), so a value between the two is stored.
    const t = await setup();
    for (const rho of [0, 1, -0.1, 1.5]) {
      expect(() =>
        t.store.getState().dispatch(setSplineRho({ feature: t.sketch, id: eid('conic'), rho })),
      ).toThrow(CommandError);
    }
    t.host.apply(setSplineRho({ feature: t.sketch, id: eid('conic'), rho: 0.06 }));
    expect(t.entity('conic').rho).toBe(0.06);
    expect(inRhoRange(0.02)).toBe(false);
    expect(inRhoRange(0.5)).toBe(true);
    expect(inRhoRange(0.96)).toBe(false);
    expect(inRhoRange(0.95)).toBe(true);
  });
});

describe('the selection panel for a spline', () => {
  it('shows the rho of the selected conic', async () => {
    const t = await setup();
    const html = renderToStaticMarkup(
      <SplineFields
        store={t.store}
        id={eid('conic')}
        spline={t.entity('conic')}
        sketchId={t.sketch}
        doc={t.store.getState().doc}
        host={t.host}
        notify={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Rho"');
    expect(html).toContain('value="0.4"');
    expect(html).toContain('>Rho<');
  });
});
