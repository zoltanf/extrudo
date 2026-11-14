# Authored fixtures for the FreeCAD import's S9: up-to extents, an edge or a datum line as an axis,
# datum lines and planes as a pattern's reference, sketches on tilted planes, and sketches with
# external (projected) geometry, arcs among it. Our own parts, made here with FreeCAD, so
# the stored shapes, the property grammar and the EdgeN / FaceN numbering are
# FreeCAD's own. Writes fixtures.json (no file metadata: only the objects'
# own XML from Document.xml, never the document's properties).
#
# Run: freecadcmd make-reference-fixtures.py <output directory>   (FreeCAD 1.1)
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

def describe(i, g):
    d = {'index': i, 'type': type(g).__name__}
    if hasattr(g, 'StartPoint'):
        d['start'] = vec(g.StartPoint); d['end'] = vec(g.EndPoint)
    if hasattr(g, 'Center'):
        d['centre'] = vec(g.Center)
    if hasattr(g, 'Radius'):
        d['radius'] = g.Radius
    return d

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
    tmp = os.path.join(tempfile.mkdtemp(prefix='s9fx'), name + '.FCStd')
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
                rec['external'] = [{'link': x[0].Name, 'subs': list(x[1])} for x in (o.ExternalGeometry or [])]
                rec['externalGeo'] = [describe(i, g) for i, g in enumerate(getattr(o, 'ExternalGeo', []) or [])]
                rec['normal'] = vec(o.Placement.Rotation.multVec(App.Vector(0, 0, 1)))
            elif o.TypeId in ('PartDesign::Line', 'PartDesign::Plane'):
                rec['datum'] = {'base': vec(o.Placement.Base), 'z': vec(o.Placement.Rotation.multVec(App.Vector(0, 0, 1))),
                                'x': vec(o.Placement.Rotation.multVec(App.Vector(1, 0, 0))), 'mapMode': str(o.MapMode)}
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

def find_vertex(shape, x, y, z):
    return ['Vertex%d' % (i + 1) for i, v in enumerate(shape.Vertexes)
            if abs(v.Point.x - x) < 1e-7 and abs(v.Point.y - y) < 1e-7 and abs(v.Point.z - z) < 1e-7][0]

def sketch_yz(body, name, x):
    # On a plane parallel to YZ at world x: sketch x is world Y, sketch y world Z, the normal +X.
    sk = body.newObject('Sketcher::SketchObject', name)
    sk.AttachmentSupport = (origin(body, 'YZ_Plane'), [''])
    sk.MapMode = 'FlatFace'
    if x:
        sk.AttachmentOffset = App.Placement(App.Vector(0, 0, x), App.Rotation())
    return sk

def x_face(x):
    return lambda f: type(f.Surface).__name__ == 'Plane' and abs(f.CenterOfMass.x - x) < 1e-7 and abs(abs(f.normalAt(0, 0).x) - 1) < 1e-6

def three_walls(doc, body):
    # The plate with three walls across it (z 10 to 25): x -20..-16, -2..2 and 16..20.
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    ws = sketch(body, 'WallsSketch', 10)
    rect(ws, -20, -10, -16, 10); rect(ws, -2, -10, 2, 10); rect(ws, 16, -10, 20, 10)
    walls = body.newObject('PartDesign::Pad', 'Walls')
    walls.Profile = ws; walls.Length = 15
    doc.recompute()
    return pad, walls

def bridge(doc, body, walls, kind, name='Bridge'):
    sk = sketch_yz(body, name + 'Sketch', -16)
    rect(sk, -3, 14, 3, 20)
    p = body.newObject('PartDesign::Pad', name)
    p.Profile = sk
    return p

def bore(doc, body, walls, name='Bore'):
    # A hole started on the outside of the first wall, going +X.
    sk = sketch_yz(body, name + 'Sketch', -20)
    circle(sk, 0, 18, 2)
    p = body.newObject('PartDesign::Pocket', name)
    p.Profile = sk
    p.Reversed = True
    return p

# --- up-to extents -------------------------------------------------------------

def pad_up_to_first(doc, body):
    pad, walls = three_walls(doc, body)
    p = bridge(doc, body, walls, 'first'); p.Type = 'UpToFirst'
case('pad_up_to_first', pad_up_to_first, 'three walls; a pad from the first wall up to the first face it meets (the middle wall)')

