import { describe, expect, it } from 'vitest';
import { applyCommand, type Command, CommandError, defineCommand } from './commands';
import {
  addConfiguration,
  capturedValues,
  configurationChanges,
  currentConfigurations,
  customizerRows,
  evaluateRange,
  isPlainValue,
  moveParameter,
  removeConfiguration,
  setParameterCustomizer,
  setParameterExpressions,
  setParameterGroup,
  updateConfiguration,
} from './customizer';
import {
  addParameter,
  parameterUsers,
  removeParameter,
  updateParameter,
} from './document-commands';
import { evaluateParameters } from './expr/parameters';
import { UndoHistory } from './history';
import type { ConfigurationId, ParameterId } from './ids';
import { DocumentSchema, type ExtrudoDocument } from './schema';
import { parameter, pid, sampleDocument } from './testing';

const cid = (id: string) => id as ConfigurationId;
const apply = (doc: ExtrudoDocument, command: Command<unknown>) => applyCommand(doc, command).doc;
const rows = (doc: ExtrudoDocument) => customizerRows(doc, evaluateParameters(doc));

/** Sets several parameter expressions, as applying a configuration does. */
const setExpressions = defineCommand<Record<ParameterId, string>>(
  'test.setExpressions',
  'Set expressions',
  (draft, changes) => {
    for (const [id, expression] of Object.entries(changes)) {
      const parameter = draft.parameters.find((p) => p.id === id);
      if (!parameter) throw new CommandError(`Parameter ${id} doesn't exist.`);
      parameter.expression = expression;
    }
  },
);

/** The sample design with `width`, `wall` and `height`; only `width` is exposed. */
function exposedDocument(): ExtrudoDocument {
  let doc = apply(
    sampleDocument(),
    setParameterCustomizer({
      id: pid('p1'),
      customizer: { min: '10 mm', max: '80 mm', step: '1 mm' },
    }),
  );
  doc = apply(doc, addParameter({ parameter: parameter('p3', 'height', '30 mm') }));
  doc = apply(doc, setParameterGroup({ id: pid('p3'), group: 'Size' }));
  doc = apply(doc, setParameterCustomizer({ id: pid('p3'), customizer: {} }));
  return doc;
}

/** `exposedDocument()` with two configurations: `c1` current, `c2` bigger. */
function withConfigurations(): ExtrudoDocument {
  let doc = apply(
    exposedDocument(),
    addConfiguration({
      configuration: { id: cid('c1'), name: 'Standard', values: { [pid('p1')]: '40 mm' } },
    }),
  );
  doc = apply(
    doc,
    addConfiguration({
      configuration: {
        id: cid('c2'),
        name: 'Big',
        values: { [pid('p1')]: '80 mm', [pid('p3')]: '50 mm' },
      },
    }),
  );
  return doc;
}

describe('isPlainValue', () => {
  it('takes one number with an optional unit, and nothing else', () => {
    for (const expression of ['12', '12 mm', ' 4.5 cm ', '-3 deg', '1e2 mm', '+7 mm', '0.5 in']) {
      expect(isPlainValue(expression)).toBe(true);
    }
    for (const expression of [
      'width / 2',
      '2 * 3 mm',
      'sqrt(4) mm',
      '12 mm * 2',
      '',
      '  ',
      'mm',
      'wall',
      '12 mm +',
    ]) {
      expect(isPlainValue(expression)).toBe(false);
    }
  });
});

