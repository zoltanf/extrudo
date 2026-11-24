/**
 * Test support (no production code): reports of a FreeCAD import that together reach every
 * branch of `fcstdNotices` and `parameterNotices` (P6-25 S13), for `fcstd-guide.test.ts`. Names
 * in them are `NAME1`, `NAME2` …, so a test can tell the file's text from the notice's own.
 */
import type { FcstdImportReport } from '@extrudo/fcstd';

type Report = Parameters<typeof import('./actions').fcstdNotices>[0];

const n = (i: number) => `NAME${i}`;
const names = (k: number, from = 1) => Array.from({ length: k }, (_, i) => n(from + i));

const empty = {
  shapes: [],
  leftOut: [],
  finalShapes: 1,
  problems: [],
  linkArrays: [],
} as unknown as Report;

const shapes = (k: number) => names(k).map((object) => ({ object, name: object }));
const body = (
  object: string,
  outcome: 'history' | 'shape' | 'left-out',
  more: Record<string, unknown> = {},
) => ({
  object,
  name: object,
  outcome,
  steps: [],
  mapped: [],
  sketches: [],
  bodies: [],
  ...more,
});
const step = (reason: string, after: number) => ({ reason, after });
const tree = (object: string, outcome: string, more: Record<string, unknown> = {}) => ({
  object,
  name: object,
  outcome,
  nodes: [],
  ...more,
});
const params = (
  p: { sheet?: number; set?: number; live?: number; numbers?: number; renames?: number } = {},
) => ({
  parameters: [
    ...Array.from({ length: p.sheet ?? 0 }, (_, i) => ({ source: 'sheet', object: `S${i % 2}` })),
    ...Array.from({ length: p.set ?? 0 }, (_, i) => ({
      source: 'variable-set',
      object: `V${i % 2}`,
    })),
  ],
  expressions: [
    ...Array.from({ length: p.live ?? 0 }, () => ({ outcome: 'kept' })),
    ...Array.from({ length: p.numbers ?? 0 }, () => ({ outcome: 'unmapped', number: 1 })),
  ],
  renames: Array.from({ length: p.renames ?? 0 }, (_, i) => ({ from: n(i + 1), to: n(i + 50) })),
  leftOut: [],
  rounds: 0,
});

