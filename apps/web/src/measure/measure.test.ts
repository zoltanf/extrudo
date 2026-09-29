import { type BodyId, createSessionStore } from '@extrudo/core';
import type { Inspection } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { boxMesh } from '../selection/testing';
import { createModelSelect } from '../selection/useModelSelection';
import { itemRows, measureSections, pairRows, sizeText, totalRows } from './format';
import { createMeasureSelect, inspectTargets } from './inspection';

const MM = { units: 'mm' as const, precision: 2 };
const face = (i: number) => ({ kind: 'face' as const, id: `b:${i}` });
const B = 'b' as BodyId;

describe('inspectTargets', () => {
  it('keeps topology that exists, in order, and leaves out everything else', () => {
    const bodies = { [B]: boxMesh() };
    const targets = inspectTargets(
      [
        face(2),
        { kind: 'profile', id: 's/r1' },
        { kind: 'body', id: 'b' },
        face(99),
        { kind: 'edge', id: 'gone:1' },
        { kind: 'vertex', id: 'b:7' },
      ],
      bodies,
    );
    expect(targets).toEqual([
      { kind: 'face', body: B, index: 2 },
      { kind: 'body', body: B, index: 0 },
      { kind: 'vertex', body: B, index: 7 },
    ]);
  });
});

describe('createMeasureSelect', () => {
  it('adds up to two picks, then starts again; a modifier toggles; empty space clears', () => {
    const session = createSessionStore();
    const select = createMeasureSelect(session, createModelSelect(session));
    select.onClick(face(1), false);
    select.onClick(face(2), false);
    expect(session.getState().selection).toEqual([face(1), face(2)]);
    // Picking one of them again changes nothing.
    select.onClick(face(2), false);
    expect(session.getState().selection).toEqual([face(1), face(2)]);
    select.onClick(face(3), false);
    expect(session.getState().selection).toEqual([face(3)]);
    select.onClick(face(4), true);
    select.onClick(face(3), true);
    expect(session.getState().selection).toEqual([face(4)]);
    select.onClick(undefined, true);
    expect(session.getState().selection).toEqual([face(4)]);
    select.onClick(undefined, false);
    expect(session.getState().selection).toEqual([]);
  });
});

describe('measure format', () => {
  const box = { min: [0, 0, 0] as const, max: [40, 80, 60] as const };

  it('sizes a box in the document unit', () => {
    expect(sizeText(box, MM)).toBe('40.00 × 80.00 × 60.00 mm');
    expect(sizeText(box, { units: 'in', precision: 3 })).toBe('1.575 × 3.150 × 2.362 in');
  });

  it('describes items', () => {
    expect(
      itemRows(
        { kind: 'body', volume: 192000, area: 20800, centroid: [20, 40, 30], bbox: box },
        MM,
      ),
    ).toEqual([
      { label: 'Volume', value: '192000.00 mm³' },
      { label: 'Area', value: '20800.00 mm²' },
      { label: 'Centre', value: '20.00, 40.00, 30.00 mm' },
    ]);
    expect(
      itemRows(
        {
          kind: 'face',
          area: 628.3185,
          centroid: [0, 0, 10],
          bbox: box,
          surface: 'cylinder',
          axis: { origin: [0, 0, 0], direction: [0, 0, 1] },
          radius: 5,
        },
        MM,
      ).map((r) => `${r.label}: ${r.value}`),
    ).toEqual(['Type: Cylinder', 'Area: 628.32 mm²', 'Radius: 5.00 mm', 'Diameter: 10.00 mm']);
    expect(
      itemRows(
        {
          kind: 'edge',
          length: Math.PI * 2.5,
          centroid: [0, 0, 0],
          bbox: box,
          curve: 'circle',
          closed: false,
          center: [1, 2, 3],
          axis: [0, 0, 1],
          radius: 5,
          sweep: 90,
        },
        MM,
      ).map((r) => `${r.label}: ${r.value}`),
    ).toEqual([
      'Type: Arc',
      'Length: 7.85 mm',
      'Radius: 5.00 mm',
      'Diameter: 10.00 mm',
      'Sweep: 90.00°',
      'Centre: 1.00, 2.00, 3.00 mm',
    ]);
    expect(itemRows({ kind: 'vertex', point: [1, -0.001, 3], bbox: box }, MM)).toEqual([
      { label: 'Position', value: '1.00, 0.00, 3.00 mm' },
    ]);
  });

  it('describes a pair: distance, its parts, angle, centre distance', () => {
    const inspection: Inspection = {
      items: [],
      pair: {
        distance: 5,
        from: [0, 0, 0],
        to: [3, -4, 0],
        angle: 90,
        centers: { distance: 12, from: [0, 0, 0], to: [12, 0, 0] },
      },
    };
    expect(pairRows(inspection, MM).map((r) => `${r.label}: ${r.value}`)).toEqual([
      'Distance: 5.00 mm',
      'ΔX, ΔY, ΔZ: 3.00, 4.00, 0.00 mm',
      'Angle: 90.00°',
      'Centre distance: 12.00 mm',
    ]);
  });

  it('sums more than two items by kind', () => {
    const rows = totalRows(
      [
        { kind: 'face', area: 10, centroid: [0, 0, 0], bbox: box, surface: 'plane' },
        { kind: 'face', area: 5, centroid: [0, 0, 0], bbox: box, surface: 'plane' },
        {
          kind: 'edge',
          length: 3,
          centroid: [0, 0, 0],
          bbox: box,
          curve: 'line',
          closed: false,
        },
      ],
      MM,
    );
    expect(rows).toEqual([
      { label: 'Face area', value: '15.00 mm²' },
      { label: 'Edge length', value: '3.00 mm' },
    ]);
  });

  it('puts the sections in order: between, each item, the box', () => {
    const vertex = { kind: 'vertex' as const, point: [0, 0, 0] as const, bbox: box };
    const sections = measureSections(
      {
        items: [vertex, vertex],
        bbox: box,
        pair: { distance: 0, from: [0, 0, 0], to: [0, 0, 0] },
      },
      (i) => `Vertex ${i + 1}`,
      MM,
    );
    expect(sections.map((s) => s.title)).toEqual([
      'Between',
      'Vertex 1',
      'Vertex 2',
      'Bounding box',
    ]);
    // No parts for a zero distance.
    expect(sections[0]?.rows.map((r) => r.label)).toEqual(['Distance']);
  });
});
