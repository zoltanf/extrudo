import { describe, expect, it } from 'vitest';
import { type Command, CommandError } from './commands';
import { removeComponent } from './components';
import { removeParameter, updateParameter } from './document-commands';
import type { ComponentId, JointId, ParameterId } from './ids';
import {
  addJoint,
  jointProblem,
  jointRange,
  jointsOf,
  movingComponents,
  newJointName,
  removeJoint,
  renameJoint,
  setJointSuppressed,
  updateJoint,
} from './joints';
import { DocumentSchema, type ExtrudoDocument, type GeomRef, type Joint } from './schema';
import { createDocumentStore } from './stores';
import { sampleDocument } from './testing';
import { replaceReferences } from './timeline';

const cmp = (id: string) => id as ComponentId;
const jid = (id: string) => id as JointId;
const face = (id: string): GeomRef => ({ kind: 'face', id });

const hinge: Joint = {
  id: jid('j1'),
  name: 'Hinge',
  type: 'revolute',
  a: { component: cmp('leaf'), ref: face('hole:f2:side:wall') },
  b: { component: cmp('base'), ref: face('cylinder:f3:side:wall') },
  min: { kind: 'expr', expr: '0 deg', unit: 'angle' },
  max: { kind: 'expr', expr: 'width * 2 deg / 1 mm', unit: 'angle' },
};

/** The sample design with components Base, Leaf and Pin and the joint Hinge. */
function design(joints: Joint[] = [hinge]): ExtrudoDocument {
  return {
    ...sampleDocument(),
    components: [
      { id: cmp('base'), name: 'Base', visible: true },
      { id: cmp('leaf'), name: 'Leaf', visible: true },
      { id: cmp('pin'), name: 'Pin', visible: true },
    ],
    ...(joints.length > 0 && { joints }),
  };
}

/** Dispatches `command` and checks one undo restores the document exactly. */
function roundTrip(doc: ExtrudoDocument, command: Command<unknown>): ExtrudoDocument {
  const store = createDocumentStore(doc);
  store.getState().dispatch(command);
  const after = store.getState().doc;
  const parsed = DocumentSchema.safeParse(after);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  store.getState().undo();
  expect(store.getState().doc).toEqual(doc);
  store.getState().redo();
  expect(store.getState().doc).toEqual(after);
  return after;
}

function refused(doc: ExtrudoDocument, command: Command<unknown>): string {
  const store = createDocumentStore(doc);
  try {
    store.getState().dispatch(command);
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    expect(store.getState().doc).toBe(doc);
    return (error as Error).message;
  }
  throw new Error('the command was not refused');
}

