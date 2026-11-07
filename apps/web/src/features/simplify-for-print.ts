/**
 * The Simplify for Print dialog (ADR-0141, #79): bodies, and a limit for
 * rounds and one for holes, each with its own toggle. The live preview
 * draws the faces that go in red (the kernel's preview tool); the Found line
 * counts them ("12 rounds, 3 holes") and its lines say, per round or
 * hole, whether it was removed. Fields are named like the feature's
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
export function simplifyLines(report: SimplifyReport): string[] {
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
      label: 'Max radius',
      unit: 'length',
      default: '1 mm',
      hint: 'Rounds up to this radius go; larger ones stay.',
      shown: (values) => values.toggles.rounds ?? true,
    },
    {
      kind: 'toggle',
      name: 'holes',
      label: 'Holes',
      default: true,
      hint: 'Remove holes: closed cylindrical walls and their floor, counterbore or countersink.',
    },
    {
      kind: 'expression',
      name: 'maxHoleDiameter',
      label: 'Max diameter',
      unit: 'length',
      default: '3 mm',
      hint: 'Holes up to this diameter go (a counterbored hole by its widest part); larger ones stay.',
      shown: (values) => values.toggles.holes ?? true,
    },
    {
      kind: 'info',
      name: 'found',
      label: 'Found',
      hint: 'What goes, drawn red in the view. A round or hole whose neighbours cannot be extended to meet stays, and is listed below.',
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
