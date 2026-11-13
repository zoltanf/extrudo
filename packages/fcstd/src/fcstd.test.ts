import { describe, expect, it } from 'vitest';
import { unzipFcstd } from './archive';
import { finalShapes, invert, rotate } from './final-shapes';
import { bodyFile10, bodyFile021, brep, documentXml, fcstd, partFile, sheetFile } from './fixtures';
import {
  brepHasSolid,
  enumString,
  type FcValue,
  readFcstd,
  storedShapeEntry,
  storedShapeText,
  versionAtLeast,
} from './model';
import { parseXml } from './xml';

const value = (v: FcValue | undefined) => v;

describe('readFcstd', () => {
  it('reads the document, its objects and their properties (1.0 entry names)', () => {
    const doc = readFcstd(bodyFile10());
    expect(doc.schemaVersion).toBe(4);
    expect(doc.programVersion).toBe('1.0.0R39109 (Git)');
    expect(doc.version).toEqual([1, 0, 0]);
    expect(versionAtLeast(doc.version, [0, 21, 0])).toBe(true);
    expect(doc.label).toBe('Unnamed');
    expect(doc.unitSystem).toBe('Imperial decimal (in, lb)');
    expect(doc.problems).toEqual([]);
    expect(doc.objects.map((o) => o.name)).toEqual(['Origin', 'XY_Plane', 'Body', 'Sketch', 'Pad']);
    const pad = doc.byName.get('Pad');
    expect(pad?.type).toBe('PartDesign::Pad');
    expect(pad?.properties.Length?.value).toEqual({ kind: 'float', value: 15, unit: 'mm' });
    expect(pad?.properties.Type?.value).toEqual({
      kind: 'enum',
      index: 0,
      values: ['Length', 'UpToLast'],
    });
    expect(enumString(pad?.properties.Type?.value)).toBe('Length');
    expect(pad?.properties.Profile?.value).toEqual({ kind: 'linkSub', object: 'Sketch', subs: [] });
    expect(pad?.properties.BaseFeature?.value).toEqual({ kind: 'link', object: undefined });
    expect(pad?.expressions).toEqual([{ path: 'Length', expression: 'Spreadsheet.depth * 2' }]);
    const body = doc.byName.get('Body');
    expect(body?.label).toBe('Bracket');
    expect(body?.extensions).toEqual(['App::OriginGroupExtension']);
    expect(body?.properties.Group?.value).toEqual({ kind: 'linkList', objects: ['Sketch', 'Pad'] });
    const p = value(body?.properties.Placement?.value);
    expect(p?.kind === 'placement' && p.value.position).toEqual([10, 0, 0]);
    expect(storedShapeEntry(doc, 'Pad')).toBe('Pad.Shape.brp');
    expect(storedShapeText(doc, 'Pad')).toContain('CASCADE Topology V1');
  });

  it('keeps a sketch’s geometry and constraints as raw records', () => {
    const doc = readFcstd(bodyFile10());
    const sketch = doc.byName.get('Sketch');
    const geometry = sketch?.properties.Geometry?.value;
    expect(geometry?.kind).toBe('geometry');
    if (geometry?.kind !== 'geometry') return;
    expect(geometry.records[0]?.attrs.type).toBe('Part::GeomCircle');
    expect(geometry.records[0]?.children.map((c) => c.tag)).toEqual([
      'GeoExtensions',
      'Circle',
      'Construction',
    ]);
    expect(geometry.records[0]?.children[1]?.attrs.Radius).toBe('5');
    const constraints = sketch?.properties.Constraints?.value;
    expect(constraints?.kind === 'constraints' && constraints.records[0]?.attrs).toMatchObject({
      Name: 'r',
      Type: '8',
      Value: '5',
    });
    expect(sketch?.properties.AttachmentSupport?.value).toEqual({
      kind: 'linkSubList',
      items: [{ object: 'XY_Plane', sub: { name: '' } }],
    });
  });

  it('reads visibility and colour from GuiDocument.xml', () => {
    const doc = readFcstd(bodyFile10());
    expect(doc.hasGui).toBe(true);
    const body = doc.byName.get('Body');
    expect(body?.gui?.visible).toBe(true);
    expect(body?.gui?.colour?.map((c) => Math.round(c * 255))).toEqual([0xcc, 0x33, 0]);
    expect(body?.gui?.transparency).toBe(0.2);
    expect(doc.byName.get('Pad')?.gui?.visible).toBe(false);
  });

  it('reads a file without GuiDocument.xml', () => {
    const doc = readFcstd(bodyFile10({ gui: false }));
    expect(doc.hasGui).toBe(false);
    expect(doc.byName.get('Body')?.gui).toBeUndefined();
    expect(finalShapes(doc).map((s) => [s.object.name, s.visible])).toEqual([['Body', true]]);
  });

  it('finds stored shapes in the 0.21 entry names and says when one is empty', () => {
    const doc = readFcstd(bodyFile021());
    expect(doc.version).toEqual([0, 21, 2]);
    expect(storedShapeEntry(doc, 'Body')).toBe('PartShape.brp');
    expect(storedShapeEntry(doc, 'Pad')).toBe('PartShape2.brp');
    expect(storedShapeText(doc, 'Pad')).toContain('TShapes');
    expect(storedShapeText(doc, 'Sketch')).toBeUndefined();
    expect(doc.problems).toEqual(['Sketch.Shape: its stored shape is empty.']);
    expect(storedShapeText(doc, 'Origin')).toBeUndefined();
    expect(doc.problems.at(-1)).toBe('Origin.Shape: no stored shape.');
  });

  it('says when a stored shape is missing, binary or not B-rep text', () => {
    const doc = readFcstd(
      fcstd({
        'Document.xml': documentXml([
          {
            name: 'A',
            type: 'Part::Feature',
            props: [
              '<Property name="Shape" type="Part::PropertyPartShape"><Part file="A.Shape.brp"/></Property>',
            ],
          },
          {
            name: 'B',
            type: 'Part::Feature',
            props: [
              '<Property name="Shape" type="Part::PropertyPartShape"><Part file="B.Shape.bin"/></Property>',
            ],
          },
          {
            name: 'C',
            type: 'Part::Feature',
            props: [
              '<Property name="Shape" type="Part::PropertyPartShape"><Part file="C.Shape.brp"/></Property>',
            ],
          },
        ]),
        'B.Shape.bin': '\nOpen CASCADE Topology V3 (c)\n',
        'C.Shape.brp': 'hello',
      }),
    );
    for (const name of ['A', 'B', 'C']) expect(storedShapeText(doc, name)).toBeUndefined();
    expect(doc.problems).toEqual([
      'A.Shape: its stored shape A.Shape.brp is missing from the file.',
      "B.Shape: its stored shape is in FreeCAD's binary form, which is not read.",
      'C.Shape: its stored shape is not B-rep text.',
    ]);
  });

  it('reads a spreadsheet’s cells and aliases', () => {
    const doc = readFcstd(sheetFile());
    const cells = doc.byName.get('Spreadsheet')?.properties.cells?.value;
    expect(cells).toEqual({
      kind: 'sheet',
      cells: [
        { address: 'A1', content: 'depth' },
        { address: 'B1', content: '=7.5 mm', alias: 'depth' },
        { address: 'B2', content: '=depth < 10 ? 3 : 4', alias: 'wall' },
      ],
    });
    expect(doc.hasGui).toBe(false);
  });

  it('reads placements by axis and angle when the file has them, else by quaternion', () => {
    const doc = readFcstd(
      fcstd({
        'Document.xml': documentXml([
          {
            name: 'A',
            type: 'Part::Box',
            props: [
              // The quaternion says nothing turned; FreeCAD reads the angle.
              '<Property name="Placement" type="App::PropertyPlacement"><PropertyPlacement Px="1" Py="2" Pz="3" Q0="0" Q1="0" Q2="0" Q3="1" A="3.141592653589793" Ox="0" Oy="0" Oz="2"/></Property>',
              '<Property name="P2" type="App::PropertyPlacement"><PropertyPlacement Px="0" Py="0" Pz="0" Q0="0" Q1="0" Q2="0.7071067811865476" Q3="0.7071067811865476"/></Property>',
            ],
          },
        ]),
      }),
    );
    const a = doc.byName.get('A');
    const p = a?.properties.Placement?.value;
    expect(
      p?.kind === 'placement' && p.value.rotation.map((x) => Math.round(x * 1e9) / 1e9),
    ).toEqual([0, 0, 1, 0]);
    const q = a?.properties.P2?.value;
    expect(
      q?.kind === 'placement' &&
        rotate(q.value.rotation, [1, 0, 0]).map((x) => Math.round(x * 1e9) / 1e9),
    ).toEqual([0, 1, 0]);
  });

  it('keeps an unknown property type raw and counts it', () => {
    const doc = readFcstd(
      fcstd({
        'Document.xml': documentXml([
          {
            name: 'A',
            type: 'App::FeaturePython',
            props: [
              '<Property name="Odd" type="Foo::PropertyOdd"><Odd a="1"><Inner/></Odd></Property>',
              '<Property name="Odd2" type="Foo::PropertyOdd"><Odd a="2"/></Property>',
            ],
          },
        ]),
      }),
    );
    expect(doc.unknownTypes).toEqual({ 'Foo::PropertyOdd': 2 });
    expect(doc.byName.get('A')?.properties.Odd?.value).toEqual({
      kind: 'unknown',
      raw: [
        { tag: 'Odd', attrs: { a: '1' }, children: [{ tag: 'Inner', attrs: {}, children: [] }] },
      ],
    });
  });
});