def pad_up_to_last(doc, body):
    pad, walls = three_walls(doc, body)
    p = bridge(doc, body, walls, 'last'); p.Type = 'UpToLast'
case('pad_up_to_last', pad_up_to_last, 'three walls; a pad from the first wall up to the last face (the far side of the third wall)')

def pad_up_to_face(doc, body):
    pad, walls = three_walls(doc, body)
    p = bridge(doc, body, walls, 'face'); p.Type = 'UpToFace'
    p.UpToFace = (walls, find_face(walls.Shape, x_face(16))[:1])
case('pad_up_to_face', pad_up_to_face, 'three walls; a pad up to the near face of the third wall, through the middle one')

def pad_up_to_face_offset(doc, body):
    pad, walls = three_walls(doc, body)
    p = bridge(doc, body, walls, 'face'); p.Type = 'UpToFace'
    p.UpToFace = (walls, find_face(walls.Shape, x_face(2))[:1])
    p.Offset = 1.5
case('pad_up_to_face_offset', pad_up_to_face_offset, 'three walls; a pad up to the far face of the middle wall, with an Offset of 1.5')

def pad_up_to_curved(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    ps = sketch(body, 'PostSketch', 10)
    circle(ps, 8, 0, 6)
    post = body.newObject('PartDesign::Pad', 'Post')
    post.Profile = ps; post.Length = 15
    doc.recompute()
    sk = sketch_yz(body, 'BeamSketch', -10)
    rect(sk, -2, 12, 2, 16)
    p = body.newObject('PartDesign::Pad', 'Beam')
    p.Profile = sk; p.Type = 'UpToFace'
    p.UpToFace = (post, find_face(post.Shape, lambda f: type(f.Surface).__name__ == 'Cylinder')[:1])
case('pad_up_to_curved', pad_up_to_curved, 'a plate with a round post; a beam padded up to the post\'s cylindrical face')

def pocket_up_to_first(doc, body):
    pad, walls = three_walls(doc, body)
    p = bore(doc, body, walls); p.Type = 'UpToFirst'
case('pocket_up_to_first', pocket_up_to_first, 'three walls; a pocket from outside the first wall up to the first face (through the first wall)')

def pocket_up_to_face_offset(doc, body):
    pad, walls = three_walls(doc, body)
    p = bore(doc, body, walls); p.Type = 'UpToFace'
    p.UpToFace = (walls, find_face(walls.Shape, x_face(16))[:1])
    p.Offset = 1.5
case('pocket_up_to_face_offset', pocket_up_to_face_offset, 'three walls; a pocket up to the near face of the third wall, with an Offset of 1.5')

def pocket_up_to_face(doc, body):
    pad, walls = three_walls(doc, body)
    p = bore(doc, body, walls); p.Type = 'UpToFace'
    p.UpToFace = (walls, find_face(walls.Shape, x_face(2))[:1])
case('pocket_up_to_face', pocket_up_to_face, 'three walls; a pocket up to the far face of the middle wall (through two walls)')

def pad_up_to_shape(doc, body):
    pad, walls = three_walls(doc, body)
    p = bridge(doc, body, walls, 'shape'); p.Type = 'UpToShape'
    p.UpToShape = [(walls, tuple(find_face(walls.Shape, x_face(16))[:1]))]
case('pad_up_to_shape', pad_up_to_shape, 'three walls; a pad with Type UpToShape (FreeCAD 1.x) naming the third wall\'s near face')

def offset_plane(doc, body, z, name='DatumPlane'):
    dp = body.newObject('PartDesign::Plane', name)
    dp.AttachmentSupport = [(origin(body, 'XY_Plane'), '')]
    dp.MapMode = 'FlatFace'
    dp.AttachmentOffset = App.Placement(App.Vector(0, 0, z), App.Rotation())
    doc.recompute()
    return dp

def pad_up_to_datum_plane(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    dp = offset_plane(doc, body, 18)
    sk = sketch(body, 'BossSketch', 10)
    rect(sk, -6, -4, 6, 4)
    p = body.newObject('PartDesign::Pad', 'Boss')
    p.Profile = sk; p.Type = 'UpToFace'; p.UpToFace = (dp, [''])
case('pad_up_to_datum_plane', pad_up_to_datum_plane, 'a boss padded from the plate\'s top up to a datum plane at z = 18')

def pocket_up_to_datum_plane(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    dp = offset_plane(doc, body, 4)
    sk = sketch(body, 'PocketSketch', 10)
    circle(sk, 6, 0, 3)
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Type = 'UpToFace'; p.UpToFace = (dp, [''])
case('pocket_up_to_datum_plane', pocket_up_to_datum_plane, 'a pocket from the plate\'s top down to a datum plane at z = 4')

# --- an edge or a datum line as an axis ----------------------------------------

def top_edge(pad):
    # The plate's top edge along X at y = -10.
    return find_edge(pad.Shape, lambda e: type(e.Curve).__name__ == 'Line' and near(mid_of(e).z, 10) and near(mid_of(e).y, -10) and abs(mid_of(e).x) < 1e-7)[:1]

def datum_line(doc, body, base, a, b, name='DatumLine'):
    dl = body.newObject('PartDesign::Line', name)
    dl.AttachmentSupport = [(base, find_vertex(base.Shape, *a)), (base, find_vertex(base.Shape, *b))]
    dl.MapMode = 'TwoPointLine'
    doc.recompute()
    return dl

def groove_about_edge(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    sk = sketch(body, 'GrooveSketch', 10)
    rect(sk, -5, -10, 5, -7)
    g = body.newObject('PartDesign::Groove', 'Groove')
    g.Profile = sk; g.ReferenceAxis = (pad, top_edge(pad)); g.Angle = 360
case('groove_about_edge', groove_about_edge, 'a groove about the plate\'s own top edge: a round notch along it')

def groove_about_datum_line(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    dl = datum_line(doc, body, pad, (-20, -10, 10), (20, -10, 10))
    sk = sketch(body, 'GrooveSketch', 10)
    rect(sk, -5, -10, 5, -7)
    g = body.newObject('PartDesign::Groove', 'Groove')
    g.Profile = sk; g.ReferenceAxis = (dl, ['']); g.Angle = 360
case('groove_about_datum_line', groove_about_datum_line, 'the same notch, its axis a datum line through two of the plate\'s corners')

def revolution_about_datum_line(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    dl = datum_line(doc, body, pad, (-20, 10, 10), (20, 10, 10))
    sk = sketch(body, 'RevSketch', 10)
    rect(sk, -8, 6, 8, 10)
    r = body.newObject('PartDesign::Revolution', 'Revolution')
    r.Profile = sk; r.ReferenceAxis = (dl, ['']); r.Angle = 180
case('revolution_about_datum_line', revolution_about_datum_line, 'a half revolution about a datum line along the plate\'s other top edge')

def revolution_about_edge(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    sk = sketch(body, 'RevSketch', 10)
    rect(sk, -8, -10, 8, -6)
    r = body.newObject('PartDesign::Revolution', 'Revolution')
    r.Profile = sk; r.ReferenceAxis = (pad, top_edge(pad)); r.Angle = 360
case('revolution_about_edge', revolution_about_edge, 'a full revolution about the plate\'s top edge: a round bead along it')

def groove_about_sketch_line(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    # A datum line on the first line of the plate's own sketch (its two end points): the bottom edge at y = -10.
    dl = body.newObject('PartDesign::Line', 'DatumLine')
    dl.AttachmentSupport = [(sk0, 'Edge1')]
    dl.MapMode = 'TwoPointLine'
    doc.recompute()
    sk = sketch(body, 'GrooveSketch')
    rect(sk, -5, -10, 5, -7)
    g = body.newObject('PartDesign::Groove', 'Groove')
    g.Profile = sk; g.ReferenceAxis = (dl, ['']); g.Angle = 360
case('groove_about_sketch_line', groove_about_sketch_line, 'a groove about a datum line that lies on a line of the plate\'s sketch: a round notch along the bottom edge')

# --- datum lines and planes as a pattern's reference ----------------------------

def pattern_along_datum_line(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    s1, p1 = pocket(doc, body, 10, [(-12, -5, 2)], 4, 'Pocket')
    dl = datum_line(doc, body, pad, (-20, -10, 10), (20, 10, 10))
    lp = transform(body, 'LinearPattern', 'LinearPattern')
    lp.Originals = [p1]
    lp.Direction = (dl, ['']); lp.Length = 24; lp.Occurrences = 3
case('pattern_along_datum_line', pattern_along_datum_line, 'a row of three pockets along a datum line that runs across the plate\'s diagonal')

def polar_about_datum_line(doc, body):
    sk0, pad = plate(doc, body, -20, -15, 20, 15, 10)
    bs, b = boss(doc, body, 10, (3, -2, 7, 2), 5, 'Boss')
    s1, p1 = pocket(doc, body, 10, [(-7, -2, 2)], 4, 'Pocket')
    dl = datum_line(doc, body, b, (3, -2, 10), (3, -2, 15))
    pp = transform(body, 'PolarPattern', 'PolarPattern')
    pp.Originals = [p1]
    pp.Axis = (dl, ['']); pp.Angle = 360; pp.Occurrences = 4
case('polar_about_datum_line', polar_about_datum_line, 'four pockets about a datum line that stands on a corner of a boss')

def mirror_about_datum_plane(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    s1, p1 = pocket(doc, body, 10, [(-10, 3, 2)], 4, 'Pocket')
    dp = body.newObject('PartDesign::Plane', 'DatumPlane')
    dp.AttachmentSupport = [(origin(body, 'YZ_Plane'), '')]
    dp.MapMode = 'FlatFace'
    dp.AttachmentOffset = App.Placement(App.Vector(0, 0, 3), App.Rotation())
    doc.recompute()
    mi = transform(body, 'Mirrored', 'Mirrored')
    mi.Originals = [p1]
    mi.MirrorPlane = (dp, [''])
case('mirror_about_datum_plane', mirror_about_datum_plane, 'a pocket mirrored about a datum plane parallel to YZ at x = 3')

# --- sketches on tilted planes ---------------------------------------------------

def tilted_plane(doc, body):
    dp = body.newObject('PartDesign::Plane', 'DatumPlane')
    dp.AttachmentSupport = [(origin(body, 'XY_Plane'), '')]
    dp.MapMode = 'FlatFace'
    dp.AttachmentOffset = App.Placement(App.Vector(2, -1, 7), App.Rotation(20, 15, 25))
    doc.recompute()
    return dp

def tilted_pad(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    dp = tilted_plane(doc, body)
    sk = body.newObject('Sketcher::SketchObject', 'TiltedSketch')
    sk.AttachmentSupport = (dp, [''])
    sk.MapMode = 'FlatFace'
    rect(sk, -4, -3, 4, 3)
    p = body.newObject('PartDesign::Pad', 'Tilted')
    p.Profile = sk; p.Length = 9
    doc.recompute()
    return pad, dp, sk, p

def pad_on_tilted_plane(doc, body):
    tilted_pad(doc, body)
case('pad_on_tilted_plane', pad_on_tilted_plane, 'a pad whose sketch is on a datum plane tilted off every origin axis')

def pocket_on_tilted_face(doc, body):
    pad, dp, sk, p = tilted_pad(doc, body)
    n = dp.Placement.Rotation.multVec(App.Vector(0, 0, 1))
    planes = [(f.CenterOfMass.dot(n), i) for i, f in enumerate(p.Shape.Faces)
              if type(f.Surface).__name__ == 'Plane' and abs(abs(f.normalAt(0, 0).dot(n)) - 1) < 1e-6]
    top = 'Face%d' % (max(planes)[1] + 1)
    s2 = body.newObject('Sketcher::SketchObject', 'FaceSketch')
    s2.AttachmentSupport = (p, [top])
    s2.MapMode = 'FlatFace'
    doc.recompute()
    circle(s2, 0, 0, 1.5)
    k = body.newObject('PartDesign::Pocket', 'Pocket')
    k.Profile = s2; k.Length = 3
case('pocket_on_tilted_face', pocket_on_tilted_face, 'the tilted pad, then a pocket whose sketch is on its tilted end face')

# --- external (projected) geometry in sketches -----------------------------------

def edge_at(shape, x, y, z):
    return find_edge(shape, lambda e: type(e.Curve).__name__ == 'Line' and near(mid_of(e).x, x) and near(mid_of(e).y, y) and near(mid_of(e).z, z))[0]

def external_edge_distance(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    sk = sketch(body, 'PocketSketch', 10)
    sk.addExternal(pad.Name, edge_at(pad.Shape, 0, 10, 10))
    circle(sk, 3, 4, 2)
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 2))
    sk.addConstraint(Sketcher.Constraint('Distance', 0, 3, -3, 5))
    sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, 0, 3, 4))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Length = 4
case('external_edge_distance', external_edge_distance, 'a pocket whose circle is dimensioned 5 from a projected top edge of the plate')

def external_projected_edge(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    sk = sketch(body, 'PocketSketch', 10)
    # An edge of the bottom face: not on the sketch's plane, so truly projected.
    sk.addExternal(pad.Name, edge_at(pad.Shape, 0, -10, 0))
    circle(sk, -3, -4, 2)
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 2))
    sk.addConstraint(Sketcher.Constraint('Distance', 0, 3, -3, 6))
    sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, 0, 3, -5))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Length = 4
case('external_projected_edge', external_projected_edge, 'a pocket whose circle is dimensioned 6 from a bottom edge projected up onto the sketch')

def external_corner(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    sk = sketch(body, 'NotchSketch', 10)
    sk.addExternal(pad.Name, edge_at(pad.Shape, 0, 10, 10))
    sk.addExternal(pad.Name, edge_at(pad.Shape, 20, 0, 10))
    rect(sk, 13.5, 5.5, 19.5, 9.5)
    for i, kind in enumerate(['Horizontal', 'Vertical', 'Horizontal', 'Vertical']):
        sk.addConstraint(Sketcher.Constraint(kind, i))
    sk.addConstraint(Sketcher.Constraint('PointOnObject', 1, 2, -3))
    sk.addConstraint(Sketcher.Constraint('PointOnObject', 1, 2, -4))
    sk.addConstraint(Sketcher.Constraint('DistanceX', 0, 1, 0, 2, 6))
    sk.addConstraint(Sketcher.Constraint('DistanceY', 1, 1, 1, 2, 4))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Notch')
    p.Profile = sk; p.Length = 3
case('external_corner', external_corner, 'a notch whose rectangle has a corner held on two projected edges of the plate')

def external_circle(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    s1, p1 = pocket(doc, body, 10, [(5, -2, 2)], 10, 'Pocket')
    rim = find_edge(p1.Shape, lambda e: type(e.Curve).__name__ == 'Circle' and near(e.Curve.Center.z, 10))[0]
    sk = sketch(body, 'CounterboreSketch', 10)
    sk.addExternal(p1.Name, rim)
    circle(sk, 4, -1, 3.5)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 3, -3, 3))
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 4))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Counterbore')
    p.Profile = sk; p.Length = 2
case('external_circle', external_circle, 'a counterbore whose circle is concentric with the projected rim of a hole')

def external_sketch(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    sk = sketch(body, 'PocketSketch', 10)
    # The first sketch's first line (the plate's edge at y = -10), from the sketch itself.
    sk.addExternal(sk0.Name, 'Edge1')
    circle(sk, 5, -5, 2)
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 2))
    sk.addConstraint(Sketcher.Constraint('Distance', 0, 3, -3, 4))
    sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, 0, 3, 6))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Length = 4
