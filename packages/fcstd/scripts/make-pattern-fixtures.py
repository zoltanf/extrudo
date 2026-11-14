# Authored fixtures for the FreeCAD import's S7 (LinearPattern, PolarPattern,
# Mirrored, MultiTransform, Hole): our own parts, made here with FreeCAD, so
# the stored shapes, the property grammar and the EdgeN / FaceN numbering are
# FreeCAD's own. Writes fixtures.json (no file metadata: only the objects'
# own XML from Document.xml, never the document's properties).
#
# Run: freecadcmd make_fixtures.py   (FreeCAD 1.1)
import json, math, os, re, sys, tempfile, traceback, zipfile
import FreeCAD as App, Part, Sketcher

OUT = os.path.dirname(os.path.abspath(__file__))
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
    tmp = os.path.join(tempfile.mkdtemp(prefix='s7fx'), name + '.FCStd')
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

# --- linear patterns --------------------------------------------------------
# The plate: 40 x 20 x 10 from the origin. One pocket of radius 2, 4 deep, from the top.

def linear(setup, circle_at=(6, 10), originals=None):
    def build(doc, body):
        sk0, pad = plate(doc, body, 0, 0, 40, 20, 10)
        sk, pk = pocket(doc, body, 10, [(circle_at[0], circle_at[1], 2)], 4)
        lp = transform(body, 'LinearPattern', 'LinearPattern')
        lp.Originals = [pk]
        setup(lp, sk, pad, body)
    return build

def lin_h(lp, sk, pad, body):
    lp.Direction = (sk, ['H_Axis']); lp.Length = 28; lp.Occurrences = 3
case('linear_h_axis', linear(lin_h), 'three pockets along the sketch H axis, extent 28')

def lin_v(lp, sk, pad, body):
    lp.Direction = (sk, ['V_Axis']); lp.Length = 6; lp.Occurrences = 2
case('linear_v_axis', linear(lin_v, (6, 6)), 'two pockets along the sketch V axis, extent 6')

def lin_rev(lp, sk, pad, body):
    lp.Direction = (sk, ['H_Axis']); lp.Reversed = True; lp.Length = 20; lp.Occurrences = 3
case('linear_reversed', linear(lin_rev, (34, 10)), 'Reversed: three pockets against the H axis')

def lin_edge(lp, sk, pad, body):
    # The top edge along X at y = 0: either sense keeps the copy inside the plate.
    e = find_edge(pad.Shape, lambda e: near(mid_of(e).z, 10) and near(mid_of(e).y, 0))
    lp.Direction = (pad, e); lp.Length = 12; lp.Occurrences = 2
case('linear_edge', linear(lin_edge, (20, 5)), 'direction = an edge of the pad; which sense is FreeCAD\'s')

def lin_edge_y(lp, sk, pad, body):
    e = find_edge(pad.Shape, lambda e: near(mid_of(e).z, 10) and near(mid_of(e).x, 40))
    lp.Direction = (pad, e); lp.Length = 6; lp.Occurrences = 2
case('linear_edge_y', linear(lin_edge_y, (20, 10)), 'direction = another edge of the pad (along Y)')

def lin_origin(lp, sk, pad, body):
    lp.Direction = (origin(body, 'X_Axis'), ['']); lp.Length = 28; lp.Occurrences = 3
case('linear_origin_axis', linear(lin_origin), 'direction = the body\'s origin X axis')

def lin_spacing(lp, sk, pad, body):
    lp.Direction = (sk, ['H_Axis']); lp.Mode = 'Spacing'; lp.Offset = 7; lp.Occurrences = 4
case('linear_spacing', linear(lin_spacing), 'Mode Spacing: four pockets 7 apart (FreeCAD 1.1)')

def lin_grid(lp, sk, pad, body):
    lp.Direction = (sk, ['H_Axis']); lp.Length = 28; lp.Occurrences = 3
    lp.Direction2 = (sk, ['V_Axis']); lp.Length2 = 8; lp.Occurrences2 = 2
case('linear_two_directions', linear(lin_grid, (6, 6)), 'a second direction: a 3 x 2 grid (FreeCAD 1.1)')

def linear_two_originals(doc, body):
    sk0, pad = plate(doc, body, 0, 0, 40, 20, 10)
    bs, b = boss(doc, body, 10, (3, 3, 7, 8), 3)
    sk, pk = pocket(doc, body, 10, [(5, 14, 2)], 4)
    lp = transform(body, 'LinearPattern', 'LinearPattern')
    lp.Originals = [b, pk]
    lp.Direction = (sk, ['H_Axis']); lp.Length = 30; lp.Occurrences = 3
