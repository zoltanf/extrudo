# Authored fixtures for the FreeCAD import's S11: the Part workbench's primitives and booleans
# (a tree of objects, each with its own stored shape, no body and no timeline). Our own parts,
# made here with FreeCAD, so the stored shapes, the property grammar, the placements and the
# EdgeN numbering are FreeCAD's own. Writes fixtures.json (no file metadata: only the objects'
# own XML from Document.xml, never the document's properties).
#
# Run: freecadcmd make-part-fixtures.py <output directory>   (FreeCAD 1.1)
# Writes fixtures.json and log.txt into that directory, never beside the script
# (log.txt holds tracebacks with local paths). The directory is the first argument
# after the script's path in sys.argv (a `--pass` before it is skipped).
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
    tmp = os.path.join(tempfile.mkdtemp(prefix='s11fx'), name + '.FCStd')
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

def rot(axis, deg):
    return App.Rotation(V(*axis), deg)

def at(o, base=(0, 0, 0), axis=(0, 0, 1), deg=0.0):
    o.Placement = App.Placement(V(*base), rot(axis, deg))
    return o

def box(doc, name, l, w, h, **k):
    o = doc.addObject('Part::Box', name)
    o.Length = l; o.Width = w; o.Height = h
    return at(o, **k) if k else o

def cyl(doc, name, r, h, **k):
    o = doc.addObject('Part::Cylinder', name)
    o.Radius = r; o.Height = h
    return at(o, **k) if k else o

def sphere(doc, name, r, **k):
    o = doc.addObject('Part::Sphere', name)
    o.Radius = r
    return at(o, **k) if k else o

def hide(*objs):
    # The GUI hides a boolean's operands; without a GUI the property is set here.
    for o in objs:
        o.Visibility = False

def two(doc, kind, name, base, tool, refine=False):
    o = doc.addObject('Part::' + kind, name)
    o.Base = base; o.Tool = tool
    o.Refine = refine
    hide(base, tool)
    return o

def many(doc, kind, name, shapes, refine=False):
    o = doc.addObject('Part::' + kind, name)
    o.Shapes = shapes
    o.Refine = refine
    hide(*shapes)
    return o

def box_cyl_cut(doc):
    b = box(doc, 'Box', 30, 20, 10)
    c = cyl(doc, 'Cylinder', 4, 10, base=(15, 10, 0))
    return [two(doc, 'Cut', 'Cut', b, c)]

def fuse_common(doc):
    a = box(doc, 'Box', 20, 20, 10)
    b = box(doc, 'Box001', 20, 10, 10, base=(10, 5, 5))
    f = two(doc, 'Fuse', 'Fusion', a, b)
    c = box(doc, 'Box002', 20, 20, 20, base=(50, 0, 0))
    s = sphere(doc, 'Sphere', 12, base=(50, 0, 0))
    k = two(doc, 'Common', 'Common', c, s)
    return [f, k]

def multi(doc):
    a = box(doc, 'Box', 40, 10, 10)
    b = cyl(doc, 'Cylinder', 6, 25, base=(10, 5, 0))
    c = box(doc, 'Box001', 10, 30, 5, base=(25, -10, 0))
    f = many(doc, 'MultiFuse', 'Fusion', [a, b, c])
    d = box(doc, 'Box002', 30, 30, 30, base=(100, 0, 0))
    e = box(doc, 'Box003', 30, 30, 30, base=(110, 10, 5))
    g = cyl(doc, 'Cylinder001', 14, 40, base=(118, 18, -5))
    k = many(doc, 'MultiCommon', 'Common', [d, e, g])
    return [f, k]

def nested(doc):
    # Common(Cut(Fuse(Box, Cylinder), MultiFuse(Cylinder, Cylinder)), Box): three levels, four booleans.
    a = box(doc, 'Box', 40, 30, 10)
    b = cyl(doc, 'Cylinder', 8, 20, base=(20, 15, 0))
    f = two(doc, 'Fuse', 'Fusion', a, b)
    h1 = cyl(doc, 'Cylinder001', 3, 30, base=(8, 8, -5))
    h2 = cyl(doc, 'Cylinder002', 3, 30, base=(32, 22, -5))
    holes = many(doc, 'MultiFuse', 'Holes', [h1, h2])
    cut = two(doc, 'Cut', 'Cut', f, holes)
    keep = box(doc, 'Box001', 36, 26, 30, base=(2, 2, -5))
    return [two(doc, 'Common', 'Common', cut, keep)]

