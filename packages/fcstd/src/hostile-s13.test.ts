/**
 * The second hostile-file pass (P6-25 S13, ADR-0144): one test for each gap the pass over the
 * whole importer found, each failing without its fix. The files are written here; none is
 * a library file.
 */
import { Design } from '@extrudo/api';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { unzipFcstd } from './archive';
import { uniqueComponentName } from './components';
import { documentXml, fcstd, guiXml, label, NO_HISTORY, placement, prop, shape } from './fixtures';
import { importFcstd, MAX_FCSTD_BYTES, markProblems } from './import';
import type { ImportKernel, StoredShapeStep } from './import-kernel';
import { meshFacts } from './mesh-read';
import { readFcstd, storedShapeText } from './model';
import { cleanName, clip, modelFileName, plainText, stepFileName } from './names';
import { constraintRecords, MAX_IMPORT_CELLS, prepareParameters } from './params';
import { effectiveOperands, type PartPlan } from './part-tree';
import { BOX } from './shape-fixtures';
import { MAX_SKETCH_CONSTRAINTS } from './sketch-decode';
import { MAX_ATTRIBUTES, parseXml } from './xml';

const sheet = (name: string, cells: readonly [string, string][]) => ({
  name,
  type: 'Spreadsheet::Sheet',
  props: [
    label(name),
    prop(
      'cells',
      'Spreadsheet::PropertySheet',
      `<Cells Count="${cells.length}" xlink="1"><XLinks count="0"></XLinks>${cells
        .map(([a, c]) => `<Cell address="${a}" content="${c}"/>`)
        .join('')}</Cells>`,
    ),
  ],
});

const prepare = (bytes: Uint8Array) => {
  const doc = readFcstd(bytes);
  return prepareParameters(doc, Design.create({ name: 'X', units: 'mm' }));
};

