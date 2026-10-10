/**
 * The timeline: the ordered list of the records the user made, in the order
 * they were made (sketches, features, construction planes, components…).
 */
import { decodeLevel, type RecordDecoder } from './common';

export const TIMELINE = '2F4C1849-1A5A-4F6C-A086-8DD445CBF94B';

export interface Timeline {
  id: number;
  context: number;
  items: number[];
}

export const timeline: RecordDecoder<Timeline> = {
  name: 'timeline',
  decode: (seg, id) =>
    decodeLevel(seg, id, 'timeline', (r) => {
      const context = r.localRef();
      const n = r.u32();
      const items: number[] = [];
      for (let i = 0; i < n; i++) items.push(r.localRef());
      return { id, context, items };
    }),
};