def placed_primitives(doc):
    # One root each: every placement a primitive can have.
    return [
        box(doc, 'BoxMoved', 20, 10, 5, base=(5, 6, 7)),
        box(doc, 'BoxTurnedZ', 20, 10, 5, base=(40, 0, 0), deg=30),
        box(doc, 'BoxQuarterX', 20, 10, 5, base=(80, 0, 0), axis=(1, 0, 0), deg=90),
        box(doc, 'BoxTilted', 20, 10, 5, base=(120, 0, 10), axis=(1, 1, 0), deg=40),
        cyl(doc, 'CylMoved', 5, 12, base=(0, 40, 3)),
        cyl(doc, 'CylAlongX', 5, 12, base=(40, 40, 5), axis=(0, 1, 0), deg=90),
        cyl(doc, 'CylAlongMinusY', 5, 12, base=(80, 40, 5), axis=(1, 0, 0), deg=90),
        cyl(doc, 'CylDown', 5, 12, base=(100, 40, 5), axis=(1, 0, 0), deg=180),
        cyl(doc, 'CylTilted', 5, 12, base=(120, 40, 5), axis=(1, 2, 3), deg=50),
        sphere(doc, 'SphereMoved', 6, base=(0, 80, 6)),
        sphere(doc, 'SphereTilted', 6, base=(40, 80, 6), axis=(1, 1, 1), deg=70),
    ]

def torus_cone(doc):
    t = doc.addObject('Part::Torus', 'Torus')
    t.Radius1 = 10; t.Radius2 = 2
    t2 = doc.addObject('Part::Torus', 'TorusTilted')
    t2.Radius1 = 10; t2.Radius2 = 2
    at(t2, base=(40, 0, 5), axis=(1, 0, 0), deg=60)
    c = doc.addObject('Part::Cone', 'Cone')
    c.Radius1 = 2; c.Radius2 = 6; c.Height = 10
    at(c, base=(80, 0, 0))
    c2 = doc.addObject('Part::Cone', 'ConePointed')
    c2.Radius1 = 5; c2.Radius2 = 0; c2.Height = 8
    at(c2, base=(110, 0, 0))
    return [t, t2, c, c2]

def other_primitives(doc):
    # Variants a box, a whole cylinder, a whole sphere or a whole torus can't say.
    c = cyl(doc, 'CylQuarter', 6, 10)
    c.Angle = 90
    s = sphere(doc, 'SphereCap', 8, base=(30, 0, 0))
    s.Angle1 = 0; s.Angle2 = 90
    s2 = sphere(doc, 'SphereWedge', 8, base=(60, 0, 0))
    s2.Angle3 = 120
    t = doc.addObject('Part::Torus', 'TorusPart')
    t.Radius1 = 10; t.Radius2 = 2; t.Angle3 = 180
    at(t, base=(100, 0, 0))
    e = doc.addObject('Part::Ellipsoid', 'Ellipsoid')
    e.Radius1 = 2; e.Radius2 = 4; e.Radius3 = 3
    at(e, base=(130, 0, 0))
    p = doc.addObject('Part::Prism', 'Prism')
    p.Polygon = 6; p.Circumradius = 5; p.Height = 8
    at(p, base=(150, 0, 0))
    w = doc.addObject('Part::Wedge', 'Wedge')
    at(w, base=(170, 0, 0))
    out = [c, s, s2, t, e, p, w]
    # A skewed cylinder (FreeCAD 1.x).
    k = cyl(doc, 'CylSkewed', 4, 10, base=(200, 0, 0))
    if 'FirstAngle' in k.PropertiesList:
        k.FirstAngle = 20
        out.append(k)
    else:
        doc.removeObject(k.Name)
    # A hole cut by a prism: an unmappable tool under a mappable boolean.
    b = box(doc, 'Box', 20, 20, 6, base=(0, 40, 0))
    q = doc.addObject('Part::Prism', 'Prism001')
    q.Polygon = 6; q.Circumradius = 4; q.Height = 10
    at(q, base=(10, 50, -2))
    out.append(two(doc, 'Cut', 'Cut', b, q))
    return out

