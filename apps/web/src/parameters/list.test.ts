import type { Parameter, ParameterId, ParameterUse } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { dropIndex, groupNames, labelOfUse, listSections, stepIndex } from './list';

/**
 * ADR-0086: the Parameters dialog's list as data. The dialog draws in a
 * portal (Radix `Dialog`), so its sections and moves are tested here; the
 * e2e spec drags and clicks.
 */
const pid = (id: string) => id as ParameterId;
const param = (id: string, group?: string): Parameter => ({
  id: pid(id),
  name: id,
  expression: '1 mm',
  unit: 'length',
  ...(group ? { group } : {}),
});

describe('listSections', () => {
  it('is one flat list while no parameter has a group', () => {
    expect(listSections([param('a'), param('b')])).toEqual([
      { group: undefined, title: 'User parameters', ids: ['a', 'b'] },
    ]);
  });

  it('puts the ungrouped first under General, then the groups by first appearance', () => {
    const parameters = [param('w', 'Size'), param('x'), param('y', 'Holes'), param('z', 'Size')];
    expect(listSections(parameters)).toEqual([
      { group: undefined, title: 'General', ids: ['x'] },
      { group: 'Size', title: 'Size', ids: ['w', 'z'] },
      { group: 'Holes', title: 'Holes', ids: ['y'] },
    ]);
    expect(groupNames(parameters)).toEqual(['Size', 'Holes']);
  });

  it('leaves out an empty General, unless a drag needs it as a place to drop', () => {
    const parameters = [param('w', 'Size')];
    expect(listSections(parameters).map((s) => s.title)).toEqual(['Size']);
    expect(listSections(parameters, true).map((s) => s.title)).toEqual(['General', 'Size']);
  });
});

describe('dropIndex', () => {
  const parameters = [param('a'), param('b', 'G'), param('c'), param('d', 'G')];

  it('lands before the row it is dropped on', () => {
    expect(dropIndex(parameters, pid('d'), { before: pid('a'), group: undefined })).toBe(0);
    expect(dropIndex(parameters, pid('a'), { before: pid('d'), group: 'G' })).toBe(2);
  });

  it('lands after the last of a section at its end, or at the end of the list', () => {
    expect(dropIndex(parameters, pid('a'), { group: 'G' })).toBe(3);
    expect(dropIndex(parameters, pid('d'), { group: undefined })).toBe(3);
    expect(dropIndex(parameters, pid('a'), { group: 'New' })).toBe(3);
  });
});

describe('stepIndex', () => {
  const parameters = [param('a', 'G'), param('b'), param('c', 'G'), param('d', 'G')];

  it("moves past the neighbour in the parameter's own group", () => {
    expect(stepIndex(parameters, pid('c'), -1)).toBe(0);
    expect(stepIndex(parameters, pid('a'), 1)).toBe(2);
    expect(stepIndex(parameters, pid('c'), 1)).toBe(3);
  });

  it('stops at either end of the group', () => {
    expect(stepIndex(parameters, pid('a'), -1)).toBeUndefined();
    expect(stepIndex(parameters, pid('d'), 1)).toBeUndefined();
    expect(stepIndex(parameters, pid('b'), 1)).toBeUndefined();
    expect(stepIndex(parameters, pid('gone'), 1)).toBeUndefined();
  });
});

describe('labelOfUse', () => {
  it('names each kind of use the way the dialog shows it', () => {
    const uses: ParameterUse[] = [
      { kind: 'parameter', id: pid('p2'), name: 'inner' },
      { kind: 'range', id: pid('p3'), name: 'lip', field: 'max' },
      {
        kind: 'feature',
        featureId: 'f1' as never,
        feature: 'Sketch1',
        paramName: 'd3',
        dimension: true,
      },
      { kind: 'feature', featureId: 'f2' as never, feature: 'Extrude1', dimension: false },
      { kind: 'joint', joint: 'Hinge', end: 'min', quantity: 'angle' },
    ];
    expect(uses.map(labelOfUse)).toEqual([
      'inner',
      'lip · Max',
      'Sketch1 · d3',
      'Extrude1',
      'Hinge · minimum angle',
    ]);
  });
});
