import {
  type FeatureId,
  SimplifyForPrintInputsSchema,
  type SimplifyGroup,
  type SimplifyReport,
  simplifyForPrintFeatureOf,
  simplifyKinds,
} from '@extrudo/core';
import type { Preview } from '@extrudo/kernel';
import { describe, expect, it } from 'vitest';
import { featureDialogs, specForCommand } from './registry';
import { simplifyBadge, simplifyForPrintDialog, simplifyNotes } from './simplify-for-print';
import type { ExpressionField } from './spec';
import { BOX, settle, setupDialogs } from './testing';
import { valuesFor } from './values';

const group = (kind: SimplifyGroup['kind'], size: number, removed = true): SimplifyGroup => ({
  kind,
  body: BOX,
  size,
  faces: kind === 'round' ? 1 : 2,
  removed,
});

const field = (name: string) =>
  simplifyForPrintDialog.fields.find((f) => f.name === name) as ExpressionField;

function started() {
  const t = setupDialogs([simplifyForPrintDialog]);
  t.session.getState().select([{ kind: 'body', id: BOX }]);
  t.controller.start('simplifyForPrint');
  return t;
}

describe('the simplify for print dialog (ADR-0141)', () => {
  it('is the app’s dialog for the tool: a card per kind, every limit on by default', () => {
    expect(specForCommand(featureDialogs(), 'simplifyForPrint')?.type).toBe('simplifyForPrint');
    expect(simplifyForPrintDialog.fields.map((f) => f.kind)).toEqual([
      'selection',
      'expression',
      'expression',
      'expression',
    ]);
    const t = started();
    const inputs = t.open()?.draft.inputs ?? {};
    expect(SimplifyForPrintInputsSchema.safeParse(inputs).success).toBe(true);
    expect(Object.keys(inputs).sort()).toEqual([
      'bodies',
      'maxChamferSize',
      'maxHoleDiameter',
      'maxRoundRadius',
    ]);
    expect(simplifyKinds(inputs as never)).toEqual({ rounds: true, chamfers: true, holes: true });
    expect(t.controller.ok()).toBe(true);
    expect(t.store.getState().doc.features.at(-1)?.name).toBe('Simplify for Print1');
  });

  it('Keep (an empty limit) makes no input; all three kept is an issue', () => {
    const t = started();
    t.controller.setExpr('maxHoleDiameter', '');
    const inputs = t.open()?.draft.inputs ?? {};
    expect(inputs.maxHoleDiameter).toBeUndefined();
    expect(simplifyKinds(inputs as never)).toEqual({ rounds: true, chamfers: true, holes: false });
    expect(t.open()?.checked.first).toBeUndefined();
    t.controller.setExpr('maxRoundRadius', '');
    t.controller.setExpr('maxChamferSize', '');
    expect(t.open()?.checked.first?.message).toBe(
      'Everything is kept: move a slider off Keep, or type a limit.',
    );
    expect(t.controller.ok()).toBe(false);
  });

  it('reads a stored feature back: no limit, or a toggle turned off, is Keep', () => {
    const t = started();
    const ctx = t.controller.context();
    if (!ctx) throw new Error('no dialog');
    const built = simplifyForPrintFeatureOf('f9' as FeatureId, 'Simplify for Print1', [BOX], {
      maxRoundRadius: '2 mm',
      maxChamferSize: '1 mm',
    });
    // An older file's chamfers toggle, off with its limit kept.
    const feature = {
      ...built,
      inputs: { ...built.inputs, chamfers: { kind: 'bool' as const, value: false } },
    };
    const values = valuesFor(simplifyForPrintDialog, feature, ctx);
    expect(values.exprs).toMatchObject({
      maxRoundRadius: '2 mm',
      maxChamferSize: '',
      maxHoleDiameter: '',
    });
  });

  it("each card's slider stops at the sizes found, its badge counts, its note says what goes", async () => {
    const t = started();
    const report: SimplifyReport = {
      groups: [group('round', 0.5), group('round', 1, false), group('hole', 3), group('hole', 2.5)],
      sizes: { round: [0.5, 1, 4], chamfer: [], hole: [2.5, 3] },
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
    expect(field('maxRoundRadius').stops?.(open.values, ctx)).toEqual([0.5, 1, 4]);
    expect(field('maxChamferSize').stops?.(open.values, ctx)).toEqual([]);
    const card = field('maxRoundRadius').card;
    expect(card?.badge?.(open.values, ctx)).toEqual({ text: '1 go', tone: 'accent' });
    // The 1 mm default: 0.5 and 1 go (one of them couldn't be removed), 4 stays.
    expect(card?.notes?.(open.values, ctx)).toEqual([
      { text: 'R0.5, R1 mm go · R4 mm stays' },
      { text: "Round R1 mm, 1 face: couldn't be removed", tone: 'warning' },
    ]);
    expect(field('maxChamferSize').card?.none).toBe('None on these bodies');
  });

  it('words the badge and the notes', () => {
    const report: SimplifyReport = {
      groups: [group('hole', 2), ...Array.from({ length: 5 }, () => group('hole', 3, false))],
      sizes: { round: [], chamfer: [0.5, 1, 1.5, 2], hole: [2, 3, 6] },
    };
    expect(simplifyBadge(report, 'hole', true)).toEqual({ text: 'Keep', tone: 'muted' });
    expect(simplifyBadge(report, 'chamfer', false)).toEqual({ text: '0 go', tone: 'muted' });
    expect(simplifyBadge(undefined, 'hole', false)).toBeUndefined();
    expect(simplifyNotes(report, 'chamfer', undefined)).toEqual([
      { text: '4 sizes 0.5–2 mm stay' },
    ]);
    expect(simplifyNotes(report, 'chamfer', 5)).toEqual([{ text: '4 sizes 0.5–2 mm go' }]);
    const holes = simplifyNotes(report, 'hole', 3);
    expect(holes[0]).toEqual({ text: 'Ø2, Ø3 mm go · Ø6 mm stays' });
    expect(holes.slice(1).map((n) => n.text)).toEqual([
      "Hole Ø3 mm, 2 faces: couldn't be removed",
      "Hole Ø3 mm, 2 faces: couldn't be removed",
      "Hole Ø3 mm, 2 faces: couldn't be removed",
      "and 2 more couldn't be removed",
    ]);
  });
});