def placed_booleans(doc):
    # A boolean's own Placement moves its result; a boolean above it sees the moved shape.
    b = box(doc, 'Box', 30, 20, 10)
    c = cyl(doc, 'Cylinder', 4, 10, base=(15, 10, 0))
    cut = at(two(doc, 'Cut', 'CutMoved', b, c), base=(10, 20, 5), deg=30)
    b2 = box(doc, 'Box001', 20, 20, 10, base=(60, 0, 0))
    c2 = cyl(doc, 'Cylinder001', 5, 20, base=(70, 10, 0))
    f = at(two(doc, 'Fuse', 'FusionTilted', b2, c2), base=(0, 0, 8), axis=(1, 1, 0), deg=35)
    # Above a moved boolean.
    b3 = box(doc, 'Box002', 30, 20, 10, base=(0, 60, 0))
    c3 = cyl(doc, 'Cylinder002', 4, 10, base=(15, 70, 0))
    inner = at(two(doc, 'Cut', 'Inner', b3, c3), base=(5, 0, 0), deg=10)
    c4 = cyl(doc, 'Cylinder003', 3, 30, base=(12, 66, -5))
    outer = two(doc, 'Cut', 'Outer', inner, c4)
    # A moved MultiFuse.
    b5 = box(doc, 'Box003', 10, 10, 10, base=(100, 60, 0))
    b6 = box(doc, 'Box004', 10, 10, 10, base=(105, 65, 5))
    m = at(many(doc, 'MultiFuse', 'MultiMoved', [b5, b6]), base=(0, 0, 20))
    return [cut, f, outer, m]

def shared_operand(doc):
    # One cylinder is the tool of two cuts; one box is the base of a cut and a member of a fuse.
    c = cyl(doc, 'Cylinder', 4, 30, base=(15, 10, -5))
    a = box(doc, 'Box', 30, 20, 10)
    b = box(doc, 'Box001', 30, 20, 10, base=(0, 0, 12))
    ca = two(doc, 'Cut', 'Cut', a, c)
    cb = two(doc, 'Cut', 'Cut001', b, c)
    d = box(doc, 'Box002', 20, 20, 10, base=(60, 0, 0))
    e = cyl(doc, 'Cylinder001', 5, 10, base=(70, 10, 0))
    g = box(doc, 'Box003', 10, 30, 4, base=(65, -5, 0))
    cd = two(doc, 'Cut', 'Cut002', d, e)
    fd = two(doc, 'Fuse', 'Fusion', d, g)
    return [ca, cb, cd, fd]

def visible_operand(doc):
    # The tool stays visible in FreeCAD (the author showed it again).
    b = box(doc, 'Box', 30, 20, 10)
    c = cyl(doc, 'Cylinder', 4, 20, base=(15, 10, 0))
    cut = two(doc, 'Cut', 'Cut', b, c)
    c.Visibility = True
    return [cut]

def hidden_root(doc):
    b = box(doc, 'Box', 30, 20, 10)
    c = cyl(doc, 'Cylinder', 4, 20, base=(15, 10, 0))
    cut = two(doc, 'Cut', 'Cut', b, c)
    cut.Visibility = False
    shown = box(doc, 'Box001', 10, 10, 10, base=(50, 0, 0))
    return [cut, shown]