case('linear_pad_and_pocket', linear_two_originals, 'two originals: a boss (added) and a pocket (cut)')

# --- polar patterns ---------------------------------------------------------
# The plate: 60 x 60 x 6 centred on the origin. One pocket of radius 2, 3 deep, at (12, 0).

def polar(setup, circle_at=(12, 0)):
    def build(doc, body):
        sk0, pad = plate(doc, body, -30, -30, 30, 30, 6)
        sk, pk = pocket(doc, body, 6, [(circle_at[0], circle_at[1], 2)], 3)
        pp = transform(body, 'PolarPattern', 'PolarPattern')
        pp.Originals = [pk]
        setup(pp, sk, pad, body)
    return build

def pol_full(pp, sk, pad, body):
    pp.Axis = (sk, ['N_Axis']); pp.Angle = 360; pp.Occurrences = 5
case('polar_full', polar(pol_full), 'five pockets round the sketch normal, the full turn')

def pol_part(pp, sk, pad, body):
    pp.Axis = (sk, ['N_Axis']); pp.Angle = 90; pp.Occurrences = 3
case('polar_partial', polar(pol_part), 'three pockets over 90 degrees (0, 45, 90)')

def pol_part_rev(pp, sk, pad, body):
    pp.Axis = (sk, ['N_Axis']); pp.Angle = 90; pp.Occurrences = 3; pp.Reversed = True
case('polar_partial_reversed', polar(pol_part_rev), 'Reversed: the other way round')

def pol_spacing(pp, sk, pad, body):
    pp.Axis = (sk, ['N_Axis']); pp.Mode = 'Spacing'; pp.Offset = 30; pp.Occurrences = 3
case('polar_spacing', polar(pol_spacing), 'Mode Spacing: three pockets 30 degrees apart (FreeCAD 1.1)')

def pol_origin(pp, sk, pad, body):
    pp.Axis = (origin(body, 'Z_Axis'), ['']); pp.Angle = 120; pp.Occurrences = 3
case('polar_origin_axis', polar(pol_origin), 'axis = the body\'s origin Z axis, 120 degrees')

def polar_edge(doc, body):
    sk0, pad = plate(doc, body, -30, -30, 30, 30, 6)
    bs, b = boss(doc, body, 6, (-18, -18, -12, -12), 4)
    sk, pk = pocket(doc, body, 6, [(0, -12, 2)], 3)
    pp = transform(body, 'PolarPattern', 'PolarPattern')
    pp.Originals = [pk]
    # The boss's vertical edge at (-12, -12): either sense keeps the copy inside the plate.
    e = find_edge(pk.Shape, lambda e: near(mid_of(e).x, -12) and near(mid_of(e).y, -12) and near(mid_of(e).z, 8))
    pp.Axis = (pk, e); pp.Angle = 90; pp.Occurrences = 2
case('polar_edge', polar_edge, 'axis = a straight edge of the body; which sense is FreeCAD\'s')

def polar_boss(doc, body):
    sk0, pad = plate(doc, body, -30, -30, 30, 30, 6)
    bs, b = boss(doc, body, 6, (10, -2, 16, 2), 4)
    pp = transform(body, 'PolarPattern', 'PolarPattern')
    pp.Originals = [b]
    pp.Axis = (bs, ['N_Axis']); pp.Angle = 360; pp.Occurrences = 4
case('polar_pad', polar_boss, 'a boss (added) four times round')

# --- mirrored ---------------------------------------------------------------
# The plate: 40 x 20 x 10 centred on the origin. One pocket of radius 2, 4 deep, at (12, 4).

def mirrored(setup):
    def build(doc, body):
        sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
        sk, pk = pocket(doc, body, 10, [(12, 4, 2)], 4)
        mi = transform(body, 'Mirrored', 'Mirrored')
        mi.Originals = [pk]
        setup(mi, sk, pad, body)
    return build

case('mirrored_v_axis', mirrored(lambda mi, sk, pad, body: setattr(mi, 'MirrorPlane', (sk, ['V_Axis']))),
     'plane through the sketch V axis and its normal: the copy at (-12, 4)')
case('mirrored_h_axis', mirrored(lambda mi, sk, pad, body: setattr(mi, 'MirrorPlane', (sk, ['H_Axis']))),
     'plane through the sketch H axis and its normal: the copy at (12, -4)')
case('mirrored_origin_plane', mirrored(lambda mi, sk, pad, body: setattr(mi, 'MirrorPlane', (origin(body, 'YZ_Plane'), ['']))),
     'plane = the body\'s origin YZ plane')

