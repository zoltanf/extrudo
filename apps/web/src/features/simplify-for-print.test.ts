import {
  type FeatureId,
  SimplifyForPrintInputsSchema,
  type SimplifyGroup,
  simplifyKinds,
  simplifySummary,
} from '@extrudo/core';
import type { Preview } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { featureDialogs, specForCommand } from './registry';
import { simplifyForPrintDialog, simplifyLines } from './simplify-for-print';
import type { InfoField } from './spec';
import { BOX, settle, setupDialogs } from './testing';
import { shownFields } from './values';

const group = (kind: 'round' | 'hole', size: number, removed = true): SimplifyGroup => ({
  kind,
  body: BOX,
  size,
  faces: kind === 'round' ? 1 : 2,
  removed,
});

function started() {
  const t = setupDialogs([simplifyForPrintDialog]);
  t.session.getState().select([{ kind: 'body', id: BOX }]);
  t.controller.start('simplifyForPrint');
  return t;
}

describe('the simplify for print dialog (ADR-0141)', () => {
  const found = simplifyForPrintDialog.fields.find((f) => f.name === 'found') as InfoField;

  it('is the app’s dialog for the tool, with both limits on by default', () => {
    expect(specForCommand(featureDialogs(), 'simplifyForPrint')?.type).toBe('simplifyForPrint');
    const t = started();
    const inputs = t.open()?.draft.inputs ?? {};
    expect(SimplifyForPrintInputsSchema.safeParse(inputs).success).toBe(true);
    expect(Object.keys(inputs).sort()).toEqual([
      'bodies',
      'holes',
      'maxHoleDiameter',
      'maxRoundRadius',
      'rounds',
    ]);
    expect(simplifyKinds(inputs as never)).toEqual({ rounds: true, holes: true });
    expect(t.controller.ok()).toBe(true);
    expect(t.store.getState().doc.features.at(-1)?.name).toBe('Simplify for Print1');
  });

  it('a limit turned off is hidden and makes no input', () => {
    const t = started();
    t.controller.setToggle('holes', false);
    const open = t.open();
    const ctx = t.controller.context();
    if (!open || !ctx) throw new Error('no dialog');
    expect(shownFields(simplifyForPrintDialog, open.values, ctx).map((f) => f.name)).not.toContain(
      'maxHoleDiameter',
    );
    const inputs = open.draft.inputs;
    expect(inputs.maxHoleDiameter).toBeUndefined();
    expect(simplifyKinds(inputs as never)).toEqual({ rounds: true, holes: false });
  });

  it('counts what goes and lists each round or hole, what stayed first', async () => {
    const t = started();
    const report = {
      groups: [group('round', 0.5), group('round', 1, false), group('hole', 3), group('hole', 2.5)],
    };
    const preview: Preview = {
      features: { [t.open()?.id as FeatureId]: { status: 'warning' } },
      bodies: {},
      tools: [],
      simplify: report,
    };
    t.kernel.previews.at(-1)?.resolve(preview);
    await settle();
    const ctx = t.controller.context();
    const open = t.open();
    if (!open || !ctx) throw new Error('no dialog');
    expect(found.text(open.values, ctx)).toBe("1 round, 2 holes · 1 couldn't be removed");
    expect(found.lines?.(open.values, ctx)).toEqual([
      "Round R1 mm, 1 face: couldn't be removed",
      'Round R0.5 mm, 1 face: removed',
      'Hole Ø3 mm, 2 faces: removed',
      'Hole Ø2.5 mm, 2 faces: removed',
    ]);
  });

  it('words the count line and caps the list', () => {
    expect(simplifySummary({ groups: [] })).toBe('No rounds or holes under the limits');
    expect(simplifySummary({ groups: [group('round', 1), group('round', 1)] })).toBe(
      '2 rounds, 0 holes',
    );
    const many = { groups: Array.from({ length: 11 }, () => group('hole', 2)) };
    const lines = simplifyLines(many);
    expect(lines).toHaveLength(9);
    expect(lines.at(-1)).toBe('and 3 more');
  });
});
