/**
 * Crafted files (all hand-built here, no real file's bytes): each ends in a
 * thrown `FcstdFormatError` with a plain message or in a document with
 * problems, in bounded time.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ENTRIES, unzipFcstd } from './archive';
import { FcstdFormatError } from './errors';
import { finalShapes } from './final-shapes';
import { brep, documentXml, fcstd, label, link, links, placement, prop, shape } from './fixtures';
import { readFcstd } from './model';
import { MAX_DEPTH, parseXml } from './xml';

/** Where each central-directory record starts, by entry name. */
function central(zip: Uint8Array): Map<string, number> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const out = new Map<string, number>();
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < view.getUint16(eocd + 10, true); i++) {
    const n = view.getUint16(p + 28, true);
    out.set(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + n)), p);
    p += 46 + n + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return out;
}

function patch(zip: Uint8Array, name: string, offset: number, value: number, bytes: 2 | 4 = 4) {
  const at = central(zip).get(name);
  if (at === undefined) throw new Error(`no ${name}`);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (bytes === 4) view.setUint32(at + offset, value, true);
  else view.setUint16(at + offset, value, true);
}

/**
 * A ZIP of `n` empty stored entries, written directly (fflate takes seconds
 * for 10^5); the end record's 16-bit count wraps as a plain ZIP's does.
 */
function emptyEntries(n: number): Uint8Array {
  const names = Array.from({ length: n }, (_, i) => new TextEncoder().encode(`e${i}`));
  const size = names.reduce((sum, name) => sum + 30 + 46 + 2 * name.length, 22);
  const zip = new Uint8Array(size);
  const view = new DataView(zip.buffer);
  let p = 0;
  const locals: number[] = [];
  for (const name of names) {
    locals.push(p);
    view.setUint32(p, 0x04034b50, true);
    view.setUint16(p + 26, name.length, true);
    zip.set(name, p + 30);
    p += 30 + name.length;
  }
  const directory = p;
  names.forEach((name, i) => {
    view.setUint32(p, 0x02014b50, true);
    view.setUint16(p + 28, name.length, true);
    view.setUint32(p + 42, locals[i] as number, true);
    zip.set(name, p + 46);
    p += 46 + name.length;
  });
  view.setUint32(p, 0x06054b50, true);
  view.setUint16(p + 8, n & 0xffff, true);
  view.setUint16(p + 10, n & 0xffff, true);
  view.setUint32(p + 12, p - directory, true);
  view.setUint32(p + 16, directory, true);
  return zip;
}

const DOC = documentXml([{ name: 'A', type: 'Part::Box', props: [label('A')] }]);

function expectError(run: () => unknown, message: RegExp, ms = 2000) {
  const t = performance.now();
  let error: unknown;
  try {
    run();
  } catch (e) {
    error = e;
  }
  expect(performance.now() - t).toBeLessThan(ms);
  expect(error).toBeInstanceOf(FcstdFormatError);
  expect((error as Error).message).toMatch(message);
}

