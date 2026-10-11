// Components and joints in the API (P6-05 S8, ADR-0081 §9): `d.component`,
// the build overload, the `component` option on a feature, `d.joint`, and the
// deterministic IDs. The lid-box fixture the CLI tests read is written here
// with `WRITE_FIXTURES=1`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError, Design } from './index';

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const FIXED = { now: '2026-10-10T00:00:00.000Z' };
const env =
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const d = () => Design.create({ name: 'Test', ...FIXED });

describe('components', () => {
  it('makes a component and puts bodies in it', () => {
    const design = d();
    const box = design.box();
    const lid = design.component('Lid', { bodies: [box.body()] });
    expect(lid.id).toBe('cmp1');
    expect(lid.name).toBe('Lid');
    expect(lid.bodies()).toEqual(['f1']);
    expect(design.doc.components).toEqual([{ id: 'cmp1', name: 'Lid', visible: true }]);
    expect(Object.values(design.doc.bodies)[0]?.component).toBe('cmp1');
  });

  it('adds bodies with the handle and reads stored members', () => {
    const design = d();
    const lid = design.component('Lid');
    const box = design.box();
    lid.add(box.body());
    expect(lid.bodies()).toEqual(['f1']);
    lid.add(box.body());
    expect(lid.bodies()).toEqual(['f1']);
  });

  it('stamps every feature added inside a build callback', () => {
    const design = d();
    const lid = design.component('Lid', (c) => {
      const box = design.box();
      design.cylinder();
      expect(box.feature?.component).toBe(c.id);
    });
    expect(lid.id).toBe('cmp1');
    expect(design.doc.features.every((f) => f.component === 'cmp1')).toBe(true);
    // A sketch is stamped too.
    design.component('Plate', (c) => {
      design.sketch(design.origin.xy, (k) => k.rectangle([0, 0], [10, 10]));
      expect(design.doc.features.at(-1)?.component).toBe(c.id);
    });
  });

  it('lets the innermost build win, and a call option override it', () => {
    const design = d();
    design.component('Outer', (outer) => {
      design.box();
      design.component('Inner', (inner) => {
        design.cylinder();
        expect(design.doc.features.at(-1)?.component).toBe(inner.id);
      });
      expect(outer.id).toBe('cmp1');
      // The outer build is back in charge after the nested one.
      design.box();
      expect(design.doc.features.at(-1)?.component).toBe(outer.id);
    });
    const other = design.component('Other');
    design.box({}, { component: other });
    expect(design.doc.features.at(-1)?.component).toBe(other.id);
  });

  it('refuses an unknown component option and changes nothing', () => {
    const design = d();
    const before = design.toJSON();
    expect(() => design.box({}, { component: 'Nope' })).toThrow(ApiError);
    expect(design.toJSON()).toEqual(before);
  });

  it('gives the same JSON for the same calls (deterministic IDs)', () => {
    const build = () => {
      const design = Design.create({ name: 'Test', now: FIXED.now });
      design.component('Lid');
      design.component('Box');
      return design.toJSON();
    };
    expect(build()).toEqual(build());
  });

  it('lists the components in browser order', () => {
    const design = d();
    design.component('Lid');
    design.component('Box');
    expect(design.components().map((c) => c.name)).toEqual(['Lid', 'Box']);
  });
});

describe('joints', () => {
  const twoComponents = () => {
    const design = d();
    const base = design.component('Base');
    const leaf = design.component('Leaf');
    const baseBox = design.box({}, { component: base });
    const leafBox = design.box({}, { component: leaf });
    return { design, base, leaf, baseBox, leafBox };
  };

  it('stores a joint and reads it back', () => {
    const { design, base, leaf, baseBox, leafBox } = twoComponents();
    const hinge = design.joint('Hinge', {
      type: 'revolute',
      a: { component: leaf, frame: leafBox.face('side:front') },
      b: { component: base, frame: baseBox.face('side:front') },
      min: '0 deg',
      max: '180 deg',
    });
    expect(hinge.id).toBe('jnt1');
    expect(hinge.name).toBe('Hinge');
    expect(design.doc.joints?.[0]).toMatchObject({
      id: 'jnt1',
      name: 'Hinge',
      type: 'revolute',
      a: { component: 'cmp2' },
      b: { component: 'cmp1' },
      min: { kind: 'expr', expr: '0 deg', unit: 'angle' },
      max: { kind: 'expr', expr: '180 deg', unit: 'angle' },
    });
    expect(design.joints().map((j) => j.name)).toEqual(['Hinge']);
  });

  it('refuses a frame kind the type does not take', () => {
    const { design, base, leaf, baseBox, leafBox } = twoComponents();
    const before = design.toJSON();
    expect(() =>
      design.joint('Bad', {
        type: 'revolute',
        a: { component: leaf, frame: leafBox.body() },
        b: { component: base, frame: baseBox.face('side:front') },
      }),
    ).toThrow(ApiError);
    expect(design.toJSON()).toEqual(before);
  });

  it('refuses both sides in the same component', () => {
    const { design, leaf, leafBox } = twoComponents();
    expect(() =>
      design.joint('Bad', {
        type: 'rigid',
        a: { component: leaf, frame: leafBox.body() },
        b: { component: leaf, frame: leafBox.body() },
      }),
    ).toThrow(ApiError);
    expect(design.doc.joints).toBeUndefined();
  });
});

/**
 * The lid-box fixture (`fixtures/components/lid-box.extrudo`): a Box component
 * and a Lid component whose box is split in two, so the second half is a
 * **piece** of the lid and its component follows the origin (ADR-0081 §2).
 * `fuzz.test.ts` edits it, and the CLI's component tests read it.
 */
export function lidBoxDesign(): Design {
  const design = Design.create({ name: 'Lid box', ...FIXED });
  const box = design.component('Box');
  design.box(
    { length: '60 mm', width: '40 mm', height: '20 mm' },
    { name: 'Base', component: box },
  );
  const lid = design.component('Lid');
  const lidBox = design.box(
    { length: '60 mm', width: '40 mm', height: '5 mm', offset: '20 mm' },
    { name: 'Lid', component: lid },
  );
  design.splitBody({
    bodies: [design.ref('body', `${lidBox.id}:0`)],
    plane: design.origin.yz,
  });
  return design;
}

describe('the lid-box fixture', () => {
  it('writes it with WRITE_FIXTURES=1', async () => {
    const design = lidBoxDesign();
    expect(design.validate()).toEqual([]);
    if (env.WRITE_FIXTURES === '1') {
      writeFileSync(join(ROOT, 'fixtures/components/lid-box.extrudo'), await design.toFile());
    }
    // Always read it back as a schema check.
    const bytes = readFileSync(join(ROOT, 'fixtures/components/lid-box.extrudo'));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('keeps the piece in the lid through the origins rule', () => {
    const doc = lidBoxDesign().doc;
    expect(doc.components?.map((c) => c.name)).toEqual(['Box', 'Lid']);
    // The lid box is stamped with the Lid component (the piece follows it through
    // the kernel's origins at recompute, which the CLI test checks).
    const split = doc.features.find((f) => f.type === 'splitBody');
    expect(split).toBeDefined();
    const lidBox = doc.features.find((f) => f.name === 'Lid');
    expect(lidBox?.component).toBe('cmp2');
  });
});
