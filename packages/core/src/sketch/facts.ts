/**
 * Small facts about a sketch's entities that every render asks for (whether it
 * has text, its fonts, how many lines it has), remembered by the data object
 * once it can't change. The app reads them for every shown sketch on every
 * render; walking every entity of every sketch each time was most of the time
 * a large design blocked the page for (ADR-0156).
 */
import type { SketchEntityId } from '../ids';
import type { SketchData } from './schema';

export interface SketchFacts {
  /** A text that isn't construction geometry: its profiles depend on the fonts. */
  readonly text: boolean;
  /** Every text entity's ID, construction ones too, in entity order. */
  readonly texts: readonly SketchEntityId[];
  /** The font of each text entity, construction ones too, in entity order. */
  readonly fonts: readonly string[];
  /** How many line entities, construction ones too. */
  readonly lines: number;
}

const remembered = new WeakMap<SketchData, SketchFacts>();

/**
 * The facts of `data`, kept by the object when its entity map and every entity
 * in it are frozen (the document store's data is): the facts read only the
 * entities' own fields, so frozen ones can never change them. Other data (a
 * builder's, a draft's) is walked on every call and nothing is kept.
 */
export function sketchFacts(data: SketchData): SketchFacts {
  const known = remembered.get(data);
  if (known) return known;
  const texts: SketchEntityId[] = [];
  const fonts: string[] = [];
  let text = false;
  let lines = 0;
  let frozen = Object.isFrozen(data) && Object.isFrozen(data.entities);
  for (const id in data.entities) {
    const e = data.entities[id as SketchEntityId];
    if (!e) continue;
    if (frozen && !Object.isFrozen(e)) frozen = false;
    if (e.type === 'line') lines++;
    else if (e.type === 'text') {
      texts.push(id as SketchEntityId);
      fonts.push(e.font);
      if (!e.construction) text = true;
    }
  }
  const facts: SketchFacts = { text, texts, fonts, lines };
  if (frozen) {
    Object.freeze(texts);
    Object.freeze(fonts);
    remembered.set(data, Object.freeze(facts));
  }
  return facts;
}
