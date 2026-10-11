import { chamferInputs, filletInputs, SKIP_LOST_EDGES_KEY } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { chamferDialog } from './chamfer';
import { filletDialog } from './fillet';
import type { DialogContext } from './spec';
import { defaultValues, inputsFor, mergeValues, shownFields, valuesFor } from './values';

const ctx = {} as DialogContext;

const edge = { kind: 'edge' as const, id: 'box:e1' };

describe('the Skip lost edges toggle (ADR-0038/0043 amendments)', () => {
  for (const [name, spec, stored] of [
    ['fillet', filletDialog, filletInputs([{ edges: [edge], radius: '1 mm' }])],
    ['chamfer', chamferDialog, chamferInputs([{ edges: [edge], distance: '1 mm' }])],
  ] as const) {
    it(`is the ${name} dialog's last field and stored only while on`, () => {
      const values = mergeValues(defaultValues(spec), { refs: { edges: [edge] } });
      expect(shownFields(spec, values).at(-1)?.name).toBe(SKIP_LOST_EDGES_KEY);
      expect(inputsFor(spec, values, ctx)).not.toHaveProperty(SKIP_LOST_EDGES_KEY);
      const on = mergeValues(values, { toggles: { [SKIP_LOST_EDGES_KEY]: true } });
      expect(inputsFor(spec, on, ctx)[SKIP_LOST_EDGES_KEY]).toEqual({ kind: 'bool', value: true });
    });

    it(`reads a stored ${name}'s toggle back`, () => {
      const feature = (inputs: typeof stored) =>
        ({ id: 'F', type: name, name: 'F1', suppressed: false, inputs }) as never;
      expect(valuesFor(spec, feature(stored), ctx).toggles[SKIP_LOST_EDGES_KEY]).toBe(false);
      const on = { ...stored, [SKIP_LOST_EDGES_KEY]: { kind: 'bool' as const, value: true } };
      expect(valuesFor(spec, feature(on), ctx).toggles[SKIP_LOST_EDGES_KEY]).toBe(true);
    });
  }
});
