/**
 * Determinism (ADR-0068 §2): the same calls on the same starting document give
 * the same JSON, byte for byte, so a script can run again on every recompute
 * without the features after it losing their references.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readArchive } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { CounterIds, Design } from './index';

const FIXED = { now: '2026-10-05T00:00:00.000Z' };
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/benchmarks');
/** One fixture's document, through storage's reader. */
const fixture = (name: string) => readArchive(readFileSync(join(FIXTURES, name))).doc;

/** The same build, twice, as the bytes `JSON.stringify` would write. */
function buildTwice(build: () => Design): [string, string] {
  const bytes = (d: Design) => JSON.stringify(d.toJSON());
  return [bytes(build()), bytes(build())];
}

describe('determinism', () => {
  it('gives the same bytes for the same calls', () => {
    const build = () => {
      const d = Design.create({ name: 'Bracket', units: 'mm', ...FIXED });
      const wall = d.parameter('wall', '3 mm', { customizer: { min: 1, max: 10 } });
      const plate = d.box({ length: '40 mm', width: '20 mm', height: `${wall}` });
      const hole = d.cylinder({ diameter: '6 mm', height: '8 mm', operation: 'cut' });
      const edge = plate.edge([plate.faceName('cap:end'), plate.faceName('side:front')]);
      const round = d.fillet({ edges: edge, radius: '1 mm' });
      const s = d.sketch(d.origin.xy, (k) => {
        const base = k.rectangle([0, 0], [40, 20]);
        k.circle([20, 10], '6 mm');
        k.dimension(base.bottom, '40 mm');
        k.equal(base.bottom, base.top);
      });
      d.extrude({ profiles: s.profileAt([1, 1]), distance: '5 mm' });
      d.rename(round, 'Round');
      d.suppress(hole);
      d.move(hole, 0);
      d.transaction('Group', () => {
        d.cylinder({ diameter: '4 mm' });
        d.sphere({ diameter: '10 mm' });
      });
      d.group(hole, plate);
      return d;
    };
    const [first, second] = buildTwice(build);
    expect(first).toBe(second);
  });

  it('gives the same document inside a transaction, moved and undone', () => {
    const build = () => {
      const d = Design.create(FIXED);
      d.transaction('Pair', () => {
        d.box({ length: '10 mm' });
        d.cylinder({ diameter: '4 mm' });
      });
      d.state.undo();
      d.state.redo();
      return d;
    };
    const [first, second] = buildTwice(build);
    expect(first).toBe(second);
  });

  it('gives the same bytes for every benchmark fixture opened and added to', () => {
    for (const name of readdirSync(FIXTURES)) {
      if (!name.endsWith('.extrudo')) continue;
      const doc = fixture(name);
      const build = () => {
        const d = Design.from(doc);
        d.parameter('extra', '5 mm');
        d.box({ length: 'extra', width: '2 mm', height: '2 mm' });
        return d;
      };
      const [first, second] = buildTwice(build);
      expect(first, name).toBe(second);
    }
  });
});

describe('opened designs', () => {
  it('keeps every benchmark fixture as it was, plus the new feature', () => {
    for (const name of readdirSync(FIXTURES)) {
      if (!name.endsWith('.extrudo')) continue;
      const doc = fixture(name);
      const d = Design.from(doc);
      d.box({ length: '1 mm' });
      const after = d.toJSON();
      expect(after.format, name).toBe(doc.format);
      expect(after.parameters, name).toEqual(doc.parameters);
      expect(after.features.slice(0, -1), name).toEqual(doc.features);
      expect(d.validate(), name).toEqual([]);
    }
  });

  it('never mints an ID a feature, parameter, group or sketch entity has', () => {
    for (const name of readdirSync(FIXTURES)) {
      if (!name.endsWith('.extrudo')) continue;
      const doc = fixture(name);
      const stored = new Set(CounterIds.all(doc));
      const d = Design.from(doc);
      const box = d.box({ length: '2 mm' });
      const one = d.parameter('one', '1 mm');
      expect(stored.has(box.id), `${name}: ${box.id}`).toBe(false);
      expect(stored.has(one.id), `${name}: ${one.id}`).toBe(false);
      const ids = [...d.doc.features.map((f) => f.id), ...d.doc.parameters.map((p) => p.id)];
      expect(new Set(ids).size, name).toBe(ids.length);
      // The counter is the design's own, and skips what was already there.
      expect(new CounterIds(doc).next('feature')).toBe('f1');
    }
  });

  it('counts a document that already has counter-like IDs from there on', () => {
    let n = 0;
    const made = Design.create({
      ...FIXED,
      ids: (kind) => (kind === 'feature' ? `f${++n}` : 'doc1'),
    });
    made.box();
    made.cylinder();
    const reopened = Design.from(made.toJSON());
    expect(reopened.doc.features.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(reopened.sphere().id).toBe('f3');
  });
});
