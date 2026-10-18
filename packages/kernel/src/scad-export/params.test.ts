// The parameter block of a `.scad` export (P6-09, ADR-0088 §5): the example
// of the decision, ordering, closure, and the Customizer list OpenSCAD reads.
import {
  createDocument,
  type ExtrudoDocument,
  evaluateParameters,
  type Parameter,
  type ParameterId,
} from '@extrudo/core';
import type { ScadCompiler } from '@extrudo/openscad';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ExprContext, scadNames } from './expr';
import { type ParameterUse, parameterBlock } from './params';

// The Node compiler is `@extrudo/openscad/node`, which needs Node's types; the
// kernel's program has none (it runs in a worker), so the entry is loaded
// through a name the type checker doesn't follow.
const NODE_ENTRY = '@extrudo/openscad/node';

let compiler: ScadCompiler;
beforeAll(async () => {
  const { createNodeCompiler } = (await import(/* @vite-ignore */ NODE_ENTRY)) as {
    createNodeCompiler(): ScadCompiler;
  };
  compiler = createNodeCompiler();
});
afterAll(() => compiler.dispose());

const pid = (id: string) => id as ParameterId;

function param(name: string, expression: string, extra: Partial<Parameter> = {}): Parameter {
  return { id: pid(`id-${name}`), name, expression, unit: 'length', ...extra };
}

function docOf(parameters: Parameter[], units: 'mm' | 'cm' = 'mm'): ExtrudoDocument {
  const doc = { ...createDocument({ now: '2026-09-25T10:00:00.000Z' }), parameters };
  doc.settings.units = units;
  return doc;
}

function ctxOf(doc: ExtrudoDocument): ExprContext {
  const evaluation = evaluateParameters(doc);
  return { evaluation, lengthUnit: doc.settings.units, names: scadNames(evaluation) };
}

const wallInGroup = (group: string) =>
  param('wall', '3 mm', { group, customizer: { min: '1 mm', max: '9 mm' } });
const blockOf = (doc: ExtrudoDocument, use: ParameterUse) => parameterBlock(doc, ctxOf(doc), use);

