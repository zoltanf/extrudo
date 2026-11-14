# Authored fixtures for the FreeCAD import's S8 (the stored-shape step in the middle of a body):
# bodies with a feature the importer doesn't map between ones it does. Our own parts, made here with FreeCAD, so
# the stored shapes, the property grammar and the EdgeN / FaceN numbering are
# FreeCAD's own. Writes fixtures.json (no file metadata: only the objects'
# own XML from Document.xml, never the document's properties).
#
# Run: freecadcmd make-step-fixtures.py <output directory>   (FreeCAD 1.1)
# Writes fixtures.json and log.txt into that directory, never beside the script
# (log.txt holds tracebacks with local paths). The directory is the first argument
# after the script's path in sys.argv (a `--pass` before it is skipped).
import json, math, os, re, sys, tempfile, traceback, zipfile
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
    'Visibility', 'ExpressionEngine', '_Body', 'Proxy', 'Geometry', 'Constraints',
    'ExternalGeometry', 'ExternalGeo', 'InternalShape', 'ExposeInternalGeometry',
    'FullyConstrained', 'Exports', 'MakeInternals',
}

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
    c = App.Vector(0, 0, 0)
    for s in solids:
        c = c + s.CenterOfMass * s.Volume
    return vec(c * (1.0 / total))

def measure(shape):
    bb = shape.BoundBox
    return {
        'solids': len(shape.Solids), 'volume': shape.Volume, 'area': shape.Area,
        'box': [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax],
        'centre': centre(shape), 'faces': len(shape.Faces), 'edges': len(shape.Edges),
    }

def element(shape, name):
    e = shape.getElement(name)
    if name.startswith('Edge'):
        c = e.Curve
        mid = e.valueAt((e.FirstParameter + e.LastParameter) / 2)
        d = {'name': name, 'curve': type(c).__name__, 'length': e.Length, 'mid': vec(mid),
             'ends': [vec(v.Point) for v in e.Vertexes], 'orientation': e.Orientation}
        if hasattr(c, 'Direction'):
            d['curveDirection'] = vec(c.Direction)
        if hasattr(c, 'Location'):
            d['curveLocation'] = vec(c.Location)
        if hasattr(c, 'Axis'):
            d['curveAxis'] = vec(c.Axis)
        if hasattr(c, 'Center'):
            d['curveCentre'] = vec(c.Center)
        return d
    if name.startswith('Face'):
        s = e.Surface
        d = {'name': name, 'surface': type(s).__name__, 'area': e.Area, 'centre': vec(e.CenterOfMass),
             'edges': len(e.Edges), 'orientation': e.Orientation}
        if hasattr(s, 'Axis'):
            d['surfaceAxis'] = vec(s.Axis)
        if hasattr(s, 'Position'):
            d['surfacePosition'] = vec(s.Position)
        return d
    return {'name': name}

def sub_info(f):
    out = {}
    for name in f.PropertiesList:
        if name in SKIP:
            continue
        try:
            v = f.getPropertyByName(name)
        except Exception:
            continue
        if isinstance(v, tuple) and len(v) == 2 and hasattr(v[0], 'Shape'):
            subs = [s for s in v[1] if re.match(r'^(Edge|Face)\d+$', s)]
            if subs:
                out[name] = [element(v[0].Shape, s) for s in subs]
    return out

def sketch_geometry(sk):
    out = []
    for i, g in enumerate(sk.Geometry):
        d = {'index': i, 'type': type(g).__name__, 'construction': bool(sk.getConstruction(i))}
        if hasattr(g, 'StartPoint'):
            d['start'] = vec(g.StartPoint); d['end'] = vec(g.EndPoint)
        if hasattr(g, 'Center'):
            d['centre'] = vec(g.Center)
        if hasattr(g, 'Radius'):
            d['radius'] = g.Radius
        if hasattr(g, 'X') and type(g).__name__ == 'Point':
            d['point'] = [g.X, g.Y, g.Z]
        out.append(d)
    return out

def object_xml(text, name):
    start = text.index('<ObjectData')
    m = re.search(r'<Object name="%s"[^>]*>.*?</Object>' % re.escape(name), text[start:], re.S)
    return m.group(0) if m else None

