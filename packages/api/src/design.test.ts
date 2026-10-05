/**
 * `Design`: create and from, parameters, the commands, transactions, the
 * document and the file (ADR-0068 §2).
 */

import { loadDocument } from '@extrudo/core';
import { memoryProjectStore, readArchive } from '@extrudo/storage';
import { describe, expect, it } from 'vitest';
import { ApiError, Design } from './index';

const FIXED = { now: '2026-10-05T00:00:00.000Z' };

describe('Design.create', () => {
  it('makes an empty design with counting IDs', () => {
    const d = Design.create({ name: 'Bracket', units: 'in', ...FIXED });
    expect(d.doc.name).toBe('Bracket');
    expect(d.doc.settings.units).toBe('in');
    expect(d.doc.meta.created).toBe(FIXED.now);
    expect(d.doc.features).toEqual([]);
    expect(d.box().id).toBe('f1');
  });

  it('names features the way the timeline does', () => {
    const d = Design.create(FIXED);
    expect(d.box().name).toBe('Box1');
    expect(d.cylinder().name).toBe('Cylinder1');
    expect(d.box().name).toBe('Box2');
    d.rename(d.feature('f2'), 'Shaft');
    expect(d.feature('f2').name).toBe('Shaft');
  });

  it('counts IDs per kind and never repeats one', () => {
    const d = Design.create(FIXED);
    const first = d.box();
    const second = d.cylinder();
    expect([first.id, second.id]).toEqual(['f1', 'f2']);
    const wall = d.parameter('wall', '3 mm');
    expect(wall.id).toBe('p1');
    expect(wall.name).toBe('wall');
  });

  it('takes IDs and names from the options of a call', () => {
    const d = Design.create(FIXED);
    const box = d.box({}, { id: 'base', name: 'Base' });
    expect(box.id).toBe('base');
    expect(box.name).toBe('Base');
    expect(d.box().id).toBe('f1');
  });

  it('takes an injected ID factory', () => {
    let n = 0;
    const d = Design.create({ ...FIXED, ids: () => `id${++n}` });
    expect(d.box().id).toBe('id2');
    expect(d.doc.id).toBe('id1');
  });
});

describe('parameters', () => {
  it('adds one with a customizer range and comment (ADR-0059)', () => {
    const d = Design.create(FIXED);
    const wall = d.parameter('wall', '3 mm', {
      comment: 'the plate',
      customizer: { min: 1, max: 10, step: 0.5, group: 'Walls' },
    });
    expect(d.doc.parameters).toEqual([
      {
        id: 'p1',
        name: 'wall',
        expression: '3 mm',
        unit: 'length',
        comment: 'the plate',
        customizer: { min: 1, max: 10, step: 0.5, group: 'Walls' },
      },
    ]);
    expect(wall.expression).toBe('3 mm');
    expect(wall.unit).toBe('length');
    expect(wall.value()).toBe(3);
  });

  it('reads the unit off the expression, unless told otherwise', () => {
    const d = Design.create(FIXED);
    expect(d.parameter('tilt', '45 deg').unit).toBe('angle');
    expect(d.parameter('half', '20 mm').unit).toBe('length');
    expect(d.parameter('copies', '3', { unit: 'unitless' }).unit).toBe('unitless');
  });

  it('sets an expression by name or handle, and keeps the others', () => {
    const d = Design.create(FIXED);
    const wall = d.parameter('wall', '3 mm');
    d.parameter('thickness', 'wall / 2');
    d.setParameter('wall', '4 mm');
    expect(d.getParameter(wall).expression).toBe('4 mm');
    expect(d.getParameter('thickness').expression).toBe('wall / 2');
    expect(wall.value()).toBe(4);
    expect(d.getParameter('thickness').value()).toBe(2);
    expect(d.doc.parameters[1]?.expression).toBe('wall / 2');
  });

  it('refuses a name that is taken, a unit function, and an unknown one', () => {
    const d = Design.create(FIXED);
    d.parameter('wall', '3 mm');
    expect(() => d.parameter('wall', '4 mm')).toThrow(/already exists/);
    expect(() => d.parameter('mm', '4 mm')).toThrow(/unit, function or constant/);
    expect(() => d.setParameter('nope', '1 mm')).toThrow(/no parameter "nope"/);
  });

  it('refuses to delete a parameter an expression uses', () => {
    const d = Design.create(FIXED);
    d.parameter('wall', '3 mm');
    const box = d.box({ length: 'wall' });
    expect(() => d.removeParameter('wall')).toThrow(/used by/);
    d.remove(box);
    expect(() => d.removeParameter('wall')).not.toThrow();
  });
});