describe('parameterBlock', () => {
  it('writes the example of the decision', () => {
    const doc = docOf([
      param('width', '40 mm', {
        comment: 'Outer width',
        customizer: { min: '10 mm', max: '100 mm', step: '1 mm' },
      }),
      param('height', '25 mm', { group: 'Size', customizer: { min: '5 mm', max: '50 mm' } }),
      param('wall', 'width / 10'),
    ]);
    const block = blockOf(doc, { used: ['wall', 'height'] });
    expect(block.code).toBe(
      `// Outer width
width = 40; // [10:1:100]

/* [Size] */
height = 25; // [5:50]

/* [Hidden] */
wall = width / 10;
`,
    );
    expect(block.written).toEqual(['width', 'height', 'wall']);
  });

  it('writes a parameter after everything it refers to', () => {
    const doc = docOf([param('a', 'b * 2'), param('b', '2 mm')]);
    expect(blockOf(doc, { used: ['a'] }).code).toBe(
      `/* [Hidden] */
b = 2;
a = b * 2;
`,
    );
  });

  it('closes over the references of a written expression', () => {
    const doc = docOf([param('a', 'b * 2'), param('b', '2 mm'), param('c', '5 mm')]);
    const block = blockOf(doc, { used: ['a'] });
    expect(block.written).toEqual(['b', 'a']);
    expect(block.code).not.toContain('c');
  });

  it('says on the description line what the file holds fixed', () => {
    const doc = docOf([param('width', '40 mm', { comment: 'Outer width' })]);
    const block = blockOf(doc, {
      used: ['width'],
      fixed: new Map([['width', ['Sketch1', 'Fillet2']]]),
    });
    expect(block.code).toBe(
      `/* [Hidden] */
// Outer width. Also sets Sketch1 and Fillet2, which this file holds fixed.
width = 40;
`,
    );
  });

  it('keeps a feature name with a line break inside the description comment', () => {
    const doc = docOf([param('width', '40 mm', { comment: 'Outer\nwidth' })]);
    const block = blockOf(doc, {
      used: ['width'],
      fixed: new Map([['width', ['S\ninclude <x.scad>\n//', 'Fillet2']]]),
    });
    expect(block.code).toBe(
      `/* [Hidden] */
// Outer width. Also sets S include <x.scad> // and Fillet2, which this file holds fixed.
width = 40;
`,
    );
  });

  it('breaks up a comment end and brackets in a group header', () => {
    const doc = docOf([wallInGroup('*/include<x.scad>/* [a]')]);
    expect(blockOf(doc, { used: ['wall'] }).code).toBe(
      '/* [* /include<x.scad>/* (a)] */\nwall = 3; // [1:9]\n',
    );
  });

  it('puts a parameter whose group is only spaces with the ungrouped ones', () => {
    const doc = docOf([wallInGroup('   ')]);
    expect(blockOf(doc, { used: ['wall'] }).code).toBe('wall = 3; // [1:9]\n');
  });

  it('writes the value of an expression that does not translate', () => {
    // The evaluation knows `b`, but the context's names map does not, so
    // `b * 2` can't become code; its value is written instead, and nothing
    // pulls `b` in.
    const doc = docOf([param('a', 'b * 2'), param('b', '1 mm')]);
    const evaluation = evaluateParameters(doc);
    const names = scadNames(evaluation);
    names.delete('b');
    expect(parameterBlock(doc, { evaluation, lengthUnit: 'mm', names }, { used: ['a'] }).code).toBe(
      `/* [Hidden] */
a = 2;
`,
    );
  });

  it('writes an erroring parameter with its message', () => {
    const doc = docOf([param('broken', '1 +'), param('ok', '1 mm')]);
    expect(blockOf(doc, { used: ['broken', 'ok'] }).code).toBe(
      `/* [Hidden] */
broken = undef; // Expected a value after \`+\`.
ok = 1;
`,
    );
  });

  it('takes the variable names from the context', () => {
    const doc = docOf([param('cube', '1 mm'), param('cube_', '2 mm')]);
    const block = blockOf(doc, { used: ['cube', 'cube_'] });
    expect(block.code).toBe(
      `/* [Hidden] */
cube__ = 1;
cube_ = 2;
`,
    );
  });

  it('writes a range given as an expression of another parameter, evaluated', () => {
    const doc = docOf([
      param('width', '40 mm'),
      param('height', '25 mm', { customizer: { min: '5 mm', max: '2 * width' } }),
    ]);
    expect(blockOf(doc, { used: ['height'] }).code).toBe('height = 25; // [5:80]\n');
  });

  it('writes no range comment when the min is above the max', () => {
    const doc = docOf([
      param('height', '25 mm', { customizer: { min: '50 mm', max: '5 mm', step: '1 mm' } }),
    ]);
    expect(blockOf(doc, { used: ['height'] }).code).toBe('height = 25;\n');
  });

  it('opens no section for a group on a parameter without a customizer', () => {
    const doc = docOf([param('wall', '3 mm', { group: 'Size' })]);
    expect(blockOf(doc, { used: ['wall'] }).code).toBe('/* [Hidden] */\nwall = 3;\n');
  });

  it('leaves the block empty when nothing is written', () => {
    const doc = docOf([param('width', '40 mm')]);
    expect(blockOf(doc, { used: [] })).toEqual({ code: '', written: [] });
  });

  describe('with the real OpenSCAD compiler', { timeout: 120_000 }, () => {
    it('reads a cleaned group header as one group', async () => {
      const doc = docOf([wallInGroup('*/include<x.scad>/* [a]')]);
      const block = parameterBlock(doc, ctxOf(doc), { used: ['wall'] });
      const source = new TextEncoder().encode(`${block.code}cube(wall);\n`);
      const listed = await compiler.parameters({ fileName: 'block.scad', source });
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.parameters.map((p) => [p.name, p.group])).toEqual([
        ['wall', '* /include<x.scad>/* (a)'],
      ]);
    });

    it('lists the customizer parameters of the example', async () => {
      const doc = docOf([
        param('width', '40 mm', {
          comment: 'Outer width',
          customizer: { min: '10 mm', max: '100 mm', step: '1 mm' },
        }),
        param('height', '25 mm', { group: 'Size', customizer: { min: '5 mm', max: '50 mm' } }),
        param('wall', 'width / 10'),
      ]);
      const ctx = ctxOf(doc);
      const block = parameterBlock(doc, ctx, { used: ['wall', 'height'] });
      const source = new TextEncoder().encode(`${block.code}cube([width, height, wall]);\n`);
      const listed = await compiler.parameters({ fileName: 'block.scad', source });
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      // As OpenSCAD reports them: the ungrouped customizer parameter in its
      // default group, a min:max range with step 1, and `wall` absent —
      // a Hidden parameter is not a Customizer parameter.
      expect(
        listed.parameters.map((p) => [p.name, p.initial, p.min, p.max, p.step, p.group]),
      ).toEqual([
        ['width', 40, 10, 100, 1, 'Parameters'],
        ['height', 25, 5, 50, 1, 'Size'],
      ]);
    });
  });
});