case('external_sketch', external_sketch, 'a pocket whose circle is dimensioned from a line of another sketch, projected')

def external_unused(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    sk = sketch(body, 'PocketSketch', 10)
    sk.addExternal(pad.Name, edge_at(pad.Shape, 0, 10, 10))
    circle(sk, 0, 0, 3)
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Length = 4
case('external_unused', external_unused, 'a pocket whose sketch has a projected edge no constraint names')

def face_sketch_external(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    bs, b = boss(doc, body, 10, (-12, -6, 0, 6), 6, 'Boss')
    top = find_face(b.Shape, lambda f: type(f.Surface).__name__ == 'Plane' and near(f.CenterOfMass.z, 16))[0]
    sk = body.newObject('Sketcher::SketchObject', 'FaceSketch')
    sk.AttachmentSupport = (b, [top])
    sk.MapMode = 'FlatFace'
    doc.recompute()
    sk.addExternal(b.Name, edge_at(b.Shape, -6, 6, 16))
    sk.addExternal(b.Name, edge_at(b.Shape, -12, 0, 16))
    at = sk.getGlobalPlacement().inverse().multVec(App.Vector(-8, 3, 16))
    circle(sk, at.x, at.y, 1.5)
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 1.5))
    sk.addConstraint(Sketcher.Constraint('Distance', 0, 3, -3, 3))
    sk.addConstraint(Sketcher.Constraint('Distance', 0, 3, -4, 4))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Length = 3
