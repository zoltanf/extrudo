# Turns the fixture JSON that make-part-fixtures.py writes (FreeCAD's own output) into
# packages/fcstd/src/part-fixtures.ts (ADR-0144 S11): each object's own <Object> XML with the
# properties the importer never reads left out, white space between elements dropped, trailing
# zeros cut from numbers and FreeCAD's repeated markup written as tokens (`PART_TOKENS`); its
# visibility, FreeCAD's measures of its stored shape, a Part fillet's or chamfer's edge list
# (the binary entry, base64) and its edges as FreeCAD read them. Each distinct B-rep text once,
# each run of spaces made one; the texts are joined and deflated into `PART_BREP_DEFLATED`
# (base64): plain, they are 586 KB, past the 500 KB the slice may add.
#
# Run, from the repository's root (FreeCAD 1.1 for the first step):
#   1. freecadcmd packages/fcstd/scripts/make-part-fixtures.py <dir>
#        writes <dir>/fixtures.json (and log.txt)
#   2. python3 packages/fcstd/scripts/part-fixtures-to-module.py \
#        <dir>/fixtures.json packages/fcstd/src/part-fixtures.ts
#   3. pnpm biome format --write packages/fcstd/src/part-fixtures.ts
import base64, json, re, sys, zlib

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
# Properties no part of the importer reads (display, attacher and material settings, twins).
SKIP = {'AttacherEngine', 'AttacherType', 'AttachmentOffset', 'AttachmentSupport', 'MapMode',
        'MapPathParameter', 'MapReversed', 'Label2', 'ShapeMaterial', 'History', 'Visibility',
        'columnWidths', 'rowHeights', 'AddSubShape', 'SuppressedShape', 'PreviewShape',
        'ExposeInternalGeometry', 'FullyConstrained', 'Exports', 'MakeInternals', 'InternalShape'}
TOKENS = [
    ('§a', '<Property name="'),
    ('§b', '</Property>'),
    ('§c', ' type="App::PropertyPlacement"><PropertyPlacement Px="'),
    ('§d', '" Q0="0" Q1="0" Q2="0" Q3="1" A="0" Ox="0" Oy="0" Oz="1"/>'),
    ('§e', ' type="App::PropertyLength"><Float value="'),
    ('§f', ' type="App::PropertyLink"><Link value="'),
    ('§g', ' type="App::PropertyString"'),
    ('§h', ' type="Part::PropertyPartShape"><Part ElementMap="15.70200.5" file="'),
    ('§i', '§aExpressionEngine" type="App::PropertyExpressionEngine"><ExpressionEngine count="0"></ExpressionEngine>§b'),
    ('§l', '<Extensions Count="1"><Extension type="Part::AttachExtension" name="AttachExtension"></Extension></Extensions>'),
    ('§m', '<Extension type="Part::AttachExtension" name="AttachExtension"></Extension>'),
    ('§j', ' type="App::PropertyAngle"><Float value="'),
    ('§k', ' type="App::PropertyBool"><Bool value="'),
]

def short_number(m):
    s = m.group(0)
    if '.' in s:
        s = s.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s

def clean_xml(xml):
    x = re.sub(r'<_Property [^>]*/>', '', xml)
    def drop(m):
        return '' if m.group(1) in SKIP else m.group(0)
    x = re.sub(r'<Property name="([^"]+)"[^>]*?(?:/>|>.*?</Property>)', drop, x, flags=re.S)
    x = re.sub(r'<ElementMap[^>]*?(?:/>|>.*?</ElementMap>)', '', x, flags=re.S)
    x = re.sub(r'<ElementMap2[^>]*/>', '', x)
    x = re.sub(r'>\s+<', '><', x).strip()
    x = re.sub(r'(?<=")-?\d+\.\d+(?=")', short_number, x)
    x = re.sub(r' status="\d+"', '', x)
    # A count that no longer matches what is left is fixed by the parts writer (the reader ignores it).
    for token, text in TOKENS:
        x = x.replace(text, token)
    return x

