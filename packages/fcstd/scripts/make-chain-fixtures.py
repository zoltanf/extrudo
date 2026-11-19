# Authored fixtures for the FreeCAD import's S12a: PartDesign features that are in no body
# (files from before bodies existed, and newer files whose features were never put in one).
# Our own parts, made with FreeCAD 1.1, so the stored shapes, the property grammar, the
# placements and the FaceN and EdgeN numbering are FreeCAD's own. FreeCAD 1.1 computes a
# feature outside a body when its BaseFeature is set (a dress-up without one is refused with
# "Missing container body"), so every feature after the first names its BaseFeature here. The
# old files' grammar (Sketch, Support, no BaseFeature, no MapMode) is derived from these in
# the tests (`chain-parts.ts`, `asOldFile`).
#
# Run: freecadcmd make-chain-fixtures.py <output directory>   (FreeCAD 1.1)
# Writes fixtures.json and log.txt into that directory, never beside the script (log.txt holds
# tracebacks with local paths). Then `chain-fixtures-to-module.py` makes the test module.
import base64, json, math, os, re, sys, tempfile, traceback, zipfile
import FreeCAD as App, Part, Sketcher

def output_dir():
    # The first argument after this script's own path (FreeCAD's sys.argv may hold its own first).
    me = os.path.basename(__file__)
    args = sys.argv[1:]
    for i, a in enumerate(sys.argv):
        if os.path.basename(a) == me:
            args = sys.argv[i + 1:]
            break
    args = [a for a in args if a != '--pass']
    if not args or not os.path.isdir(args[0]):
        sys.stderr.write('usage: freecadcmd %s <output directory>\n' % me)
        sys.exit(2)
    return os.path.abspath(args[0])

OUT = output_dir()
log = []
cases = []

SKIP = {
    'Shape', 'AddSubShape', 'SuppressedShape', 'PreviewShape', 'Label', 'Label2',
    'ExpressionEngine', '_Body', 'Proxy', 'Geometry', 'Constraints',
    'ExternalGeometry', 'ExternalGeo', 'InternalShape', 'ExposeInternalGeometry',
    'FullyConstrained', 'Exports', 'MakeInternals', 'cells',
}
V = App.Vector

def vec(v):
    return [v.x, v.y, v.z]

def place(p):
    q = p.Rotation.Q
    return {'base': vec(p.Base), 'q': [q[0], q[1], q[2], q[3]]}

def conv(f, name, v):
    t = f.getTypeIdOfProperty(name)
    if 'Enumeration' in t:
        names = f.getEnumerationsOfProperty(name) or []
        return {'enum': str(v), 'index': names.index(str(v)) if str(v) in names else None,
                'count': len(names), 'first': names[:12]}
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if hasattr(v, 'Base') and hasattr(v, 'Rotation'):
        return place(v)
    if hasattr(v, 'x') and hasattr(v, 'y') and hasattr(v, 'z'):
        return vec(v)
    if hasattr(v, 'Value') and hasattr(v, 'Unit'):
        return float(v.Value)
    if hasattr(v, 'TypeId') and hasattr(v, 'Name'):
        return {'link': v.Name}
    if isinstance(v, tuple) and len(v) == 2 and hasattr(v[0], 'Name'):
        return {'link': v[0].Name, 'subs': list(v[1])}
    if isinstance(v, (list, tuple)):
        out = []
        for x in v:
            if hasattr(x, 'Name') and hasattr(x, 'TypeId'):
                out.append({'link': x.Name})
            elif isinstance(x, tuple) and len(x) == 2 and hasattr(x[0], 'Name'):
                out.append({'link': x[0].Name, 'subs': list(x[1])})
            elif isinstance(x, (bool, int, float, str)):
                out.append(x)
            elif isinstance(x, tuple) and all(isinstance(y, (int, float)) for y in x):
                out.append(list(x))
            else:
                out.append(str(x)[:120])
        return out
    return str(v)[:200]

