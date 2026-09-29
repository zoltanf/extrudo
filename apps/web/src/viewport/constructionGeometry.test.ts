import { faceSketchFrame, type SelectionItem } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import {
  CONSTRUCTION_AXIS_HALF,
  CONSTRUCTION_PLANE_HALF,
  type ConstructionDrawing,
  constructionPick,
  constructionState,
  constructionSummary,
} from './constructionGeometry';

const frame = faceSketchFrame([0, 0, 30], [0, 0, 1]);
const items: ConstructionDrawing[] = [
  { id: 'P', name: 'Offset Plane1', report: { kind: 'plane', frame, anchor: [1, 2, 30] } },
  { id: 'A', name: 'Axis1', report: { kind: 'axis', origin: [0, 0, 5], direction: [1, 0, 0] } },
  { id: 'Q', name: 'Point1', report: { kind: 'point', point: [1, 2, 3] } },
  {
    id: 'draft',
    name: 'Offset Plane2',
    preview: true,
    report: { kind: 'plane', frame, anchor: [0, 0, 30] },
  },
];

describe('construction geometry as drawn', () => {
  it('sizes what can be picked by the view size, and leaves the preview out', () => {
    const pick = constructionPick(items, 100);
    expect(pick.planes).toEqual([
      { id: 'P', frame, anchor: [1, 2, 30], half: 100 * CONSTRUCTION_PLANE_HALF },
    ]);
    expect(pick.axes).toEqual([
      { id: 'A', origin: [0, 0, 5], direction: [1, 0, 0], half: 100 * CONSTRUCTION_AXIS_HALF },
    ]);
    expect(pick.points).toEqual([{ id: 'Q', at: [1, 2, 3] }]);
  });

  it('says hovered or selected by the kind of reference, or by a hovered feature row', () => {
    const [plane] = items as [ConstructionDrawing];
    const pick = (kind: SelectionItem['kind'], id = 'P'): SelectionItem => ({ kind, id });
    expect(constructionState(plane, undefined, [])).toBeUndefined();
    expect(constructionState(plane, pick('plane'), [])).toBe('hover');
    expect(constructionState(plane, pick('feature'), [])).toBe('hover');
    expect(constructionState(plane, pick('plane'), [pick('plane')])).toBe('selected');
    expect(constructionState(plane, pick('axis'), [])).toBeUndefined();
    expect(constructionState(plane, pick('plane', 'other'), [])).toBeUndefined();
  });

  it('summarises for tests: name, kind, place', () => {
    expect(constructionSummary([])).toBeUndefined();
    expect(constructionSummary(items)).toBe(
      'Offset_Plane1:plane:0,0,30:0,0,1 Axis1:axis:0,0,5:1,0,0 Point1:point:1,2,3 preview:Offset_Plane2:plane:0,0,30:0,0,1',
    );
  });
});
