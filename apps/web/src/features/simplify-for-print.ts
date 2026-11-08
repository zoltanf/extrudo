/**
 * The Simplify for Print dialog (ADR-0141, #79): bodies, and a limit each
 * for rounds, chamfers and holes ("Remove up to"), each with its own toggle
 * and a slider that stops at the sizes found on the bodies. The live
 * preview draws the faces that go in red (the kernel's preview tool); the
 * Found line counts them ("12 rounds, 3 holes") and its lines say, per
 * round, chamfer or hole, whether it was removed. Fields are named like the feature's
 * inputs, so the framework's default mapping turns them into inputs and
 * back; a limit whose toggle is off is hidden and makes no input.
 */
import {
  type SimplifyReport,
  simplifyForPrintFeature,
  simplifyGroupLine,
  simplifySummary,
} from '@extrudo/core';
import { type DialogContext, defineFeatureDialog } from './spec';

/** Lines of the per-group list shown at most; the rest are counted. */
const LIST_LINES = 8;

/** The list under the count: what stayed first (it is what to act on), then what went. */
export function simplifyLines(report: Pick<SimplifyReport, 'groups'>): string[] {
  const ordered = [
    ...report.groups.filter((g) => !g.removed),
    ...report.groups.filter((g) => g.removed),
  ];
  const lines = ordered.slice(0, LIST_LINES).map(simplifyGroupLine);
  const more = ordered.length - lines.length;
  if (more > 0) lines.push(`and ${more} more`);
  return lines;
}

const reportOf = (ctx: DialogContext | undefined) => ctx?.draftSimplify;

export const simplifyForPrintDialog = defineFeatureDialog({
  ...simplifyForPrintFeature,
  command: 'simplifyForPrint',
  fields: [
    {
      kind: 'selection',
      name: 'bodies',
      label: 'Bodies',
      accepts: ['body'],
      prompt: 'Pick bodies',
      hint: 'Solid bodies; an imported mesh needs Mesh to Solid first.',
    },
    {
      kind: 'toggle',
      name: 'rounds',
      label: 'Rounds',
      default: true,
      hint: 'Remove fillets and other rounds: curved faces that blend smoothly into their neighbours.',
    },
    {
      kind: 'expression',
      name: 'maxRoundRadius',
      label: 'Remove up to',
      inputName: 'Round radius',
      unit: 'length',
      default: '1 mm',
      hint: 'Rounds up to this radius go; larger ones stay. The slider stops at each radius on the bodies.',
      shown: (values) => values.toggles.rounds ?? true,
      stops: (_values, ctx) => reportOf(ctx)?.sizes.round,
    },
    {
      kind: 'toggle',
      name: 'chamfers',
      label: 'Chamfers',
      default: true,
      hint: 'Remove chamfers: narrow flat or conical bevels between two faces that meet at an angle.',
    },
    {
      kind: 'expression',
      name: 'maxChamferSize',
      label: 'Remove up to',
      inputName: 'Chamfer size',
      unit: 'length',
      default: '1 mm',
      hint: 'Chamfers that cut back up to this far into either face go; larger ones stay. The slider stops at each size on the bodies.',
      shown: (values) => values.toggles.chamfers ?? true,
      stops: (_values, ctx) => reportOf(ctx)?.sizes.chamfer,
    },
    {
      kind: 'toggle',
      name: 'holes',
      label: 'Holes',
      default: true,
      hint: 'Remove holes: closed cylindrical walls with their floor, counterbore, countersink and rounded edge.',
    },
    {
      kind: 'expression',
      name: 'maxHoleDiameter',
      label: 'Remove up to',
      inputName: 'Hole diameter',
      unit: 'length',
      default: '3 mm',
      hint: 'Holes up to this diameter go (a counterbored hole by its widest part); larger ones stay. The slider stops at each diameter on the bodies.',
      shown: (values) => values.toggles.holes ?? true,
      stops: (_values, ctx) => reportOf(ctx)?.sizes.hole,
    },
    {
      kind: 'info',
      name: 'found',
      label: 'Found',
      hint: 'What goes, drawn red in the view. One whose neighbours cannot be extended to meet stays, and is listed below.',
      shown: (_values, ctx) => reportOf(ctx) !== undefined,
      text: (_values, ctx) => {
        const report = reportOf(ctx);
        return report ? simplifySummary(report) : '';
      },
      lines: (_values, ctx) => {
        const report = reportOf(ctx);
        return report ? simplifyLines(report) : [];
      },
    },
  ],
});