describe('the reader (S13)', () => {
  it('reads a cell of 200,000 digits and a letter in bounded time (no backtracking)', () => {
    const start = performance.now();
    prepare(
      fcstd({ 'Document.xml': documentXml([sheet('S', [['A1', `${'9'.repeat(200_000)}x`]])]) }),
    );
    // The old pattern took about 150 s on this; linear, it takes milliseconds.
    expect(performance.now() - start).toBeLessThan(2_000);
  });

  it('reads at most MAX_IMPORT_CELLS cells over all the sheets of a file', () => {
    const cells = (n: number) =>
      Array.from({ length: n }, (_, i) => [`A${i + 1}`, `${i}`] as [string, string]);
    const per = Math.ceil(MAX_IMPORT_CELLS / 2);
    const p = prepare(
      fcstd({
        'Document.xml': documentXml([
          sheet('S1', cells(per)),
          sheet('S2', cells(per)),
          sheet('S3', cells(10)),
        ]),
      }),
    );
    expect(p.leftOut.some((l) => l.reason === 'limit' && /of the file/.test(l.detail ?? ''))).toBe(
      true,
    );
  });

  it('makes a sketch’s constraint records once, and none past the sketch limit', () => {
    const sketch = (n: number) =>
      readFcstd(
        fcstd({
          'Document.xml': documentXml([
            {
              name: 'Sketch',
              type: 'Sketcher::SketchObject',
              props: [
                prop(
                  'Constraints',
                  'Sketcher::PropertyConstraintList',
                  `<ConstraintList count="${n}">${'<Constrain Name="" Type="6" Value="1" First="0" FirstPos="0" Second="-2000" SecondPos="0" Third="-2000" ThirdPos="0"/>'.repeat(n)}</ConstraintList>`,
                ),
              ],
            },
          ]),
        }),
      ).byName.get('Sketch');
    const small = sketch(3);
    if (!small) throw new Error('no sketch');
    expect(constraintRecords(small)).toHaveLength(3);
    expect(constraintRecords(small)).toBe(constraintRecords(small));
    const large = sketch(MAX_SKETCH_CONSTRAINTS + 1);
    if (!large) throw new Error('no sketch');
    expect(constraintRecords(large)).toEqual([]);
  });

  it('reads control characters XML forbids, literal or referenced, as U+FFFD', () => {
    const root = parseXml('<a x="A\u0000B&#1;C" y="&#xFFFE;">t\u0007</a>');
    expect(root.attrs.x).toBe('A�B�C');
    expect(root.attrs.y).toBe('�');
    expect(root.text).toBe('t�');
    // So no name can carry the separator of a key built from names.
    expect(Object.values(root.attrs).join('').includes('\u0000')).toBe(false);
  });

  it('refuses an element with more attributes than MAX_ATTRIBUTES, and more elements than the cap', () => {
    const attrs = (n: number) => Array.from({ length: n }, (_, i) => `a${i}="1"`).join(' ');
    expect(() => parseXml(`<a ${attrs(MAX_ATTRIBUTES)}/>`)).not.toThrow();
    expect(() => parseXml(`<a ${attrs(MAX_ATTRIBUTES + 1)}/>`)).toThrow(/more than 256 attributes/);
    expect(() => parseXml(`<a>${'<b/>'.repeat(99)}</a>`, 'x', 100)).not.toThrow();
    expect(() => parseXml(`<a>${'<b/>'.repeat(100)}</a>`, 'x', 100)).toThrow(
      /more than 100 elements/,
    );
  });

  it('refuses an archive whose entries overlap (one deflate stream feeding two entries)', () => {
    const zip = zipSync(
      { 'a.txt': new Uint8Array(1000), 'b.txt': new Uint8Array(1000) },
      { level: 0 },
    );
    expect(() => unzipFcstd(zip)).not.toThrow();
    // Point b's central record at a's local header + 1: its bytes lie inside a's.
    const bad = zip.slice();
    const view = new DataView(bad.buffer);
    let cd = bad.length - 22;
    cd = view.getUint32(cd + 16, true);
    const second =
      cd +
      46 +
      view.getUint16(cd + 28, true) +
      view.getUint16(cd + 30, true) +
      view.getUint16(cd + 32, true);
    // b's local header copied to just after a's, inside a's data.
    const aLocal = view.getUint32(cd + 42, true);
    const bLocal = view.getUint32(second + 42, true);
    const inside = aLocal + 30 + 5 + 10;
    bad.set(bad.subarray(bLocal, bLocal + 30 + 5), inside);
    view.setUint32(second + 42, inside, true);
    expect(() => unzipFcstd(bad)).toThrow(/overlaps another entry/);
  });

  it('reads only the head of a colour entry: a broken tail costs nothing', () => {
    const colours = new Uint8Array(4 + 4 * 100_000);
    const v = new DataView(colours.buffer);
    v.setUint32(0, 100_000, true);
    // Colours that don't compress past the archive's ratio; the first is red.
    for (let i = 1; i < 100_000; i++) v.setUint32(4 + 4 * i, Math.imul(i, 2654435761) >>> 0, true);
    v.setUint32(4, 0xff000000, true);
    const zip = zipSync({
      'Document.xml': new TextEncoder().encode(
        documentXml([
          { name: 'B', type: 'Part::Feature', props: [label('B'), placement(), shape('B.brp')] },
        ]),
      ),
      'GuiDocument.xml': new TextEncoder().encode(
        guiXml([{ name: 'B' }]).replace(
          '<Properties Count="0">\n',
          '<Properties Count="1">\n<Property name="DiffuseColor" type="App::PropertyColorList">\n<ColorList file="DiffuseColor"/>\n</Property>\n',
        ),
      ),
      'B.brp': new TextEncoder().encode(BOX),
      DiffuseColor: colours,
    });
    // Corrupt the colour entry's checksum in its central record: a whole read would refuse it.
    const view = new DataView(zip.buffer);
    let at = view.getUint32(zip.length - 22 + 16, true);
    for (let k = 0; k < 4; k++) {
      const nameLength = view.getUint16(at + 28, true);
      const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
      if (name === 'DiffuseColor') view.setUint32(at + 16, 0, true);
      at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    }
    const doc = readFcstd(zip);
    expect(doc.problems.filter((p) => /colour/.test(p))).toEqual([]);
    expect(doc.byName.get('B')?.gui?.colour).toEqual([1, 0, 0]);
  });

  it('refuses a large stored shape that is not B-rep text from its head, never inflating it whole', () => {
    const doc = readFcstd(
      fcstd({
        'Document.xml': documentXml([
          { name: 'B', type: 'Part::Feature', props: [label('B'), placement(), shape('B.brp')] },
        ]),
        // Text that doesn't compress past the archive's ratio: 2 MB of letters.
        'B.brp': `not a shape ${Array.from({ length: 2_000_000 }, (_, i) =>
          String.fromCharCode(97 + ((Math.imul(i, 2654435761) >>> 24) % 26)),
        ).join('')}`,
      }),
    );
    const read = { whole: 0, head: 0 };
    const { get, head } = doc.entries;
    Object.assign(doc.entries, {
      get: (name: string) => {
        read.whole++;
        return get(name);
      },
      head: (name: string, n: number) => {
        read.head += n;
        return head(name, n);
      },
    });
    expect(storedShapeText(doc, 'B')).toBeUndefined();
    expect(doc.problems.at(-1)).toMatch(/is not B-rep text/);
    expect(read).toEqual({ whole: 0, head: 128 });
  });
});

