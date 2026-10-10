import type { BodyId, Component, ComponentId } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import type { BodyEntry } from '../shell/bodies';
import { componentDisplay, componentRows, componentsSummary } from './componentRows';

const cid = (id: string) => id as ComponentId;
const entry = (id: string, name: string, component?: string): BodyEntry => ({
  id: id as BodyId,
  meta: { name, visible: true },
  stored: true,
  display: 'shown',
  ...(component && { component: cid(component) }),
});
const lid: Component = { id: cid('c1'), name: 'Lid', visible: true };
const box: Component = { id: cid('c2'), name: 'Box part', visible: false, ghost: true };

describe('componentRows', () => {
  it('groups live bodies under their components in document order, empties too, loose last', () => {
    const { rows, loose } = componentRows({ components: [lid, box] }, [
      entry('A:0', 'Body1', 'c2'),
      entry('A:1', 'Body2'),
      entry('B:0', 'Body3', 'c2'),
      entry('C:0', 'Body4', 'gone'),
    ]);
    expect(
      rows.map((r) => [r.component.name, r.display, r.bodies.map((b) => b.meta.name)]),
    ).toEqual([
      ['Lid', 'shown', []],
      ['Box part', 'ghost', ['Body1', 'Body3']],
    ]);
    expect(loose.map((b) => b.meta.name)).toEqual(['Body2', 'Body4']);
  });

  it('has no rows without components', () => {
    expect(componentRows({}, [entry('A:0', 'Body1')]).rows).toEqual([]);
  });

  it('reads a component display', () => {
    expect(componentDisplay(lid)).toBe('shown');
    expect(componentDisplay(box)).toBe('ghost');
    expect(componentDisplay({ ...lid, visible: false })).toBe('hidden');
  });
});

describe('componentsSummary', () => {
  it('is absent with no components and lists names with spaces as underscores', () => {
    expect(componentsSummary([])).toBeUndefined();
    const { rows } = componentRows({ components: [lid, box] }, [
      entry('A:0', 'Body1', 'c1'),
      entry('A:1', 'Body 2', 'c1'),
    ]);
    expect(componentsSummary(rows)).toBe('Lid:Body1,Body_2;Box_part:');
  });
});