def props(f):
    out = {}
    for name in f.PropertiesList:
        if name in SKIP:
            continue
        try:
            out[name] = {'type': f.getTypeIdOfProperty(name), 'value': conv(f, name, f.getPropertyByName(name))}
        except Exception as e:
            out[name] = {'error': str(e)[:120]}
    return out

def centre(shape):
    solids = shape.Solids
    total = sum(s.Volume for s in solids)
    if not solids or total == 0:
        return None
    c = V(0, 0, 0)
    for s in solids:
        c = c + s.CenterOfMass * s.Volume
    return vec(c * (1.0 / total))

def measure(shape):
    bb = shape.BoundBox
    return {
        'solids': len(shape.Solids), 'volume': shape.Volume, 'area': shape.Area,
        'box': [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax],
        'centre': centre(shape), 'faces': len(shape.Faces), 'edges': len(shape.Edges),
        'shapeType': shape.ShapeType,
    }

def edge_info(shape, i):
    e = shape.Edges[i - 1]
    c = e.Curve
    mid = e.valueAt((e.FirstParameter + e.LastParameter) / 2)
    d = {'name': 'Edge%d' % i, 'curve': type(c).__name__, 'length': e.Length, 'mid': vec(mid),
         'ends': [vec(v.Point) for v in e.Vertexes]}
    if hasattr(c, 'Direction'):
        d['curveDirection'] = vec(c.Direction)
    if hasattr(c, 'Center'):
        d['curveCentre'] = vec(c.Center)
    if hasattr(c, 'Radius'):
        d['curveRadius'] = c.Radius
    return d

def object_xml(text, name):
    start = text.index('<ObjectData')
    m = re.search(r'<Object name="%s"[^>]*>.*?</Object>' % re.escape(name), text[start:], re.S)
    return m.group(0) if m else None

def expressions(o):
    return [{'path': p, 'expression': e} for p, e in (o.ExpressionEngine or [])]

OPERANDS = ('Base', 'Tool', 'Shapes', 'Links', 'Source', 'Sections', 'Spine', 'Profile', 'Group')

def operands(o):
    out = []
    for name in OPERANDS:
        if name not in o.PropertiesList:
            continue
        v = o.getPropertyByName(name)
        if v is None:
            continue
        if hasattr(v, 'Name'):
            out.append({'property': name, 'object': v.Name})
        elif isinstance(v, tuple) and len(v) == 2 and hasattr(v[0], 'Name'):
            out.append({'property': name, 'object': v[0].Name})
        elif isinstance(v, (list, tuple)):
            for x in v:
                if hasattr(x, 'Name'):
                    out.append({'property': name, 'object': x.Name})
    return out