def stored_leaf(doc):
    # A plain stored shape (what a STEP import or "simple copy" leaves) as a base and as a tool.
    s = Part.makeBox(30, 20, 10).fuse(Part.makeCylinder(6, 18, V(15, 10, 0)))
    f = doc.addObject('Part::Feature', 'Imported')
    f.Shape = s
    c = cyl(doc, 'Cylinder', 3, 30, base=(15, 10, -5))
    cut = two(doc, 'Cut', 'Cut', f, c)
    t = doc.addObject('Part::Feature', 'Tool')
    t.Shape = Part.makeWedge(0, 0, 0, 0, 0, 10, 10, 10, 10, 10)
    at(t, base=(60, 5, 2))
    b = box(doc, 'Box', 30, 20, 10, base=(50, 0, 0))
    cut2 = two(doc, 'Cut', 'Cut001', b, t)
    return [cut, cut2]

def free_sketch(doc, name, z=0.0):
    sk = doc.addObject('Sketcher::SketchObject', name)
    sk.Placement = App.Placement(V(0, 0, z), App.Rotation())
    return sk

def rect(sk, x0, y0, x1, y1):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    n = sk.GeometryCount
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        sk.addGeometry(Part.LineSegment(V(a[0], a[1], 0), V(b[0], b[1], 0)), False)
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint('Coincident', n + i, 2, n + (i + 1) % 4, 1))

def extrusion_leaf(doc):
    # A Part extrusion of a sketch (not in a body) under a cut.
    sk = free_sketch(doc, 'Sketch')
    rect(sk, 0, 0, 30, 20)
    sk.addGeometry(Part.Circle(V(8, 10, 0), V(0, 0, 1), 3), False)
    doc.recompute()
    e = doc.addObject('Part::Extrusion', 'Extrude')
    e.Base = sk; e.DirMode = 'Normal'; e.LengthFwd = 12; e.Solid = True
    hide(sk)
    c = cyl(doc, 'Cylinder', 4, 30, base=(22, 10, -5))
    return [two(doc, 'Cut', 'Cut', e, c)]

def body_operand(doc):
    # A PartDesign body (a pad and a pocket) cut by a Part cylinder, and fused with a Part box.
    body = doc.addObject('PartDesign::Body', 'Body')
    sk = body.newObject('Sketcher::SketchObject', 'Sketch')
    xy = [o for o in body.Origin.OriginFeatures if o.Role == 'XY_Plane'][0]
    sk.AttachmentSupport = (xy, ['']); sk.MapMode = 'FlatFace'
    rect(sk, 0, 0, 40, 20)
    pad = body.newObject('PartDesign::Pad', 'Pad')
    pad.Profile = sk; pad.Length = 10
    doc.recompute()
    ps = body.newObject('Sketcher::SketchObject', 'PocketSketch')
    ps.AttachmentSupport = (xy, ['']); ps.MapMode = 'FlatFace'
    ps.AttachmentOffset = App.Placement(V(0, 0, 10), App.Rotation())
    ps.addGeometry(Part.Circle(V(10, 10, 0), V(0, 0, 1), 4), False)
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = ps; p.Length = 4
    doc.recompute()
    c = cyl(doc, 'Cylinder', 3, 30, base=(30, 10, -5))
    cut = two(doc, 'Cut', 'Cut', body, c)
    b = box(doc, 'Box', 10, 20, 20, base=(40, 0, 0))
    return [two(doc, 'Fuse', 'Fusion', cut, b)]

def compounds(doc):
    # A compound at the top; a compound as a tool; a compound as a base.
    a = box(doc, 'Box', 10, 10, 10)
    b = cyl(doc, 'Cylinder', 4, 10, base=(30, 5, 0))
    top = doc.addObject('Part::Compound', 'Compound')
    top.Links = [a, b]; hide(a, b)
    big = box(doc, 'Box001', 40, 20, 10, base=(0, 40, 0))
    h1 = cyl(doc, 'Cylinder001', 3, 20, base=(10, 50, -5))
    h2 = cyl(doc, 'Cylinder002', 3, 20, base=(30, 50, -5))
    tools = doc.addObject('Part::Compound', 'Holes')
    tools.Links = [h1, h2]; hide(h1, h2)
    cut = two(doc, 'Cut', 'Cut', big, tools)
    p = box(doc, 'Box002', 10, 10, 10, base=(0, 80, 0))
    q = box(doc, 'Box003', 10, 10, 10, base=(20, 80, 0))
    bases = doc.addObject('Part::Compound', 'Blocks')
    bases.Links = [p, q]; hide(p, q)
    slot = box(doc, 'Box004', 40, 4, 4, base=(-5, 83, 6))
    cut2 = two(doc, 'Cut', 'Cut001', bases, slot)
    return [top, cut, cut2]

