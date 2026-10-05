import { describe, expect, it } from 'vitest';
import { addAttachment, attachmentHashes, removeAttachment, usedAttachments } from './attachments';
import { applyCommand, CommandError } from './commands';
import { createDocument } from './document';
import { restoreVersion } from './document-commands';
import type { AttachmentId, FeatureId, SketchEntityId } from './ids';
import { DocumentSchema, type Feature } from './schema';
import { addToSketch, createSketch, setText } from './sketch/commands';
import { readSketch } from './sketch/feature';
import { originPlaneRef } from './sketch/planes';

const aid = (id: string) => id as AttachmentId;
const fid = (id: string) => id as FeatureId;
const eid = (id: string) => id as SketchEntityId;

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

const font = (over: Partial<Parameters<typeof addAttachment>[0]['attachment']> = {}) => ({
  name: 'Comic Neue Bold',
  fileName: 'ComicNeue-Bold.ttf',
  mediaType: 'font/ttf' as const,
  sha256: HASH,
  size: 1234,
  ...over,
});

/** A sketch with one text shaped with `fontId`. */
function withText(fontId: string) {
  const created = applyCommand(
    createDocument({ now: '2026-10-03T09:00:00.000Z' }),
    createSketch({ id: fid('s1'), plane: originPlaneRef('origin:xy') }),
  ).doc;
  return applyCommand(
    created,
    addToSketch({
      feature: fid('s1'),
      entities: {
        [eid('a')]: { type: 'point', x: 0, y: 0 },
        [eid('t')]: { type: 'point', x: 0, y: 10 },
        [eid('label')]: {
          type: 'text',
          anchor: eid('a'),
          top: eid('t'),
          text: 'Hi',
          font: fontId,
          align: 'left',
          construction: false,
        },
      },
    }),
  ).doc;
}