case('face_sketch_external', face_sketch_external, 'a sketch attached to a boss\'s top face, its circle dimensioned from two projected edges of that face')

# --- arcs as projected edges (S9, arcs) -----------------------------------

def rounded_plate(doc, body):
    # The plate with its corner at (+20, +10) rounded with radius 6: its top and bottom faces get an arc.
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    v = find_edge(pad.Shape, lambda e: near(mid_of(e).x, 20) and near(mid_of(e).y, 10))
    f = body.newObject('PartDesign::Fillet', 'Fillet')
    f.Base = (pad, v); f.Radius = 6
    doc.recompute()
    return pad, f

def arc_edge(shape, z):
    return find_edge(shape, lambda e: type(e.Curve).__name__ == 'Circle' and near(mid_of(e).z, z)
                     and len(e.Vertexes) == 2)[0]

def external_arc_concentric(doc, body):
    pad, f = rounded_plate(doc, body)
    sk = sketch(body, 'PocketSketch', 10)
    sk.addExternal(f.Name, arc_edge(f.Shape, 10))
    circle(sk, 13, 3, 2)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 3, -3, 3))
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 2))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Length = 4
case('external_arc_concentric', external_arc_concentric, 'a pocket whose circle is concentric with the projected arc of a rounded corner (the arc on the sketch\'s plane)')