def mirrored_face(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    bs, b = boss(doc, body, 10, (-1, -10, 1, 10), 5)
    sk, pk = pocket(doc, body, 10, [(12, 4, 2)], 4)
    mi = transform(body, 'Mirrored', 'Mirrored')
    mi.Originals = [pk]
    f = find_face(pk.Shape, lambda f: near(f.CenterOfMass.x, 1) and near(f.CenterOfMass.z, 12.5))
    mi.MirrorPlane = (pk, f)
case('mirrored_face', mirrored_face, 'plane = a flat face of the body (x = 1): the copy at (-10, 4)')

def mirrored_boss(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    bs, b = boss(doc, body, 10, (8, 2, 14, 6), 3)
    mi = transform(body, 'Mirrored', 'Mirrored')
    mi.Originals = [b]
    mi.MirrorPlane = (bs, ['V_Axis'])
case('mirrored_pad', mirrored_boss, 'a boss (added) mirrored')

# --- multi-transform --------------------------------------------------------

def multi(children, circle_at=(12, 4)):
    def build(doc, body):
        sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
        sk, pk = pocket(doc, body, 10, [(circle_at[0], circle_at[1], 2)], 4)
        kids = []
        for kind, name, setup in children:
            c = doc.addObject('PartDesign::' + kind, name)
            setup(c, sk, body)
            body.addObject(c)
            kids.append(c)
        mt = doc.addObject('PartDesign::MultiTransform', 'MultiTransform')
        mt.Originals = [pk]
        mt.Transformations = kids
        body.addObject(mt)
        body.Tip = mt
    return build

def k_mirror(axis):
    return lambda c, sk, body: setattr(c, 'MirrorPlane', (sk, [axis]))

def k_linear(axis, length, n, reversed=False):
    def f(c, sk, body):
        c.Direction = (sk, [axis]); c.Length = length; c.Occurrences = n; c.Reversed = reversed
    return f

def k_polar(angle, n):
    def f(c, sk, body):
        c.Axis = (sk, ['N_Axis']); c.Angle = angle; c.Occurrences = n
    return f

case('multi_mirror_mirror', multi([('Mirrored', 'Mirrored', k_mirror('V_Axis')), ('Mirrored', 'Mirrored001', k_mirror('H_Axis'))]),
     'mirror in V, then in H: four pockets')
case('multi_linear_linear', multi([('LinearPattern', 'LinearPattern', k_linear('H_Axis', 24, 3)), ('LinearPattern', 'LinearPattern001', k_linear('V_Axis', 8, 2))], (-12, -4)),
     'a row of three, then two rows: a 3 x 2 grid')
case('multi_linear_mirror', multi([('LinearPattern', 'LinearPattern', k_linear('H_Axis', 6, 2)), ('Mirrored', 'Mirrored', k_mirror('V_Axis'))], (8, 4)),
     'a row of two, then mirrored: four pockets')
case('multi_mirror_polar', multi([('Mirrored', 'Mirrored', k_mirror('H_Axis')), ('PolarPattern', 'PolarPattern', k_polar(180, 2))], (12, 4)),
     'mirrored, then turned half way round the sketch normal: four pockets')

# --- holes ------------------------------------------------------------------
# The plate: 40 x 20 x 10 centred on the origin. Two centres, (-10, 0) and (10, 3).

def hole(setup, from_bottom=False):
    def build(doc, body):
        sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
        sk = sketch(body, 'HoleSketch', 0 if from_bottom else 10)
        circle(sk, -10, 0, 1.5)
        circle(sk, 10, 3, 1.5)
        h = body.newObject('PartDesign::Hole', 'Hole')
        h.Profile = sk
        h.Threaded = False
        h.ThreadType = 'None'
        setup(h)
    return build

def h_through(h):
    h.Diameter = 5; h.DepthType = 'ThroughAll'
case('hole_through', hole(h_through), 'two plain holes of 5, through all')

def h_flat(h):
    h.Diameter = 5; h.DepthType = 'Dimension'; h.Depth = 6; h.DrillPoint = 'Flat'
case('hole_blind_flat', hole(h_flat), 'blind, 6 deep, flat bottom')

def h_angled(h):
    h.Diameter = 5; h.DepthType = 'Dimension'; h.Depth = 6; h.DrillPoint = 'Angled'; h.DrillPointAngle = 118
    h.DrillForDepth = False
case('hole_blind_angled', hole(h_angled), 'blind, 6 deep, 118 degree point beyond the depth')

def h_angled_in(h):
    h.Diameter = 5; h.DepthType = 'Dimension'; h.Depth = 6; h.DrillPoint = 'Angled'; h.DrillPointAngle = 118
    h.DrillForDepth = True
case('hole_blind_angled_in_depth', hole(h_angled_in), 'the same with DrillForDepth: the point counts in the depth')

def h_cbore(h):
    h.Diameter = 5; h.DepthType = 'ThroughAll'; h.HoleCutType = 'Counterbore'
    h.HoleCutCustomValues = True; h.HoleCutDiameter = 9; h.HoleCutDepth = 3
case('hole_counterbore', hole(h_cbore), 'counterbore 9 x 3, through')

def h_cbore_blind(h):
    h.Diameter = 4; h.DepthType = 'Dimension'; h.Depth = 7; h.DrillPoint = 'Flat'; h.HoleCutType = 'Counterbore'
    h.HoleCutCustomValues = True; h.HoleCutDiameter = 8; h.HoleCutDepth = 2
case('hole_counterbore_blind', hole(h_cbore_blind), 'counterbore 8 x 2, blind 7: is the depth from the top or under the counterbore')

def h_csink(h):
    h.Diameter = 5; h.DepthType = 'ThroughAll'; h.HoleCutType = 'Countersink'
    h.HoleCutCustomValues = True; h.HoleCutDiameter = 10; h.HoleCutCountersinkAngle = 90
case('hole_countersink', hole(h_csink), 'countersink to 10 at 90 degrees, through')

def h_csink_depth(h):
    h.Diameter = 5; h.DepthType = 'ThroughAll'; h.HoleCutType = 'Countersink'
    h.HoleCutCustomValues = True; h.HoleCutDiameter = 10; h.HoleCutDepth = 1.5; h.HoleCutCountersinkAngle = 82
case('hole_countersink_82', hole(h_csink_depth), 'countersink to 10 at 82 degrees with HoleCutDepth set')

def h_reversed(h):
    h.Diameter = 5; h.DepthType = 'Dimension'; h.Depth = 6; h.DrillPoint = 'Flat'; h.Reversed = True
case('hole_reversed', hole(h_reversed, True), 'sketch on the bottom, Reversed: drilled along the sketch normal')

def m6(h):
    return [n for n in h.getEnumerationsOfProperty('ThreadSize') if n.startswith('M6')][0]

def h_clearance(h):
    h.ThreadType = 'ISOMetricProfile'; h.ThreadSize = m6(h); h.ThreadFit = 'Medium'; h.DepthType = 'ThroughAll'
case('hole_clearance_m6', hole(h_clearance), 'not threaded, sized by a table (M6 clearance): Diameter is what FreeCAD stored')

def h_threaded(h):
    h.ThreadType = 'ISOMetricProfile'; h.ThreadSize = m6(h); h.Threaded = True; h.ModelThread = False
    h.DepthType = 'ThroughAll'
case('hole_threaded_m6', hole(h_threaded), 'threaded M6, thread not modelled: the tap drill')

def h_tapered(h):
    h.Diameter = 5; h.DepthType = 'Dimension'; h.Depth = 6; h.DrillPoint = 'Flat'; h.Tapered = True; h.TaperedAngle = 85
case('hole_tapered', hole(h_tapered), 'a tapered hole: not mapped, for the refusal')

def hole_pattern(doc, body):
    sk0, pad = plate(doc, body, -20, -10, 20, 10, 10)
    sk = sketch(body, 'HoleSketch', 10)
    circle(sk, -14, -4, 1.5)
    h = body.newObject('PartDesign::Hole', 'Hole')
    h.Profile = sk; h.Threaded = False; h.ThreadType = 'None'
    h.Diameter = 4; h.DepthType = 'ThroughAll'; h.HoleCutType = 'Counterbore'
    h.HoleCutCustomValues = True; h.HoleCutDiameter = 7; h.HoleCutDepth = 2
    doc.recompute()
    lp = transform(body, 'LinearPattern', 'LinearPattern')
    lp.Originals = [h]
    lp.Direction = (sk, ['H_Axis']); lp.Length = 28; lp.Occurrences = 3
    doc.recompute()
    mi = transform(body, 'Mirrored', 'Mirrored')
    mi.Originals = [h]
    mi.MirrorPlane = (sk, ['H_Axis'])
case('hole_then_pattern_then_mirror', hole_pattern, 'a counterbored hole, a row of three of it, then the hole mirrored (FreeCAD refuses a pattern as an original)')

with open(os.path.join(OUT, 'fixtures.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'cases': cases}, fh, indent=1)
with open(os.path.join(OUT, 'log.txt'), 'w') as fh:
    fh.write('\n'.join(log) + '\n')
os._exit(0)