def case(name, build, note=''):
    doc = App.newDocument(name)
    tmp = os.path.join(tempfile.mkdtemp(prefix='s8fx'), name + '.FCStd')
    try:
        body = doc.addObject('PartDesign::Body', 'Body')
        build(doc, body)
        doc.recompute()
        last = [o for o in body.Group if o.isDerivedFrom('PartDesign::Feature') and not o.Shape.isNull() and o.Shape.Solids]
        doc.saveAs(tmp)
        with zipfile.ZipFile(tmp) as z:
            xml = z.read('Document.xml').decode('utf-8')
        out = {'name': name, 'note': note, 'tip': body.Tip.Name if body.Tip else None,
               'group': [o.Name for o in body.Group], 'objects': []}
        vols = []
        for o in body.Group:
            if o.isDerivedFrom('App::Origin'):
                continue
            if 'Invalid' in o.State or 'Error' in o.State:
                raise RuntimeError('%s is invalid: %s' % (o.Name, o.State))
            rec = {'object': o.Name, 'type': o.TypeId, 'props': props(o), 'xml': object_xml(xml, o.Name)}
            if o.isDerivedFrom('Sketcher::SketchObject'):
                rec['geometry'] = sketch_geometry(o)
            elif hasattr(o, 'Shape') and not o.Shape.isNull() and o.Shape.Solids:
                rec['stored'] = o.Shape.exportBrepToString()
                rec['measure'] = measure(o.Shape)
                vols.append('%s %.4f' % (o.Name, o.Shape.Volume))
            info = sub_info(o)
            if info:
                rec['subInfo'] = info
            out['objects'].append(rec)
        cases.append(out)
        log.append('%s ok: tip %s; %s' % (name, out['tip'], ', '.join(vols)))
    except Exception:
        log.append('%s FAILED\n%s' % (name, traceback.format_exc()))
    finally:
        App.closeDocument(doc.Name)
        try:
            os.remove(tmp); os.rmdir(os.path.dirname(tmp))
        except Exception:
            pass

# --- builders ---------------------------------------------------------------

def transform(body, kind, name):
    # newObject leaves the Tip where it was for a transform without originals: set it, as the GUI does.
    f = body.newObject('PartDesign::' + kind, name)
    body.Tip = f
    return f

def origin(body, role):
    return [o for o in body.Origin.OriginFeatures if o.Role == role][0]

def sketch(body, name, z=0.0):
    sk = body.newObject('Sketcher::SketchObject', name)
    sk.AttachmentSupport = (origin(body, 'XY_Plane'), [''])
    sk.MapMode = 'FlatFace'
    if z:
        sk.AttachmentOffset = App.Placement(App.Vector(0, 0, z), App.Rotation())
    return sk

def rect(sk, x0, y0, x1, y1):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    n = sk.GeometryCount
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        sk.addGeometry(Part.LineSegment(App.Vector(a[0], a[1], 0), App.Vector(b[0], b[1], 0)), False)
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint('Coincident', n + i, 2, n + (i + 1) % 4, 1))

def circle(sk, x, y, r):
    sk.addGeometry(Part.Circle(App.Vector(x, y, 0), App.Vector(0, 0, 1), r), False)

def plate(doc, body, x0, y0, x1, y1, h):
    sk = sketch(body, 'Sketch')
    rect(sk, x0, y0, x1, y1)
    pad = body.newObject('PartDesign::Pad', 'Pad')
    pad.Profile = sk
    pad.Length = h
    doc.recompute()
    return sk, pad

def pocket(doc, body, z, circles, depth, name='Pocket'):
    sk = sketch(body, name + 'Sketch', z)
    for c in circles:
        circle(sk, *c)
    p = body.newObject('PartDesign::Pocket', name)
    p.Profile = sk
    p.Length = depth
    doc.recompute()
    return sk, p

def boss(doc, body, z, box, h, name='Boss'):
    sk = sketch(body, name + 'Sketch', z)
    rect(sk, *box)
    p = body.newObject('PartDesign::Pad', name)
    p.Profile = sk
    p.Length = h
    doc.recompute()
    return sk, p

def find_edge(shape, pred):
    return ['Edge%d' % (i + 1) for i, e in enumerate(shape.Edges) if pred(e)]

def find_face(shape, pred):
    return ['Face%d' % (i + 1) for i, f in enumerate(shape.Faces) if pred(f)]

