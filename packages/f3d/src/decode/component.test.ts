/**
 * The component tree on a synthetic segment, built in code: a root and a
 * "Lid" component, the Lid's occurrence (placed, and hidden), a feature and
 * bodies in each, and a "Body to Component" that moves a root body into the
 * Lid (and the same as a cut and paste of bodies). Only the references and
 * strings the decoder reads are written.
 */
import { describe, expect, it } from 'vitest';
import { Segment } from '../segment';
import { BODY } from './body';
import {
  BODY_CONTAINER,
  BODY_MOVES,
  BODY_TO_COMPONENT,
  COMPONENT,
  COMPONENT_HISTORY,
  CUT_PASTE_BODIES,
  componentOfBody,
  componentOfFeature,
  FEATURE_LIST,
  HIDDEN_OCCURRENCE,
  OCCURRENCE,
  OCCURRENCE_LIST,
  readBodyMove,
  readComponents,
} from './component';
import { BODY_LINK, BODY_OPERAND } from './pattern';

const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const u64 = (v: number) => [...u32(v), 0, 0, 0, 0];
const str8 = (s: string) => [...u32(s.length), ...[...s].map((c) => c.charCodeAt(0))];
const wstr = (s: string) => [
  ...u32(s.length),
  ...[...s].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >>> 8]),
];
const f64 = (v: number) => [...new Uint8Array(new Float64Array([v]).buffer)];
/** A local reference: presence, the id, not cross-document, no segment. */
const ref = (id: number) => [1, ...u64(id), 0, 0];
const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A record: its type, payload, and optionally a base level. */
interface Rec {
  id: number;
  type: string;
  name?: string;
  payload: number[];
  base?: number[];
}

/** MetaStream and BulkStream for the records, as `Segment` reads them. */
function segment(records: Rec[]): Segment {
  const types = [...new Set(records.map((r) => r.type))];
  const bulk: number[] = [];
  const primary: [number, number][] = [];
  const secondary: [number, number][] = [];
  for (const r of records) {
    primary.push([r.id, bulk.length]);
    const tag = String(256 + types.indexOf(r.type));
    bulk.push(...str8(tag), ...u64(r.id), ...str8(r.name ?? ''), ...r.payload);
    if (r.base) {
      secondary.push([r.id, bulk.length]);
      bulk.push(...str8('999'), ...u64(r.id), ...str8(''), ...r.base);
    }
  }
  const meta = [
    ...str8('Design1'),
    ...u32(1),
    ...wstr(guid(0)),
    ...u32(4),
    ...u32(0),
    ...str8('DesignSegment'),
    ...str8('Design'),
    ...u64(0),
    ...u32(types.length),
    ...types.flatMap((t) => {
      const ids = records.filter((r) => r.type === t).map((r) => r.id);
      return [
        ...str8(t),
        ...str8(t),
        ...u32(0),
        ...str8('Test'),
        ...u32(ids.length),
        ...ids.flatMap(u64),
      ];
    }),
    ...u32(0),
    ...u32(primary.length),
    ...primary.flatMap(([id, at]) => [...u64(id), ...u64(at)]),
    ...u32(secondary.length),
    ...secondary.flatMap(([id, at]) => [...u64(id), ...u64(at)]),
  ];
  return new Segment(new Uint8Array(meta), new Uint8Array(bulk));
}

/** A component: its history; in its base level, its occurrence list, GUID and name. */
const component = (id: number, history: number, list: number, name: string): Rec => ({
  id,
  type: COMPONENT,
  payload: [...ref(history), 2, 0],
  base: [0, 0, ...ref(list), 3, 0, 0, ...wstr(guid(id)), ...wstr(name), 2, 0],
});

const MOVE = [1, 0, 0, 2.5, 0, 1, 0, -1, 0, 0, 1, 0, 0, 0, 0, 1];

/** The hidden-occurrence record: the path to the occurrence, then the path again. */
const hidden = (path: number[], component: number): Rec => ({
  id: 70,
  type: HIDDEN_OCCURRENCE,
  payload: [
    1,
    ...ref(component),
    ...u32(3),
    ...path.flatMap(ref),
    ...u32(2),
    ...path.flatMap(ref),
    ...ref(3),
  ],
});

