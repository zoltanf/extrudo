/**
 * One budget per design for the work an imported design asks of the app each
 * time it opens (ADR-0083, amendment of 2026-11-15): the copies patterns and
 * mirrors make, hole centres, thread turns, text, sketch copies and the
 * profiles of sketches no feature uses. The file's counts are only bounded per
 * feature; this bounds the design. A feature past the budget comes in
 * suppressed, a sketch no feature uses comes in hidden, each with a note.
 */
import { type Feature, MAX_PATTERN_INSTANCES } from '@extrudo/core';

/**
 * The units one design's import may spend: as much repeated work as one
 * pattern may make by itself (`MAX_PATTERN_INSTANCES`). A unit is about what
 * the kernel does for one copy of one small feature: one copy of one feature
 * a pattern or mirror repeats (or one body it copies; a pattern costs at
 * least one), one hole centre, `THREAD_UNITS` a thread turn on one face,
 * `TEXT_UNITS` a text character, and one per `ENTITIES_PER_UNIT` points and
 * curves of a sketch copy or of a sketch no feature uses (with the edges of
 * its profiles). The corpus's dearest design spends 192 (a pattern of 160,
 * two threads and a text), so the margin is about 5.2.
 */
export const IMPORT_WORK = MAX_PATTERN_INSTANCES;

/** The units of one thread turn on one face (a turn costs the kernel about two copies). */
export const THREAD_UNITS = 2;

/** The units of one text character (a glyph costs the kernel about three copies). */
export const TEXT_UNITS = 3;

/** Points and curves per unit, for sketch copies and sketches no feature uses. */
export const ENTITIES_PER_UNIT = 25;

/**
 * The most turns a thread is charged per face: the most a thread may have
 * (the kernel's `MAX_TURNS`; a test keeps the two equal). A full-length
 * thread whose face's length the B-rep doesn't tell is charged this.
 */
export const FULL_THREAD_TURNS = 150;

/**
 * The most sketch points and curves one import may make, copies included.
 * The corpus's largest design has 8,090 (5,474 in one sketch). Past it the
 * import is refused, before the design reaches the app.
 */
export const MAX_IMPORT_ENTITIES = 100_000;

/** Why a design is refused past `MAX_IMPORT_ENTITIES`, in the person's words. */
export const TOO_MANY_ENTITIES = `This .f3d file is too large to import (its sketches have more than ${MAX_IMPORT_ENTITIES.toLocaleString('en-US')} points and curves).`;

/** The note on a feature suppressed past `IMPORT_WORK`. */
export function overBudgetNote(name: string): string {
  return `${name} is suppressed: it would take the design past the import's limit on repeated work (pattern copies, hole centres, thread turns, text and sketch copies). Unsuppress it to build it.`;
}

/**
 * The note on an extrude suppressed past `IMPORT_WORK` whose start offset
 * needed a copy of its sketch: the copy is not made, so it starts on its sketch.
 */
export function offsetDroppedNote(name: string): string {
  return `${name} starts on its sketch's plane, not at its start offset: the copy of its sketch it would start on is not made past the import's limit.`;
}

/** The one note on the sketches no feature uses that are hidden past `IMPORT_WORK`. */
export function hiddenSketchesNote(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(', ');
  const more = names.length > 3 ? ` and ${names.length - 3} more` : '';
  const one = names.length === 1;
  return `${shown}${more}: no feature uses ${one ? 'this sketch' : 'these sketches'}, and finding ${one ? 'its' : 'their'} profiles would take the design past the import's limit on repeated work, so ${one ? 'it is' : 'they are'} hidden. Show ${one ? 'it' : 'them'} to see ${one ? 'it' : 'them'}.`;
}

/** A feature's input as the kernel reads it, a number; undefined when it doesn't evaluate. */
export type InputValue = (feature: Feature, input: string) => number | undefined;

const PATTERNS = new Set(['circularPattern', 'rectangularPattern', 'pathPattern', 'mirror']);

/** The sketch points and curves of a sketch feature (0 for any other). */
export function sketchEntities(feature: Feature): number {
  const sketch = feature.inputs.sketch;
  return sketch?.kind === 'sketchData' ? Object.keys(sketch.sketch.entities).length : 0;
}

/** The characters of a sketch feature's texts. */
function textCharacters(feature: Feature): number {
  const sketch = feature.inputs.sketch;
  if (sketch?.kind !== 'sketchData') return 0;
  let n = 0;
  for (const e of Object.values(sketch.sketch.entities)) if (e.type === 'text') n += e.text.length;
  return n;
}