def mid_of(e):
    return e.valueAt((e.FirstParameter + e.LastParameter) / 2)

def near(a, b):
    return abs(a - b) < 1e-9

# --- features the importer doesn't map (S8's steps) ---------------------------
# The plate: 40 x 20 x 10 centred on the origin, unless a part says otherwise.

def draft(doc, body, base, angle=5.0, name='Draft'):
    # The four side faces drafted about the bottom face.
    sides = find_face(base.Shape, lambda f: abs(f.normalAt(0, 0).z) < 1e-6 and type(f.Surface).__name__ == 'Plane')
    bottom = find_face(base.Shape, lambda f: near(f.CenterOfMass.z, 0) and abs(abs(f.normalAt(0, 0).z) - 1) < 1e-6)
    d = body.newObject('PartDesign::Draft', name)
    d.Base = (base, sides)
    d.NeutralPlane = (base, bottom)
    d.Angle = angle
    doc.recompute()
    return d

def thickness(doc, body, base, value=1.5, name='Thickness'):
    # The top face opened, the rest a wall.
    zmax = base.Shape.BoundBox.ZMax
    top = find_face(base.Shape, lambda f: near(f.CenterOfMass.z, zmax) and abs(abs(f.normalAt(0, 0).z) - 1) < 1e-6)
    t = body.newObject('PartDesign::Thickness', name)
    t.Base = (base, top[:1])
    t.Value = value
    t.Reversed = True
    doc.recompute()
    return t

def fillet(doc, body, base, pred, radius, name='Fillet'):
    f = body.newObject('PartDesign::Fillet', name)
    f.Base = (base, find_edge(base.Shape, pred)[:1])
    f.Radius = radius
    doc.recompute()
    return f

def chamfer(doc, body, base, pred, size, name='Chamfer'):
    c = body.newObject('PartDesign::Chamfer', name)
    c.Base = (base, find_edge(base.Shape, pred)[:1])
    c.Size = size
    doc.recompute()
    return c

def vertical_at(x, y):
    return lambda e: type(e.Curve).__name__ == 'Line' and near(mid_of(e).x, x) and near(mid_of(e).y, y)