def in_containers(doc):
    # A cut inside an App::Part that is moved and turned; a fuse inside a plain group.
    part = doc.addObject('App::Part', 'Part')
    b = box(doc, 'Box', 30, 20, 10)
    c = cyl(doc, 'Cylinder', 4, 10, base=(15, 10, 0))
    cut = two(doc, 'Cut', 'Cut', b, c)
    part.addObjects([b, c, cut])
    part.Placement = App.Placement(V(100, 50, 20), rot((0, 0, 1), 45))
    grp = doc.addObject('App::DocumentObjectGroup', 'Group')
    d = box(doc, 'Box001', 10, 10, 10)
    e = box(doc, 'Box002', 10, 10, 10, base=(5, 5, 5))
    f = two(doc, 'Fuse', 'Fusion', d, e)
    grp.addObjects([d, e, f])
    tilted = doc.addObject('App::Part', 'Part001')
    g = box(doc, 'Box003', 20, 10, 5)
    h = cyl(doc, 'Cylinder001', 3, 5, base=(10, 5, 0))
    cut2 = two(doc, 'Cut', 'Cut001', g, h)
    tilted.addObjects([g, h, cut2])
    tilted.Placement = App.Placement(V(0, 100, 0), rot((1, 1, 0), 30))
    return [cut, f, cut2]

def refine(doc):
    # Two boxes sharing a face: with Refine the seam is gone (fewer faces, the same solid).
    a = box(doc, 'Box', 10, 10, 10)
    b = box(doc, 'Box001', 10, 10, 10, base=(10, 0, 0))
    plain = two(doc, 'Fuse', 'Fusion', a, b)
    c = box(doc, 'Box002', 10, 10, 10, base=(0, 30, 0))
    d = box(doc, 'Box003', 10, 10, 10, base=(10, 30, 0))
    refined = two(doc, 'Fuse', 'FusionRefined', c, d, refine=True)
    e = box(doc, 'Box004', 20, 10, 10, base=(0, 60, 0))
    g = box(doc, 'Box005', 10, 10, 5, base=(5, 60, 10))
    h = box(doc, 'Box006', 10, 10, 5, base=(5, 60, 10))
    f2 = two(doc, 'Fuse', 'Step', e, g)
    back = two(doc, 'Cut', 'CutRefined', f2, h, refine=True)
    return [plain, refined, back]

def split_and_empty(doc):
    # A cut that leaves two solids; a common of two boxes that only touch.
    b = box(doc, 'Box', 30, 10, 10)
    s = box(doc, 'Box001', 4, 20, 20, base=(13, -5, -5))
    cut = two(doc, 'Cut', 'Cut', b, s)
    return [cut]