describe('finalShapes', () => {
  it('takes a body’s own shape, never its features’', () => {
    const doc = readFcstd(bodyFile10());
    const final = finalShapes(doc);
    expect(final.map((s) => [s.kind, s.object.name, s.entry, s.name])).toEqual([
      ['body', 'Body', 'Body.Shape.brp', 'Bracket'],
    ]);
    // The body's shape already has its placement: nothing to apply on top.
    expect(final[0]?.chain).toEqual([]);
    expect(final[0]?.transparency).toBe(0.2);
  });

  it('takes a boolean’s result, not its tools, with the container’s placement, and one copy per link', () => {
    const doc = readFcstd(partFile());
    const final = finalShapes(doc);
    expect(final.map((s) => [s.kind, s.object.name, s.source.name, s.visible])).toEqual([
      ['shape', 'Cut', 'Cut', true],
      ['link', 'Link', 'Cut', true],
    ]);
    const [cut, copy] = final;
    expect(cut?.chain).toEqual([{ position: [0, 0, 5], rotation: [0, 0, 0, 1] }]);
    expect(cut?.colour).toEqual([0, 1, 0]);
    // The link replaces the cut's own placement (LinkTransform false): its own, then the cut's undone.
    expect(copy?.chain.map((p) => p.position)).toEqual([
      [20, 0, 0],
      [-0, -0, -0],
    ]);
    expect(copy?.entry).toBe('PartShape2.brp');
    expect(doc.problems).toEqual([]);
  });

  it('leaves out a shape with no solid (a 2D profile)', () => {
    const doc = readFcstd(partFile());
    expect(finalShapes(doc).some((s) => s.object.name === 'Sketch2D')).toBe(false);
  });
});

