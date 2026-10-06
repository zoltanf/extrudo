/**
 * A parametric shelf of N compartments (P5-02, ADR-0070 §4): a Script feature
 * that makes a bottom board, `compartments + 1` uprights on it and a top board
 * on them, all joined into one body (each join needs something to touch, so
 * the order matters: a top board made first would be a body of its own, which
 * the script's status says as a warning). Change `compartments` and the shelf gets more
 * uprights, evenly spaced; change `width` and they spread out.
 * `packages/cli/src/scripts.test.ts` runs this file through the script runner
 * and recomputes it with the kernel.
 *
 * ```ts
 * import { shelf } from './script-shelf.ts';
 *
 * const d = shelf();
 * d.setParameter('compartments', 5);
 * ```
 */
import { Design } from '@extrudo/api';

/** The script's source: two boards and the uprights between them. */
export const SHELF = `
const { width, depth, height, board, compartments } = params;
// The bottom board, centred on the origin like every box.
design.box({ length: width, width: depth, height: board });
// The uprights, joined to it: one at each end and one between each two
// compartments.
const step = (width - board) / compartments;
for (let i = 0; i <= compartments; i++) {
  design.box({
    length: board,
    width: depth,
    height: height - 2 * board,
    x: -width / 2 + board / 2 + i * step,
    offset: board,
    operation: 'join',
  });
}
// The top board last: it only touches the body once the uprights stand.
design.box({ length: width, width: depth, height: board, offset: height - board, operation: 'join' });
`;

export function shelf(): Design {
  const d = Design.create({ name: 'Shelf', units: 'mm' });
  d.parameter('compartments', '3', { comment: 'How many compartments side by side' });
  d.parameter('width', '600 mm');
  d.parameter('depth', '250 mm');
  d.parameter('height', '300 mm');
  d.parameter('board', '18 mm', { comment: "The boards' thickness" });
  d.script({ code: SHELF }, { name: 'Shelf' });
  return d;
}