function issues(doc: unknown): string[] {
  const result = DocumentSchema.safeParse(doc);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

/** The document with the attachment and the text that uses it. */
function design() {
  return applyCommand(
    applyCommand(
      withText(`attachment:${aid('f1')}`),
      addAttachment({ id: aid('f1'), attachment: font() }),
    ).doc,
    addAttachment({ id: aid('f2'), attachment: font({ name: 'Unused', sha256: OTHER_HASH }) }),
  ).doc;
}

describe('attachments in the document (P4-03b, ADR-0061 §1)', () => {
  it('accepts a design with an attachment, and refuses a malformed record', () => {
    expect(issues(createDocument())).toEqual([]);
    expect(issues(design())).toEqual([]);
    const doc = design();
    const at = (id: AttachmentId, over: Record<string, unknown>) => ({
      ...doc,
      attachments: { ...doc.attachments, [id]: over },
    });
    expect(issues(at(aid('f1'), font({ sha256: 'not-a-hash' })))).toEqual([
      'attachments.f1.sha256: must be 64 lower case hex digits',
    ]);
    expect(issues(at(aid('f1'), font({ sha256: 'A'.repeat(64) })))).toHaveLength(1);
    expect(issues(at(aid('f1'), font({ mediaType: 'font/woff2' as 'font/ttf' })))).toHaveLength(1);
    expect(
      issues(at(aid('f1'), font({ mediaType: 'application/octet-stream' as 'font/ttf' }))),
    ).toHaveLength(1);
    expect(issues(at(aid('f1'), font({ size: 0 })))).toHaveLength(1);
    expect(issues(at(aid('f1'), font({ name: '' })))).toHaveLength(1);
    expect(issues(at(aid('f1'), font({ fileName: '' })))).toHaveLength(1);
    expect(issues({ ...doc, attachments: { f1: { ...font(), extra: 1 } } })).toHaveLength(1);
  });

  it('needs the attachment a text names', () => {
    const doc = design();
    expect(issues(doc)).toEqual([]);
    // The record is gone, but the text still points at it.
    expect(issues({ ...doc, attachments: { [aid('f2')]: doc.attachments?.[aid('f2')] } })).toEqual([
      'features.0.inputs.sketch.sketch.entities.label.font: is the font of attachment "f1", which this design doesn\'t carry',
    ]);
    expect(issues({ ...doc, attachments: undefined })).toHaveLength(1);
    // A bundled font needs nothing.
    expect(issues(withText('inter-regular@1'))).toEqual([]);
  });

  it('refuses a text font that is neither bundled nor an attachment', () => {
    const doc = { ...withText('Inter Regular'), attachments: {} };
    expect(issues(doc)).toHaveLength(1);
  });

  it('adds and removes an attachment as one undo step each', () => {
    const base = withText('inter-regular@1');
    const added = applyCommand(base, addAttachment({ id: aid('f1'), attachment: font() }));
    expect(added.doc.attachments).toEqual({ f1: font() });
    expect(added.patches).toHaveLength(1);

    const removed = applyCommand(added.doc, removeAttachment({ id: aid('f1') }));
    expect(removed.doc.attachments).toEqual({});
    // The inverse patch undoes it.
    const undone = applyCommand(removed.doc, addAttachment({ id: aid('f1'), attachment: font() }));
    expect(undone.doc.attachments).toEqual({ f1: font() });
    expect(base.attachments).toBeUndefined();
  });

  it('refuses a bad record, a duplicate ID and a missing one, changing nothing', () => {
    const doc = design();
    const run =
      (id: AttachmentId, attachment = font()) =>
      () =>
        applyCommand(doc, addAttachment({ id, attachment }));
    expect(run(aid('f1'))).toThrow(CommandError);
    expect(run(aid('f3'), font({ sha256: 'nope' }))).toThrow("can't be added to the design");
    expect(run(aid('f3'), font({ mediaType: 'font/woff2' as 'font/ttf' }))).toThrow(
      "can't be added to the design",
    );
    expect(() => applyCommand(doc, removeAttachment({ id: aid('nope') }))).toThrow(
      'no file with the ID nope',
    );
  });

  it('refuses to remove a font a text uses, naming the sketches', () => {
    const doc = design();
    expect(() => applyCommand(doc, removeAttachment({ id: aid('f1') }))).toThrow(
      "Fonts in use can't be removed: Sketch1.",
    );
    // An unused attachment goes.
    expect(applyCommand(doc, removeAttachment({ id: aid('f2') })).doc.attachments).toEqual({
      f1: font(),
    });
  });

  it('names every sketch that uses a font', () => {
    const second = applyCommand(
      design(),
      createSketch({ id: fid('s2'), plane: originPlaneRef('origin:xy') }),
    ).doc;
    const withText2 = applyCommand(
      second,
      addToSketch({
        feature: fid('s2'),
        entities: {
          [eid('b')]: { type: 'point', x: 0, y: 0 },
          [eid('u')]: { type: 'point', x: 0, y: 10 },
          [eid('label2')]: {
            type: 'text',
            anchor: eid('b'),
            top: eid('u'),
            text: 'Ho',
            font: `attachment:${aid('f1')}`,
            align: 'left',
            construction: false,
          },
        },
      }),
    ).doc;
    expect(() => applyCommand(withText2, removeAttachment({ id: aid('f1') }))).toThrow(
      "Fonts in use can't be removed: Sketch1 and Sketch2.",
    );
  });

  it('lists what the texts use and what the bytes are', () => {
    const doc = design();
    expect([...usedAttachments(doc)]).toEqual(['f1']);
    expect([...attachmentHashes(doc)].sort()).toEqual([HASH, OTHER_HASH]);
    // Both attachments travel, whether a text uses them or not.
    expect([...attachmentHashes(withText('inter-regular@1'))]).toEqual([]);
    // A text with a bundled font uses no attachment.
    expect([...usedAttachments(withText('inter-regular@1'))]).toEqual([]);
  });

  it('follows a text that is switched to and from a design font', () => {
    const doc = design();
    const bundled = applyCommand(
      doc,
      setText({ feature: fid('s1'), id: eid('label'), patch: { font: 'inter-bold@1' } }),
    ).doc;
    expect([...usedAttachments(bundled)]).toEqual([]);
    expect(applyCommand(bundled, removeAttachment({ id: aid('f1') })).doc.attachments).toEqual({
      f2: font({ name: 'Unused', sha256: OTHER_HASH }),
    });
  });

  it('restores a version with its attachments', () => {
    const doc = design();
    const restored = applyCommand(doc, restoreVersion({ doc: withText('inter-regular@1') }));
    expect(restored.doc.attachments).toBeUndefined();
    expect(issues(restored.doc)).toEqual([]);
    const back = applyCommand(
      restored.doc,
      restoreVersion({ doc: { ...doc, attachments: undefined } }),
    ).doc;
    // The version's texts then have no font, which the schema catches.
    expect(issues(back)).toHaveLength(1);
  });

  it('keeps the sketch a text belongs to findable', () => {
    const doc = design();
    const sketch = readSketch(doc.features[0] as Feature);
    expect(sketch?.data.entities[eid('label')]).toMatchObject({
      font: 'attachment:f1',
    });
  });
});