def external_arc_below(doc, body):
    pad, f = rounded_plate(doc, body)
    sk = sketch(body, 'PocketSketch', 10)
    sk.addExternal(f.Name, arc_edge(f.Shape, 0))
    circle(sk, 13, 3, 2)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 3, -3, 3))
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 2))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Length = 4
case('external_arc_below', external_arc_below, 'the same from the bottom face\'s arc, 10 below the sketch\'s plane')

def external_arc_ends(doc, body):
    pad, f = rounded_plate(doc, body)
    sk = sketch(body, 'NotchSketch', 10)
    sk.addExternal(f.Name, arc_edge(f.Shape, 10))
    # A slot from the arc's two ends inward: its outer corners are held on the arc's end points.
    sk.addGeometry(Part.LineSegment(App.Vector(14, 10, 0), App.Vector(14, 4, 0)), False)
    sk.addGeometry(Part.LineSegment(App.Vector(14, 4, 0), App.Vector(20, 4, 0)), False)
    sk.addGeometry(Part.LineSegment(App.Vector(20, 4, 0), App.Vector(14, 10, 0)), False)
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 2, 1, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 1, 2, 2, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 2, 2, 0, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 1, -3, 1))
    sk.addConstraint(Sketcher.Constraint('Coincident', 1, 2, -3, 2))
    sk.addConstraint(Sketcher.Constraint('Coincident', 0, 2, -3, 3))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Notch')
    p.Profile = sk; p.Length = 3
