import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, CommandError, defineCommand } from './commands';
import {
  addConfiguration,
  removeConfiguration,
  setParameterCustomizer,
  updateConfiguration,
} from './customizer';
import {
  addParameter,
  insertFeature,
  isFeatureVisible,
  moveTimelineMarker,
  nameBodies,
  newBodyNames,
  removeFeature,
  removeParameter,
  renameDocument,
  renameFeature,
  restoreVersion,
  setFeatureSuppressed,
  setFeatureVisibility,
  updateBody,
  updateFeatureInputs,
  updateParameter,
  updateSettings,
} from './document-commands';
import { UndoHistory } from './history';
import type { ConfigurationId, DimensionId, SketchEntityId } from './ids';
import { removeBodiesFeatureOf } from './remove';
import { DocumentSchema, type ExtrudoDocument, type Feature } from './schema';
import { emptySketchData } from './sketch/feature';
import { bid, feature, fid, parameter, pid, sampleDocument } from './testing';

const apply = (doc: ExtrudoDocument, command: Command<unknown>) => applyCommand(doc, command).doc;
const cid = (id: string) => id as ConfigurationId;

describe('applyCommand', () => {
  it('returns the new document with forward and inverse patches', () => {
    const doc = sampleDocument();
    const result = applyCommand(doc, renameDocument({ name: 'Bracket' }));
    expect(result.doc.name).toBe('Bracket');
    expect(doc.name).toBe('Sample');
    expect(result.patches).toEqual([{ op: 'replace', path: ['name'], value: 'Bracket' }]);
    expect(result.inversePatches).toEqual([{ op: 'replace', path: ['name'], value: 'Sample' }]);
  });

  it('shares unchanged parts with the previous document', () => {
    const doc = sampleDocument();
    const next = apply(doc, renameFeature({ id: fid('f2'), name: 'Base' }));
    expect(next.parameters).toBe(doc.parameters);
    expect(next.features[0]).toBe(doc.features[0]);
    expect(next.features[1]).not.toBe(doc.features[1]);
  });

  it('leaves the document unchanged when a command throws', () => {
    const doc = sampleDocument();
    const before = JSON.parse(JSON.stringify(doc));
    expect(() => apply(doc, renameFeature({ id: fid('nope'), name: 'X' }))).toThrow(CommandError);
    expect(doc).toEqual(before);
  });

  it('carries type, label and payload for logs and the undo menu', () => {
    const shout = defineCommand<{ times: number }>('test.shout', 'Shout', (draft, { times }) => {
      draft.name = draft.name.toUpperCase() + '!'.repeat(times);
    });
    const command = shout({ times: 2 });
    expect(shout.type).toBe('test.shout');
    expect(command).toMatchObject({ type: 'test.shout', label: 'Shout', payload: { times: 2 } });
    expect(apply(sampleDocument(), command).name).toBe('SAMPLE!!');
  });
});