describe('features', () => {
  it('adds a primitive with every input stored as given', () => {
    const d = Design.create(FIXED);
    const box = d.box({ plane: d.origin.xy, length: '40 mm', operation: 'join' });
    expect(box.type).toBe('box');
    expect(box.feature?.inputs).toEqual({
      plane: { kind: 'ref', refs: [{ kind: 'plane', id: 'origin:xy' }] },
      length: { kind: 'expr', expr: '40 mm', unit: 'length' },
      operation: { kind: 'enum', value: 'join' },
    });
  });

  it('leaves out the inputs left undefined', () => {
    const d = Design.create(FIXED);
    expect(Object.keys(d.box({ length: undefined }).feature?.inputs ?? {})).toEqual([]);
  });

  it('adds a feature by type name', () => {
    const d = Design.create(FIXED);
    expect(d.add('cylinder').type).toBe('cylinder');
    expect(() => d.add('sprocket')).toThrow(ApiError);
    try {
      d.add('sprocket');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).featureType).toBe('sprocket');
      expect((error as ApiError).path).toBe('type');
      expect((error as ApiError).message).toBe('There is no feature type "sprocket".');
    }
  });

  it('inserts at the marker, or where a call says', () => {
    const d = Design.create(FIXED);
    const first = d.box();
    const second = d.cylinder();
    d.add('sphere', {}, { index: 0 });
    expect(d.doc.features.map((f) => f.type)).toEqual(['sphere', 'box', 'cylinder']);
    // The marker stays past every feature, at the end of the timeline.
    expect(d.doc.timelineMarker).toBe(3);
    expect(first.name).toBe('Box1');
    expect(second.name).toBe('Cylinder1');
  });

  it('suppresses, renames, moves and removes', () => {
    const d = Design.create(FIXED);
    const box = d.box();
    const hole = d.cylinder();
    d.suppress(box);
    expect(d.feature(box.id).feature?.suppressed).toBe(true);
    d.suppress(box, false);
    expect(d.feature(box.id).feature?.suppressed).toBe(false);
    d.rename(hole, 'Bore');
    expect(hole.name).toBe('Bore');
    d.move(box, 1);
    expect(d.doc.features.map((f) => f.id)).toEqual([hole.id, box.id]);
    d.remove(hole);
    expect(d.doc.features.map((f) => f.id)).toEqual([box.id]);
  });

  it('refuses a delete another feature depends on, and says which', () => {
    const d = Design.create(FIXED);
    const box = d.box();
    const join = d.combine({ target: box.body(), tools: [box.body()] });
    expect(() => d.remove('f1')).toThrow(/Combine1 uses it/);
    expect(d.doc.features).toHaveLength(2);
    d.remove(join);
    expect(() => d.remove('f1')).not.toThrow();
    expect(d.doc.features).toHaveLength(0);
  });

  it('refuses a move that would put a feature before one that uses it', () => {
    const d = Design.create(FIXED);
    const box = d.box();
    const join = d.combine({ target: box.body(), tools: [box.body()] });
    expect(() => d.move(box, 2)).toThrow(/Can't move Box1/);
    // Moving the user of it the other way round is refused too.
    expect(() => d.move(join, 0)).toThrow(/uses/);
  });

  it('groups a run of features under one name (ADR-0065)', () => {
    const d = Design.create(FIXED);
    const first = d.box();
    const second = d.cylinder();
    const id = d.group(first, second, { name: 'Pair', collapsed: true });
    expect(d.doc.groups).toEqual([
      { id, name: 'Pair', first: first.id, last: second.id, collapsed: true },
    ]);
    expect(() => d.group(first, second)).toThrow(/already in a group/);
    expect(() => d.group(second, first)).toThrow(/from the first to the last/);
  });

  it('groups the features between the two, not only the two', () => {
    const d = Design.create(FIXED);
    const first = d.box();
    d.cylinder();
    const third = d.sphere();
    d.group(first, third);
    expect(d.doc.groups?.[0]).toMatchObject({ first: first.id, last: third.id });
  });
});