describe('setParameterCustomizer', () => {
  it('exposes a parameter, changes its range, and takes it out again', () => {
    let doc = apply(sampleDocument(), setParameterCustomizer({ id: pid('p1'), customizer: {} }));
    expect(doc.parameters[0]).toMatchObject({ name: 'width', customizer: {} });
    doc = apply(
      doc,
      setParameterCustomizer({
        id: pid('p1'),
        customizer: { min: ' 10 mm ', max: '20 * wall', step: '0.5 mm' },
      }),
    );
    // Expressions are kept as typed (trimmed), formulas included (ADR-0086 §2).
    expect(doc.parameters[0]?.customizer).toEqual({
      min: '10 mm',
      max: '20 * wall',
      step: '0.5 mm',
    });
    // An empty field is left out.
    doc = apply(
      doc,
      setParameterCustomizer({ id: pid('p1'), customizer: { min: '10 mm', max: ' ' } }),
    );
    expect(doc.parameters[0]?.customizer).toEqual({ min: '10 mm' });
    doc = apply(doc, setParameterCustomizer({ id: pid('p1') }));
    expect(doc.parameters[0]).not.toHaveProperty('customizer');
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('refuses an unknown parameter and a range that runs backwards', () => {
    const doc = sampleDocument();
    expect(() => apply(doc, setParameterCustomizer({ id: pid('nope'), customizer: {} }))).toThrow(
      "Parameter nope doesn't exist.",
    );
    expect(() =>
      apply(
        doc,
        setParameterCustomizer({ id: pid('p1'), customizer: { min: '80 mm', max: '10 mm' } }),
      ),
    ).toThrow("Min 80 mm can't be above max 10 mm.");
  });

  it('refuses a field that does not evaluate, a non-positive step and a moving range', () => {
    const doc = apply(
      sampleDocument(),
      addParameter({ parameter: parameter('p3', 'half', 'width / 2') }),
    );
    const refused = (customizer: Record<string, string>) => () =>
      apply(doc, setParameterCustomizer({ id: pid('p1'), customizer }));
    expect(refused({ min: '10 deg' })).toThrow(/^Min: /);
    expect(refused({ max: 'nothing + 1' })).toThrow(/^Max: /);
    expect(refused({ step: '0 mm' })).toThrow('Step: The step must be above 0.');
    expect(refused({ max: '2 * width' })).toThrow("Max: The range can't use `width` itself.");
    expect(refused({ max: 'half + 10 mm' })).toThrow(
      "Max: The range can't use `half`: it changes with `width`.",
    );
  });

  it('refuses what the schema would refuse, naming the field', () => {
    const doc = sampleDocument();
    expect(() =>
      apply(doc, setParameterCustomizer({ id: pid('p1'), customizer: { min: 10 } } as never)),
    ).toThrow(/The customizer settings are not valid: `min`/);
    expect(() =>
      apply(doc, setParameterCustomizer({ id: pid('p1'), customizer: { group: 'Size' } } as never)),
    ).toThrow(/Unrecognized key: "group"/);
    expect(() =>
      apply(doc, setParameterCustomizer({ id: pid('p1'), customizer: { extra: 1 } } as never)),
    ).toThrow(/Unrecognized key: "extra"/);
  });
});

describe('evaluateRange', () => {
  it('evaluates in the parameter unit against the other parameters', () => {
    const doc = apply(
      sampleDocument(),
      addParameter({ parameter: parameter('p3', 'half', 'width / 2') }),
    );
    const evaluation = evaluateParameters(doc);
    const wall = { name: 'wall', unit: 'length' } as const;
    expect(evaluateRange(evaluation, wall, 'max', 'width / 10')).toMatchObject({
      ok: true,
      value: 4,
    });
    expect(evaluateRange(evaluation, wall, 'max', 'half')).toMatchObject({ ok: true, value: 20 });
    const own = evaluateRange(evaluation, { name: 'width', unit: 'length' }, 'min', '1 mm + half');
    expect(own.ok).toBe(false);
    if (!own.ok) expect(own.error.span).toEqual({ start: 7, end: 11 });
    expect(evaluateRange(evaluation, wall, 'step', '-1 mm').ok).toBe(false);
    expect(evaluateRange(evaluation, wall, 'min', '-1 mm').ok).toBe(true);
  });
});

describe('setParameterGroup', () => {
  it('puts a parameter in a trimmed group and takes it out again', () => {
    let doc = apply(sampleDocument(), setParameterGroup({ id: pid('p2'), group: ' Walls ' }));
    expect(doc.parameters[1]?.group).toBe('Walls');
    doc = apply(doc, setParameterGroup({ id: pid('p2'), group: '' }));
    expect(doc.parameters[1]).not.toHaveProperty('group');
    doc = apply(doc, setParameterGroup({ id: pid('p2'), group: 'Walls' }));
    doc = apply(doc, setParameterGroup({ id: pid('p2') }));
    expect(doc.parameters[1]).not.toHaveProperty('group');
    expect(() => apply(doc, setParameterGroup({ id: pid('p2'), group: 'x'.repeat(41) }))).toThrow(
      /The group name is not valid/,
    );
  });
});

describe('moveParameter', () => {
  it('moves a parameter to a position, into a group or out of one, in one step', () => {
    let doc = apply(
      sampleDocument(),
      addParameter({ parameter: parameter('p3', 'height', '30 mm') }),
    );
    const names = (d: ExtrudoDocument) => d.parameters.map((p) => p.name);
    expect(names(doc)).toEqual(['width', 'wall', 'height']);
    doc = apply(doc, moveParameter({ id: pid('p3'), index: 0 }));
    expect(names(doc)).toEqual(['height', 'width', 'wall']);
    doc = apply(doc, moveParameter({ id: pid('p3'), index: 2, group: 'Size' }));
    expect(names(doc)).toEqual(['width', 'wall', 'height']);
    expect(doc.parameters[2]?.group).toBe('Size');
    doc = apply(doc, moveParameter({ id: pid('p3'), index: 2, group: null }));
    expect(doc.parameters[2]).not.toHaveProperty('group');
    expect(() => apply(doc, moveParameter({ id: pid('p3'), index: 3 }))).toThrow(
      'There is no position 3 in the parameter list.',
    );
    // Order never changes a value: `wall` still evaluates after moving above `width`.
    doc = apply(doc, updateParameter({ id: pid('p2'), changes: { expression: 'width / 10' } }));
    doc = apply(doc, moveParameter({ id: pid('p2'), index: 0 }));
    expect(evaluateParameters(doc).parameters.get('wall')?.result).toMatchObject({ value: 4 });
  });
});

describe('configurations', () => {
  it('saves one under a trimmed name, creating the list', () => {
    const doc = apply(
      exposedDocument(),
      addConfiguration({
        configuration: {
          id: cid('c1'),
          name: '  Standard  ',
          values: { [pid('p1')]: '40 mm', [pid('p3')]: '30 mm' },
        },
      }),
    );
    expect(doc.configurations).toEqual([
      { id: cid('c1'), name: 'Standard', values: { [pid('p1')]: '40 mm', [pid('p3')]: '30 mm' } },
    ]);
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('refuses a name another configuration has, however it is written', () => {
    const doc = withConfigurations();
    const save = (name: string) =>
      addConfiguration({ configuration: { id: cid('c3'), name, values: {} } });
    expect(() => apply(doc, save('Big'))).toThrow('A configuration named "Big" already exists.');
    expect(() => apply(doc, save('  big '))).toThrow('A configuration named "big" already exists.');
    expect(() => apply(doc, save('bigger'))).not.toThrow();
    expect(() => apply(doc, save('  '))).toThrow("The configuration's name can't be empty.");
    expect(() => apply(doc, save('x'.repeat(61)))).toThrow(
      "The name can't be longer than 60 characters (this one is 61).",
    );
  });

  it('refuses a second configuration with the same ID, and bad values', () => {
    const doc = withConfigurations();
    expect(() =>
      apply(doc, addConfiguration({ configuration: { id: cid('c1'), name: 'Other', values: {} } })),
    ).toThrow('Configuration c1 already exists.');
    expect(() =>
      apply(
        doc,
        addConfiguration({
          configuration: { id: cid('c3'), name: 'Third', values: { [pid('')]: '1 mm' } },
        }),
      ),
    ).toThrow(/The configuration's values are not valid/);
  });

  it('renames a configuration and replaces its values', () => {
    const doc = apply(
      withConfigurations(),
      updateConfiguration({
        id: cid('c2'),
        changes: { name: '  Large ', values: { [pid('p3')]: '60 mm' } },
      }),
    );
    expect(doc.configurations?.[1]).toEqual({
      id: cid('c2'),
      name: 'Large',
      values: { [pid('p3')]: '60 mm' },
    });
    // A rename that lands on another configuration's name is refused, its own
    // name is not a conflict.
    expect(() =>
      apply(doc, updateConfiguration({ id: cid('c2'), changes: { name: 'standard' } })),
    ).toThrow('A configuration named "standard" already exists.');
    expect(() =>
      apply(doc, updateConfiguration({ id: cid('c2'), changes: { name: 'Large' } })),
    ).not.toThrow();
    expect(() =>
      apply(doc, updateConfiguration({ id: cid('c2'), changes: { values: { p3: 60 } } as never })),
    ).toThrow(/The configuration's values are not valid/);
  });

  it('refuses unknown IDs', () => {
    const doc = withConfigurations();
    expect(() => apply(doc, updateConfiguration({ id: cid('nope'), changes: {} }))).toThrow(
      CommandError,
    );
    expect(() => apply(doc, updateConfiguration({ id: cid('nope'), changes: {} }))).toThrow(
      "Configuration nope doesn't exist.",
    );
    expect(() => apply(doc, removeConfiguration({ id: cid('nope') }))).toThrow(
      "Configuration nope doesn't exist.",
    );
  });

  it('deletes one, and one that deletes the last leaves an empty list', () => {
    const doc = apply(withConfigurations(), removeConfiguration({ id: cid('c1') }));
    expect(doc.configurations?.map((c) => c.id)).toEqual([cid('c2')]);
    const empty = apply(doc, removeConfiguration({ id: cid('c2') }));
    expect(empty.configurations).toEqual([]);
    expect(DocumentSchema.safeParse(empty).success).toBe(true);
  });

  it('drops a deleted parameter from every configuration', () => {
    const doc = apply(withConfigurations(), removeParameter({ id: pid('p1') }));
    expect(doc.configurations?.map((c) => c.values)).toEqual([{}, { p3: '50 mm' }]);
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
  });
});

describe('customizerRows', () => {
  it('lists the exposed parameters in panel order: ungrouped, then groups by first appearance', () => {
    let doc = exposedDocument();
    // width, height (Size), and two more: an ungrouped one and a second group.
    doc = apply(doc, addParameter({ parameter: parameter('p4', 'corner', '2 mm') }));
    doc = apply(doc, setParameterGroup({ id: pid('p4'), group: 'Walls' }));
    doc = apply(
      doc,
      setParameterCustomizer({ id: pid('p4'), customizer: { min: '0.5 mm', max: '5 mm' } }),
    );
    doc = apply(doc, addParameter({ parameter: parameter('p5', 'label', '8 mm') }));
    doc = apply(doc, setParameterCustomizer({ id: pid('p5'), customizer: {} }));
    // A group alone doesn't expose a parameter: wall is grouped, not exposed.
    doc = apply(doc, setParameterGroup({ id: pid('p2'), group: 'Walls' }));
    const listed = rows(doc);
    expect(listed.map((row) => row.name)).toEqual(['width', 'label', 'height', 'corner']);
    expect(listed.map((row) => row.group)).toEqual([undefined, undefined, 'Size', 'Walls']);
    expect(listed.map((row) => row.id)).toEqual([pid('p1'), pid('p5'), pid('p3'), pid('p4')]);
  });

  it('carries the value, the expression and whether a slider is possible', () => {
    let doc = exposedDocument();
    doc = apply(doc, addParameter({ parameter: parameter('p4', 'half', 'width / 2') }));
    doc = apply(
      doc,
      setParameterCustomizer({ id: pid('p4'), customizer: { min: '1 mm', max: '40 mm' } }),
    );
    const [width, half, height] = rows(doc);
    expect(width).toEqual({
      id: pid('p1'),
      name: 'width',
      comment: undefined,
      group: undefined,
      unit: 'length',
      expression: '40 mm',
      value: 40,
      plain: true,
      min: 10,
      max: 80,
      step: 1,
      outOfRange: false,
    });
    expect(height).toMatchObject({ name: 'height', group: 'Size', value: 30, plain: true });
    // A comment travels with the row: the panel shows it as the row's hint.
    doc = apply(doc, updateParameter({ id: pid('p1'), changes: { comment: 'Outer width' } }));
    expect(rows(doc)[0]).toMatchObject({ name: 'width', comment: 'Outer width' });
    // A formula shows its computed value but can't be dragged.
    expect(half).toMatchObject({ name: 'half', expression: 'width / 2', value: 20, plain: false });
  });

  it('evaluates a formula range, in the document unit, and follows its parameters', () => {
    let doc = apply(
      sampleDocument(),
      setParameterCustomizer({ id: pid('p2'), customizer: { min: '1 mm', max: 'width / 10' } }),
    );
    expect(rows(doc)[0]).toMatchObject({ name: 'wall', min: 1, max: 4 });
    doc = apply(doc, updateParameter({ id: pid('p1'), changes: { expression: '60 mm' } }));
    expect(rows(doc)[0]).toMatchObject({ min: 1, max: 6 });
    // A plain number is in the document's length unit, like any expression.
    doc = apply(
      { ...doc, settings: { ...doc.settings, units: 'in' } },
      setParameterCustomizer({ id: pid('p2'), customizer: { min: '0', max: '1' } }),
    );
    expect(rows(doc)[0]).toMatchObject({ min: 0, max: 25.4 });
  });

  it('leaves out a range end that stopped evaluating, and a range that runs backwards', () => {
    let doc = apply(sampleDocument(), addParameter({ parameter: parameter('p3', 'gap', '1 mm') }));
    doc = apply(
      doc,
      setParameterCustomizer({ id: pid('p1'), customizer: { min: 'gap * 10', max: '100 mm' } }),
    );
    expect(rows(doc)[0]).toMatchObject({ min: 10, max: 100 });
    // gap now depends on width: width's min would move while dragging.
    doc = apply(doc, updateParameter({ id: pid('p3'), changes: { expression: 'width / 40' } }));
    expect(rows(doc)[0]).not.toHaveProperty('min');
    expect(rows(doc)[0]).toMatchObject({ max: 100 });
    // gap back to a value, but now its min is above the max: no slider.
    doc = apply(doc, updateParameter({ id: pid('p3'), changes: { expression: '20 mm' } }));
    expect(rows(doc)[0]).not.toHaveProperty('min');
    expect(rows(doc)[0]).not.toHaveProperty('max');
  });

  it('warns about a value outside the range, and leaves the rest alone', () => {
    let doc = apply(
      sampleDocument(),
      setParameterCustomizer({ id: pid('p1'), customizer: { min: '10 mm', max: '80 mm' } }),
    );
    doc = apply(
      doc,
      setParameterCustomizer({ id: pid('p2'), customizer: { min: '1 mm', max: '2 mm' } }),
    );
    const [width, wall] = rows(doc);
    expect(width?.outOfRange).toBe(false);
    // The range is a slider range, not a constraint: wall is 3 mm with max 2.
    expect(wall).toMatchObject({ value: 3, min: 1, max: 2, outOfRange: true });
    // A parameter whose expression has an error has no value to be out of.
    doc = apply(doc, addParameter({ parameter: parameter('p4', 'broken', 'width +') }));
    doc = apply(
      doc,
      setParameterCustomizer({ id: pid('p4'), customizer: { min: '1 mm', max: '2 mm' } }),
    );
    expect(rows(doc).at(-1)).toMatchObject({
      name: 'broken',
      value: undefined,
      plain: false,
      outOfRange: false,
    });
  });
});

describe('configurationChanges', () => {
  it('lists the parameters a configuration would change, and skips the rest', () => {
    const doc = apply(
      exposedDocument(),
      addConfiguration({
        configuration: {
          id: cid('c1'),
          name: 'Big',
          // p2 (wall) already has this, p9 is gone, p3 changes too.
          values: {
            [pid('p1')]: '80 mm',
            [pid('p2')]: '3 mm',
            [pid('p9')]: '5 mm',
            [pid('p3')]: '50 mm',
          },
        },
      }),
    );
    expect(configurationChanges(doc, cid('c1'))).toEqual([
      { id: pid('p1'), expression: '80 mm' },
      { id: pid('p3'), expression: '50 mm' },
    ]);
    // Applying it changes nothing the second time.
    const applied = apply(doc, setExpressions({ [pid('p1')]: '80 mm', [pid('p3')]: '50 mm' }));
    expect(configurationChanges(applied, cid('c1'))).toEqual([]);
  });

  it('sees no difference in whitespace, and nothing at all in an unknown configuration', () => {
    let doc = apply(
      exposedDocument(),
      addConfiguration({
        configuration: {
          id: cid('c1'),
          name: 'Same',
          values: { [pid('p1')]: '  40 mm  ', [pid('p3')]: '30mm ' },
        },
      }),
    );
    doc = apply(doc, setExpressions({ [pid('p3')]: '  30mm  ' }));
    expect(configurationChanges(doc, cid('c1'))).toEqual([]);
    expect(configurationChanges(doc, cid('nope'))).toEqual([]);
  });
});

describe('setParameterExpressions', () => {
  it('sets several parameters in one undo step', () => {
    const original = exposedDocument();
    const command = setParameterExpressions({
      changes: [
        { id: pid('p1'), expression: '60 mm' },
        { id: pid('p3'), expression: '45 mm' },
      ],
    });
    const result = applyCommand(original, command);
    expect(result.doc.parameters.map((p) => p.expression)).toEqual(['60 mm', '3 mm', '45 mm']);
    expect(DocumentSchema.safeParse(result.doc).success).toBe(true);
    const history = new UndoHistory();
    history.record({ label: command.label, ...result });
    expect(history.undo(result.doc)).toEqual(original);
  });

  it('applies a configuration with it, and nothing when it is current already', () => {
    const doc = withConfigurations();
    const changes = configurationChanges(doc, cid('c2'));
    expect(changes.length).toBeGreaterThan(0);
    const applied = apply(doc, setParameterExpressions({ changes }));
    expect(currentConfigurations(applied)).toEqual([cid('c2')]);
    // Applying the same configuration again is an empty change list.
    expect(
      applyCommand(
        applied,
        setParameterExpressions({ changes: configurationChanges(applied, cid('c2')) }),
      ).patches,
    ).toEqual([]);
  });

  it('refuses a parameter that is not there, and changes nothing', () => {
    const doc = exposedDocument();
    expect(() =>
      apply(
        doc,
        setParameterExpressions({
          changes: [
            { id: pid('p1'), expression: '9 mm' },
            { id: pid('p9'), expression: '1 mm' },
          ],
        }),
      ),
    ).toThrow("Parameter p9 doesn't exist.");
    expect(doc.parameters.map((p) => p.expression)).toEqual(['40 mm', '3 mm', '30 mm']);
  });
});

describe('currentConfigurations', () => {
  it('matches configurations whose values the document has, ignoring whitespace', () => {
    let doc = withConfigurations();
    // c1 (Standard) holds width = 40 mm, which the design has; c2 (Big) doesn't.
    expect(currentConfigurations(doc)).toEqual([cid('c1')]);
    doc = apply(doc, setExpressions({ [pid('p1')]: '80 mm', [pid('p3')]: '50 mm' }));
    expect(currentConfigurations(doc)).toEqual([cid('c2')]);
    // Neither once something else moves.
    doc = apply(doc, setExpressions({ [pid('p1')]: '60 mm' }));
    expect(currentConfigurations(doc)).toEqual([]);
    expect(currentConfigurations(exposedDocument())).toEqual([]);
  });

  it('counts a configuration whose parameters are all gone, and one with padded values', () => {
    let doc = withConfigurations();
    doc = apply(
      doc,
      addConfiguration({
        configuration: { id: cid('c3'), name: 'Gone', values: { [pid('p9')]: '1 mm' } },
      }),
    );
    expect(currentConfigurations(doc)).toEqual([cid('c1'), cid('c3')]);
    doc = apply(
      doc,
      updateConfiguration({ id: cid('c1'), changes: { values: { [pid('p1')]: ' 40 mm ' } } }),
    );
    expect(currentConfigurations(doc)).toEqual([cid('c1'), cid('c3')]);
  });
});

describe('capturedValues', () => {
  it('captures the exposed parameters for "Save as"', () => {
    expect(capturedValues(exposedDocument())).toEqual({
      [pid('p1')]: '40 mm',
      [pid('p3')]: '30 mm',
    });
    expect(capturedValues(sampleDocument())).toEqual({});
  });

  it('brings a base configuration\'s own parameters up to date for "Update"', () => {
    const doc = withConfigurations();
    // Standard holds width; Big holds width and height, which is also exposed.
    expect(capturedValues(doc, cid('c2'))).toEqual({
      [pid('p1')]: '40 mm',
      [pid('p3')]: '30 mm',
    });
    // A configuration with a parameter that is no longer exposed keeps it, as
    // long as the parameter is still there.
    let changed = apply(
      doc,
      addConfiguration({
        configuration: {
          id: cid('c4'),
          name: 'Walls',
          values: { [pid('p2')]: '5 mm', [pid('p9')]: '1 mm' },
        },
      }),
    );
    expect(capturedValues(changed, cid('c4'))).toEqual({
      [pid('p2')]: '3 mm',
      [pid('p1')]: '40 mm',
      [pid('p3')]: '30 mm',
    });
    // Once the parameter is gone, its value goes with it (removeParameter).
    changed = apply(changed, removeParameter({ id: pid('p2') }));
    expect(capturedValues(changed, cid('c4'))).toEqual({
      [pid('p1')]: '40 mm',
      [pid('p3')]: '30 mm',
    });
    // An unknown base saves like a new one.
    expect(capturedValues(doc, cid('nope'))).toEqual({
      [pid('p1')]: '40 mm',
      [pid('p3')]: '30 mm',
    });
  });
});

describe('undo', () => {
  const cases: [name: string, command: Command<unknown>][] = [
    ['expose a parameter', setParameterCustomizer({ id: pid('p1'), customizer: { min: '1 mm' } })],
    [
      'expose a second parameter',
      setParameterCustomizer({ id: pid('p2'), customizer: { min: '1 mm' } }),
    ],
    ['group a parameter', setParameterGroup({ id: pid('p2'), group: 'Walls' })],
    ['move a parameter', moveParameter({ id: pid('p2'), index: 0, group: 'Walls' })],
    [
      'save a configuration',
      addConfiguration({
        configuration: { id: cid('c9'), name: 'New', values: { [pid('p1')]: '40 mm' } },
      }),
    ],
    [
      'rename a configuration',
      updateConfiguration({ id: cid('c1'), changes: { name: 'Renamed' } }),
    ],
    [
      "replace a configuration's values",
      updateConfiguration({ id: cid('c1'), changes: { values: { [pid('p3')]: '10 mm' } } }),
    ],
    ['delete a configuration', removeConfiguration({ id: cid('c1') })],
    ['delete a parameter', removeParameter({ id: pid('p2') })],
  ];

  it.each(cases)('%s is one undo step', (_name, command) => {
    const history = new UndoHistory();
    const original = withConfigurations();
    const result = applyCommand(original, command);
    expect(result.doc).not.toEqual(original);
    expect(DocumentSchema.safeParse(result.doc).success).toBe(true);
    history.record({ label: command.label, ...result });
    const undone = history.undo(result.doc);
    expect(undone).toEqual(original);
    expect(history.redo(undone)).toEqual(result.doc);
    expect(history.undo(history.redo(undone))).toEqual(original);
  });
});

describe('parameterUsers (ADR-0086 §4)', () => {
  /** width used by wall, by wall's slider max, by Extrude1's distance (`d1`) and a plain input. */
  function usedDocument(): ExtrudoDocument {
    let doc = sampleDocument();
    doc = {
      ...doc,
      features: doc.features.map((f) =>
        f.name === 'Extrude1'
          ? {
              ...f,
              inputs: {
                distance: { kind: 'expr', expr: 'width / 4', paramName: 'd1' },
                taper: { kind: 'expr', expr: 'width / 40', unit: 'unitless' },
              },
            }
          : f,
      ),
    };
    doc = apply(doc, updateParameter({ id: pid('p2'), changes: { expression: 'width / 10' } }));
    doc = apply(doc, addParameter({ parameter: parameter('p3', 'lip', '2 mm') }));
    return apply(
      doc,
      setParameterCustomizer({ id: pid('p3'), customizer: { min: '1 mm', max: 'width / 8' } }),
    );
  }

  it('lists every expression that names the parameter, in document order', () => {
    expect(parameterUsers(usedDocument(), 'width')).toEqual([
      { kind: 'parameter', id: pid('p2'), name: 'wall' },
      { kind: 'range', id: pid('p3'), name: 'lip', field: 'max' },
      { kind: 'feature', featureId: 'f2', feature: 'Extrude1', paramName: 'd1', dimension: false },
      { kind: 'feature', featureId: 'f2', feature: 'Extrude1', dimension: false },
    ]);
    // A model parameter has users by its name too, and isn't its own.
    expect(parameterUsers(usedDocument(), 'd1')).toEqual([]);
    expect(parameterUsers(usedDocument(), 'lip')).toEqual([]);
  });

  it('renames inside slider ranges, and refuses deleting a parameter a range uses', () => {
    let doc = apply(usedDocument(), updateParameter({ id: pid('p1'), changes: { name: 'span' } }));
    expect(doc.parameters[2]?.customizer).toEqual({ min: '1 mm', max: 'span / 8' });
    doc = apply(doc, updateParameter({ id: pid('p2'), changes: { expression: '3 mm' } }));
    doc = { ...doc, features: sampleDocument().features };
    expect(() => apply(doc, removeParameter({ id: pid('p1') }))).toThrow(
      '`span` is used by the slider range of `lip`. Change that first.',
    );
  });
});
