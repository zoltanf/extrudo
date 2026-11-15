# Turns the fixture JSON that make-reference-fixtures.py writes (FreeCAD's own
# output) into packages/fcstd/src/reference-fixtures.ts: each distinct B-rep text
# once (runs of spaces made one), each distinct property list once, sketches as
# their geometry, placement, constraints, external links, stored projections,
# support and map mode. The cases come out in the order of the files given.
#
# Run, from the repository's root (FreeCAD 1.1 for the first step):
#   1. freecadcmd packages/fcstd/scripts/make-reference-fixtures.py <dir>
#        writes <dir>/fixtures.json (and log.txt)
#   2. python3 packages/fcstd/scripts/reference-fixtures-to-module.py \
#        <fixtures.json> [<fixtures.json> ...] packages/fcstd/src/reference-fixtures.ts
#   3. pnpm biome format --write packages/fcstd/src/reference-fixtures.ts
# The module checked in was made from two runs, S9's parts first, then the
# arcs amendment's (`external_arc_*`).
import json, re, sys
srcs, out = sys.argv[1:-1], sys.argv[-1]
d = {'cases': [c for src in srcs for c in json.load(open(src))['cases']]}
SKIP = {'Shape', 'AddSubShape', 'SuppressedShape', 'PreviewShape', 'Label', 'Label2', 'Visibility',
        'ExpressionEngine', 'Placement', 'ShapeMaterial', 'MapPathParameter', 'AttacherEngine',
        'AttacherType', '_ElementMapVersion', 'ResizeMode'}
brep, brep_ix = [], {}
props, props_ix = [], {}
def attrs(s):
    return dict(re.findall(r'(\w+)="([^"]*)"', s))
def unesc(s):
    return s.replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
def num(s):
    v = float(s)
    return int(v) if v == int(v) and abs(v) < 1e15 else v
def value(name, inner, pyprops):
    m = re.match(r'\s*<(\w+)([^>]*?)(/?)>', inner)
    tag, a = m.group(1), attrs(m.group(2))
    if tag == 'Float': return num(a['value'])
    if tag == 'Integer':
        if a.get('CustomEnum') == 'true':
            names = [unesc(x) for x in re.findall(r'<Enum value="([^"]*)"', inner)]
            return {'index': int(a['value']), 'names': names}
        return int(a['value'])
    if tag == 'Bool': return a['value'] == 'true'
    if tag == 'String': return {'string': unesc(a['value'])}
    if tag == 'Link': return {'link': a['value']}
    if tag == 'LinkSub':
        return {'sub': [a['value'], [unesc(x) for x in re.findall(r'<Sub value="([^"]*)"', inner)]]}
    if tag == 'LinkList': return {'list': re.findall(r'<Link value="([^"]*)"', inner)}
    if tag == 'LinkSubList':
        return {'subList': [[o, unesc(s)] for o, s in re.findall(r'<Link obj="([^"]*)" sub="([^"]*)"', inner)]}
    if tag == 'PropertyVector': return {'vector': [num(a['valueX']), num(a['valueY']), num(a['valueZ'])]}
    if tag == 'PropertyPlacement':
        return {'raw': '<PropertyPlacement ' + ' '.join(f'{k}="{a[k]}"' for k in ('Px','Py','Pz','Q0','Q1','Q2','Q3','A','Ox','Oy','Oz') if k in a) + '/>'}
    if tag == 'FloatList':
        if not a.get('file'): return {'floats': []}
        return {'floats': list(pyprops[name]['value'])}
    if tag == 'IntegerList': return {'ints': [int(x) for x in re.findall(r'<I v="([^"]*)"', inner)]}
    return None
def placement_at(xml):
    pl = attrs(re.search(r'<Property name="Placement"[^>]*>\s*<PropertyPlacement([^>]*)/>', xml).group(1))
    return [num(pl[k]) for k in ('Px', 'Py', 'Pz', 'Q0', 'Q1', 'Q2', 'Q3')]
def prop_inner(xml, name):
    m = re.search(r'<Property name="' + name + r'" type="[^"]+"[^>]*>(.*?)</Property>', xml, re.S)
    return m.group(1) if m else None