def case(name, build, note=''):
    doc = App.newDocument(name)
    tmp = os.path.join(tempfile.mkdtemp(prefix='s12fx'), name + '.FCStd')
    try:
        roots = build(doc) or []
        doc.recompute()
        doc.saveAs(tmp)
        with zipfile.ZipFile(tmp) as z:
            xml = z.read('Document.xml').decode('utf-8')
            entries = {n: z.read(n) for n in z.namelist()}
        out = {'name': name, 'note': note, 'roots': [r.Name for r in roots], 'order': [o.Name for o in doc.Objects], 'objects': []}
        vols = []
        for o in doc.Objects:
            if o.isDerivedFrom('App::Origin') or o.isDerivedFrom('App::OriginFeature') or o.TypeId in ('App::Line', 'App::Plane', 'App::Point'):
                continue
            if 'Invalid' in o.State or 'Error' in o.State:
                raise RuntimeError('%s is invalid: %s' % (o.Name, o.State))
            ox = object_xml(xml, o.Name)
            rec = {'object': o.Name, 'type': o.TypeId, 'label': o.Label, 'props': props(o), 'xml': ox,
                   'operands': operands(o), 'usedBy': sorted(set(x.Name for x in o.InList))}
            ex = expressions(o)
            if ex:
                rec['expressions'] = ex
            if 'Placement' in o.PropertiesList:
                rec['placement'] = place(o.Placement)
            if 'Visibility' in o.PropertiesList:
                rec['visibility'] = bool(o.Visibility)
            # Binary side entries the object's XML names (a Part fillet's or chamfer's edge list), as base64.
            files = {}
            for fn in re.findall(r'file="([^"]+)"', ox or ''):
                if fn in entries and not fn.endswith('.brp'):
                    files[fn] = base64.b64encode(entries[fn]).decode('ascii')
            if files:
                rec['files'] = files
            if o.isDerivedFrom('Spreadsheet::Sheet'):
                rec['cells'] = {}
                for m in re.finditer(r'<Cell address="([^"]+)"([^>]*)/>', ox or ''):
                    a = m.group(1)
                    try:
                        v = o.get(a)
                        rec['cells'][a] = {'value': float(v.Value) if hasattr(v, 'Value') else v}
                    except Exception as e:
                        rec['cells'][a] = {'error': str(e)[:80]}
            if hasattr(o, 'Shape') and not o.Shape.isNull():
                rec['measure'] = measure(o.Shape)
                if o.Shape.Solids or o.TypeId == 'Part::Compound':
                    rec['stored'] = o.Shape.exportBrepToString()
                    vols.append('%s %.4f (%d solid%s)' % (o.Name, o.Shape.Volume, len(o.Shape.Solids), '' if len(o.Shape.Solids) == 1 else 's'))
                if o.TypeId in ('Part::Fillet', 'Part::Chamfer') and o.Base is not None:
                    rec['edges'] = [{'index': e[0], 'first': e[1], 'second': e[2], 'on': edge_info(o.Base.Shape, e[0])} for e in o.Edges]
            out['objects'].append(rec)
        cases.append(out)
        log.append('%s ok: roots %s; %s' % (name, ', '.join(out['roots']), ', '.join(vols)))
    except Exception:
        log.append('%s FAILED\n%s' % (name, traceback.format_exc()))
    finally:
        App.closeDocument(doc.Name)
        try:
            os.remove(tmp); os.rmdir(os.path.dirname(tmp))
        except Exception:
            pass

# --- builders ---------------------------------------------------------------

import math
import Part, Sketcher
import FreeCAD as App, Part, Sketcher
V = App.Vector

def rot(axis, deg):
    return App.Rotation(V(*axis), deg)

def hide(*objs):
    for o in objs:
        o.Visibility = False

def rect(sk, x0, y0, x1, y1):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    n = sk.GeometryCount
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        sk.addGeometry(Part.LineSegment(V(a[0], a[1], 0), V(b[0], b[1], 0)), False)
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint('Coincident', n + i, 2, n + (i + 1) % 4, 1))

def circle(sk, x, y, r):
    sk.addGeometry(Part.Circle(V(x, y, 0), V(0, 0, 1), r), False)

def free_sketch(doc, name, base=(0, 0, 0), axis=(0, 0, 1), deg=0.0):
    s = doc.addObject('Sketcher::SketchObject', name)
    s.Placement = App.Placement(V(*base), rot(axis, deg))
    return s

def face_sketch(doc, name, obj, pred):
    doc.recompute()
    i = next(i for i, f in enumerate(obj.Shape.Faces) if pred(f))
    s = doc.addObject('Sketcher::SketchObject', name)
    s.AttachmentSupport = [(obj, 'Face%d' % (i + 1))]
    s.MapMode = 'FlatFace'
    doc.recompute()
    return s

def top(z):
    return lambda f: f.Surface.TypeId == 'Part::GeomPlane' and abs(f.CenterOfMass.z - z) < 1e-6 and abs(abs(f.normalAt(0, 0).z) - 1) < 1e-6