def fillets_chamfers(doc):
    # Part fillets and chamfers: edges by number on the base's shape, a size (or two) per edge.
    b = box(doc, 'Box', 30, 20, 10)
    c = cyl(doc, 'Cylinder', 4, 10, base=(15, 10, 0))
    cut = two(doc, 'Cut', 'Cut', b, c)
    doc.recompute()
    top = [i + 1 for i, e in enumerate(cut.Shape.Edges)
           if abs(e.BoundBox.ZMin - 10) < 1e-7 and abs(e.BoundBox.ZMax - 10) < 1e-7 and type(e.Curve).__name__ == 'Line']
    f = doc.addObject('Part::Fillet', 'Fillet')
    f.Base = cut
    f.Edges = [(i, 2.0, 2.0) for i in top]
    hide(cut)
    doc.recompute()
    b2 = box(doc, 'Box001', 20, 20, 10, base=(50, 0, 0))
    doc.recompute()
    vertical = [i + 1 for i, e in enumerate(b2.Shape.Edges) if abs(e.BoundBox.ZMax - e.BoundBox.ZMin - 10) < 1e-7]
    ch = doc.addObject('Part::Chamfer', 'Chamfer')
    ch.Base = b2
    ch.Edges = [(i, 3.0, 3.0) for i in vertical]
    hide(b2)
    c3 = cyl(doc, 'Cylinder001', 8, 12, base=(100, 10, 0))
    doc.recompute()
    rim = [i + 1 for i, e in enumerate(c3.Shape.Edges) if type(e.Curve).__name__ == 'Circle' and abs(e.BoundBox.ZMin - 12) < 1e-7]
    ch2 = doc.addObject('Part::Chamfer', 'ChamferRim')
    ch2.Base = c3
    ch2.Edges = [(i, 1.5, 1.5) for i in rim]
    hide(c3)
    # Two sizes on a chamfer, two radii on a fillet (a fillet that changes along its edge).
    b4 = box(doc, 'Box002', 20, 20, 10, base=(130, 0, 0))
    doc.recompute()
    v4 = [i + 1 for i, e in enumerate(b4.Shape.Edges) if abs(e.BoundBox.ZMax - e.BoundBox.ZMin - 10) < 1e-7]
    ch3 = doc.addObject('Part::Chamfer', 'ChamferTwoSizes')
    ch3.Base = b4
    ch3.Edges = [(v4[0], 2.0, 4.0)]
    hide(b4)
    b5 = box(doc, 'Box003', 20, 20, 10, base=(160, 0, 0))
    doc.recompute()
    v5 = [i + 1 for i, e in enumerate(b5.Shape.Edges) if abs(e.BoundBox.ZMax - e.BoundBox.ZMin - 10) < 1e-7]
    f2 = doc.addObject('Part::Fillet', 'FilletVariable')
    f2.Base = b5
    f2.Edges = [(v5[0], 1.0, 4.0)]
    hide(b5)
    # Different radii on different edges of one fillet.
    b6 = box(doc, 'Box004', 20, 20, 10, base=(190, 0, 0))
    doc.recompute()
    v6 = [i + 1 for i, e in enumerate(b6.Shape.Edges) if abs(e.BoundBox.ZMax - e.BoundBox.ZMin - 10) < 1e-7]
    f3 = doc.addObject('Part::Fillet', 'FilletTwoRadii')
    f3.Base = b6
    f3.Edges = [(v6[0], 2.0, 2.0), (v6[1], 4.0, 4.0)]
    hide(b6)
    # A boolean above a fillet.
    hole = cyl(doc, 'Cylinder002', 3, 30, base=(8, 5, -5))
    above = two(doc, 'Cut', 'CutAbove', f, hole)
    return [above, ch, ch2, ch3, f2, f3]

def mirrors(doc):
    b = box(doc, 'Box', 20, 10, 10)
    c = cyl(doc, 'Cylinder', 3, 10, base=(5, 5, 0))
    cut = two(doc, 'Cut', 'Cut', b, c)
    m = doc.addObject('Part::Mirroring', 'Mirror')
    m.Source = cut; m.Base = V(25, 0, 0); m.Normal = V(1, 0, 0)
    hide(cut)
    b2 = box(doc, 'Box001', 20, 10, 10, base=(0, 40, 0))
    m2 = doc.addObject('Part::Mirroring', 'MirrorTilted')
    m2.Source = b2; m2.Base = V(25, 40, 0); m2.Normal = V(1, 1, 0)
    hide(b2)
    keep = box(doc, 'Box002', 100, 100, 6, base=(-20, 20, 0))
    k = two(doc, 'Common', 'Common', m2, keep)
    return [m, k]