describe('joint commands (ADR-0081 §4)', () => {
  it('adds a joint at the end, one step', () => {
    const slide: Joint = {
      id: jid('j2'),
      name: ' Slide ',
      type: 'slider',
      a: { component: cmp('pin'), ref: { kind: 'axis', id: 'origin:x' } },
      b: { component: cmp('base'), ref: { kind: 'edge', id: 'e[a|b]' } },
    };
    const command = addJoint({ joint: slide });
    expect(command.label).toBe('New joint');
    const after = roundTrip(design(), command);
    expect(after.joints?.map((j) => j.name)).toEqual(['Hinge', 'Slide']);
    // The first joint of a design brings the key.
    expect(roundTrip(design([]), addJoint({ joint: hinge })).joints).toEqual([hinge]);
  });

  it('refuses a clashing name, a missing or shared component, a kind or unit the type lacks', () => {
    const doc = design();
    const other = { ...hinge, id: jid('j2') };
    expect(refused(doc, addJoint({ joint: { ...other, name: 'HINGE' } }))).toBe(
      'There is already a joint named Hinge.',
    );
    expect(refused(doc, addJoint({ joint: { ...other, name: ' ' } }))).toBe(
      "The name can't be empty.",
    );
    expect(refused(doc, addJoint({ joint: hinge }))).toBe('Joint j1 already exists.');
    expect(
      refused(
        doc,
        addJoint({ joint: { ...other, name: 'X', a: { ...hinge.a, component: cmp('gone') } } }),
      ),
    ).toBe("Component gone doesn't exist.");
    expect(
      refused(
        doc,
        addJoint({ joint: { ...other, name: 'X', b: { ...hinge.b, component: cmp('leaf') } } }),
      ),
    ).toBe('Both sides are in Leaf: pick a frame on another component.');
    expect(
      refused(
        doc,
        addJoint({
          joint: { ...other, name: 'X', a: { ...hinge.a, ref: { kind: 'vertex', id: 'v[a]' } } },
        }),
      ),
    ).toBe("A revolute joint can't use a vertex as a frame.");
    expect(refused(doc, addJoint({ joint: { ...other, name: 'X', type: 'slider' } }))).toBe(
      "A slider joint's limits are lengths.",
    );
    expect(refused(doc, addJoint({ joint: { ...other, name: 'X', type: 'rigid' } }))).toBe(
      'A rigid joint has no limits.',
    );
  });

  it('edits a joint in place and keeps its position', () => {
    const doc = design([hinge, { ...hinge, id: jid('j2'), name: 'Other' }]);
    const { id: _, ...rest } = hinge;
    const after = roundTrip(
      doc,
      updateJoint({ id: jid('j1'), joint: { ...rest, name: 'Lid hinge', flip: true } }),
    );
    expect(after.joints?.map((j) => [j.id, j.name, j.flip])).toEqual([
      ['j1', 'Lid hinge', true],
      ['j2', 'Other', undefined],
    ]);
    expect(refused(doc, updateJoint({ id: jid('j1'), joint: { ...rest, name: 'other' } }))).toBe(
      'There is already a joint named Other.',
    );
    expect(refused(doc, updateJoint({ id: jid('nope'), joint: rest }))).toBe(
      "Joint nope doesn't exist.",
    );
  });

  it('renames, allowing its own name in another case', () => {
    expect(
      roundTrip(design(), renameJoint({ id: jid('j1'), name: 'HINGE' })).joints?.[0]?.name,
    ).toBe('HINGE');
    expect(refused(design(), renameJoint({ id: jid('j1'), name: 'x'.repeat(101) }))).toBe(
      "A joint's name can be at most 100 characters.",
    );
  });

  it('suppresses and unsuppresses, deleting the key', () => {
    const command = setJointSuppressed({ ids: [jid('j1')], suppressed: true });
    expect(command.label).toBe('Suppress joint');
    const off = roundTrip(design(), command);
    expect(off.joints?.[0]?.suppressed).toBe(true);
    const on = roundTrip(off, setJointSuppressed({ ids: [jid('j1')], suppressed: false }));
    expect(on.joints?.[0]).not.toHaveProperty('suppressed');
  });

  it('deletes joints, and `joints` with the last', () => {
    const two = design([hinge, { ...hinge, id: jid('j2'), name: 'Other' }]);
    expect(removeJoint({ ids: [jid('j1'), jid('j2')] }).label).toBe('Delete joints');
    expect(roundTrip(two, removeJoint({ ids: [jid('j1')] })).joints?.map((j) => j.id)).toEqual([
      'j2',
    ]);
    expect(roundTrip(two, removeJoint({ ids: [jid('j1'), jid('j2')] }))).not.toHaveProperty(
      'joints',
    );
    expect(refused(two, removeJoint({ ids: [jid('x')] }))).toBe("Joint x doesn't exist.");
  });

  it('deleting a component takes its joints in the same step', () => {
    const doc = design([
      hinge,
      { ...hinge, id: jid('j2'), name: 'Other', a: { ...hinge.a, component: cmp('pin') } },
    ]);
    const command = removeComponent({ id: cmp('leaf') });
    expect(command.label).toBe('Delete component');
    expect(roundTrip(doc, command).joints?.map((j) => j.id)).toEqual(['j2']);
    expect(roundTrip(design(), removeComponent({ id: cmp('base') }))).not.toHaveProperty('joints');
  });

  it("replaces a joint's frame references (Fix References)", () => {
    const to: GeomRef = { kind: 'face', id: 'hole:f2:side:wall#1' };
    const after = roundTrip(
      design(),
      replaceReferences({ id: jid('j1'), replace: [{ from: hinge.a.ref, to }] }),
    );
    expect(after.joints?.[0]?.a.ref).toEqual(to);
    expect(after.joints?.[0]?.b).toEqual(hinge.b);
    expect(
      refused(
        design(),
        replaceReferences({ id: jid('j1'), replace: [{ from: hinge.a.ref, to: null }] }),
      ),
    ).toBe('Hinge needs a frame on each side: pick one.');
    expect(
      refused(design(), replaceReferences({ id: jid('j1'), replace: [{ from: face('x'), to }] })),
    ).toBe('Hinge has none of those references.');
  });

  it('refuses to delete a parameter a limit uses, and a rename carries into the limits', () => {
    const doc = design();
    expect(refused(doc, removeParameter({ id: 'p1' as ParameterId }))).toBe(
      "`width` is used by Hinge's maximum angle. Change that first.",
    );
    const after = roundTrip(
      doc,
      updateParameter({ id: 'p1' as ParameterId, changes: { name: 'span' } }),
    );
    expect(after.joints?.[0]?.max?.expr).toBe('span * 2 deg / 1 mm');
  });
});

