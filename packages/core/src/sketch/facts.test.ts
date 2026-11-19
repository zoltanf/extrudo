import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import type { SketchEntityId } from '../ids';
import { sketchFacts } from './facts';
import type { SketchData } from './schema';

type Entities = SketchData['entities'];

/** A plate's outline, a construction text and a text, with a counter of walks over its entities. */
function sketch(freeze: boolean) {
  const entities = {
    p1: { type: 'point', x: 0, y: 0 },
    p2: { type: 'point', x: 10, y: 0 },
    p3: { type: 'point', x: 10, y: 10 },
    p4: { type: 'point', x: 0, y: 10 },
    l1: { type: 'line', start: 'p1', end: 'p2', construction: false },
    l2: { type: 'line', start: 'p2', end: 'p3', construction: false },
    l3: { type: 'line', start: 'p3', end: 'p4', construction: true },
    l4: { type: 'line', start: 'p4', end: 'p1', construction: false },
    t1: {
      type: 'text',
      anchor: 'p1',
      top: 'p4',
      text: 'A',
      font: 'mono',
      align: 'left',
      construction: true,
    },
    t2: { type: 'text', anchor: 'p2', top: 'p3', text: 'B', font: 'sans', align: 'left' },
  } as unknown as Entities;
  if (freeze) {
    for (const e of Object.values(entities)) Object.freeze(e);
    Object.freeze(entities);
  }
  const walks = { n: 0 };
  const counted = new Proxy(entities, {
    ownKeys(target) {
      walks.n++;
      return Reflect.ownKeys(target);
    },
  });
  const data = { entities: counted, constraints: {}, dimensions: {} } as SketchData;
  return { data: freeze ? Object.freeze(data) : data, walks };
}

describe('sketchFacts', () => {
  it('finds the texts, their fonts and the lines in entity order', () => {
    const facts = sketchFacts(sketch(false).data);
    expect(facts).toEqual({ text: true, texts: ['t1', 't2'], fonts: ['mono', 'sans'], lines: 4 });
  });

  it('counts a construction text but says no text for profiles', () => {
    const { data } = sketch(false);
    delete (data.entities as Record<string, unknown>).t2;
    expect(sketchFacts(data)).toMatchObject({ text: false, texts: ['t1'], fonts: ['mono'] });
  });

  it('walks frozen data once, however often it is asked', () => {
    const { data, walks } = sketch(true);
    const first = sketchFacts(data);
    const once = walks.n;
    for (let i = 0; i < 10; i++) expect(sketchFacts(data)).toBe(first);
    expect(walks.n).toBe(once);
    expect(once).toBeGreaterThan(0);
  });

  it('walks data that is not frozen on every call', () => {
    const { data, walks } = sketch(false);
    for (let i = 0; i < 10; i++) sketchFacts(data);
    expect(walks.n).toBe(10);
  });

  it('keeps nothing when one entity is not frozen', () => {
    const { data } = sketch(true);
    const entities = { ...data.entities, l9: { type: 'line', start: 'p1', end: 'p3' } };
    const open = Object.freeze({ ...data, entities: Object.freeze(entities) as Entities });
    expect(sketchFacts(open).lines).toBe(5);
    (entities.l9 as { type: string }).type = 'circle';
    expect(sketchFacts(open).lines).toBe(4);
  });

  it("follows the store's edits: a new data object has its own facts", () => {
    const { data } = sketch(true);
    const plain = { ...data, entities: { ...data.entities } };
    const before = produce(plain, () => {});
    const after = produce(before, (d) => {
      delete d.entities['l1' as SketchEntityId];
    });
    expect(sketchFacts(before).lines).toBe(4);
    expect(sketchFacts(after).lines).toBe(3);
    expect(sketchFacts(before).lines).toBe(4);
  });
});