case('external_arc_ends', external_arc_ends, 'a triangular notch with corners held on the projected arc\'s two ends and its centre')

def external_arc_on_object(doc, body):
    pad, f = rounded_plate(doc, body)
    sk = sketch(body, 'PocketSketch', 10)
    sk.addExternal(f.Name, arc_edge(f.Shape, 10))
    r = 6 - 2.5
    circle(sk, 14 + r * math.cos(math.radians(45)) - 2.5 * 0, 4 + r * math.sin(math.radians(45)), 2.5)
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 2.5))
    sk.addConstraint(Sketcher.Constraint('Tangent', 0, -3))
    sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, 0, 3, 14 + r * math.cos(math.radians(45))))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Length = 4
case('external_arc_tangent', external_arc_on_object, 'a pocket whose circle is tangent to the projected arc from inside')

def external_arc_tilted(doc, body):
    # An arc whose axis is not the sketch's normal: the rounded corner seen from the side (it projects to a line).
    pad, f = rounded_plate(doc, body)
    sk = sketch_yz(body, 'SideSketch', 20)
    sk.addExternal(f.Name, arc_edge(f.Shape, 10))
    circle(sk, 0, 5, 2)
    sk.addConstraint(Sketcher.Constraint('Radius', 0, 2))
    sk.addConstraint(Sketcher.Constraint('DistanceY', 0, 3, -3, 1, 5))
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = sk; p.Length = 3
case('external_arc_edge_on', external_arc_tilted, 'a side sketch that projects the corner\'s arc edge-on (FreeCAD projects it to a line); its circle is dimensioned from the projection\'s start')

with open(os.path.join(OUT, 'fixtures.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'cases': cases}, fh, indent=1)
with open(os.path.join(OUT, 'log.txt'), 'w') as fh:
    fh.write('\n'.join(log) + '\n')
os._exit(0)
