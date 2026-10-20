import {
  type ConstructionReports,
  type Feature,
  type FeatureId,
  ORIGIN_PLANES,
  type SketchFrame,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../viewport/store';
import { constructionDatumSources, type DatumSource, datumSnapsAt } from './datums';

const plane = (id: string) => ORIGIN_PLANES.find((p) => p.id === id)?.frame as SketchFrame;
const shown = { ...DEFAULT_SETTINGS.origin };

describe('datum picks (ADR-0093)', () => {
  it('offers the origin before an axis, and an axis as its 100 mm line', () => {
    const xy = plane('origin:xy');
    expect(datumSnapsAt(xy, [0.1, 0.1], 0.8, shown).point?.ref).toEqual({
      kind: 'point',
      id: 'origin:point',
    });
    const { point, axis } = datumSnapsAt(xy, [0.3, 30], 0.8, shown);
    expect(point).toBeUndefined();
    expect(axis).toMatchObject({
      ref: { kind: 'axis', id: 'origin:y' },
      kind: 'axis',
      point: [0, 30],
      line: [
        [0, -50],
        [0, 50],
      ],
    });
    expect(datumSnapsAt(xy, [5, 5], 0.8, shown)).toEqual({});
  });

  it('turns an axis along the normal into a point, and skips hidden ones', () => {
    // The Front plane (XZ): the Y axis is seen end-on, Z runs up the sketch.
    const xz = plane('origin:xz');
    const hidden = { ...shown, point: false };
    expect(datumSnapsAt(xz, [0.1, 0], 0.8, hidden).point).toMatchObject({
      ref: { kind: 'axis', id: 'origin:y' },
      kind: 'point',
    });
    expect(datumSnapsAt(xz, [0.2, 20], 0.8, shown).axis?.ref.id).toBe('origin:z');
    expect(datumSnapsAt(xz, [0.2, 20], 0.8, { ...shown, z: false })).toEqual({});
  });
});

describe('construction datum picks (ADR-0093 slice 2)', () => {
  const xy = plane('origin:xy');
  const source: DatumSource = {
    ref: { kind: 'axis', id: 'cx' },
    kind: 'axis',
    origin: [0, 10, 0],
    direction: [1, 0, 0],
  };

  it('offers a construction axis parallel to the sketch as its 100 mm line', () => {
    const { point, axis } = datumSnapsAt(xy, [5, 10.1], 0.8, shown, [source]);
    expect(point).toBeUndefined();
    expect(axis).toMatchObject({
      ref: { kind: 'axis', id: 'cx' },
      kind: 'axis',
      point: [5, 10],
      line: [
        [-50, 10],
        [50, 10],
      ],
    });
  });

  it('turns a construction axis along the normal into a point', () => {
    const z: DatumSource = {
      ref: { kind: 'axis', id: 'cz' },
      kind: 'axis',
      origin: [3, 4, 0],
      direction: [0, 0, 1],
    };
    expect(datumSnapsAt(xy, [3.1, 4], 0.8, shown, [z]).point).toMatchObject({
      ref: { kind: 'axis', id: 'cz' },
      kind: 'point',
      point: [3, 4],
    });
  });

  it('offers a construction point at its projection', () => {
    const p: DatumSource = { ref: { kind: 'point', id: 'cp' }, kind: 'point', point: [3, 4, 0] };
    expect(datumSnapsAt(xy, [3.1, 4.1], 0.8, shown, [p]).point).toMatchObject({
      ref: { kind: 'point', id: 'cp' },
      kind: 'point',
      point: [3, 4],
    });
    expect(datumSnapsAt(xy, [10, 5], 0.8, shown, [p, source])).toEqual({});
  });

  it('ranks construction points with the datum points, nearest first', () => {
    const p: DatumSource = { ref: { kind: 'point', id: 'cp' }, kind: 'point', point: [3, 4, 0] };
    expect(datumSnapsAt(xy, [3.1, 4.1], 0.8, shown, [p]).point?.ref.id).toBe('cp');
    expect(datumSnapsAt(xy, [0.1, 0.1], 0.8, shown, [p]).point?.ref.id).toBe('origin:point');
  });
});

describe('constructionDatumSources (ADR-0093 slice 2)', () => {
  const feature = (id: string, type: string, over: Partial<Feature> = {}): Feature => ({
    id: id as FeatureId,
    type,
    name: id,
    suppressed: false,
    inputs: {},
    ...over,
  });
  const reports = {
    ax: { kind: 'axis', origin: [0, 10, 0], direction: [1, 0, 0] },
    cp: { kind: 'point', point: [3, 4, 0] },
    pl: { kind: 'plane', frame: plane('origin:xy'), anchor: [0, 0, 0] },
  } as ConstructionReports;

  it('takes the construction features before the sketch, shown and live', () => {
    const doc = {
      features: [
        feature('ax', 'axisAlongEdge'),
        feature('cp', 'constructionPoint'),
        feature('pl', 'offsetPlane'),
        feature('sk', 'sketch'),
        feature('late', 'constructionPoint'),
      ],
      timelineMarker: 5,
    };
    expect(constructionDatumSources(doc, reports, 'sk' as FeatureId)).toEqual([
      { ref: { kind: 'axis', id: 'ax' }, kind: 'axis', origin: [0, 10, 0], direction: [1, 0, 0] },
      { ref: { kind: 'point', id: 'cp' }, kind: 'point', point: [3, 4, 0] },
    ]);
  });

  it('drops suppressed, hidden, rolled-back and plane features, and an unknown sketch', () => {
    const doc = {
      features: [
        feature('ax', 'axisAlongEdge', { suppressed: true }),
        feature('ax2', 'axisAlongEdge'),
        feature('cp', 'constructionPoint', { visible: false }),
        feature('pl', 'offsetPlane'),
        feature('sk', 'sketch'),
      ],
      timelineMarker: 4, // the plane at the marker is rolled back
    };
    expect(
      constructionDatumSources(
        doc,
        { ax2: reports['ax' as FeatureId] } as ConstructionReports,
        'sk' as FeatureId,
      ),
    ).toEqual([
      { ref: { kind: 'axis', id: 'ax2' }, kind: 'axis', origin: [0, 10, 0], direction: [1, 0, 0] },
    ]);
    expect(
      constructionDatumSources({ ...doc, timelineMarker: 5 }, reports, 'nope' as FeatureId),
    ).toEqual([]);
    expect(constructionDatumSources(doc, reports, undefined)).toEqual([]);
  });
});
