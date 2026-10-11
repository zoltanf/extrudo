import { chamferInputs, filletInputs, SKIP_LOST_EDGES_KEY } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { chamferDialog } from './chamfer';
import { filletDialog } from './fillet';
import type { DialogContext } from './spec';
import { defaultValues, inputsFor, mergeValues, shownFields, valuesFor } from './values';

const ctx = {} as DialogContext;
const edge = { kind: 'edge' as const, id: 'box:e1' };
const ON = { kind: 'bool' as const, value: true };

describe('the Skip lost edges toggle (ADR-0038/0043 amendments)', () => {
  for (const [name, spec, stored] of [
    ['fillet', filletDialog, filletInputs([{ edges: [edge], radius: '1 mm' }])],
    ['chamfer', chamferDialog, chamferInputs([{ edges: [edge], distance: '1 mm' }])],
  ] as const) {
    const feature = (inputs: typeof stored) =>
      ({ id: 'F', type: name, name: 'F1', suppressed: false, inputs }) as never;
    const shown = (values: Parameters<typeof shownFields>[1]) =>
      shownFields(spec, values).map((f) => f.name);

    it(`is not in a new ${name} dialog, nor in one opened on a ${name} without it`, () => {
      const fresh = mergeValues(defaultValues(spec), { refs: { edges: [edge] } });
      expect(shown(fresh)).not.toContain(SKIP_LOST_EDGES_KEY);
      expect(inputsFor(spec, fresh, ctx)).not.toHaveProperty(SKIP_LOST_EDGES_KEY);
      const plain = valuesFor(spec, feature(stored), ctx);
      expect(shown(plain)).not.toContain(SKIP_LOST_EDGES_KEY);
      expect(inputsFor(spec, plain, ctx)).not.toHaveProperty(SKIP_LOST_EDGES_KEY);
    });

    it(`shows last and ticked on a ${name} that has it; unticked it stays and is dropped`, () => {
      const opened = valuesFor(spec, feature({ ...stored, [SKIP_LOST_EDGES_KEY]: ON }), ctx);
      expect(opened.toggles[SKIP_LOST_EDGES_KEY]).toBe(true);
      expect(shown(opened).at(-1)).toBe(SKIP_LOST_EDGES_KEY);
      expect(inputsFor(spec, opened, ctx)[SKIP_LOST_EDGES_KEY]).toEqual(ON);
      const off = mergeValues(opened, { toggles: { [SKIP_LOST_EDGES_KEY]: false } });
      expect(shown(off).at(-1)).toBe(SKIP_LOST_EDGES_KEY);
      expect(inputsFor(spec, off, ctx)).not.toHaveProperty(SKIP_LOST_EDGES_KEY);
      const back = mergeValues(off, { toggles: { [SKIP_LOST_EDGES_KEY]: true } });
      expect(inputsFor(spec, back, ctx)[SKIP_LOST_EDGES_KEY]).toEqual(ON);
      // The dialog's mark is no input.
      expect(Object.keys(inputsFor(spec, back, ctx))).not.toContain('skipLostEdgesShown');
    });
  }
});