describe('hostile archives', () => {
  it('refuses a ratio bomb before inflating it', () => {
    const zip = fcstd({ 'Document.xml': DOC, 'bomb.brp': new Uint8Array(20 * 1024 * 1024) });
    expectError(
      () => unzipFcstd(zip),
      /claims to unpack to 20971520 bytes from \d+ \(more than 500 to 1\)/,
    );
  });

  it('refuses an archive with too many entries', () => {
    const zip = emptyEntries(MAX_ENTRIES + 1);
    expectError(() => unzipFcstd(zip), /too many entries \(20001; the limit is 20000\)/);
  });

  it('refuses 10^5 entries, whose count no longer fits a plain ZIP', () => {
    const zip = emptyEntries(100_000);
    // 100,000 wraps to 34,464 in the 16-bit count: still over the limit.
    expectError(() => unzipFcstd(zip), /too many entries \(34464;/);
  });

  it('refuses an entry that unpacks to more than it declares', () => {
    const zip = fcstd({ 'Document.xml': DOC });
    patch(zip, 'Document.xml', 24, DOC.length - 10);
    const entries = unzipFcstd(zip);
    expectError(() => entries.get('Document.xml'), /unpacks to more than its declared/);
    expectError(() => readFcstd(zip), /unpacks to more than its declared/);
  });

  it('refuses an entry that unpacks to less than it declares', () => {
    const zip = fcstd({ 'Document.xml': DOC });
    patch(zip, 'Document.xml', 24, DOC.length + 10);
    expectError(() => readFcstd(zip), /unpacks to \d+ bytes, not its declared/);
  });

  it('refuses a stored entry whose sizes disagree', () => {
    const zip = fcstd({ 'Document.xml': DOC, 'x.brp': new Uint8Array(0) });
    patch(zip, 'x.brp', 10, 0, 2); // stored
    patch(zip, 'x.brp', 24, 1000);
    expectError(() => unzipFcstd(zip), /stored with \d+ bytes but declares 1000/);
  });

  it('refuses ZIP64 and encrypted entries', () => {
    const zip64 = fcstd({ 'Document.xml': DOC });
    patch(zip64, 'Document.xml', 24, 0xffffffff);
    expectError(() => unzipFcstd(zip64), /ZIP64/);
    const encrypted = fcstd({ 'Document.xml': DOC });
    patch(encrypted, 'Document.xml', 8, 1, 2);
    expectError(() => unzipFcstd(encrypted), /encrypted/);
  });

  it('refuses an entry that fails its checksum', () => {
    const zip = fcstd({ 'Document.xml': DOC });
    patch(zip, 'Document.xml', 16, 0x12345678);
    expectError(() => readFcstd(zip), /fails its checksum/);
  });

  it('leaves out a name that climbs out of its folder, and a second entry of one name', () => {
    const zip = fcstd({ 'Document.xml': DOC, '../evil.brp': brep(), 'Document.xmm': '<x/>' });
    // Rename the third entry, in its central and local headers, to the first's name.
    const at = central(zip).get('Document.xmm') as number;
    const view = new DataView(zip.buffer);
    const local = view.getUint32(at + 42, true);
    for (const p of [at + 46, local + 30]) zip.set(new TextEncoder().encode('Document.xml'), p);
    const doc = readFcstd(zip);
    expect(doc.objects.map((o) => o.name)).toEqual(['A']);
    expect(doc.entries.names).toEqual(['Document.xml']);
    expect(doc.problems).toEqual([
      'archive: an entry name that is not a plain name was left out ("../evil.brp").',
      'archive: a second entry named Document.xml was left out (the first is read).',
    ]);
  });

  it('refuses what is not a ZIP, and a ZIP without Document.xml', () => {
    expectError(() => readFcstd(new TextEncoder().encode('hello')), /not a ZIP archive/);
    expectError(() => readFcstd(fcstd({ 'a.txt': 'x' })), /no Document.xml/);
  });
});

const docWith = (xml: string) => fcstd({ 'Document.xml': xml });

describe('hostile XML', () => {
  it('refuses a document type declaration', () => {
    expectError(
      () =>
        readFcstd(docWith('<?xml version="1.0"?><!DOCTYPE Document [<!ENTITY a "b">]><Document/>')),
      /document type declaration/,
    );
  });

  it('refuses an entity bomb, and any entity but the five predefined', () => {
    const lol = Array.from(
      { length: 10 },
      (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i};`.repeat(10)}">`,
    ).join('');
    expectError(
      () =>
        readFcstd(docWith(`<!DOCTYPE lolz [<!ENTITY lol0 "lol">${lol}]><Document a="&lol10;"/>`)),
      /document type declaration/,
    );
    expectError(() => parseXml('<Document a="&lol10;"/>'), /the entity &lol10; is not supported/);
    expectError(
      () => parseXml('<Document>&nbsp;</Document>'),
      /the entity &nbsp; is not supported/,
    );
    expectError(() => parseXml('<Document a="&#0;"/>'), /bad character reference/);
    expectError(() => parseXml('<Document a="&#xD800;"/>'), /bad character reference/);
  });

  it('refuses 10^5 levels of nesting', () => {
    const xml = `${'<a>'.repeat(100_000)}${'</a>'.repeat(100_000)}`;
    expectError(() => parseXml(xml), new RegExp(`nested more than ${MAX_DEPTH} deep`));
  });

  it('reads a 10 MB attribute in bounded time', () => {
    // Letters that don't compress well, so the entry passes the ratio limit.
    let seed = 1;
    const letters = new Uint8Array(10 * 1024 * 1024).map(() => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return 97 + ((seed >>> 16) % 26);
    });
    const big = new TextDecoder('latin1').decode(letters);
    const xml = documentXml([
      {
        name: 'A',
        type: 'App::FeaturePython',
        props: [prop('Big', 'App::PropertyString', `<String value="${big}&amp;"/>`)],
      },
    ]);
    const t = performance.now();
    const doc = readFcstd(docWith(xml));
    expect(performance.now() - t).toBeLessThan(3000);
    const v = doc.byName.get('A')?.properties.Big?.value;
    expect(v?.kind === 'string' && v.value.length).toBe(big.length + 1);
  });

  it('reads many entities in a long value in linear time', () => {
    const xml = `<a v="${'&amp;'.repeat(1_000_000)}"/>`;
    const t = performance.now();
    expect(parseXml(xml).attrs.v?.length).toBe(1_000_000);
    expect(performance.now() - t).toBeLessThan(2000);
  });

  it('refuses an unclosed element, a mismatched one and two roots', () => {
    expectError(() => readFcstd(docWith('<Document><Objects>')), /<Objects> never ends/);
    expectError(() => parseXml('<a><b></a>'), /<\/a> closes <b>/);
    expectError(() => parseXml('<a/><b/>'), /more than one root/);
    expectError(() => parseXml('<a x="1"'), /never ends/);
    expectError(() => parseXml('<a x="1" x="2"/>'), /twice/);
    expectError(() => parseXml('<a x="<"/>'), /a "<" in the attribute/);
  });

  it('refuses invalid UTF-8', () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('<Document a="'),
      0xc3,
      0x28,
      ...new TextEncoder().encode('"/>'),
    ]);
    expectError(() => readFcstd(fcstd({ 'Document.xml': bytes })), /not valid UTF-8/);
  });
});