describe('bad calls', () => {
  it('names the input path and the feature', () => {
    const d = Design.create(FIXED);
    expect(() => d.extrude({ distance: { kind: 'expr', expr: '10 mm', unit: 'angle' } })).toThrow(
      ApiError,
    );
    try {
      d.extrude({ distance: { kind: 'expr', expr: '10 mm', unit: 'angle' } });
      expect.unreachable();
    } catch (error) {
      const api = error as ApiError;
      expect(api.path).toBe('distance');
      expect(api.featureType).toBe('extrude');
      expect(api.message).toMatch(/^Extrude: distance: must be a length$/);
    }
    // The plain form is checked the same way: a body is not a profile.
    expect(() => d.extrude({ profiles: d.ref('body', 'f9') })).toThrow(/profiles: must be profile/);
  });

  it('says which input a reference belongs in', () => {
    const d = Design.create(FIXED);
    try {
      d.extrude({ profiles: [{ kind: 'body', id: 'f1' }] });
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).path).toBe('profiles');
      expect((error as ApiError).message).toBe(
        'Extrude: profiles: must be profile or face or sketchEntity references',
      );
    }
  });

  it('refuses an input name the feature does not have', () => {
    const d = Design.create(FIXED);
    try {
      d.box({ widht: '40 mm' } as never);
      expect.unreachable();
    } catch (error) {
      expect((error as ApiError).path).toBe('widht');
      expect((error as ApiError).message).toBe('Box: widht: Unrecognized key: "widht"');
      expect((error as ApiError).featureType).toBe('box');
    }
  });

  it('changes nothing when a call throws', () => {
    const d = Design.create(FIXED);
    const before = JSON.stringify(d.toJSON());
    expect(() => d.extrude({ profiles: d.ref('body', 'f9') })).toThrow();
    expect(JSON.stringify(d.toJSON())).toBe(before);
    expect(d.doc.features).toEqual([]);
  });

  it('throws for a feature or parameter that is not there', () => {
    const d = Design.create(FIXED);
    expect(() => d.feature('f9')).toThrow(/no feature "f9"/);
    expect(() => d.rename('f9', 'X')).toThrow(ApiError);
    expect(() => d.getParameter('width')).toThrow(/no parameter "width"/);
  });
});

describe('undo and transactions', () => {
  it('undoes and redoes every command', () => {
    const d = Design.create(FIXED);
    d.parameter('wall', '3 mm');
    const box = d.box({ length: 'wall' });
    d.rename(box, 'Base');
    expect(d.doc.features[0]?.name).toBe('Base');
    d.state.undo();
    expect(d.doc.features[0]?.name).toBe('Box1');
    d.state.undo();
    expect(d.doc.features).toEqual([]);
    d.state.redo();
    expect(d.doc.features).toHaveLength(1);
    expect(d.state.canUndo).toBe(true);
  });

  it('takes a transaction as one step', () => {
    const d = Design.create(FIXED);
    d.transaction('Frame', () => {
      d.box();
      d.cylinder();
      d.sphere();
    });
    expect(d.doc.features).toHaveLength(3);
    expect(d.state.undoLabel).toBe('Frame');
    d.state.undo();
    expect(d.doc.features).toEqual([]);
  });

  it('rolls a transaction back when it throws', () => {
    const d = Design.create(FIXED);
    expect(() =>
      d.transaction('Broken', () => {
        d.box();
        d.add('sprocket');
      }),
    ).toThrow(ApiError);
    expect(d.doc.features).toEqual([]);
    expect(d.state.canUndo).toBe(false);
  });

  it('nests transactions in one step', () => {
    const d = Design.create(FIXED);
    d.transaction('Outer', () => {
      d.box();
      d.transaction('Inner', () => {
        d.cylinder();
        d.sphere();
      });
    });
    d.state.undo();
    expect(d.doc.features).toEqual([]);
  });
});

describe('the document', () => {
  it('is valid, and validate() finds nothing in it', () => {
    const d = Design.create(FIXED);
    d.parameter('wall', '3 mm');
    d.box({ length: 'wall' });
    expect(() => loadDocument(d.toJSON())).not.toThrow();
    expect(d.validate()).toEqual([]);
  });

  it('reports a feature with an unknown type or bad inputs', () => {
    const d = Design.create(FIXED);
    const bad = d.box();
    d.state.dispatch({
      type: 'test.broken',
      label: 'Break it',
      payload: {},
      recipe: (draft) => {
        const feature = draft.features.find((f) => f.id === bad.id);
        if (feature) feature.type = 'sprocket';
      },
    });
    const issues = d.validate();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toBe('Box1: Unknown feature type "sprocket".');
    expect(issues[0]?.featureId).toBe(bad.id);
    expect(issues[0]).toBeInstanceOf(ApiError);
  });

  it('is frozen, and toJSON is the document itself', () => {
    const d = Design.create(FIXED);
    d.box();
    expect(Object.isFrozen(d.doc)).toBe(true);
    expect(d.toJSON()).toBe(d.doc);
    expect(() => (d.toJSON().name = 'x')).toThrow();
  });
});