# 1. A draft in the middle: pad, pocket, draft (not mapped), another pocket, a fillet.
def mid_draft(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    s1, p1 = pocket(doc, body, 10, [(-10, 0, 3)], 4, 'Pocket')
    d = draft(doc, body, p1)
    s2, p2 = pocket(doc, body, 10, [(10, 0, 3)], 4, 'Pocket001')
    top = d.Shape.BoundBox
    # A top edge of the drafted plate, along X at the +Y side.
    fillet(doc, body, p2, lambda e: type(e.Curve).__name__ == 'Line' and near(mid_of(e).z, 10) and mid_of(e).y > 5 and abs(mid_of(e).x) < 1e-6, 1.0)
case('mid_draft', mid_draft, 'pad, pocket, Draft (not mapped), pocket, fillet: one stored-shape step in the middle')

# 2. A thickness in the middle, then a pocket through the floor and a row of it.
def mid_thickness(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    t = thickness(doc, body, pad)
    s1, p1 = pocket(doc, body, 1.5, [(-12, 0, 2)], 5, 'Pocket')
    lp = transform(body, 'LinearPattern', 'LinearPattern')
    lp.Originals = [p1]
    lp.Direction = (s1, ['H_Axis']); lp.Length = 24; lp.Occurrences = 3
case('mid_thickness_then_pattern', mid_thickness, 'pad, Thickness (not mapped), a pocket through the floor, a row of three of it')

# 3. The body starts with a primitive (not mapped): the step is the first thing in the body.
def first_primitive(doc, body):
    b = body.newObject('PartDesign::AdditiveBox', 'Box')
    b.Length = 30; b.Width = 20; b.Height = 8
    doc.recompute()
    s1, p1 = pocket(doc, body, 8, [(15, 10, 4)], 3, 'Pocket')
    chamfer(doc, body, p1, vertical_at(0, 0), 2.0)
case('first_primitive', first_primitive, 'an AdditiveBox (not mapped) first, then a pocket and a chamfer')

# 4. Two unmapped features in a row, then a pocket: one step, the shape after the second.
def two_in_a_row(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    d = draft(doc, body, pad)
    t = thickness(doc, body, d)
    s1, p1 = pocket(doc, body, 1.5, [(0, 0, 3)], 5, 'Pocket')
case('two_in_a_row', two_in_a_row, 'pad, Draft, Thickness (neither mapped), pocket: the two are one step')

# 5. The unmapped feature is the last: the body ends on the stored shape.
def last_unmapped(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    s1, p1 = pocket(doc, body, 10, [(-10, 0, 3)], 4, 'Pocket')
    draft(doc, body, p1)
case('last_unmapped', last_unmapped, 'pad, pocket, Draft (not mapped) as the last feature')

# 6. A pattern after the step whose original is from before it.
def pattern_of_earlier(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    s1, p1 = pocket(doc, body, 10, [(-12, 0, 2)], 4, 'Pocket')
    d = draft(doc, body, p1)
    lp = transform(body, 'LinearPattern', 'LinearPattern')
    lp.Originals = [p1]
    lp.Direction = (s1, ['H_Axis']); lp.Length = 24; lp.Occurrences = 3
case('pattern_of_earlier', pattern_of_earlier, 'pad, pocket, Draft (not mapped), then a row of the pocket from before the step')

# 7. Two separate steps with a mapped feature between them.
def step_then_step(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    d = draft(doc, body, pad)
    s1, p1 = pocket(doc, body, 10, [(-10, 0, 3)], 3, 'Pocket')
    b = body.newObject('PartDesign::SubtractiveCylinder', 'Cylinder')
    b.Radius = 2.5; b.Height = 20
    b.AttachmentSupport = (origin(body, 'XY_Plane'), [''])
    b.MapMode = 'FlatFace'
    b.AttachmentOffset = App.Placement(App.Vector(10, 0, -5), App.Rotation())
    doc.recompute()
    s2, p2 = pocket(doc, body, 10, [(0, 5, 1.5)], 3, 'Pocket001')
    fillet(doc, body, p2, lambda e: type(e.Curve).__name__ == 'Circle' and near(e.Curve.Center.z, 10) and near(e.Curve.Center.x, 0) and near(e.Curve.Radius, 1.5), 0.5)
case('step_then_step', step_then_step, 'pad, Draft (not mapped), pocket, SubtractiveCylinder (not mapped), pocket, fillet: two steps')

# 8. A tapered hole (not mapped), then a pocket and a mirror of it.
def hole_then_mirror(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    hs = sketch(body, 'HoleSketch', 10)
    circle(hs, 0, 0, 1.5)
    h = body.newObject('PartDesign::Hole', 'Hole')
    h.Profile = hs; h.Threaded = False; h.ThreadType = 'None'
    h.Diameter = 5; h.DepthType = 'Dimension'; h.Depth = 6; h.DrillPoint = 'Flat'; h.Tapered = True; h.TaperedAngle = 85
    doc.recompute()
    s1, p1 = pocket(doc, body, 10, [(12, 4, 2)], 4, 'Pocket')
    mi = transform(body, 'Mirrored', 'Mirrored')
    mi.Originals = [p1]
    mi.MirrorPlane = (s1, ['V_Axis'])
case('tapered_hole_then_mirror', hole_then_mirror, 'pad, a tapered hole (not mapped), a pocket, the pocket mirrored')

# 9. A pad on top of the stored shape and a revolution-cut after it (a groove).
def pad_after_step(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    t = thickness(doc, body, pad)
    bs, b = boss(doc, body, 1.5, (-4, -4, 4, 4), 6, 'Boss')
    fillet(doc, body, b, vertical_at(4, 4), 1.0)
case('pad_after_step', pad_after_step, 'pad, Thickness (not mapped), a boss on the floor, a fillet on the boss')

# 10. Every feature after the first pad unmapped: nothing holds after the step.
def nothing_after(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    d = draft(doc, body, pad)
    thickness(doc, body, d)
case('nothing_after', nothing_after, 'pad, Draft, Thickness: the body ends on the stored shape of the last')

with open(os.path.join(OUT, 'fixtures.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'cases': cases}, fh, indent=1)
with open(os.path.join(OUT, 'log.txt'), 'w') as fh:
    fh.write('\n'.join(log) + '\n')
os._exit(0)
