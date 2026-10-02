import {
  createDocument,
  type DimensionId,
  EXTRUDE_TYPE,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  FILLET_TYPE,
  newId,
  originPlaneRef,
  SHELL_TYPE,
  type SketchData,
  sketchInputs,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { outline } from '../project/templates';
import { currentStep, TUTORIAL_STEPS, type TutorialFacts, textParts } from './tutorial';

const feature = (type: string, inputs: Feature['inputs'] = {}, suppressed = false): Feature => ({
  id: newId<FeatureId>(),
  type,
  name: type,
  suppressed,
  inputs,
});

const box = (): SketchData =>
  outline([
    [0, 0],
    [40, 0],
    [40, 20],
    [0, 20],
  ]);

const sketch = (data: SketchData = { entities: {}, constraints: {}, dimensions: {} }) =>
  feature('sketch', sketchInputs(originPlaneRef('origin:xy'), data));

/** A design with these features, in a mode. */
const facts = (
  features: Feature[],
  over: Partial<Omit<TutorialFacts, 'doc'>> = {},
): TutorialFacts => ({
  doc: { ...createDocument(), features } as ExtrudoDocument,
  mode: 'model',
  activeTool: undefined,
  ...over,
});

const withDimension = (data: SketchData): SketchData => ({
  ...data,
  dimensions: { [newId<DimensionId>()]: { type: 'distance' } as never },
});

describe('tutorial steps', () => {
  it('has five steps with a title, a hint of what to press and a control to point at', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual([
      'sketch',
      'rectangle',
      'dimension',
      'extrude',
      'round',
    ]);
    const asks = facts([]);
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.length).toBeGreaterThan(5);
      expect(step.text(asks)).toMatch(/\*\*[A-Za-z ]+\*\*/);
    }
  });

  it('starts at step 1 in an empty design, pointing at Create Sketch', () => {
    const empty = facts([]);
    expect(currentStep(empty)).toBe(0);
    expect(TUTORIAL_STEPS[0]?.target(empty)).toBe('sketch');
  });

  it('asks for a plane once Create Sketch runs, and points at none', () => {
    const picking = facts([], { activeTool: 'sketch' });
    expect(currentStep(picking)).toBe(0);
    expect(TUTORIAL_STEPS[0]?.text(picking)).toContain('XY plane');
    expect(TUTORIAL_STEPS[0]?.target(picking)).toBeUndefined();
  });

  it('moves on when a sketch exists, and again when it has four lines', () => {
    expect(currentStep(facts([sketch()], { mode: 'sketch' }))).toBe(1);
    const state = facts([sketch(box())], { mode: 'sketch' });
    expect(currentStep(state)).toBe(2);
    expect(TUTORIAL_STEPS[1]?.target(facts([sketch()], { mode: 'sketch' }))).toBe('rectangle');
  });

  it('needs four lines: three are no rectangle', () => {
    const one = box();
    const lines = Object.entries(one.entities).filter(([, e]) => e.type === 'line');
    const threeLines: SketchData = {
      ...one,
      entities: Object.fromEntries(
        Object.entries(one.entities).filter(([id]) => id !== lines[0]?.[0]),
      ),
    };
    expect(currentStep(facts([sketch(threeLines)], { mode: 'sketch' }))).toBe(1);
  });

  it('wants a dimension next, then the extrude', () => {
    const dimensioned = sketch(withDimension(box()));
    const sketching = facts([dimensioned], { mode: 'sketch' });
    expect(currentStep(sketching)).toBe(3);
    // In the sketch it points at Finish Sketch; outside it at Extrude.
    expect(TUTORIAL_STEPS[3]?.target(sketching)).toBe('finishSketch');
    expect(TUTORIAL_STEPS[3]?.target(facts([dimensioned]))).toBe('extrude');
  });

  it('follows the real design: an extrude, then a fillet, a chamfer or a shell finishes it', () => {
    const base = [sketch(withDimension(box())), feature(EXTRUDE_TYPE)];
    expect(currentStep(facts(base))).toBe(4);
    for (const type of [FILLET_TYPE, SHELL_TYPE, 'chamfer']) {
      expect(currentStep(facts([...base, feature(type)]))).toBe(TUTORIAL_STEPS.length);
    }
  });

  it('ignores suppressed features', () => {
    const suppressed = [sketch(withDimension(box())), feature(EXTRUDE_TYPE, {}, true)];
    expect(currentStep(facts(suppressed))).toBe(3);
  });

  it('goes back a step when the design does (undo)', () => {
    const done = [sketch(withDimension(box())), feature(EXTRUDE_TYPE)];
    expect(currentStep(facts(done))).toBe(4);
    expect(currentStep(facts(done.slice(0, 1)))).toBe(3);
    expect(currentStep(facts([]))).toBe(0);
  });

  it('skips the steps before the floor, whatever the design has', () => {
    expect(currentStep(facts([]), 2)).toBe(2);
    expect(currentStep(facts([]), 99)).toBe(TUTORIAL_STEPS.length);
  });

  it('says to reopen the sketch when a sketch step is shown outside one', () => {
    const outside = facts([sketch()]);
    expect(TUTORIAL_STEPS[1]?.text(outside)).toMatch(/^Double-click the sketch/);
    expect(TUTORIAL_STEPS[1]?.target(outside)).toBeUndefined();
    expect(TUTORIAL_STEPS[1]?.text(facts([sketch()], { mode: 'sketch' }))).not.toMatch(
      /Double-click/,
    );
  });

  it('names the keys from the keymap', () => {
    const sketching = facts([sketch()], { mode: 'sketch' });
    expect(TUTORIAL_STEPS[1]?.text(sketching)).toContain('(R)');
    expect(TUTORIAL_STEPS[2]?.text(sketching)).toContain('(D)');
    expect(TUTORIAL_STEPS[3]?.text(facts([]))).toContain('(E)');
    expect(TUTORIAL_STEPS[4]?.text(facts([]))).toContain('(F)');
  });
});

describe('textParts', () => {
  it('splits bold control names out of a step’s text', () => {
    expect(textParts('Press **Extrude** (E), then OK.')).toEqual([
      { bold: false, text: 'Press ' },
      { bold: true, text: 'Extrude' },
      { bold: false, text: ' (E), then OK.' },
    ]);
    expect(textParts('plain')).toEqual([{ bold: false, text: 'plain' }]);
  });
});