def bound(doc):
    # Sizes and places read from a spreadsheet and a variable set (S10's binder).
    sh = doc.addObject('Spreadsheet::Sheet', 'Params')
    for a, v, n in (('A1', '30', 'length'), ('A2', '20', 'width'), ('A3', '10', 'height'), ('A4', '4', 'hole_r'),
                    ('A5', '=length / 2', 'hole_x'), ('A6', '8', 'lift')):
        sh.set(a, v); sh.setAlias(a, n)
    doc.recompute()
    b = box(doc, 'Box', 30, 20, 10)
    b.setExpression('Length', 'Params.length')
    b.setExpression('Width', 'Params.width')
    b.setExpression('Height', 'Params.height')
    c = cyl(doc, 'Cylinder', 4, 10, base=(15, 10, 0))
    c.setExpression('Radius', 'Params.hole_r')
    c.setExpression('Height', 'Params.height')
    c.setExpression('Placement.Base.x', 'Params.hole_x')
    c.setExpression('Placement.Base.y', 'Params.width / 2')
    cut = two(doc, 'Cut', 'Cut', b, c)
    cut.setExpression('Placement.Base.z', 'Params.lift')
    s = sphere(doc, 'Sphere', 6, base=(60, 0, 0))
    s.setExpression('Radius', 'Params.hole_r * 1.5')
    t = doc.addObject('Part::Torus', 'Torus')
    t.Radius1 = 10; t.Radius2 = 2
    at(t, base=(100, 0, 0))
    t.setExpression('Radius1', 'Params.height')
    t.setExpression('Radius2', 'Params.hole_r / 2')
    return [cut, s, t]

def deep_chain(doc):
    # Twelve cuts in a row, each the base of the next.
    cur = box(doc, 'Box', 130, 20, 10)
    for i in range(12):
        c = cyl(doc, 'Cylinder' if i == 0 else 'Cylinder%03d' % i, 3, 20, base=(8 + 10 * i, 10, -5))
        cur = two(doc, 'Cut', 'Cut' if i == 0 else 'Cut%03d' % i, cur, c)
    return [cur]

case('box_cyl_cut', box_cyl_cut, 'a box with a cylinder cut out of it')
case('fuse_common', fuse_common, 'a fuse of two boxes; a common of a box and a sphere')
case('multi', multi, 'a MultiFuse of three shapes; a MultiCommon of three')
case('nested', nested, 'a common of a cut of a fuse and a MultiFuse: three levels')
case('placed_primitives', placed_primitives, 'boxes, cylinders and spheres, each a root, moved, turned about Z, turned by quarter turns and tilted')
case('torus_cone', torus_cone, 'a torus, a tilted torus, a cone and a pointed cone, each a root')
case('other_primitives', other_primitives, 'a part cylinder, sphere and torus, an ellipsoid, a prism, a wedge, a skewed cylinder; a box cut by a prism')
case('placed_booleans', placed_booleans, 'a cut moved and turned about Z, a fuse tilted, a cut above a moved cut, a MultiFuse moved')
case('shared_operand', shared_operand, 'one cylinder the tool of two cuts; one box the base of a cut and of a fuse')
case('visible_operand', visible_operand, 'a cut whose tool is visible in FreeCAD')
case('hidden_root', hidden_root, 'a cut that is hidden in FreeCAD, and a visible box')
case('stored_leaf', stored_leaf, 'a plain stored shape as the base of a cut, and another as a tool')
case('extrusion_leaf', extrusion_leaf, 'a Part extrusion of a sketch as the base of a cut')
case('body_operand', body_operand, 'a PartDesign body cut by a Part cylinder, then fused with a Part box')
case('compounds', compounds, 'a compound at the top, a compound as a tool, a compound as a base')
case('in_containers', in_containers, 'a cut in a moved and turned App::Part, a fuse in a group, a cut in a tilted App::Part')
case('refine', refine, 'a fuse with and without Refine; a cut with Refine that gives the box back')
case('split', split_and_empty, 'a cut that leaves two solids')
case('fillets_chamfers', fillets_chamfers, 'Part fillets and chamfers by edge number, one or two sizes, and a cut above a fillet')
case('mirrors', mirrors, 'a Part mirror of a cut; a tilted mirror under a common')
case('bound', bound, 'sizes and placements read from a spreadsheet')
case('deep_chain', deep_chain, 'twelve cuts in a row')

with open(os.path.join(OUT, 'fixtures.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'cases': cases}, fh, indent=1)
with open(os.path.join(OUT, 'log.txt'), 'w') as fh:
    fh.write('\n'.join(log) + '\n')
os._exit(0)
