/**
 * The Simplify for Print dialog (ADR-0141, #79): bodies, then a card per kind
 * (rounds, chamfers, holes). Each card's slider starts at **Keep** and stops
 * at every size of its kind found on the bodies, with the limit's field
 * beside it; its badge says how many go, and its note which sizes go and
 * which stay, and what couldn't be removed. Keep is an empty limit: it makes
 * no input, so that kind stays (the feature's toggles are only read back from
 * older files). The live preview draws the faces that go in red (the
 * kernel's preview tool).
 */
import {
  type SimplifyGroup,
  type SimplifyReport,
  simplifyForPrintFeature,
  simplifyGroupLine,
} from '@extrudo/core';
import { CircleDot, Octagon, SquareRoundCorner } from 'lucide-react';
import {
  type CardNote,
  type DialogContext,
  type DialogValues,
  defineFeatureDialog,
  type ExpressionField,
} from './spec';
import { defaultFromInputs } from './values';

type Kind = SimplifyGroup['kind'];

/** An empty limit: the kind stays. */
const KEEP = 'Keep';

/** Each kind's limit input, the toggle older files may have, and how its sizes read. */
const KINDS = {
  round: { limit: 'maxRoundRadius', toggle: 'rounds', prefix: 'R' },
  chamfer: { limit: 'maxChamferSize', toggle: 'chamfers', prefix: '' },
  hole: { limit: 'maxHoleDiameter', toggle: 'holes', prefix: 'Ø' },
} as const;

/** Notes at most for what couldn't be removed; the rest are counted. */
const FAILED_LINES = 3;

const reportOf = (ctx: DialogContext | undefined) => ctx?.draftSimplify;

const kept = (values: Pick<DialogValues, 'exprs'>, kind: Kind) =>
  (values.exprs[KINDS[kind].limit] ?? '').trim() === '';

/** "R0.5, R1 mm"; more than three: "6 sizes R0.5–R3 mm". */
function sizeList(kind: Kind, sizes: readonly number[]): string {
  const { prefix } = KINDS[kind];
  const one = (size: number) => `${prefix}${Number(size.toFixed(3))}`;
  if (sizes.length <= 3) return `${sizes.map(one).join(', ')} mm`;
  return `${sizes.length} sizes ${one(sizes[0] as number)}–${one(sizes.at(-1) as number)} mm`;
}

/** The pill: "Keep" while kept, else how many of the kind go. */
export function simplifyBadge(
  report: SimplifyReport | undefined,
  kind: Kind,
  isKept: boolean,
): CardNote | undefined {
  if (isKept) return { text: KEEP, tone: 'muted' };
  if (!report) return undefined;
  const removed = report.groups.filter((g) => g.kind === kind && g.removed).length;
  return { text: `${removed} go`, tone: removed > 0 ? 'accent' : 'muted' };
}

/**
 * The notes: which sizes found go under `limit` and which stay ("R1.2 mm goes
 * · R3.6 mm stays"; no limit: all stay), then each one that couldn't be
 * removed, at most three and a count.
 */
export function simplifyNotes(
  report: SimplifyReport | undefined,
  kind: Kind,
  limit: number | undefined,
): CardNote[] {
  if (!report) return [];
  const sizes = report.sizes[kind];
  const goes = limit === undefined ? [] : sizes.filter((size) => size <= limit + 1e-6);
  const stays = sizes.filter((size) => !goes.includes(size));
  const parts: string[] = [];
  if (goes.length > 0) parts.push(`${sizeList(kind, goes)} ${goes.length === 1 ? 'goes' : 'go'}`);
  if (stays.length > 0) {
    parts.push(`${sizeList(kind, stays)} ${stays.length === 1 ? 'stays' : 'stay'}`);
  }
  const notes: CardNote[] = parts.length > 0 ? [{ text: parts.join(' · ') }] : [];
  const failed = report.groups.filter((g) => g.kind === kind && !g.removed);
  for (const group of failed.slice(0, FAILED_LINES)) {
    notes.push({ text: simplifyGroupLine(group), tone: 'warning' });
  }
  if (failed.length > FAILED_LINES) {
    notes.push({
      text: `and ${failed.length - FAILED_LINES} more couldn't be removed`,
      tone: 'warning',
    });
  }
  return notes;
}

function kindField(
  kind: Kind,
  options: Pick<ExpressionField, 'label' | 'inputName' | 'default' | 'hint'> & {
    icon: NonNullable<ExpressionField['card']>['icon'];
  },
): ExpressionField {
  const { icon, ...rest } = options;
  return {
    kind: 'expression',
    name: KINDS[kind].limit,
    unit: 'length',
    empty: KEEP,
    ...rest,
    stops: (_values, ctx) => reportOf(ctx)?.sizes[kind],
    card: {
      icon,
      none: 'None on these bodies',
      badge: (values, ctx) => simplifyBadge(reportOf(ctx), kind, kept(values, kind)),
      notes: (values, ctx) =>
        simplifyNotes(
          reportOf(ctx),
          kind,
          kept(values, kind) ? undefined : ctx.value(KINDS[kind].limit),
        ),
    },
  };
}

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
    kindField('round', {
      label: 'Rounds',
      inputName: 'Round radius',
      default: '1 mm',
      icon: SquareRoundCorner,
      hint: 'Fillets and other rounds: curved faces that blend smoothly into their neighbours. Rounds up to this radius go; Keep keeps them all.',
    }),
    kindField('chamfer', {
      label: 'Chamfers',
      inputName: 'Chamfer size',
      default: '1 mm',
      icon: Octagon,
      hint: 'Narrow flat or conical bevels between two faces that meet at an angle. Chamfers that cut back up to this far into either face go; Keep keeps them all.',
    }),
    kindField('hole', {
      label: 'Holes',
      inputName: 'Hole diameter',
      default: '3 mm',
      icon: CircleDot,
      hint: 'Closed cylindrical walls with their floor, counterbore, countersink and rounded edge. Holes up to this diameter go (a counterbored one by its widest part); Keep keeps them all.',
    }),
  ],
  // A kind an older file turned off with its toggle reads as Keep.
  fromInputs: (inputs) => {
    const values = defaultFromInputs(simplifyForPrintDialog, inputs);
    for (const { limit, toggle } of Object.values(KINDS)) {
      const input = inputs[toggle];
      if (input?.kind === 'bool' && !input.value) values.exprs = { ...values.exprs, [limit]: '' };
    }
    return values;
  },
  validate: (values) =>
    (Object.keys(KINDS) as Kind[]).every((kind) => kept(values, kind))
      ? { message: 'Everything is kept: move a slider off Keep, or type a limit.' }
      : undefined,
});
