import { Design } from '@extrudo/api';
import type { ExtrudoDocument, FeatureId, SketchReport } from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { placedNow } from './anchor';

const frame = { origin: [0, 0, 5], x: [1, 0, 0], y: [0, 1, 0], normal: [0, 0, 1] } as const;

/** A sketch with a point and a note 1 mm right of it, the sketch hidden. */
function hiddenSketch() {
  const d = Design.create();
  let point = '';
  const sketch = d.sketch(d.origin.xy, (k) => {
    point = k.point([10, 5]).id;
  });
  d.annotate('On the point', { sketch, at: [1, 0], entity: point });
  const doc = d.toJSON() as ExtrudoDocument;
  const features = doc.features.map((f) => (f.id === sketch.id ? { ...f, visible: false } : f));
  return { doc: { ...doc, features }, id: sketch.id as FeatureId };
}

describe('placedNow', () => {
  it("leaves out a hidden sketch's notes, unless the sketch is open", () => {
    const { doc, id } = hiddenSketch();
    const model = {
      annotations: {},
      sketches: { [id]: { frame } as unknown as SketchReport },
    };
    expect(placedNow(doc, model)).toEqual([]);
    const open = placedNow(doc, model, { id, frame: frame as never });
    expect(open.map((p) => p.at)).toEqual([[11, 5, 5]]);
  });
});