/** The design, the Lid's occurrence hidden by default; a Knob inside the Lid. */
function design(hide: Rec = hidden([60], 20), move = BODY_TO_COMPONENT): Segment {
  return segment([
    component(3, 10, 4, 'Box v2'),
    { id: 4, type: OCCURRENCE_LIST, payload: [...ref(60), ...ref(3)] },
    { id: 10, type: COMPONENT_HISTORY, payload: ref(11) },
    { id: 11, type: FEATURE_LIST, payload: [], base: [...ref(50), ...ref(80)] },
    component(20, 21, 23, 'Lid'),
    { id: 21, type: COMPONENT_HISTORY, payload: ref(22) },
    { id: 22, type: FEATURE_LIST, payload: [], base: ref(51) },
    // The Lid's occurrence list is in its base level, with the Knob's occurrence.
    { id: 23, type: OCCURRENCE_LIST, payload: [...ref(95), ...ref(20)] },
    component(90, 91, 93, 'Knob'),
    { id: 91, type: COMPONENT_HISTORY, payload: ref(92) },
    { id: 92, type: FEATURE_LIST, payload: [] },
    { id: 93, type: OCCURRENCE_LIST, payload: ref(90) },
    {
      id: 95,
      type: OCCURRENCE,
      payload: [1, ...ref(90), 0, 0, ...u32(1), ...wstr(guid(90)), ...wstr(guid(95)), 0],
    },
    // Body containers and bodies: #41 in the root, #40 and #42 in the Lid.
    { id: 30, type: BODY_CONTAINER, payload: [0, ...ref(20)] },
    { id: 31, type: BODY_CONTAINER, payload: [0, ...ref(3)] },
    { id: 40, type: BODY, payload: [0, ...ref(30)] },
    { id: 41, type: BODY, payload: [0, ...ref(31)] },
    { id: 42, type: BODY, payload: [0, ...ref(30)] },
    // Features: their base level ends with their component's feature list.
    { id: 50, type: 'SCOPE', payload: [0], base: [0, ...ref(11)] },
    { id: 51, type: 'SCOPE', payload: [0], base: [0, ...ref(22)] },
    // The Lid's occurrence, placed 25 mm along x and −10 mm along y, and hidden.
    {
      id: 60,
      type: OCCURRENCE,
      payload: [
        1,
        ...ref(20),
        0,
        0,
        0,
        0,
        ...u32(1),
        ...wstr(guid(20)),
        ...wstr(guid(60)),
        0,
        ...ref(20),
        0,
        ...MOVE.flatMap(f64),
        ...ref(4),
      ],
    },
    { id: 61, type: OCCURRENCE, name: 'rootInstance', payload: [...ref(3), 0, 0, 0] },
    hide,
    // Body to Component: takes #41 (operand → link → body), makes #42 (its link names #84).
    { id: 80, type: move, payload: [...ref(81), ...ref(84)] },
    { id: 81, type: BODY_OPERAND, payload: ref(82) },
    { id: 82, type: BODY_LINK, payload: [...wstr(guid(41)), ...ref(41), ...ref(50)] },
    { id: 83, type: BODY_LINK, payload: [...wstr(guid(42)), ...ref(42), ...ref(84)] },
    { id: 84, type: 'MOVE_PART', payload: [0] },
  ]);
}

describe('readComponents', () => {
  it('reads the components, their names and the root', () => {
    const tree = readComponents(design());
    expect(tree.components.map((c) => [c.id, c.name, c.root, c.parent])).toEqual([
      [3, 'Box v2', true, undefined],
      [20, 'Lid', false, 3],
      [90, 'Knob', false, 20],
    ]);
  });

  it("reads an occurrence's ordinal and transform, and whose child it is", () => {
    const lid = readComponents(design()).components[1];
    expect(lid?.occurrences).toEqual([{ id: 60, ordinal: 1, transform: MOVE }]);
    expect(lid?.parent).toBe(3);
  });

  it('hides the component a hidden-occurrence record names, and the ones inside it', () => {
    const visible = (seg: Segment) => readComponents(seg).components.map((c) => c.visible);
    expect(visible(design())).toEqual([true, false, false]);
    // The path root → Lid → Knob: only the Knob is hidden.
    expect(visible(design(hidden([60, 95], 90)))).toEqual([true, true, false]);
  });

  it("finds a feature's component through its feature list, a body's through its container", () => {
    const seg = design();
    const tree = readComponents(seg);
    expect(componentOfFeature(seg, tree, 50)).toBe(3);
    expect(componentOfFeature(seg, tree, 51)).toBe(20);
    expect(componentOfBody(seg, tree, 40)).toBe(20);
    expect(componentOfBody(seg, tree, 41)).toBe(3);
  });
});

describe('readBodyMove', () => {
  it('reads the bodies a Body to Component takes and makes, and its target', () => {
    const seg = design();
    expect(readBodyMove(seg, readComponents(seg), 80)).toEqual({
      id: 80,
      sources: [41],
      made: [42],
      target: 20,
    });
  });

  it('reads a cut and paste of bodies the same way, as a body move', () => {
    const seg = design(hidden([60], 20), CUT_PASTE_BODIES);
    expect(BODY_MOVES.has(CUT_PASTE_BODIES)).toBe(true);
    expect(readBodyMove(seg, readComponents(seg), 80)).toEqual({
      id: 80,
      sources: [41],
      made: [42],
      target: 20,
    });
  });
});