describe('hostile values', () => {
  it('leaves out a property whose number is NaN or 1e999, with a problem', () => {
    const doc = readFcstd(
      docWith(
        documentXml([
          {
            name: 'A',
            type: 'Part::Box',
            props: [
              prop('Length', 'App::PropertyLength', '<Float value="NaN"/>'),
              prop('Width', 'App::PropertyLength', '<Float value="1e999"/>'),
              prop('Height', 'App::PropertyLength', '<Float value="2"/>'),
              prop(
                'Placement',
                'App::PropertyPlacement',
                '<PropertyPlacement Px="inf" Py="0" Pz="0" Q0="0" Q1="0" Q2="0" Q3="1"/>',
              ),
              prop('Count', 'App::PropertyInteger', '<Integer value="1.5"/>'),
            ],
          },
        ]),
      ),
    );
    const a = doc.byName.get('A');
    expect(Object.keys(a?.properties ?? {})).toEqual(['Height']);
    expect(doc.problems).toEqual([
      'A.Length was left out: A.Length: "NaN" is not a finite number.',
      'A.Width was left out: A.Width: "1e999" is not a finite number.',
      'A.Placement was left out: A.Placement: "inf" is not a finite number.',
      'A.Count was left out: A.Count: 1.5 is not an integer.',
    ]);
  });

  it('reads a property type named like an object member as no unit', () => {
    const doc = readFcstd(
      docWith(
        documentXml([
          {
            name: 'A',
            type: 'Part::Box',
            props: [
              prop('Length', 'constructor', '<Float value="2"/>'),
              prop('Width', '__proto__', '<Float value="3"/>'),
            ],
          },
        ]),
      ),
    );
    const a = doc.byName.get('A');
    expect(a?.properties.Length?.value).toEqual({ kind: 'float', value: 2 });
    expect(a?.properties.Width?.value).toEqual({ kind: 'float', value: 3 });
  });

  it('ends the final-shape walk on links to nothing and on cycles', () => {
    const xlink = (target: string) =>
      prop('LinkedObject', 'App::PropertyXLink', `<XLink file="" stamp="" name="${target}"/>`);
    const doc = readFcstd(
      fcstd({
        'Document.xml': documentXml([
          // Two parts holding each other, with a box inside.
          { name: 'P1', type: 'App::Part', props: [links('Group', ['P2', 'Box']), placement(1)] },
          { name: 'P2', type: 'App::Part', props: [links('Group', ['P1']), placement(2)] },
          { name: 'Box', type: 'Part::Box', props: [shape('Box.Shape.brp')] },
          // Links that lead back to themselves, and one to nothing.
          { name: 'L1', type: 'App::Link', props: [xlink('L2')] },
          { name: 'L2', type: 'App::Link', props: [xlink('L1')] },
          { name: 'L3', type: 'App::Link', props: [xlink('Missing')] },
          // A cut whose tool doesn't exist: nothing breaks.
          {
            name: 'Cut',
            type: 'Part::Cut',
            props: [link('Base', 'Ghost'), link('Tool', 'Nowhere'), shape('Cut.Shape.brp')],
          },
          // A body that lists itself.
          {
            name: 'Body',
            type: 'PartDesign::Body',
            props: [links('Group', ['Body']), shape('Body.Shape.brp')],
          },
        ]),
        'Box.Shape.brp': brep(),
        'Cut.Shape.brp': brep(),
        'Body.Shape.brp': brep(),
      }),
    );
    const t = performance.now();
    const final = finalShapes(doc);
    expect(performance.now() - t).toBeLessThan(1000);
    expect(final.map((s) => [s.object.name, s.chain.length])).toEqual([
      ['Box', 0],
      ['Cut', 0],
      ['Body', 0],
    ]);
    expect(doc.problems).toEqual([
      'Box: its containers hold each other in a loop; their placements are left out.',
      'L1: links that lead back to themselves, left out.',
      'L2: links that lead back to themselves, left out.',
      "L3: a link to Missing, which isn't in the file, left out.",
    ]);
  });
});