def side_x(x):
    return lambda f: f.Surface.TypeId == 'Part::GeomPlane' and abs(f.CenterOfMass.x - x) < 1e-6 and abs(abs(f.normalAt(0, 0).x) - 1) < 1e-6

def feature(doc, kind, name, sk, base=None, **k):
    o = doc.addObject('PartDesign::' + kind, name)
    o.Profile = sk
    if base is not None:
        o.BaseFeature = base
        hide(base)
    for key, v in k.items():
        setattr(o, key, v)
    hide(sk)
    doc.recompute()
    if o.Shape.isNull() or not o.Shape.Solids:
        raise RuntimeError('%s has no solid' % name)
    return o

def plate(doc, name='Pad', l=40, w=30, h=8, **k):
    s = free_sketch(doc, name + 'Sketch', **k)
    rect(s, 0, 0, l, w)
    return feature(doc, 'Pad', name, s, Length=h)

# --- cases ------------------------------------------------------------------

def pad_only(doc):
    s = free_sketch(doc, 'Sketch', base=(5, 7, 9), axis=(1, 0, 0), deg=30)
    rect(s, 0, 0, 30, 20)
    return [feature(doc, 'Pad', 'Pad', s, Length=10)]

def pad_pocket(doc):
    p = plate(doc)
    s = face_sketch(doc, 'Sketch001', p, top(8))
    circle(s, 12, 10, 4)
    return [feature(doc, 'Pocket', 'Pocket', s, base=p, Length=5)]

def chain_five(doc):
    p = plate(doc)
    s1 = face_sketch(doc, 'Sketch001', p, top(8))
    circle(s1, 8, 8, 3)
    k1 = feature(doc, 'Pocket', 'Hole', s1, base=p, Type='ThroughAll')
    s2 = face_sketch(doc, 'Sketch002', k1, top(8))
    rect(s2, 20, 10, 32, 22)
    b = feature(doc, 'Pad', 'Boss', s2, base=k1, Length=6)
    s3 = face_sketch(doc, 'Sketch003', b, top(14))
    circle(s3, 26, 16, 3)
    k2 = feature(doc, 'Pocket', 'Recess', s3, base=b, Length=3)
    s4 = face_sketch(doc, 'Sketch004', k2, side_x(40))
    doc.recompute()
    # A square on the side face, in the sketch's own axes: found from the face's placement.
    inv = s4.Placement.inverse()
    a = inv.multVec(V(40, 5, 2)); c = inv.multVec(V(40, 12, 6))
    rect(s4, min(a.x, c.x), min(a.y, c.y), max(a.x, c.x), max(a.y, c.y))
    return [feature(doc, 'Pad', 'Lug', s4, base=k2, Length=4)]

def pad_kinds(doc):
    out = []
    s = free_sketch(doc, 'SketchA'); rect(s, 0, 0, 10, 10)
    out.append(feature(doc, 'Pad', 'Symmetric', s, Length=8, SideType='Symmetric'))
    s = free_sketch(doc, 'SketchB', base=(20, 0, 0)); rect(s, 0, 0, 10, 10)
    out.append(feature(doc, 'Pad', 'Reversed', s, Length=8, Reversed=True))
    s = free_sketch(doc, 'SketchC', base=(40, 0, 0)); rect(s, 0, 0, 10, 10)
    out.append(feature(doc, 'Pad', 'TwoSides', s, SideType='Two sides', Length=8, Length2=3))
    return out

