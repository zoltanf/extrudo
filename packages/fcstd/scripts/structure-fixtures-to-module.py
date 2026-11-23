# Turns the fixture JSON that make-structure-fixtures.py writes (FreeCAD's own output) into
# packages/fcstd/src/structure-fixtures.ts (ADR-0144 S12b): each object's own <Object> XML with
# the properties the importer never reads left out and white space between elements dropped,
# its visibility, FreeCAD's measures of its stored shape (`measure`), of the shape FreeCAD shows
# for it in the document's frame (`world`) and of its mesh (`mesh`), and its binary side entries
# (a mesh's kernel entry, a link array's placement and scale lists: `files`, base64). Each
# distinct B-rep text once, each run of spaces made one. Everything is one JSON text, deflated
# (base64): plain it is about 1 MB.
#
# Run, from the repository's root (FreeCAD 1.1 for the first step):
#   1. freecadcmd packages/fcstd/scripts/make-structure-fixtures.py <dir>
#   2. python3 packages/fcstd/scripts/structure-fixtures-to-module.py \
#        <dir>/fixtures.json packages/fcstd/src/structure-fixtures.ts
import base64, json, re, sys, zlib

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
SKIP = {'AttacherEngine', 'AttacherType', 'AttachmentOffset', 'AttachmentSupport', 'MapMode',
        'MapPathParameter', 'MapReversed', 'Label2', 'ShapeMaterial', 'History', 'Visibility',
        'AddSubShape', 'SuppressedShape', 'PreviewShape', 'ExposeInternalGeometry',
        'FullyConstrained', 'Exports', 'MakeInternals', 'InternalShape', '_ChildCache',
        '_Part_ShapeCache', 'ColoredElements', 'LinkCopyOnChangeGroup', 'LinkCopyOnChangeSource'}

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
    return x

def measure(m):
    return {k: m[k] for k in ('solids', 'volume', 'area', 'box', 'centre') if k in m}

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
        for key in ('measure', 'world'):
            if o.get(key) and 'error' not in o[key]:
                rec[key] = measure(o[key])
        if o.get('mesh'):
            rec['mesh'] = o['mesh']
        files = {k: v for k, v in (o.get('files') or {}).items() if not k.endswith('.Map.txt')}
        if files:
            rec['files'] = files
        objs.append(rec)
    cases[c['name']] = {'note': c['note'], 'roots': c['roots'], 'objects': objs}

text = json.dumps({'cases': cases, 'breps': brep}, ensure_ascii=False, separators=(',', ':'))
deflated = base64.b64encode(zlib.compress(text.encode('utf-8'), 9)[2:-4]).decode('ascii')
with open(out, 'w') as f:
    f.write('''/**
 * Test support (no production code): small documents made for the structure slice (ADR-0144
 * S12b): App::Part containers (placed, nested, empty, in a folder, hidden, labels that differ
 * only by case), links (moved, turned, LinkTransform both ways, hidden targets, to a part, to a
 * link, arrays with a placement list and with link elements, scaled), compounds at the top
 * (plain, placed, nested, overlapping) and meshes (closed, turned, hidden, in a part, of two
 * pieces, open, flat, empty). The documents are ours: built with FreeCAD 1.1.4 by the script
 * beside this package (`packages/fcstd/scripts/make-structure-fixtures.py`; its JSON made this
 * module by `structure-fixtures-to-module.py` beside it). One deflated JSON text (base64):
 * `structure-parts.ts` reads it.
 */
/* biome-ignore-all lint: generated data */

''')
    f.write('export const STRUCTURE_FIXTURES_DEFLATED =\n  ')
    f.write(json.dumps(deflated))
    f.write(';\n')