describe('document commands', () => {
  it('rename the document and features, trimming whitespace', () => {
    let doc = apply(sampleDocument(), renameDocument({ name: '  Bracket ' }));
    doc = apply(doc, renameFeature({ id: fid('f1'), name: 'Outline' }));
    expect(doc.name).toBe('Bracket');
    expect(doc.features[0]?.name).toBe('Outline');
    expect(() => apply(doc, renameDocument({ name: '  ' }))).toThrow("The name can't be empty.");
  });

  it('change settings', () => {
    const doc = apply(sampleDocument(), updateSettings({ units: 'in' }));
    expect(doc.settings).toEqual({ units: 'in', precision: 2 });
  });

  it('add, edit and delete parameters, keeping names unique and valid', () => {
    let doc = apply(sampleDocument(), addParameter({ parameter: parameter('p3', 'gap') }));
    expect(doc.parameters.map((p) => p.name)).toEqual(['width', 'wall', 'gap']);
    expect(() => apply(doc, addParameter({ parameter: parameter('p4', 'gap') }))).toThrow(
      'A parameter named "gap" already exists.',
    );
    expect(() => apply(doc, addParameter({ parameter: parameter('p4', 'a b') }))).toThrow(
      /isn't a valid parameter name/,
    );
    expect(() => apply(doc, updateParameter({ id: pid('p3'), changes: { name: 'wall' } }))).toThrow(
      /already exists/,
    );
    doc = apply(doc, updateParameter({ id: pid('p3'), changes: { name: 'gap', expression: '2' } }));
    expect(doc.parameters[2]).toMatchObject({ name: 'gap', expression: '2' });
    doc = apply(doc, removeParameter({ id: pid('p1') }));
    expect(doc.parameters.map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(() => apply(doc, removeParameter({ id: pid('p1') }))).toThrow(/doesn't exist/);
  });

  it('insert features at the timeline marker and move the marker past them', () => {
    let doc = apply(sampleDocument(), moveTimelineMarker({ index: 1 }));
    doc = apply(doc, insertFeature({ feature: feature('f4') }));
    expect(doc.features.map((f) => f.id)).toEqual(['f1', 'f4', 'f2', 'f3']);
    expect(doc.timelineMarker).toBe(2);
    // After the marker: in the rolled-back part, the marker stays.
    doc = apply(doc, insertFeature({ feature: feature('f5'), index: 4 }));
    expect(doc.features.map((f) => f.id)).toEqual(['f1', 'f4', 'f2', 'f3', 'f5']);
    expect(doc.timelineMarker).toBe(2);
    expect(() => apply(doc, insertFeature({ feature: feature('f1') }))).toThrow(/already exists/);
    expect(() => apply(doc, insertFeature({ feature: feature('f6'), index: 9 }))).toThrow(
      /position 9/,
    );
  });

  it('delete features, keeping the marker on the same active features', () => {
    let doc = apply(sampleDocument(), moveTimelineMarker({ index: 2 }));
    doc = apply(doc, removeFeature({ id: fid('f1') }));
    expect(doc.features.map((f) => f.id)).toEqual(['f2', 'f3']);
    expect(doc.timelineMarker).toBe(1);
    doc = apply(doc, removeFeature({ id: fid('f3') }));
    expect(doc.timelineMarker).toBe(1);
  });

  it('edit and suppress features', () => {
    let doc = apply(
      sampleDocument(),
      updateFeatureInputs({ id: fid('f2'), inputs: { flip: { kind: 'bool', value: true } } }),
    );
    expect(doc.features[1]?.inputs).toEqual({
      distance: { kind: 'expr', expr: '10 mm' },
      flip: { kind: 'bool', value: true },
    });
    doc = apply(doc, setFeatureSuppressed({ id: fid('f2'), suppressed: true }));
    expect(doc.features[1]?.suppressed).toBe(true);
    // A dialog's OK replaces the inputs as a whole (P2-05).
    doc = apply(
      doc,
      updateFeatureInputs({
        id: fid('f2'),
        inputs: { distance: { kind: 'expr', expr: '4 mm' } },
        replace: true,
      }),
    );
    expect(doc.features[1]?.inputs).toEqual({ distance: { kind: 'expr', expr: '4 mm' } });
  });

  it('show and hide features in one step, storing nothing while shown', () => {
    let doc = apply(
      sampleDocument(),
      setFeatureVisibility({ ids: [fid('f1'), fid('f2')], visible: false }),
    );
    expect(doc.features.map((f) => isFeatureVisible(f))).toEqual([false, false, true]);
    doc = apply(doc, setFeatureVisibility({ ids: [fid('f1')], visible: true }));
    expect(doc.features[0]).not.toHaveProperty('visible');
    expect(DocumentSchema.parse(doc)).toEqual(doc);
    expect(() => apply(doc, setFeatureVisibility({ ids: [fid('x')], visible: true }))).toThrow(
      CommandError,
    );
  });

  it("refuse to delete a feature another feature's references point into", () => {
    const extrude: Feature = {
      ...feature('f4', 'extrude', 'Extrude2'),
      inputs: { profiles: { kind: 'ref', refs: [{ kind: 'profile', id: 'f1/r1' }] } },
    };
    const doc = apply(sampleDocument(), insertFeature({ feature: extrude }));
    expect(() => apply(doc, removeFeature({ id: fid('f1') }))).toThrow(
      "Can't delete Sketch1: Extrude2 uses it. Change or delete that first.",
    );
    expect(apply(doc, removeFeature({ id: fid('f4') })).features).toHaveLength(3);
  });

  it('refuse to delete a sketch whose named dimensions are used outside it', () => {
    const data = emptySketchData();
    const dim = (expr: string, paramName: string) => ({
      type: 'distance' as const,
      orientation: 'aligned' as const,
      a: 'l' as SketchEntityId,
      expr,
      driven: false,
      paramName,
    });
    data.dimensions = {
      ['a' as DimensionId]: dim('10', 'd1'),
      ['b' as DimensionId]: dim('d1 * 2', 'd2'),
    };
    const sketch: Feature = {
      ...feature('f1', 'sketch', 'Sketch1'),
      inputs: { sketch: { kind: 'sketchData', sketch: data } },
    };
    let doc: ExtrudoDocument = { ...sampleDocument(), features: [sketch], timelineMarker: 1 };
    // Its own dimensions may use each other.
    expect(apply(doc, removeFeature({ id: fid('f1') })).features).toEqual([]);
    doc = apply(doc, addParameter({ parameter: parameter('p3', 'depth', 'd2 + 1 mm') }));
    expect(() => apply(doc, removeFeature({ id: fid('f1') }))).toThrow(
      "Can't delete Sketch1: `d2` is used by `depth`. Change that first.",
    );
  });

  it('keep the timeline marker within the timeline', () => {
    const doc = sampleDocument();
    expect(apply(doc, moveTimelineMarker({ index: 0 })).timelineMarker).toBe(0);
    expect(() => apply(doc, moveTimelineMarker({ index: 4 }))).toThrow(CommandError);
    expect(() => apply(doc, moveTimelineMarker({ index: 1.5 }))).toThrow(CommandError);
  });

  it('create and change body metadata', () => {
    let doc = apply(sampleDocument(), updateBody({ id: bid('b1'), changes: { name: 'Body1' } }));
    expect(doc.bodies).toEqual({ b1: { name: 'Body1', visible: true } });
    doc = apply(doc, updateBody({ id: bid('b1'), changes: { visible: false, color: '#ff8800' } }));
    expect(doc.bodies).toEqual({ b1: { name: 'Body1', visible: false, color: '#ff8800' } });
    expect(() => apply(doc, updateBody({ id: bid('b2'), changes: {} }))).toThrow(CommandError);
  });

  it('body metadata: opacity, back to the default colour, names trimmed and required', () => {
    let doc = apply(
      sampleDocument(),
      updateBody({ id: bid('b1'), changes: { name: ' Base ', color: '#112233', opacity: 0.5 } }),
    );
    expect(doc.bodies).toEqual({
      b1: { name: 'Base', visible: true, color: '#112233', opacity: 0.5 },
    });
    doc = apply(doc, updateBody({ id: bid('b1'), changes: {}, clear: ['color', 'opacity'] }));
    expect(doc.bodies).toEqual({ b1: { name: 'Base', visible: true } });
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
    expect(() => apply(doc, updateBody({ id: bid('b1'), changes: { name: '  ' } }))).toThrow(
      "The name can't be empty.",
    );
  });

  it('names new bodies, keeping metadata that is there', () => {
    let doc = apply(sampleDocument(), updateBody({ id: bid('b1'), changes: { name: 'Body2' } }));
    const names = newBodyNames(doc, [bid('b2'), bid('b3'), bid('b4')]);
    expect(names).toEqual({ b2: 'Body1', b3: 'Body3', b4: 'Body4' });
    doc = apply(
      doc,
      nameBodies({
        bodies: {
          [bid('b1')]: { name: 'Other', visible: true },
          [bid('b2')]: { name: 'Body1', visible: true },
        },
      }),
    );
    expect(doc.bodies).toEqual({
      b1: { name: 'Body2', visible: true },
      b2: { name: 'Body1', visible: true },
    });
  });

  it('refuses to delete a feature whose bodies a later feature refers to', () => {
    const doc = apply(
      sampleDocument(),
      insertFeature({ feature: removeBodiesFeatureOf(fid('r1'), 'Remove1', [bid('f2:0')]) }),
    );
    expect(() => apply(doc, removeFeature({ id: fid('f2') }))).toThrow(
      "Can't delete Extrude1: Remove1 uses it.",
    );
    // The Remove itself goes, and then the extrude can.
    const without = apply(doc, removeFeature({ id: fid('r1') }));
    expect(apply(without, removeFeature({ id: fid('f2') })).features.map((f) => f.id)).toEqual([
      'f1',
      'f3',
    ]);
  });
});

/** Every command in one list, with a valid payload for `sampleDocument()`. */
const EACH_COMMAND: Command<unknown>[] = [
  renameDocument({ name: 'Renamed' }),
  updateSettings({ units: 'cm', precision: 3 }),
  addParameter({ parameter: parameter('p3', 'gap') }),
  updateParameter({ id: pid('p1'), changes: { expression: '42 mm', comment: 'wider' } }),
  removeParameter({ id: pid('p1') }),
  insertFeature({ feature: feature('f4') }),
  insertFeature({ feature: feature('f4'), index: 0 }),
  updateFeatureInputs({ id: fid('f2'), inputs: { distance: { kind: 'expr', expr: 'wall' } } }),
  renameFeature({ id: fid('f2'), name: 'Base' }),
  setFeatureSuppressed({ id: fid('f3'), suppressed: true }),
  removeFeature({ id: fid('f2') }),
  moveTimelineMarker({ index: 1 }),
  updateBody({ id: bid('b1'), changes: { name: 'Body1' } }),
  nameBodies({ bodies: { [bid('b1')]: { name: 'Body1', visible: true } } }),
  setParameterCustomizer({ id: pid('p1'), customizer: { min: 10, max: 80, group: 'Size' } }),
  addConfiguration({
    configuration: { id: cid('c1'), name: 'Big', values: { [pid('p1')]: '60 mm' } },
  }),
];

describe('undo/redo round trips', () => {
  it.each(EACH_COMMAND.map((c) => [c.type, c] as const))('%s', (_type, command) => {
    const history = new UndoHistory();
    const original = sampleDocument();
    const { doc: changed, patches, inversePatches } = applyCommand(original, command);
    expect(changed).not.toEqual(original);
    expect(DocumentSchema.safeParse(changed).success).toBe(true);
    history.record({ label: command.label, patches, inversePatches });

    const undone = history.undo(changed);
    expect(undone).toEqual(original);
    const redone = history.redo(undone);
    expect(redone).toEqual(changed);
    // Round trips repeat.
    expect(history.redo(history.undo(redone))).toEqual(changed);
  });

  it('a long random edit session undoes to the start and redoes to the end', () => {
    const random = mulberry32(20260925);
    const history = new UndoHistory();
    const start = sampleDocument();
    const snapshots = [start];
    let doc = start;
    let nextId = 100;

    for (let step = 0; step < 400; step++) {
      const command = randomCommand(doc, random, () => String(nextId++));
      if (!command) continue;
      const result = applyCommand(doc, command);
      history.record({ label: command.label, ...result });
      // A command that changes nothing leaves no undo step.
      if (result.patches.length === 0) continue;
      doc = result.doc;
      snapshots.push(doc);
      const parsed = DocumentSchema.safeParse(doc);
      if (!parsed.success) throw new Error(`step ${step} (${command.type}): ${parsed.error}`);
    }
    expect(snapshots.length).toBeGreaterThan(300);

    for (let i = snapshots.length - 1; i > 0; i--) {
      doc = history.undo(doc);
      expect(doc).toEqual(snapshots[i - 1]);
    }
    expect(history.canUndo).toBe(false);
    for (let i = 1; i < snapshots.length; i++) {
      doc = history.redo(doc);
      expect(doc).toEqual(snapshots[i]);
    }
    expect(history.canRedo).toBe(false);
  });
});

/** A small seeded PRNG, so the random session is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random command that is valid for `doc`, or undefined if the pick doesn't apply. */
function randomCommand(
  doc: ExtrudoDocument,
  random: () => number,
  newId: () => string,
): Command<unknown> | undefined {
  const pick = <T>(list: readonly T[]): T | undefined => list[Math.floor(random() * list.length)];
  const aFeature = pick(doc.features);
  const aParameter = pick(doc.parameters);
  const n = Math.floor(random() * 1000);
  switch (Math.floor(random() * 13)) {
    case 0:
      return renameDocument({ name: `Doc ${n}` });
    case 1:
      return updateSettings({ precision: n % 9 });
    case 2:
      return addParameter({ parameter: parameter(`p${newId()}`, `x${newId()}`, `${n} mm`) });
    case 3:
      return aParameter && updateParameter({ id: aParameter.id, changes: { expression: `${n}` } });
    case 4:
      return aParameter && removeParameter({ id: aParameter.id });
    case 5:
      return insertFeature({
        feature: feature(`f${newId()}`),
        index: Math.floor(random() * (doc.features.length + 1)),
      });
    case 6:
      return aFeature && renameFeature({ id: aFeature.id, name: `Feature ${n}` });
    case 7:
      return (
        aFeature &&
        updateFeatureInputs({
          id: aFeature.id,
          inputs: { [`i${n % 3}`]: { kind: 'expr', expr: `${n} mm` } },
        })
      );
    case 8:
      return (
        aFeature && setFeatureSuppressed({ id: aFeature.id, suppressed: !aFeature.suppressed })
      );
    case 9:
      return aFeature && random() < 0.5
        ? removeFeature({ id: aFeature.id })
        : moveTimelineMarker({ index: Math.floor(random() * (doc.features.length + 1)) });
    case 11:
      return (
        aParameter &&
        (aParameter.customizer
          ? setParameterCustomizer({ id: aParameter.id })
          : setParameterCustomizer({
              id: aParameter.id,
              customizer: { min: 0, max: 100, group: `Group ${n % 3}` },
            }))
      );
    default: {
      // Configurations (P4-07): a fresh name every time, so nothing is refused.
      const configuration = pick(doc.configurations ?? []);
      const again = random();
      if (configuration && again < 0.4) {
        return random() < 0.5
          ? removeConfiguration({ id: configuration.id })
          : updateConfiguration({
              id: configuration.id,
              changes: aParameter
                ? { values: { [aParameter.id]: `${n} mm` } }
                : { name: `Config ${newId()}` },
            });
      }
      if (again < 0.7) {
        return addConfiguration({
          configuration: {
            id: cid(`c${newId()}`),
            name: `Config ${newId()}`,
            values: aParameter ? { [aParameter.id]: `${n} mm` } : {},
          },
        });
      }
      return updateBody({
        id: bid(`b${n % 3}`),
        changes: { name: `Body ${n}`, visible: n % 2 === 0 },
      });
    }
  }
}

describe('restoreVersion', () => {
  it("brings back a version's content, keeping the ID, name and dates, as one undo step", () => {
    const old = sampleDocument();
    let now = apply(old, renameDocument({ name: 'Renamed' }));
    now = apply(now, removeParameter({ id: old.parameters[0]?.id as never }));
    now = apply(now, updateSettings({ units: 'in' }));
    const version = { ...old, id: now.id, name: 'Old name', meta: { ...old.meta, created: 'x' } };
    const history = new UndoHistory();
    const result = applyCommand(now, restoreVersion({ doc: version }));
    history.record({ label: 'Restore version', ...result });
    expect(result.doc.name).toBe('Renamed');
    expect(result.doc.meta).toEqual(now.meta);
    expect(result.doc.parameters).toEqual(old.parameters);
    expect(result.doc.settings).toEqual(old.settings);
    expect(result.doc.features).toEqual(old.features);
    expect(DocumentSchema.safeParse(result.doc).success).toBe(true);
    expect(history.undo(result.doc)).toEqual(now);
  });
});
