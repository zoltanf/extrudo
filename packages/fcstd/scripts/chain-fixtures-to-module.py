# Turns the fixture JSON that make-chain-fixtures.py writes (FreeCAD's own output) into
# packages/fcstd/src/chain-fixtures.ts (ADR-0144 S12a): each object's own <Object> XML with the
# properties the importer never reads left out and white space between elements dropped, its
# visibility and FreeCAD's measures of its stored shape. Each distinct B-rep text once, each run
# of spaces made one. Everything is one JSON text, deflated (base64): plain it is about 1 MB.
#
# Run, from the repository's root (FreeCAD 1.1 for the first step):
#   1. freecadcmd packages/fcstd/scripts/make-chain-fixtures.py <dir>
#   2. python3 packages/fcstd/scripts/chain-fixtures-to-module.py \
#        <dir>/fixtures.json packages/fcstd/src/chain-fixtures.ts
import base64, json, re, sys, zlib

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
# Display settings, side shapes and twins no part of the importer reads. The attacher's
# properties stay: a sketch's support is what a chain's base is read from.
SKIP = {'Label2', 'ShapeMaterial', 'History', 'Visibility', 'columnWidths', 'rowHeights',
        'AddSubShape', 'SuppressedShape', 'PreviewShape', 'ExposeInternalGeometry',
        'FullyConstrained', 'Exports', 'MakeInternals', 'InternalShape'}

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
    x = re.sub(r' shadow="[^"]*"', '', x)
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
        objs.append(rec)
    cases[c['name']] = {'note': c['note'], 'roots': c['roots'], 'objects': objs}

text = json.dumps({'cases': cases, 'breps': brep}, ensure_ascii=False, separators=(',', ':'))
deflated = base64.b64encode(zlib.compress(text.encode('utf-8'), 9)[2:-4]).decode('ascii')
with open(out, 'w') as f:
    f.write('''/**
 * Test support (no production code): small documents of PartDesign features that are in no
 * body (ADR-0144 S12a). The documents are ours: built with FreeCAD 1.1.4 by the script beside
 * this package (`packages/fcstd/scripts/make-chain-fixtures.py`; its JSON made this module by
 * `chain-fixtures-to-module.py`), so each object's XML, each stored shape, each placement and
 * the `FaceN` and `EdgeN` numbering are FreeCAD's own. `chain-parts.ts` reads it.
 */
/* biome-ignore-all lint: generated data */
export const CHAIN_FIXTURES_DEFLATED =
  '%s';
''' % deflated)
print(len(text), len(deflated))