describe('joint helpers', () => {
  it('names new joints Joint1, Joint2…', () => {
    expect(newJointName({})).toBe('Joint1');
    expect(newJointName({ joints: [{ ...hinge, name: 'joint1' }] })).toBe('Joint2');
  });

  it('lists the joints a component moves', () => {
    const other = { ...hinge, id: jid('j2'), a: { ...hinge.a, component: cmp('pin') } };
    expect(jointsOf({ joints: [hinge, other] }, cmp('leaf'))).toEqual([hinge]);
    expect(jointsOf({}, cmp('leaf'))).toEqual([]);
  });

  it('carries rigidly joined components, never across side b', () => {
    const rigid = (id: string, a: string, b: string, suppressed?: true): Joint => ({
      id: jid(id),
      name: id,
      type: 'rigid',
      a: { component: cmp(a), ref: face(`${a}-face`) },
      b: { component: cmp(b), ref: face(`${b}-face`) },
      ...(suppressed && { suppressed }),
    });
    // leaf—arm rigid, arm—knob rigid (a chain), base—cap rigid (b's side), a cycle arm—leaf.
    const joints = [
      hinge,
      rigid('r1', 'arm', 'leaf'),
      rigid('r2', 'arm', 'knob'),
      rigid('r3', 'base', 'cap'),
      rigid('r4', 'leaf', 'arm'),
      rigid('r5', 'leaf', 'spare', true),
      // A rigid joint to b is not crossed.
      rigid('r6', 'knob', 'base'),
    ];
    expect(movingComponents({ joints }, hinge)).toEqual(['leaf', 'arm', 'knob']);
    expect(movingComponents({}, hinge)).toEqual(['leaf']);
  });

  it('reads the range only with both limits', () => {
    const value = (input: { expr: string }) => Number.parseFloat(input.expr);
    expect(jointRange(hinge, () => 45)).toEqual({ min: 45, max: 45 });
    expect(jointRange({ ...hinge, max: undefined }, value)).toBeUndefined();
    expect(jointRange({ ...hinge, type: 'rigid' }, value)).toBeUndefined();
  });

  it('words what is wrong with a joint', () => {
    expect(jointProblem(design(), hinge)).toBeUndefined();
  });
});