/** A sketch's units: its text characters, and its size when it is a sketch copy. */
export function sketchUnits(feature: Feature, copy: boolean): number {
  return (
    TEXT_UNITS * textCharacters(feature) +
    (copy ? Math.ceil(sketchEntities(feature) / ENTITIES_PER_UNIT) : 0)
  );
}

/** The ids an input refers to (`feature`, `body`, … references), or none. */
function refsOf(feature: Feature, input: string): readonly { id: string }[] {
  const v = feature.inputs[input];
  return v?.kind === 'ref' ? v.refs : [];
}

/** The units of a design's import, spent feature by feature in timeline order. */
export class ImportBudget {
  #left: number;
  /** What each feature stands for when a pattern or mirror repeats it. */
  readonly #units = new Map<string, number>();

  constructor(total = IMPORT_WORK) {
    this.#left = total;
  }

  get left(): number {
    return this.#left;
  }

  /** Spends `units`, or nothing and false when that would pass the budget. */
  spend(units: number): boolean {
    if (units > this.#left) return false;
    this.#left -= units;
    return true;
  }

  /** Counts a feature as suppressed: a pattern that repeats it repeats nothing. */
  suppressed(id: string): void {
    this.#units.set(id, 0);
  }

  /**
   * What features just added cost, in units; each one's worth when repeated
   * is kept for the patterns after it. `copies` are the sketch copies the
   * import made (charged by their size); `fullTurns`, a full-length thread's
   * turns, where its faces' lengths are known.
   */
  cost(
    features: readonly Feature[],
    value: InputValue,
    copies: ReadonlySet<string>,
    fullTurns?: number,
  ): number {
    let total = 0;
    for (const f of features) {
      let own = 0;
      let worth = 1;
      if (PATTERNS.has(f.type)) {
        const n = f.type === 'mirror' ? 2 : instances(f, value);
        let each = 0;
        if (f.inputs.objects?.kind === 'enum' && f.inputs.objects.value === 'features')
          for (const r of refsOf(f, 'features')) each += this.#units.get(r.id) ?? 1;
        else each = refsOf(f, 'bodies').length;
        // At least one unit: a pattern does some work, and is evaluated no more than the budget allows.
        own = Math.max(1, (n - 1) * each);
        worth = n * each;
      } else if (f.type === 'hole') {
        own = refsOf(f, 'points').length;
        worth = Math.max(1, own);
      } else if (f.type === 'thread') {
        own = THREAD_UNITS * refsOf(f, 'faces').length * turns(f, value, fullTurns);
        worth = Math.max(1, own);
      } else if (f.type === 'sketch') own = sketchUnits(f, copies.has(f.id));
      this.#units.set(f.id, worth);
      total += own;
    }
    return total;
  }
}

/** A pattern's instances, the original included (the kernel's most when its count doesn't evaluate). */
function instances(f: Feature, value: InputValue): number {
  const count = (input: string) => {
    if (f.inputs[input] === undefined) return 1;
    const n = value(f, input);
    return n === undefined || !Number.isFinite(n) ? MAX_PATTERN_INSTANCES : Math.round(n);
  };
  const n = f.type === 'rectangularPattern' ? count('count1') * count('count2') : count('count');
  return Math.max(1, Math.min(MAX_PATTERN_INSTANCES, n));
}

/** A thread's turns on one face: its length over its pitch, at most `FULL_THREAD_TURNS`. */
function turns(f: Feature, value: InputValue, fullTurns?: number): number {
  const extent = f.inputs.extent;
  if (extent?.kind !== 'enum' || extent.value !== 'length')
    return fullTurns === undefined || !Number.isFinite(fullTurns)
      ? FULL_THREAD_TURNS
      : Math.max(1, Math.min(FULL_THREAD_TURNS, whole(fullTurns)));
  const length = value(f, 'length');
  const pitch = value(f, 'pitch');
  if (length === undefined || pitch === undefined || !(pitch > 0) || !Number.isFinite(length))
    return FULL_THREAD_TURNS;
  return Math.max(1, Math.min(FULL_THREAD_TURNS, whole(length / pitch)));
}

/** Rounded up, past a hair: 1.5 / 0.15 is ten turns. */
function whole(x: number): number {
  return Math.ceil(x - 1e-9);
}