/** Every report the tests drive the notices with, by what it reaches. */
export function noticeReports(): [string, Report][] {
  const r = (more: Record<string, unknown>) => ({ ...empty, ...more }) as unknown as Report;
  const out: [string, Report][] = [
    ['no shapes', r({ finalShapes: 0 })],
    ['plain one', r({ shapes: shapes(1), finalShapes: 2 })],
    ['plain many', r({ shapes: shapes(3), finalShapes: 3 })],
    ['whole one', r({ bodies: [body(n(1), 'history')] })],
    ['whole many', r({ bodies: [body(n(1), 'history'), body(n(2), 'history')], finalShapes: 2 })],
    [
      'partial one, a body and a tree with primitives',
      r({
        bodies: [body(n(1), 'history', { steps: [step('type', 2)] })],
        trees: [tree(n(2), 'history', { nodes: [{ outcome: 'body' }] })],
        finalShapes: 2,
      }),
    ],
    ['partial alone', r({ bodies: [body(n(1), 'history', { steps: [step('type', 2)] })] })],
    [
      'partial many, trees only',
      r({
        trees: [
          tree(n(1), 'leaves', { nodes: [{ outcome: 'leaf', reason: 'type' }] }),
          tree(n(2), 'leaves', { nodes: [{ outcome: 'leaf', reason: 'type' }] }),
        ],
        finalShapes: 2,
      }),
    ],
    [
      'all three kinds',
      r({
        shapes: shapes(1),
        bodies: [
          body(n(2), 'history'),
          body(n(3), 'history', { steps: [step('type', 0), step('taper', 0)] }),
        ],
        finalShapes: 3,
      }),
    ],
    ['two kinds', r({ shapes: shapes(1), bodies: [body(n(2), 'history')], finalShapes: 2 })],
    [
      'components: parts',
      r({ shapes: shapes(1), components: { made: [{ kind: 'part', name: n(5) }] } }),
    ],
    [
      'components: parts, compounds and links',
      r({
        shapes: shapes(1),
        components: {
          made: [
            { kind: 'part', name: n(5) },
            { kind: 'compound', name: n(6) },
            { kind: 'link', name: n(7) },
          ],
        },
      }),
    ],
    [
      'components: compounds',
      r({ shapes: shapes(1), components: { made: [{ kind: 'compound', name: n(5) }] } }),
    ],
    [
      'components: two kinds',
      r({
        shapes: shapes(1),
        components: {
          made: [
            { kind: 'part', name: n(5) },
            { kind: 'link', name: n(6) },
          ],
        },
      }),
    ],
    [
      'a compound and a copy',
      r({
        compounds: [{ object: n(9), outcome: 'members', members: [n(1)] }],
        links: [{ object: n(8), outcome: 'copy', sources: [n(1)], name: n(8) }],
        bodies: [body(n(1), 'history')],
        finalShapes: 2,
      }),
    ],
    ['parameters, one live', r({ shapes: shapes(1), parameters: params({ sheet: 1, live: 1 }) })],
    ['parameters, two live', r({ shapes: shapes(1), parameters: params({ set: 3, live: 2 }) })],
    [
      'parameters, many live, sheets and sets',
      r({ shapes: shapes(1), parameters: params({ sheet: 3, set: 1, live: 4 }) }),
    ],
    ['expressions, one number', r({ shapes: shapes(1), parameters: params({ numbers: 1 }) })],
    [
      'expressions, numbers',
      r({ shapes: shapes(1), parameters: params({ sheet: 1, numbers: 3 }) }),
    ],
    [
      'expressions, mixed',
      r({ shapes: shapes(1), parameters: params({ sheet: 2, live: 2, numbers: 1 }) }),
    ],
    ['parameters only', r({ shapes: shapes(1), parameters: params({ sheet: 2 }) })],
    [
      'part of the history and without',
      r({
        shapes: shapes(1),
        bodies: [body(n(2), 'history', { steps: [step('type', 2)] })],
        finalShapes: 2,
      }),
    ],
    [
      'expressions, all live, no parameters',
      r({ shapes: shapes(1), parameters: params({ live: 3 }) }),
    ],
    [
      'expressions, mixed, no parameters',
      r({ shapes: shapes(1), parameters: params({ live: 2, numbers: 2 }) }),
    ],
    [
      'expressions, two live, no parameters',
      r({ shapes: shapes(1), parameters: params({ live: 2 }) }),
    ],
    [
      'expressions, numbers, no parameters',
      r({ shapes: shapes(1), parameters: params({ numbers: 3 }) }),
    ],
    [
      'renames, one',
      r({ shapes: shapes(1), parameters: params({ sheet: 1, live: 1, renames: 1 }) }),
    ],
    [
      'renames, two',
      r({ shapes: shapes(1), parameters: params({ sheet: 1, live: 1, renames: 2 }) }),
    ],
    [
      'renames, many',
      r({ shapes: shapes(1), parameters: params({ sheet: 1, live: 1, renames: 5 }) }),
    ],
    ['starts, one', r({ bodies: [body(n(1), 'history', { steps: [step('type', 0)] })] })],
    [
      'starts, many',
      r({
        bodies: [
          body(n(1), 'history', { steps: [step('type', 0)] }),
          body(n(2), 'history', { steps: [step('foreign-base', 0)] }),
        ],
        finalShapes: 2,
      }),
    ],
    [
      'part way, many',
      r({
        bodies: [
          body(n(1), 'history', { steps: [step('type', 2)] }),
          body(n(2), 'history', { steps: [step('differs', 1)] }),
        ],
        finalShapes: 2,
      }),
    ],
    [
      'leaves, one part',
      r({ trees: [tree(n(1), 'leaves', { nodes: [{ outcome: 'leaf', reason: 'type' }] })] }),
    ],
    [
      'leaves, one tree, parts',
      r({
        trees: [
          tree(n(1), 'leaves', {
            nodes: [
              { outcome: 'leaf', reason: 'type' },
              { outcome: 'body', body: { steps: [step('taper', 1)] } },
            ],
          }),
        ],
      }),
    ],
    [
      'leaves, many',
      r({
        trees: [
          tree(n(1), 'leaves', { nodes: [{ outcome: 'leaf', reason: 'partial' }] }),
          tree(n(2), 'leaves', { nodes: [{ outcome: 'leaf', reason: 'operand' }] }),
        ],
        finalShapes: 2,
      }),
    ],
    [
      'short, one',
      r({ shapes: shapes(1), bodies: [body(n(2), 'shape', { stop: { reason: 'type' } })] }),
    ],
    [
      'short, many, rebuilt',
      r({
        shapes: shapes(2),
        bodies: [
          body(n(1), 'shape', { stop: { reason: 'type' }, bodies: ['f:0'] }),
          body(n(2), 'shape', { stop: { reason: 'failed' } }),
        ],
        trees: [tree(n(3), 'shape', { reason: 'partial' })],
        finalShapes: 3,
      }),
    ],
    [
      'not imported',
      r({
        shapes: shapes(1),
        leftOut: [
          { object: n(2), name: n(2), reason: 'empty' },
          { object: n(3), name: n(3), reason: 'kernel' },
          { object: n(4), name: n(4), reason: 'kernel' },
        ],
        finalShapes: 4,
      }),
    ],
    [
      'partly, one',
      r({ shapes: shapes(1), bodies: [body(n(2), 'left-out', { bodies: ['f:0'] })] }),
    ],
    [
      'partly, many',
      r({
        shapes: shapes(1),
        bodies: [
          body(n(2), 'left-out', { bodies: ['f:0'] }),
          body(n(3), 'left-out', { bodies: ['g:0'] }),
        ],
      }),
    ],
    [
      'a datum',
      r({ bodies: [body(n(1), 'history', { mapped: [{ datums: [{ how: 'fixed' }] }] })] }),
    ],
    [
      'datums and a plane',
      r({
        bodies: [
          body(n(1), 'history', {
            mapped: [{ datums: [{ how: 'fixed' }, { how: 'fixed' }] }],
            sketches: [{ plane: 'points' }],
          }),
        ],
      }),
    ],
    ['a plane', r({ bodies: [body(n(1), 'history', { sketches: [{ plane: 'points' }] })] })],
    [
      'planes',
      r({
        bodies: [body(n(1), 'history', { sketches: [{ plane: 'points' }, { plane: 'points' }] })],
      }),
    ],
    [
      'a datum and a plane',
      r({
        bodies: [
          body(n(1), 'history', {
            mapped: [{ datums: [{ how: 'fixed' }] }],
            sketches: [{ plane: 'points' }],
          }),
        ],
      }),
    ],
    [
      'a thread',
      r({ bodies: [body(n(1), 'history', { mapped: [{ kind: 'hole', threadLost: true }] })] }),
    ],
    [
      'threads',
      r({
        bodies: [
          body(n(1), 'history', {
            mapped: [
              { kind: 'hole', threadLost: true },
              { kind: 'hole', threadLost: true },
            ],
          }),
        ],
      }),
    ],
    [
      'not copied, one',
      r({
        shapes: shapes(1),
        links: [{ object: n(1), name: n(1), outcome: 'today', reason: 'target' }],
      }),
    ],
    [
      'not copied, many',
      r({
        shapes: shapes(2),
        links: [
          { object: n(1), name: n(1), outcome: 'today', reason: 'target' },
          { object: n(2), name: n(2), outcome: 'today', reason: 'kernel' },
        ],
        finalShapes: 2,
      }),
    ],
    ['link arrays', r({ shapes: shapes(1), linkArrays: [n(2)] })],
    ['a problem', r({ shapes: shapes(1), problems: ['x'] })],
    ['problems', r({ shapes: shapes(1), problems: ['x', 'y'] })],
    [
      'listed past six',
      r({
        leftOut: names(8).map((object) => ({ object, name: object, reason: 'empty' })),
        finalShapes: 8,
      }),
    ],
  ];
  return out;
}

export type { FcstdImportReport };