brep, brep_ix = [], {}
cases = {}
for c in d['cases']:
    objs = []
    for o in c['objects']:
        rec = {'object': o['object'], 'type': o['type'], 'label': o['label'],
               'xml': clean_xml(o['xml'])}
        if o.get('visibility') is False:
            rec['hidden'] = True
        if o.get('stored'):
            t = re.sub(' +', ' ', o['stored'])
            if t not in brep_ix:
                brep_ix[t] = len(brep)
                brep.append(t)
            rec['stored'] = brep_ix[t]
        if o.get('measure'):
            m = o['measure']
            rec['measure'] = {'solids': m['solids'], 'volume': m['volume'], 'area': m['area'],
                              'box': m['box'], 'centre': m['centre']}
        files = {k: v for k, v in (o.get('files') or {}).items() if not k.endswith('.Map.txt')}
        if files:
            rec['files'] = files
        if o.get('edges'):
            rec['edges'] = [[e['index'], e['first'], e['second']] for e in o['edges']]
        objs.append(rec)
    cases[c['name']] = {'note': c['note'], 'roots': c['roots'], 'objects': objs}

joined = '\u0000'.join(brep).encode('utf-8')
deflated = base64.b64encode(zlib.compress(joined, 9)[2:-4]).decode('ascii')
with open(out, 'w') as f:
    f.write('''/**
 * Test support (no production code): small Part-workbench documents made for the
 * primitives-and-booleans slice (ADR-0144 S11): boxes, cylinders, spheres and toruses
 * placed and turned, cuts, fuses and commons (and their several-operand forms) with and
 * without placements of their own, shared operands, stored leaves, a PartDesign body as an
 * operand, compounds, containers, refine, a split result, Part fillets and chamfers, mirrors,
 * spreadsheet-bound sizes and a chain of twelve cuts. The documents are ours: built with
 * FreeCAD 1.1.4 by the script beside this package
 * (`packages/fcstd/scripts/make-part-fixtures.py`; its JSON made this module by
 * `part-fixtures-to-module.py` beside it), so each object's XML, each stored shape, each
 * placement and the `EdgeN` numbering are FreeCAD's own. Each object is its own `<Object>`
 * element with the properties the importer never reads left out, white space between
 * elements dropped, trailing zeros cut and FreeCAD's repeated markup written as the tokens
 * of `PART_TOKENS` (`part-parts.ts` expands them); `hidden` where FreeCAD hides it, FreeCAD's
 * measures of its stored shape (`measure`: box as min then max), a Part fillet's or
 * chamfer's binary edge list (`files`, base64) and its edges (`edges`: index, first and
 * second size). Each distinct B-rep text is stored once, each run of spaces made one, the
 * texts joined by NUL and deflated (`PART_BREP_DEFLATED`, base64): plain, they are 586 KB.
 */
/* biome-ignore-all lint: generated data */

export interface PartFixtureObject {
  readonly object: string;
  readonly type: string;
  readonly label: string;
  readonly xml: string;
  readonly hidden?: true;
  readonly stored?: number;
  readonly measure?: {
    readonly solids: number;
    readonly volume: number;
    readonly area: number;
    readonly box: readonly number[];
    readonly centre: readonly number[];
  };
  readonly files?: Readonly<Record<string, string>>;
  readonly edges?: readonly (readonly [number, number, number])[];
}

export interface PartFixtureCase {
  readonly note: string;
  readonly roots: readonly string[];
  readonly objects: readonly PartFixtureObject[];
}

''')
    f.write('export const PART_TOKENS: readonly (readonly [string, string])[] = ')
    f.write(json.dumps(TOKENS, ensure_ascii=False))
    f.write(';\n\n')
    f.write('export const PART_BREP_DEFLATED = ')
    f.write(json.dumps(deflated))
    f.write(';\n\n')
    f.write('export const PART_CASES: Readonly<Record<string, PartFixtureCase>> = ')
    f.write(json.dumps(cases, ensure_ascii=False))
    f.write(' as never;\n')