cases = {}
for c in d['cases']:
    objs = []
    for o in c['objects']:
        if o['type'].startswith('Sketcher'):
            x = o['xml']
            geo = []
            for g in o['geometry']:
                e = None
                if g['type'] == 'LineSegment': e = ['line', num(g['start'][0]), num(g['start'][1]), num(g['end'][0]), num(g['end'][1])]
                elif g['type'] == 'Circle': e = ['circle', num(g['centre'][0]), num(g['centre'][1]), num(g['radius'])]
                else: raise SystemExit('geometry ' + g['type'])
                if g['construction']: e.append('construction')
                geo.append(e)
            s = {'at': placement_at(x), 'geometry': geo}
            cons = []
            for m in re.finditer(r'<Constrain ([^>]*)/>', x):
                a = attrs(m.group(1))
                r = [int(a['Type']), num(a['Value']), int(a['First']), int(a['FirstPos']), int(a['Second']), int(a['SecondPos']), int(a['Third']), int(a['ThirdPos'])]
                if a.get('Name') or a.get('IsDriving') != '1' or a.get('IsActive') != '1':
                    r += [unesc(a.get('Name', '')), a.get('IsDriving') == '1', a.get('IsActive') == '1']
                cons.append(r)
            if cons: s['constraints'] = cons
            ext = prop_inner(x, 'ExternalGeometry')
            links = re.findall(r'<Link obj="([^"]*)" sub="([^"]*)"(?: shadow="([^"]*)")?', ext or '')
            if links: s['external'] = [[a, unesc(b), unesc(sh)] for a, b, sh in links]
            eg = prop_inner(x, 'ExternalGeo')
            entries = []
            for m in re.finditer(r'<Geometry type="([^"]+)"([^>]*)>(.*?)</Geometry>', eg or '', re.S):
                t, ga, body = m.groups()
                ref = unesc(attrs(ga).get('ref', ''))
                if 'LineSegment' in t:
                    la = attrs(re.search(r'<LineSegment([^>]*)/>', body).group(1))
                    entries.append(['line', num(la['StartX']), num(la['StartY']), num(la['EndX']), num(la['EndY']), ref])
                elif 'ArcOfCircle' in t:
                    ca = attrs(re.search(r'<ArcOfCircle([^>]*)/>', body).group(1))
                    entries.append(['arc', num(ca['CenterX']), num(ca['CenterY']), num(ca['Radius']), num(ca['AngleXU']), num(ca['StartAngle']), num(ca['EndAngle']), num(ca['NormalZ']), ref])
                elif 'Circle' in t:
                    ca = attrs(re.search(r'<Circle([^>]*)/>', body).group(1))
                    entries.append(['circle', num(ca['CenterX']), num(ca['CenterY']), num(ca['Radius']), ref])
                else: raise SystemExit('external ' + t)
            if len(entries) > 2 or links: s['externalGeo'] = entries[2:]
            sup = prop_inner(x, 'AttachmentSupport')
            sl = re.findall(r'<Link obj="([^"]*)" sub="([^"]*)"', sup or '')
            if sl: s['support'] = [[a, unesc(b)] for a, b in sl]
            mm = o['props'].get('MapMode', {}).get('value')
            if isinstance(mm, dict): s['mapMode'] = mm['enum']
            objs.append({'object': o['object'], 'sketch': s})
            continue
        plist = []
        for m in re.finditer(r'<Property name="([^"]+)" type="([^"]+)"[^>]*>(.*?)</Property>', o['xml'], re.S):
            name, typ, inner = m.groups()
            if name in SKIP: continue
            v = value(name, inner, o['props'])
            if v is None: continue
            plist.append([name, typ, v])
        key = json.dumps(plist)
        if key not in props_ix: props_ix[key] = len(props); props.append(plist)
        rec = {'object': o['object'], 'type': o['type'], 'props': props_ix[key]}
        at = placement_at(o['xml'])
        if at != [0, 0, 0, 0, 0, 0, 1]: rec['at'] = at
        if o.get('stored'):
            t = re.sub(' +', ' ', o['stored'])
            if t not in brep_ix: brep_ix[t] = len(brep); brep.append(t)
            rec['stored'] = brep_ix[t]
        if o.get('measure'):
            m = o['measure']
            rec['measure'] = {'volume': m['volume'], 'area': m['area'], 'box': m['box'], 'centre': m['centre']}
        objs.append(rec)
    cases[c['name']] = {'note': c['note'], 'tip': c['tip'], 'group': c['group'], 'objects': objs}
with open(out, 'w') as f:
    f.write('''/**
 * Test support (no production code): small PartDesign parts made for the
 * references slice (ADR-0144 S9): up-to extents, an edge or a datum line as an
 * axis, datum lines and planes as a pattern's or mirror's reference, sketches
 * on tilted planes and faces, and projected (external) geometry in sketches.
 * The parts are ours: built with FreeCAD 1.1.4 by the script beside this
 * package (`packages/fcstd/scripts/make-reference-fixtures.py`, its JSON made
 * this module by `reference-fixtures-to-module.py` beside it), so each
 * stored shape, each property as FreeCAD writes it and the `EdgeN` / `FaceN`
 * numbering are FreeCAD's own. The same form as `pattern-fixtures.ts` (read by
 * `pattern-parts.ts`): each distinct B-rep text once (`REF_BREP`, each run of
 * spaces made one), each distinct property list once (`REF_PROPS`; labels,
 * shapes and display settings left out), a datum's stored placement (`at`),
 * FreeCAD's measures of each stored shape; sketches as their geometry, stored
 * placement, constraints (type, value, first, its position, second, its
 * position, third, its position), external links (object, element, shadow
 * name), external geometry as FreeCAD stored it (after the two axes, in the
 * sketch's coordinates, with its `ref`; an arc as centre, radius, `AngleXU`,
 * start and end angles and its normal's Z), support and map mode. The
 * `external_arc_*` parts are S9's arcs amendment's.
 */
/* biome-ignore-all lint: generated data */
import type { FixtureProp, PatternFixtureCase } from './pattern-fixtures';

''')
    f.write('export const REF_BREP: readonly string[] = [\n')
    for t in brep: f.write('  ' + json.dumps(t) + ',\n')
    f.write('];\nexport const REF_PROPS: readonly (readonly FixtureProp[])[] = [\n')
    for p in props: f.write('  ' + json.dumps(p) + ',\n')
    f.write('];\nexport const REF_CASES: Readonly<Record<string, PatternFixtureCase>> = ' + json.dumps(cases, indent=1) + ';\n')
print(len(brep), len(props), len(cases))
