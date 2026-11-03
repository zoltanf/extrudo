// @vitest-environment jsdom
// The Project tool picking a sketch curve or a whole sketch (ADR-0125): the
// view's `sketchEntity` item and the browser's `feature` item become
// `addProjection` dispatches; a later sketch or a text is refused.
import {
  addToSketch,
  applyCommand,
  createDocument,
  createDocumentStore,
  createSessionStore,
  createSketch,
  type DocumentId,
  type Feature,
  type FeatureId,
  type GeomRef,
  originPlaneRef,
  readSketch,
  type SketchEntity,
  type SketchEntityId,
} from '@extrudo/core';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViewportStore } from '../viewport/store';
import { useProjectTool } from './project';

afterEach(cleanup);

const viewport = {
  getState: () => ({ setFieldFilter: () => {} }),
} as unknown as ViewportStore;

function setup() {
  const base = createDocument({
    id: 'd' as DocumentId,
    name: 'P',
    now: '2026-11-03T00:00:00.000Z',
  });
  let doc = applyCommand(
    base,
    createSketch({ id: 'A' as FeatureId, plane: originPlaneRef('origin:xy') }),
  ).doc;
  doc = applyCommand(
    doc,
    createSketch({ id: 'S' as FeatureId, plane: originPlaneRef('origin:xy') }),
  ).doc;
  doc = applyCommand(
    doc,
    createSketch({ id: 'L' as FeatureId, plane: originPlaneRef('origin:xy') }),
  ).doc;
  doc = applyCommand(
    doc,
    addToSketch({
      feature: 'A' as FeatureId,
      entities: {
        ['p0' as SketchEntityId]: { type: 'point', x: 0, y: 0 },
        ['ta' as SketchEntityId]: { type: 'point', x: 40, y: 0 },
        ['tt' as SketchEntityId]: { type: 'point', x: 40, y: 10 },
        ['c1' as SketchEntityId]: { type: 'circle', center: 'p0', radius: 5, construction: false },
        ['t1' as SketchEntityId]: {
          type: 'text',
          anchor: 'ta',
          top: 'tt',
          text: 'Hi',
          font: 'inter-regular@1',
          align: 'left',
          construction: false,
        },
      } as Record<SketchEntityId, SketchEntity>,
    }),
  ).doc;
  const store = createDocumentStore(doc);
  const session = createSessionStore();
  const notify = vi.fn();
  const { result, unmount } = renderHook(() =>
    useProjectTool({
      store,
      session,
      viewport,
      kernel: undefined,
      notify,
      tool: 'project',
      sketchId: 'S' as FeatureId,
    }),
  );
  const projections = () => {
    const feature = store.getState().doc.features.find((f) => f.id === 'S') as Feature;
    return readSketch(feature)?.data.projections ?? {};
  };
  const select = result.current.select;
  if (!select) throw new Error('no project select');
  return { store, notify, select, projections, unmount };
}

describe('the Project tool (ADR-0125)', () => {
  it('projects a curve of an earlier sketch', () => {
    const { notify, select, projections } = setup();
    select.onClick({ kind: 'sketchEntity', id: 'A/c1' }, false);
    const records = Object.values(projections());
    expect(records).toHaveLength(1);
    expect(records[0]?.ref).toEqual({ kind: 'sketchEntity', id: 'A/c1' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('refuses a later sketch and a text', () => {
    const { notify, select, projections } = setup();
    select.onClick({ kind: 'sketchEntity', id: 'L/c1' }, false);
    select.onClick({ kind: 'sketchEntity', id: 'A/t1' }, false);
    expect(Object.keys(projections())).toEqual([]);
    expect(notify).toHaveBeenCalledWith(
      'error',
      'Only a sketch earlier in the timeline can be projected.',
    );
    expect(notify).toHaveBeenCalledWith(
      'error',
      "Text can't be projected: project its sketch's curves instead.",
    );
  });

  it("projects a whole sketch through its browser row's click", () => {
    const { select, projections } = setup();
    select.onClick({ kind: 'feature', id: 'A' }, false);
    const records = Object.values(projections());
    expect(records[0]?.ref).toEqual({ kind: 'feature', id: 'A' } satisfies GeomRef);
  });
});