def revolved(doc):
    s = free_sketch(doc, 'Sketch', axis=(1, 0, 0), deg=90)
    rect(s, 5, 0, 12, 20)
    r = doc.addObject('PartDesign::Revolution', 'Revolution')
    r.Profile = s
    r.ReferenceAxis = (s, ['V_Axis'])
    r.Angle = 360
    hide(s)
    doc.recompute()
    s2 = free_sketch(doc, 'Sketch001', axis=(1, 0, 0), deg=90)
    rect(s2, 10, 8, 14, 12)
    g = doc.addObject('PartDesign::Groove', 'Groove')
    g.Profile = s2
    g.BaseFeature = r
    g.ReferenceAxis = (s2, ['V_Axis'])
    g.Angle = 360
    hide(s2, r)
    doc.recompute()
    return [g]

def on_part_box(doc):
    b = doc.addObject('Part::Box', 'Box'); b.Length = 30; b.Width = 20; b.Height = 10
    s = face_sketch(doc, 'Sketch', b, top(10))
    rect(s, 5, 5, 15, 15)
    p = feature(doc, 'Pad', 'Pad', s, base=b, Length=5)
    s2 = face_sketch(doc, 'Sketch001', p, top(15))
    circle(s2, 10, 10, 2)
    return [feature(doc, 'Pocket', 'Pocket', s2, base=p, Length=3)]

def on_part_cut(doc):
    b = doc.addObject('Part::Box', 'Box'); b.Length = 30; b.Width = 20; b.Height = 10
    c = doc.addObject('Part::Cylinder', 'Cylinder'); c.Radius = 4; c.Height = 10
    c.Placement = App.Placement(V(22, 10, 0), App.Rotation())
    cut = doc.addObject('Part::Cut', 'Cut'); cut.Base = b; cut.Tool = c
    hide(b, c)
    s = face_sketch(doc, 'Sketch', cut, top(10))
    rect(s, 2, 2, 12, 18)
    return [feature(doc, 'Pad', 'Pad', s, base=cut, Length=4)]

def tip_in_tree(doc):
    p = plate(doc)
    s = face_sketch(doc, 'Sketch001', p, top(8))
    circle(s, 12, 10, 4)
    k = feature(doc, 'Pocket', 'Pocket', s, base=p, Length=5)
    c = doc.addObject('Part::Cylinder', 'Cylinder'); c.Radius = 3; c.Height = 20
    c.Placement = App.Placement(V(30, 20, -5), App.Rotation())
    cut = doc.addObject('Part::Cut', 'Cut'); cut.Base = k; cut.Tool = c
    hide(k, c)
    p2 = plate(doc, 'Slab', 20, 20, 5, base=(0, 60, 0))
    b = doc.addObject('Part::Box', 'Box'); b.Length = 10; b.Width = 10; b.Height = 10
    b.Placement = App.Placement(V(15, 65, 0), App.Rotation())
    fuse = doc.addObject('Part::MultiFuse', 'Fusion'); fuse.Shapes = [p2, b]
    hide(p2, b)
    doc.recompute()
    return [cut, fuse]

def branch(doc):
    p = plate(doc)
    s1 = face_sketch(doc, 'Sketch001', p, top(8))
    circle(s1, 10, 10, 4)
    a = feature(doc, 'Pocket', 'PocketA', s1, base=p, Length=5)
    s2 = face_sketch(doc, 'Sketch002', p, top(8))
    rect(s2, 22, 5, 34, 25)
    b = feature(doc, 'Pocket', 'PocketB', s2, base=p, Length=2)
    a.Visibility = True; b.Visibility = True
    return [a, b]

def in_part(doc):
    part = doc.addObject('App::Part', 'Part')
    part.Placement = App.Placement(V(50, 0, 0), rot((0, 0, 1), 30))
    p = plate(doc)
    s = face_sketch(doc, 'Sketch001', p, top(8))
    circle(s, 12, 10, 4)
    k = feature(doc, 'Pocket', 'Pocket', s, base=p, Length=5)
    for o in (p.Profile[0] if isinstance(p.Profile, tuple) else p.Profile, p, s, k):
        part.addObject(o)
    q = plate(doc, 'Loose', 10, 10, 3, base=(0, -40, 0))
    doc.recompute()
    return [k, q]