describe('helpers', () => {
  it('tells a solid in B-rep text by its shape table', () => {
    expect(brepHasSolid(brep('solid'))).toBe(true);
    expect(brepHasSolid(brep('face'))).toBe(false);
    expect(brepHasSolid('So\n')).toBe(false);
  });

  it('inverts a placement', () => {
    const p = {
      position: [1, 2, 3] as const,
      rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const,
    };
    const q = invert(p);
    // q(p(v)) = v for v = (1, 0, 0): p(v) = R v + t.
    const pv = rotate(p.rotation, [1, 0, 0]).map((x, i) => x + (p.position[i] as number)) as [
      number,
      number,
      number,
    ];
    const back = rotate(q.rotation, pv).map((x, i) => x + (q.position[i] as number));
    expect(back.map((x) => Math.round(x * 1e9) / 1e9)).toEqual([1, 0, 0]);
  });

  it('reads XML: entities, character references, comments, CDATA and text', () => {
    const root = parseXml(
      `<?xml version="1.0"?><!-- c --><a x="&lt;&amp;&#65;&#x42;&quot;&apos;&gt;" y='1&#10;2'>t&amp;<![CDATA[<raw>]]><b/></a>`,
    );
    expect(root.attrs).toEqual({ x: `<&AB"'>`, y: '1\n2' });
    expect(root.text).toBe('t&<raw>');
    expect(root.children.map((c) => c.name)).toEqual(['b']);
    expect(Object.getPrototypeOf(parseXml('<a __proto__="x"/>').attrs)).toBeNull();
  });
});

describe('unzipFcstd', () => {
  it('lists entries by name and inflates only on demand', () => {
    const entries = unzipFcstd(fcstd({ 'Document.xml': '<Document/>', 'a/b.brp': 'x' }));
    expect(entries.names).toEqual(['Document.xml', 'a/b.brp']);
    expect(entries.size('a/b.brp')).toBe(1);
    expect(new TextDecoder().decode(entries.get('a/b.brp'))).toBe('x');
    expect(entries.get('missing')).toBeUndefined();
    expect(entries.problems).toEqual([]);
  });
});