describe('names and texts that leave the importer (S13)', () => {
  it('drops bidirectional controls and zero widths, makes C1 controls spaces, mends lone surrogates', () => {
    expect(cleanName('Safe\u202Etxt.exe', 'X')).toBe('Safetxt.exe');
    expect(cleanName('a\u2066b\u2069c\u200Bd\uFEFFe\u200Ff', 'X')).toBe('abcdef');
    expect(cleanName('a\u0085b\u2028c', 'X')).toBe('a b c');
    expect(cleanName('a\uD800b', 'X')).toBe('a�b');
    expect(cleanName('\u202E\u2066', 'Fallback')).toBe('Fallback');
    expect(plainText('ok 😀')).toBe('ok 😀');
    expect(clip('x\u202Ey\nz')).toBe('xy z');
    expect(cleanName('a\u180Eb\uFFF9c\uFFFBd\u{E0041}\u{E007F}e', 'X')).toBe('abcde');
    expect(cleanName('\u{E0001}', 'Fallback')).toBe('Fallback');
  });

  it('makes an attachment file name with no path separator and no leading dot', () => {
    for (const label of ['../../etc/passwd', '..\\..\\x', '/abs', '.hidden', ' . . .x', 'C:\\x'])
      for (const name of [
        stepFileName(cleanName(label, 'X')),
        modelFileName(cleanName(label, 'X'), 'stl'),
      ]) {
        expect(name, label).not.toMatch(/[\\/:]/);
        expect(name.startsWith('.'), label).toBe(false);
        expect(name.startsWith(' '), label).toBe(false);
      }
    expect(stepFileName(cleanName('...', 'X'))).toBe('Shape.step');
  });

  it('cuts a component name within the schema’s length, never inside a surrogate pair', () => {
    const name = uniqueComponentName(`${'a'.repeat(89)}😀tail`, new Set());
    expect(name).toBe('a'.repeat(89));
    expect(name.length).toBeLessThanOrEqual(90);
  });
});

describe('the import’s own limits (S13)', () => {
  it('refuses a file over MAX_FCSTD_BYTES before reading it, whoever calls it', async () => {
    const kernel: ImportKernel = {
      storedShapeToStep: async () => ({}) as StoredShapeStep,
      ...NO_HISTORY,
      restart: async () => {},
    };
    // A view of a large buffer: nothing in it is read.
    const big = new Uint8Array(MAX_FCSTD_BYTES + 1);
    await expect(importFcstd(big, 'X', { kernel })).rejects.toThrow(/too large to import/);
  });

  it('markProblems takes doc.problems back to its length (a guard: no walk leaves a problem today)', () => {
    const doc = readFcstd(fcstd({ 'Document.xml': documentXml([]) }));
    doc.problems.push('before');
    const back = markProblems(doc);
    doc.problems.push('a member that never came in');
    back();
    expect(doc.problems).toEqual(['before']);
  });

  it('refuses a mesh a placement takes past 10 km', () => {
    const mesh = {
      points: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      facets: Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
    };
    const at = (x: number) => [
      {
        position: [x, 0, 0] as [number, number, number],
        rotation: [0, 0, 0, 1] as [number, number, number, number],
      },
    ];
    expect(meshFacts(mesh, at(0)).far).toBe(0);
    expect(meshFacts(mesh, at(1e300)).far).toBe(4);
    expect(meshFacts(mesh, at(2e7)).far).toBe(4);
  });
});

describe('a list the file sets is never spread into a call (S13)', () => {
  it('reads a compound of 300,000 links as one operand: its members, without a spread', () => {
    // A compound's `Links` list has no cap of its own; the XML reader's million elements hold it.
    const members = Array.from({ length: 300_000 }, (_, i) => `B${i}`);
    const plan = {
      nodes: new Map<string, unknown>([
        ['Cut', { kind: 'cut', operands: ['C'] }],
        ['C', { kind: 'compound', operands: members }],
      ]),
    } as unknown as PartPlan;
    const out = effectiveOperands(plan, 'Cut', () => true);
    expect(out).toHaveLength(300_000);
    expect(out[0]).toBe('B0');
  });
});