def long_chain(doc):
    cur = plate(doc, 'Pad', 130, 20, 6)
    for i in range(12):
        s = face_sketch(doc, 'HoleSketch%d' % i, cur, top(6))
        circle(s, 8 + 10 * i, 10, 3)
        cur = feature(doc, 'Pocket', 'Hole%d' % i, s, base=cur, Length=2 + (i % 3))
    return [cur]

def bound(doc):
    sheet = doc.addObject('Spreadsheet::Sheet', 'Spreadsheet')
    sheet.set('A1', '12'); sheet.setAlias('A1', 'height')
    sheet.set('A2', '4'); sheet.setAlias('A2', 'depth')
    sheet.set('A3', '30'); sheet.setAlias('A3', 'length')
    doc.recompute()
    s = free_sketch(doc, 'Sketch')
    rect(s, 0, 0, 30, 20)
    s.addConstraint(Sketcher.Constraint('DistanceX', 0, 1, 0, 2, 30))
    s.setExpression('Constraints[%d]' % (s.ConstraintCount - 1), 'Spreadsheet.length')
    s.addConstraint(Sketcher.Constraint('DistanceY', 1, 1, 1, 2, 20))
    for i in (0, 2):
        s.addConstraint(Sketcher.Constraint('Horizontal', i))
    for i in (1, 3):
        s.addConstraint(Sketcher.Constraint('Vertical', i))
    s.addConstraint(Sketcher.Constraint('Coincident', 0, 1, -1, 1))
    p = feature(doc, 'Pad', 'Pad', s, Length=12)
    p.setExpression('Length', 'Spreadsheet.height')
    s2 = face_sketch(doc, 'Sketch001', p, top(12))
    circle(s2, 10, 10, 4)
    k = feature(doc, 'Pocket', 'Pocket', s2, base=p, Length=4)
    k.setExpression('Length', 'Spreadsheet.depth')
    doc.recompute()
    return [k]

def edges_where(shape, pred):
    return ['Edge%d' % (i + 1) for i, e in enumerate(shape.Edges) if pred(e)]

def vertical(e):
    v = e.Vertexes
    return len(v) == 2 and abs(v[0].X - v[1].X) < 1e-6 and abs(v[0].Y - v[1].Y) < 1e-6 and abs(v[0].Z - v[1].Z) > 1e-6

def dressup(doc, kind, name, base, edges, **k):
    f = doc.addObject('PartDesign::' + kind, name)
    f.Base = (base, edges)
    f.BaseFeature = base
    for key, v in k.items():
        setattr(f, key, v)
    hide(base)
    doc.recompute()
    if f.Shape.isNull() or not f.Shape.Solids:
        raise RuntimeError('%s has no solid' % name)
    return f

def dressups(doc):
    p = plate(doc)
    f = dressup(doc, 'Fillet', 'Fillet', p, edges_where(p.Shape, vertical), Radius=3)
    s = face_sketch(doc, 'Sketch001', f, top(8))
    circle(s, 20, 15, 6)
    k = feature(doc, 'Pocket', 'Pocket', s, base=f, Length=4)
    rim = edges_where(k.Shape, lambda e: e.Curve.TypeId == 'Part::GeomCircle' and abs(e.Curve.Radius - 6) < 1e-6 and abs(e.CenterOfMass.z - 8) < 1e-6)
    return [dressup(doc, 'Chamfer', 'Chamfer', k, rim, Size=1)]

def pattern(doc, kind, name, base, originals, **k):
    t = doc.addObject('PartDesign::' + kind, name)
    t.Originals = originals
    t.BaseFeature = base
    for key, v in k.items():
        setattr(t, key, v)
    hide(base)
    doc.recompute()
    if t.Shape.isNull() or not t.Shape.Solids:
        raise RuntimeError('%s has no solid' % name)
    return t