describe('Design.from', () => {
  it('reads a document object and its JSON', () => {
    const made = Design.create({ name: 'Bracket', ...FIXED });
    made.box();
    const doc = made.toJSON();
    expect(Design.from(doc).toJSON()).toEqual(doc);
    expect(Design.from(JSON.parse(JSON.stringify(doc))).toJSON()).toEqual(doc);
    expect(Design.from(doc).notices).toEqual([]);
  });

  it('refuses something that is not a design', () => {
    expect(() => Design.from({ hello: 'world' })).toThrow(ApiError);
    try {
      Design.from({ hello: 'world' });
    } catch (error) {
      expect((error as ApiError).message).toBe('This is not an Extrudo document.');
    }
  });

  it('refuses a design this version cannot read', () => {
    const made = Design.create(FIXED);
    // A newer file whose settings aren't the shape this version knows.
    const future = { ...made.toJSON(), formatVersion: 99, settings: 'mm' };
    expect(() => Design.from(future)).toThrow(/newer Extrudo/);
  });

  it('says what a newer file carried', () => {
    const made = Design.create(FIXED);
    const newer = { ...made.toJSON(), somethingNew: true };
    const d = Design.from(newer);
    expect(d.notices).toHaveLength(1);
    expect(d.notices[0]).toContain('saved by a newer Extrudo');
    expect((d.doc as Record<string, unknown>).somethingNew).toBeUndefined();
  });

  it('never hands out an ID the document already has', () => {
    // A design whose features were named f1, f2 and f3 by a counting factory.
    let n = 0;
    const made = Design.create({
      ...FIXED,
      ids: (kind) => (kind === 'feature' ? `f${++n}` : 'doc1'),
    });
    made.box();
    made.cylinder();
    made.sphere();
    expect(made.doc.features.map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    // Reopened, the counters start past the three: f4, not a collision.
    const reopened = Design.from(made.toJSON());
    expect(reopened.cylinder().id).toBe('f4');
    expect(reopened.doc.features.map((f) => f.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('counts past the IDs of the parameters and groups too', () => {
    const counters = { feature: 0, parameter: 0 };
    const made = Design.create({
      ...FIXED,
      ids: (kind) =>
        kind === 'feature'
          ? `f${++counters.feature}`
          : kind === 'parameter'
            ? `p${++counters.parameter}`
            : 'doc1',
    });
    made.parameter('wall', '3 mm');
    const first = made.box();
    const second = made.cylinder();
    made.group(first, second);
    const reopened = Design.from(made.toJSON());
    expect(reopened.parameter('other', '1 mm').id).toBe('p2');
    expect(new Set(reopened.doc.features.map((f) => f.id)).size).toBe(2);
  });

  it('keeps a loaded design editable', () => {
    const made = Design.create({ name: 'Kept', ...FIXED });
    made.parameter('wall', '3 mm');
    const reopened = Design.from(made.toJSON());
    reopened.setParameter('wall', '5 mm');
    expect(reopened.getParameter('wall').value()).toBe(5);
    expect(reopened.doc.name).toBe('Kept');
  });
});

describe('toFile', () => {
  it('writes .extrudo bytes that read back', async () => {
    const d = Design.create({ name: 'Bracket', ...FIXED });
    d.box();
    const archive = readArchive(await d.toFile());
    expect(archive.doc.name).toBe('Bracket');
    expect(archive.doc.features).toHaveLength(1);
  });

  it('imports through a project store', async () => {
    const store = memoryProjectStore();
    const d = Design.create({ name: 'Bracket', ...FIXED });
    d.parameter('wall', '3 mm');
    d.box({ length: 'wall' });
    const bytes = await d.toFile();
    const summary = await store.importFile(new Blob([bytes as BlobPart]));
    expect(summary.name).toBe('Bracket');
    const stored = await store.load(summary.id);
    expect(stored.parameters.map((p) => p.name)).toEqual(['wall']);
    expect(stored.features.map((f) => f.type)).toEqual(['box']);
    expect(stored.meta.modified).toBeTruthy();
  });
});

describe('OpenSCAD overrides (ADR-0071 §5)', () => {
  it("store a parameter handle with the parameter's own unit, a plain value as unitless", () => {
    const d = Design.create(FIXED);
    const width = d.parameter('width', '60 mm');
    const teeth = d.parameter('teeth', '24', { unit: 'unitless' });
    const part = d.import({
      file: 'att-gear.scad',
      scadName: 'width',
      scadValue: width,
      scadName2: 'teeth',
      scadValue2: teeth,
      scadName3: 'fn',
      scadValue3: 64,
    });
    const inputs = part.feature?.inputs ?? {};
    expect(inputs.scadValue).toEqual({ kind: 'expr', expr: 'width', unit: 'length' });
    expect(inputs.scadValue2).toEqual({ kind: 'expr', expr: 'teeth', unit: 'unitless' });
    expect(inputs.scadValue3).toEqual({ kind: 'expr', expr: '64', unit: 'unitless' });
  });

  it('refuses a stored value without its unit', () => {
    const d = Design.create(FIXED);
    expect(() =>
      d.import({
        file: 'att-gear.scad',
        scadName: 'width',
        scadValue: { kind: 'expr', expr: '5' },
      }),
    ).toThrow(/scadValue: must say its unit/);
  });
});