def patterns(doc):
    p = plate(doc, 'Pad', 60, 60, 8)
    s = face_sketch(doc, 'Sketch001', p, top(8))
    circle(s, 6, 6, 2)
    k = feature(doc, 'Pocket', 'Pocket', s, base=p, Length=3)
    lp = pattern(doc, 'LinearPattern', 'LinearPattern', k, [k], Direction=(s, ['H_Axis']), Length=20, Occurrences=3)
    s2 = face_sketch(doc, 'Sketch002', lp, top(8))
    rect(s2, 40, 28, 46, 32)
    b = feature(doc, 'Pad', 'Boss', s2, base=lp, Length=5)
    cs = free_sketch(doc, 'AxisSketch', base=(30, 30, 0))
    cs.addGeometry(Part.LineSegment(V(0, 0, 0), V(5, 0, 0)), True)
    hide(cs)
    doc.recompute()
    pp = pattern(doc, 'PolarPattern', 'PolarPattern', b, [b], Axis=(cs, ['N_Axis']), Angle=360, Occurrences=4)
    s3 = face_sketch(doc, 'Sketch003', pp, top(8))
    circle(s3, 10, 50, 3)
    k2 = feature(doc, 'Pocket', 'Corner', s3, base=pp, Type='ThroughAll')
    return [pattern(doc, 'Mirrored', 'Mirrored', k2, [k2], MirrorPlane=(cs, ['V_Axis']))]

def pattern_two(doc):
    # A linear pattern of two originals, the second built on the first.
    p = plate(doc, 'Pad', 60, 30, 8)
    s = face_sketch(doc, 'Sketch001', p, top(8))
    circle(s, 6, 8, 2)
    k1 = feature(doc, 'Pocket', 'Round', s, base=p, Length=3)
    s2 = face_sketch(doc, 'Sketch002', k1, top(8))
    rect(s2, 4, 18, 8, 24)
    k2 = feature(doc, 'Pocket', 'Square', s2, base=k1, Length=2)
    return [pattern(doc, 'LinearPattern', 'LinearPattern', k2, [k1, k2], Direction=(s, ['H_Axis']), Length=30, Occurrences=3)]

case('pad_only', pad_only, 'one pad on a sketch placed off the origin and tilted, no body')
case('pad_pocket', pad_pocket, 'a pad and a pocket sketched on its top face, no body')
case('chain_five', chain_five, 'pad, through hole, boss on the top face, recess in the boss, a lug on a side face')
case('pad_kinds', pad_kinds, 'three chains of one pad: symmetric, reversed, two sides')
case('revolved', revolved, 'a revolution about a sketch axis and a groove in it, no body')
case('on_part_box', on_part_box, 'a pad and a pocket built on a Part box')
case('on_part_cut', on_part_cut, 'a pad built on a Part cut of a box by a cylinder')
case('tip_in_tree', tip_in_tree, 'a chain as the base of a Part cut; a chain as a member of a MultiFuse')
case('branch', branch, 'two pockets that each continue the same pad: two tips, both visible')
case('in_part', in_part, 'a chain inside a moved and turned App::Part, and a chain at the top')
case('long_chain', long_chain, 'a pad and twelve pockets, each sketched on the one before')
case('bound', bound, 'a pad and a pocket whose sizes read a spreadsheet, a bound sketch dimension')
case('dressups', dressups, 'a fillet on a pad, a pocket in it, a chamfer on the pocket rim; every feature names its BaseFeature')
case('pattern_two', pattern_two, 'a linear pattern of two pockets, the second built on the first')
case('patterns', patterns, 'a linear pattern of a pocket, a polar pattern of a boss about a sketch normal, a mirrored through hole')

with open(os.path.join(OUT, 'fixtures.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'cases': cases}, fh, indent=1)
with open(os.path.join(OUT, 'log.txt'), 'w') as fh:
    fh.write('\n'.join(log) + '\n')
os._exit(0)
