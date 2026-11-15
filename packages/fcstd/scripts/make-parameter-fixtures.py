# Authored fixtures for the FreeCAD import's S10: spreadsheets, variable sets and expressions
# on sketch constraints and feature inputs. Our own parts, made here with FreeCAD, so the
# expression grammar as stored, the cell and property XML and the values FreeCAD computed are
# FreeCAD's own. Writes fixtures.json (no file metadata: only the objects' own XML from
# Document.xml, never the document's properties).
#
# Run: freecadcmd make-parameter-fixtures.py <output directory>   (FreeCAD 1.1)
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


def expressions_of(o):
    try:
        return [[str(p), str(e)] for p, e in (o.ExpressionEngine or [])]
    except Exception:
        return []

def constraints_of(sk):
    out = []
    for i, c in enumerate(sk.Constraints):
        out.append({'index': i, 'type': c.Type, 'name': c.Name, 'value': c.Value, 'driving': bool(c.Driving),
                    'first': c.First, 'second': c.Second})
    return out

def sheet_values(sh):
    # What FreeCAD computes for each cell that has content (the file stores only the content).
    out = []
    for addr in sh.getUsedCells():
        rec = {'address': addr, 'content': sh.getContents(addr), 'alias': sh.getAlias(addr)}
        try:
            v = sh.get(addr)
            if hasattr(v, 'Value') and hasattr(v, 'Unit'):
                rec['value'] = float(v.Value); rec['unit'] = str(v.Unit.Type) or str(v.Unit)
            elif isinstance(v, (bool, int, float, str)):
                rec['value'] = v
            else:
                rec['value'] = str(v)[:80]
        except Exception as e:
            rec['error'] = str(e)[:120]
        out.append(rec)
    return out

def varset_values(vs):
    out = []
    for name in vs.PropertiesList:
        if vs.getGroupOfProperty(name) in ('Base', ''):
            continue
        v = vs.getPropertyByName(name)
        out.append({'name': name, 'type': vs.getTypeIdOfProperty(name), 'group': vs.getGroupOfProperty(name),
                    'value': float(v.Value) if hasattr(v, 'Value') else (v if isinstance(v, (bool, int, float, str)) else str(v)[:80])})
    return out

REJECTED = []

def bind(o, path, expr):
    # FreeCAD refuses some expressions when they are set: those are recorded, never raised.
    try:
        o.setExpression(path, expr)
        return True
    except Exception as e:
        REJECTED.append({'object': o.Name, 'path': path, 'expression': expr, 'error': str(e)[:160]})
        return False

def case(name, build, note=''):
    doc = App.newDocument(name)
    tmp = os.path.join(tempfile.mkdtemp(prefix='s10fx'), name + '.FCStd')
    del REJECTED[:]
    try:
        body = doc.addObject('PartDesign::Body', 'Body')
        build(doc, body)
        doc.recompute()
        doc.saveAs(tmp)
        with zipfile.ZipFile(tmp) as z:
            xml = z.read('Document.xml').decode('utf-8')
        out = {'name': name, 'note': note, 'tip': body.Tip.Name if body.Tip else None,
               'group': [o.Name for o in body.Group], 'objects': [], 'outside': [],
               'rejected': list(REJECTED)}
        vols = []
        for o in doc.Objects:
            if o.TypeId == 'Spreadsheet::Sheet':
                out['outside'].append({'object': o.Name, 'type': o.TypeId, 'label': o.Label, 'xml': object_xml(xml, o.Name),
                                       'cells': sheet_values(o), 'expressions': expressions_of(o)})
            elif o.TypeId == 'App::VarSet':
                out['outside'].append({'object': o.Name, 'type': o.TypeId, 'label': o.Label, 'xml': object_xml(xml, o.Name),
                                       'vars': varset_values(o), 'expressions': expressions_of(o)})
        for o in body.Group:
            if o.isDerivedFrom('App::Origin'):
                continue
            if 'Invalid' in o.State or 'Error' in o.State:
                raise RuntimeError('%s is invalid: %s' % (o.Name, o.State))
            rec = {'object': o.Name, 'type': o.TypeId, 'label': o.Label, 'props': props(o), 'xml': object_xml(xml, o.Name),
                   'expressions': expressions_of(o)}
            if o.isDerivedFrom('Sketcher::SketchObject'):
                rec['geometry'] = sketch_geometry(o)
                rec['constraints'] = constraints_of(o)
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
        n = sum(len(r.get('expressions', [])) for r in out['objects'] + out['outside'])
        log.append('%s ok: tip %s; %d expressions, %d refused by FreeCAD; %s' % (name, out['tip'], n, len(out['rejected']), ', '.join(vols)))
        for r in out['rejected']:
            log.append('   refused: %s.%s = %s  (%s)' % (r['object'], r['path'], r['expression'], r['error']))
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

def offset_plane(doc, body, z, name='DatumPlane'):
    dp = body.newObject('PartDesign::Plane', name)
    dp.AttachmentSupport = [(origin(body, 'XY_Plane'), '')]
    dp.MapMode = 'FlatFace'
    dp.AttachmentOffset = App.Placement(App.Vector(0, 0, z), App.Rotation())
    doc.recompute()
    return dp


# --- S10 builders -------------------------------------------------------------

def sheet(doc, name, label, cells):
    # cells: (address, content, alias or None, display unit or None)
    sh = doc.addObject('Spreadsheet::Sheet', name)
    sh.Label = label
    for addr, content, alias, unit in cells:
        sh.set(addr, content)
        if unit:
            sh.setDisplayUnit(addr, unit)
    doc.recompute()
    for addr, content, alias, unit in cells:
        if alias:
            try:
                sh.setAlias(addr, alias)
            except Exception as e:
                REJECTED.append({'object': sh.Name, 'path': addr, 'expression': 'alias ' + alias, 'error': str(e)[:160]})
    doc.recompute()
    return sh

def hv(sk, first=0):
    for i, kind in enumerate(['Horizontal', 'Vertical', 'Horizontal', 'Vertical']):
        sk.addConstraint(Sketcher.Constraint(kind, first + i))

def sized_rect(sk, x0, y0, x1, y1, wname='', hname=''):
    # A rectangle with its lower left corner held, a width and a height dimension; returns their indices.
    n = sk.GeometryCount
    rect(sk, x0, y0, x1, y1)
    hv(sk, n)
    sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, n, 1, x0))
    sk.addConstraint(Sketcher.Constraint('DistanceY', -1, 1, n, 1, y0))
    w = sk.addConstraint(Sketcher.Constraint('DistanceX', n, 1, n, 2, x1 - x0))
    h = sk.addConstraint(Sketcher.Constraint('DistanceY', n + 1, 1, n + 1, 2, y1 - y0))
    if wname:
        sk.renameConstraint(w, wname)
    if hname:
        sk.renameConstraint(h, hname)
    return w, h

def sized_plate(doc, body, x0, y0, x1, y1, h, wname='', hname=''):
    sk = sketch(body, 'Sketch')
    w, d = sized_rect(sk, x0, y0, x1, y1, wname, hname)
    pad = body.newObject('PartDesign::Pad', 'Pad')
    pad.Profile = sk
    pad.Length = h
    doc.recompute()
    return sk, pad, w, d

def held_circle(sk, x, y, r, diameter=False):
    # A circle with its centre held by two dimensions from the origin and a radius or diameter; returns the three indices.
    n = sk.GeometryCount
    circle(sk, x, y, r)
    cx = sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, n, 3, x))
    cy = sk.addConstraint(Sketcher.Constraint('DistanceY', -1, 1, n, 3, y))
    cr = sk.addConstraint(Sketcher.Constraint('Diameter', n, 2 * r) if diameter else Sketcher.Constraint('Radius', n, r))
    return cx, cy, cr

# 1. A plate driven by a spreadsheet: aliases by label and by name, a formula, a cell without an alias,
#    a quantity cell, a second sheet that reads the first.
def sheet_plate(doc, body):
    sh = sheet(doc, 'Spreadsheet', 'Params', [
        ('A1', 'Width', None, None), ('B1', '40', 'width', None),
        ('A2', 'Depth', None, None), ('B2', '20', 'depth', None),
        ('A3', 'Height', None, None), ('B3', '10', 'height', 'mm'),
        ('A4', 'Inset', None, None), ('B4', '=width / 4', 'inset', None),
        ('A5', 'Count', None, None), ('B5', '3', 'count', None),
        ('A6', 'Gaps', None, None), ('B6', '=B5 - 1', None, None),
        ('A7', 'Hole', None, None), ('B7', '6 mm', 'hole_d', None),
        ('A8', 'Pitch', None, None), ('B8', '=inset * 0.8', 'pitch', None),
        ('A9', "'a note", None, None), ('B9', '12.5', 'unused_one', None),
    ])
    sh2 = sheet(doc, 'Spreadsheet001', 'Derived', [
        ('A1', '=<<Params>>.depth / 2', 'half_depth', None),
        ('A2', '=Spreadsheet.height - 6', 'pocket_depth', None),
    ])
    sk, pad, w, d = sized_plate(doc, body, -20, -10, 20, 10, 10, 'Wide', '')
    bind(sk, '.Constraints.Wide', '<<Params>>.width')
    bind(sk, 'Constraints[%d]' % d, 'Spreadsheet.depth')
    bind(pad, 'Length', '<<Params>>.height')
    doc.recompute()
    ps = sketch(body, 'PocketSketch', 10)
    cx, cy, cr = held_circle(ps, -10, 10, 3, True)
    ps.renameConstraint(cy, 'FromAxis')
    bind(ps, 'Constraints[%d]' % cx, '-<<Params>>.inset')
    bind(ps, '.Constraints.FromAxis', '<<Derived>>.half_depth')
    bind(ps, 'Constraints[%d]' % cr, '<<Params>>.hole_d')
    bind(ps, 'AttachmentOffset.Base.z', '<<Params>>.height')
    doc.recompute()
    # The circle sits on the plate's edge at y = 10: half of it cuts.
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = ps; p.Length = 4
    bind(p, 'Length', '<<Derived>>.pocket_depth')
    doc.recompute()
    lp = transform(body, 'LinearPattern', 'LinearPattern')
    lp.Originals = [p]
    lp.Direction = (ps, ['H_Axis']); lp.Length = 16; lp.Occurrences = 3
    bind(lp, 'Occurrences', '<<Params>>.count')
    bind(lp, 'Length', '<<Params>>.pitch * Spreadsheet.B6')
case('sheet_plate', sheet_plate, 'a plate whose sketch, pad, pocket and pattern read two spreadsheets (by label, by name, a formula, a cell without an alias, a quantity cell)')

# 2. A variable set (FreeCAD 1.0+): length, distance, angle, float, integer and bool properties.
def varset_part(doc, body):
    vs = doc.addObject('App::VarSet', 'VarSet')
    vs.Label = 'Vars'
    vs.addProperty('App::PropertyLength', 'Height', 'Dims', 'the plate thickness'); vs.Height = 10
    vs.addProperty('App::PropertyDistance', 'Shift', 'Dims', 'where the first hole is'); vs.Shift = -12
    vs.addProperty('App::PropertyAngle', 'Sweep', 'Pattern', 'the angle the holes cover'); vs.Sweep = 360
    vs.addProperty('App::PropertyInteger', 'Count', 'Pattern', 'how many holes'); vs.Count = 4
    vs.addProperty('App::PropertyFloat', 'Ratio', 'Dims', 'depth of a hole as a part of the height'); vs.Ratio = 0.5
    vs.addProperty('App::PropertyBool', 'Flag', 'Other', 'a switch'); vs.Flag = False
    vs.addProperty('App::PropertyString', 'Note', 'Other', 'a text'); vs.Note = 'text'
    doc.recompute()
    sk, pad, w, d = sized_plate(doc, body, -20, -20, 20, 20, 10)
    bind(pad, 'Length', 'VarSet.Height')
    doc.recompute()
    ps = sketch(body, 'PocketSketch', 10)
    cx, cy, cr = held_circle(ps, -12, 0, 2)
    bind(ps, 'Constraints[%d]' % cx, 'VarSet.Shift')
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = ps; p.Length = 5
    bind(p, 'Length', 'VarSet.Height * VarSet.Ratio')
    bind(p, 'Reversed', 'VarSet.Flag')
    doc.recompute()
    pp = transform(body, 'PolarPattern', 'PolarPattern')
    pp.Originals = [p]
    pp.Axis = (ps, ['N_Axis']); pp.Angle = 360; pp.Occurrences = 4
    bind(pp, 'Angle', 'VarSet.Sweep')
    bind(pp, 'Occurrences', 'VarSet.Count')
case('varset_part', varset_part, 'a plate with a ring of holes that read a variable set (length, distance, angle, integer, float; a bool on Reversed)')

# 3. Values that read other model values: a named and an indexed constraint, of the same sketch and of
#    another, a feature's input, an own input.
def model_refs(doc, body):
    sk, pad, w, d = sized_plate(doc, body, -20, -10, 20, 10, 10, 'Width', '')
    bind(sk, 'Constraints[%d]' % d, '.Constraints.Width / 2')
    bind(pad, 'Length', 'Sketch.Constraints.Width / 4')
    doc.recompute()
    ps = sketch(body, 'PocketSketch', 10)
    cx, cy, cr = held_circle(ps, 5, 0, 2)
    bind(ps, 'Constraints[%d]' % cr, 'Sketch.Constraints[%d] / 10' % d)
    bind(ps, 'Constraints[%d]' % cx, 'Sketch.Constraints.Width / 8')
    doc.recompute()
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = ps; p.Length = 5
    bind(p, 'Length', 'Pad.Length / 2')
    doc.recompute()
    bs = sketch(body, 'BossSketch', 10)
    sized_rect(bs, -18, -8, -12, 8)
    b = body.newObject('PartDesign::Pad', 'Boss')
    b.Profile = bs
    b.SideType = 'Two sides'
    b.Length = 6; b.Length2 = 3
    bind(b, 'Length2', 'Length / 2')
    bind(b, 'Length', 'Pocket.Length + 1 mm')
case('model_refs', model_refs, 'dimensions and lengths that read other dimensions (by name, by index, of another sketch) and other features\' inputs')

# 4. A truth table: one driven line per expression, the value FreeCAD computed is the stored constraint value.
LENGTHS = [
    '10 mm', '2.5 cm', '1 in', '0.5', '1e1', '.5 * 20', '10 mm + 1 cm', '(4 + 6) mm', '3 mm * 2',
    '(20 mm * 3 mm) / 4 mm', '2 dm / 10', '1500 um', '10 thou * 1000', "1' 2\"", '1 / 2 in',
    '2 ^ 3', '2 ^ 3 ^ 2 / 10', '-2 ^ 2 + 10', '2 ^ -1 * 10', '17 % 5', 'mod(17; 5)', 'mod(17, 5)',
    'hypot(3; 4)', 'cath(5; 3)', 'pow(2; 3)', 'cbrt(27)', 'sqrt(49)', 'abs(-7)', 'min(4; 9; 6)',
    'max(4; 9; 6)', 'round(7.4)', 'floor(7.9)', 'ceil(7.1)', 'trunc(7.9)', 'exp(2)', 'log(100)',
    'log10(1000)', '10 * sin(30)', '10 * cos(60 deg)', '10 * tan(45)', '10 * sin(0.5 rad)',
    '10 * sin(pi / 6)', 'asin(0.5) / 3 deg', 'acos(0.5) / 6 deg', 'atan(1) / 5 deg', 'atan2(1; 1) / 5 deg',
    '1 > 0 ? 7 : 9', '(2 == 3) ? 7 : 9', 'e * 2', 'pi * 2', '10 * sin(Spreadsheet.n)',
    'Spreadsheet.n / 3', 'Spreadsheet.len_mm / 2', 'Spreadsheet.len_mm + 1', 'Spreadsheet.len_mm + 1 mm',
    'Spreadsheet.n mm', 'sqrt(Spreadsheet.len_mm * 2 mm)', 'round(Spreadsheet.n / 7)',
    '10 * cos(Spreadsheet.ang)', 'Spreadsheet.n * Spreadsheet.ratio', '-Spreadsheet.neg',
    'abs(Spreadsheet.neg) mm', 'max(Spreadsheet.n; Spreadsheet.len_mm / 1 mm) / 2',
    'Spreadsheet.n * 1 mm / (2 mm) * 1 mm', '5 mm ^ 2 / 1 mm', 'sum(1; 2; 3)', 'average(4; 8)',
    'count(4; 8; 9) * 2', '1 + 2 * 3', '(1 + 2) * 3', '12 / 4 / 3 * 5', '10 - 4 - 3', '+7',
]
ANGLES = ['30 deg', '45', 'pi / 6 rad', '1 rad', 'asin(0.5)', '60 deg / 2', 'Spreadsheet.ang',
          'Spreadsheet.n * 1 deg', 'atan2(1; 1)', '0.25 * 180 deg', '50 gon', '90 deg - Spreadsheet.ang']

def tried(doc, sk, c, expr, kind, start):
    # Binds one expression; one FreeCAD can't evaluate (the sketch turns invalid) is taken off again.
    row = {'kind': kind, 'expression': expr, 'constraint': c, 'accepted': bind(sk, 'Constraints[%d]' % c, expr)}
    doc.recompute()
    if 'Invalid' in sk.State or 'Error' in sk.State:
        row['accepted'] = False
        row['error'] = 'not evaluated: ' + str(sk.getStatusString())[:160]
        sk.setExpression('Constraints[%d]' % c, None)
        try:
            sk.setDatum(c, start)
        except Exception:
            pass
        doc.recompute()
        if 'Invalid' in sk.State:
            raise RuntimeError('the sketch stays invalid after %s' % expr)
    return row

def functions_table(doc, body):
    sheet(doc, 'Spreadsheet', 'Spreadsheet', [
        ('A1', '30', 'n', None), ('A2', '8 mm', 'len_mm', None), ('A3', '60 deg', 'ang', None),
        ('A4', '0.25', 'ratio', None), ('A5', '-9', 'neg', None),
    ])
    sk, pad, w, d = sized_plate(doc, body, -40, -200, -30, -190, 5)
    table = []
    for i, expr in enumerate(LENGTHS):
        n = sk.GeometryCount
        y = 2.0 * (i + 1)
        sk.addGeometry(Part.LineSegment(App.Vector(1, y, 0), App.Vector(11, y, 0)), True)
        sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, n, 1, 1))
        sk.addConstraint(Sketcher.Constraint('DistanceY', -1, 1, n, 1, y))
        sk.addConstraint(Sketcher.Constraint('Horizontal', n))
        c = sk.addConstraint(Sketcher.Constraint('DistanceX', n, 1, n, 2, 10))
        table.append(tried(doc, sk, c, expr, 'length', 10))
    for i, expr in enumerate(ANGLES):
        n = sk.GeometryCount
        y = -10.0 - 12.0 * i
        sk.addGeometry(Part.LineSegment(App.Vector(60, y, 0), App.Vector(60 + 8.66, y + 5, 0)), True)
        sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, n, 1, 60))
        sk.addConstraint(Sketcher.Constraint('DistanceY', -1, 1, n, 1, y))
        sk.addConstraint(Sketcher.Constraint('Distance', n, 10))
        c = sk.addConstraint(Sketcher.Constraint('Angle', n, math.radians(30)))
        table.append(tried(doc, sk, c, expr, 'angle', math.radians(30)))
    doc.recompute()
    for t in table:
        t['value'] = sk.Constraints[t['constraint']].Value
        t['stored'] = dict(sk.ExpressionEngine).get('Constraints[%d]' % t['constraint'])
        if not t['accepted'] and 'error' not in t:
            t['error'] = [r['error'] for r in REJECTED if r['expression'] == t['expression']][-1:]
    TABLES['functions_table'] = table
TABLES = {}
case('functions_table', functions_table, 'one driven line per expression: the value FreeCAD computed for each is its constraint\'s stored value (lengths in mm, angles in radians)')

# 5. Every kind of feature input bound to a spreadsheet cell.
def bound_pad_pocket(doc, body):
    sheet(doc, 'Spreadsheet', 'P', [('A1', '10', 'thick', None), ('A2', '6', 'up', None), ('A3', '3', 'down', None),
                                    ('A4', '4', 'cut', None), ('A5', '2', 'r', None)])
    sk, pad, w, d = sized_plate(doc, body, -20, -10, 20, 10, 10)
    bind(pad, 'Length', '<<P>>.thick')
    doc.recompute()
    bs = sketch(body, 'BossSketch', 10)
    sized_rect(bs, -18, -8, -12, 8)
    bind(bs, 'AttachmentOffset.Base.z', '<<P>>.thick')
    b = body.newObject('PartDesign::Pad', 'Boss')
    b.Profile = bs; b.SideType = 'Two sides'; b.Length = 6; b.Length2 = 3
    bind(b, 'Length', '<<P>>.up'); bind(b, 'Length2', '<<P>>.down')
    doc.recompute()
    ps = sketch(body, 'PocketSketch', 10)
    cx, cy, cr = held_circle(ps, 8, 0, 2)
    bind(ps, 'Constraints[%d]' % cr, '<<P>>.r')
    bind(ps, 'AttachmentOffset.Base.z', '<<P>>.thick')
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = ps; p.Length = 4
    bind(p, 'Length', '<<P>>.cut')
case('bound_pad_pocket', bound_pad_pocket, 'a pad, a two-sided pad, a pocket and their sketches\' offsets, each input read from a cell')

def bound_dressups(doc, body):
    sheet(doc, 'Spreadsheet', 'P', [('A1', '2', 'round', None), ('A2', '1.5', 'bevel', None)])
    sk, pad, w, d = sized_plate(doc, body, -20, -10, 20, 10, 10)
    v = find_edge(pad.Shape, lambda e: near(mid_of(e).x, 20) and near(mid_of(e).y, 10))
    f = body.newObject('PartDesign::Fillet', 'Fillet')
    f.Base = (pad, v); f.Radius = 2
    bind(f, 'Radius', '<<P>>.round')
    doc.recompute()
    t = find_edge(f.Shape, lambda e: near(mid_of(e).x, -20) and near(mid_of(e).z, 10))
    c = body.newObject('PartDesign::Chamfer', 'Chamfer')
    c.Base = (f, t); c.Size = 1.5
    bind(c, 'Size', '<<P>>.bevel')
case('bound_dressups', bound_dressups, 'a fillet radius and a chamfer size read from cells')

def bound_patterns(doc, body):
    sheet(doc, 'Spreadsheet', 'P', [('A1', '3', 'n', None), ('A2', '24', 'span', None), ('A3', '4', 'around', None),
                                    ('A4', '360', 'sweep', None)])
    sk, pad, w, d = sized_plate(doc, body, -20, -20, 20, 20, 10)
    s1, p1 = pocket(doc, body, 10, [(-12, -15, 2)], 4, 'Pocket')
    lp = transform(body, 'LinearPattern', 'LinearPattern')
    lp.Originals = [p1]; lp.Direction = (s1, ['H_Axis']); lp.Length = 24; lp.Occurrences = 3
    bind(lp, 'Length', '<<P>>.span'); bind(lp, 'Occurrences', '<<P>>.n')
    doc.recompute()
    s2, p2 = pocket(doc, body, 10, [(0, 10, 1.5)], 4, 'Pocket001')
    pp = transform(body, 'PolarPattern', 'PolarPattern')
    pp.Originals = [p2]; pp.Axis = (s2, ['N_Axis']); pp.Angle = 360; pp.Occurrences = 4
    bind(pp, 'Angle', '<<P>>.sweep'); bind(pp, 'Occurrences', '<<P>>.around')
case('bound_patterns', bound_patterns, 'a row and a ring of pockets whose length, angle and counts are read from cells')

def bound_revolve(doc, body):
    sheet(doc, 'Spreadsheet', 'P', [('A1', '180', 'turn', None), ('A2', '90 deg', 'notch', None)])
    sk = sketch(body, 'Sketch')
    sized_rect(sk, 5, 0, 15, 10)
    r = body.newObject('PartDesign::Revolution', 'Revolution')
    r.Profile = sk; r.ReferenceAxis = (sk, ['V_Axis']); r.Angle = 180
    bind(r, 'Angle', '<<P>>.turn')
    doc.recompute()
    gs = sketch(body, 'GrooveSketch')
    sized_rect(gs, 12, 4, 15, 6)
    g = body.newObject('PartDesign::Groove', 'Groove')
    g.Profile = gs; g.ReferenceAxis = (gs, ['V_Axis']); g.Angle = 90
    bind(g, 'Angle', '<<P>>.notch')
case('bound_revolve', bound_revolve, 'a half revolution and a quarter groove whose angles are read from cells (a plain number and an angle)')

def bound_hole(doc, body):
    sheet(doc, 'Spreadsheet', 'P', [('A1', '5', 'bore', None), ('A2', '6', 'deep', None)])
    sk, pad, w, d = sized_plate(doc, body, -20, -10, 20, 10, 10)
    hs = sketch(body, 'HoleSketch', 10)
    circle(hs, -8, 0, 2); circle(hs, 8, 0, 2)
    doc.recompute()
    h = body.newObject('PartDesign::Hole', 'Hole')
    h.Profile = hs; h.Threaded = False; h.ThreadType = 'None'
    h.Diameter = 5; h.DepthType = 'Dimension'; h.Depth = 6; h.DrillPoint = 'Flat'
    bind(h, 'Diameter', '<<P>>.bore'); bind(h, 'Depth', '<<P>>.deep')
case('bound_hole', bound_hole, 'two blind holes whose diameter and depth are read from cells')

def bound_datum_upto(doc, body):
    sheet(doc, 'Spreadsheet', 'P', [('A1', '18', 'level', None), ('A2', '1.5', 'past', None)])
    sk, pad, w, d = sized_plate(doc, body, -20, -10, 20, 10, 10)
    dp = offset_plane(doc, body, 18)
    bind(dp, 'AttachmentOffset.Base.z', '<<P>>.level')
    doc.recompute()
    bs = sketch(body, 'BossSketch', 10)
    sized_rect(bs, -6, -6, 6, 6)
    b = body.newObject('PartDesign::Pad', 'Boss')
    b.Profile = bs; b.Type = 'UpToFace'; b.UpToFace = (dp, ['']); b.Offset = 1.5
    bind(b, 'Offset', '<<P>>.past')
case('bound_datum_upto', bound_datum_upto, 'a datum plane whose offset is read from a cell, and a pad up to it with its offset read from a cell')

# 6. Names: a label with spaces and letters outside ASCII, aliases FreeCAD accepts that Extrudo may not,
#    an alias and a constraint with the same name, two aliases that differ by case.
def names(doc, body):
    sheet(doc, 'Spreadsheet', 'Maße #1', [
        ('A1', '40', 'Width', None), ('A2', '20', 'width', None), ('A3', '10', 'd', None),
        ('A4', '2', 'sin_', None), ('A5', '3', 'cos', None), ('A6', '4', 'max', None),
        ('A7', '5', 'mm', None), ('A8', '6', 'pi', None), ('A9', '7', 'in_', None),
        ('A10', '8', 'e1', None), ('A11', '9', 'deg', None), ('A12', '11', 'round', None),
        ('A13', '12', 'Länge', None), ('A14', '13', '_lead', None), ('A15', '14', 'x1', None),
        ('A16', '15', 'A1x', None), ('A17', '16', 'H', None), ('A18', '17', 'Pad', None),
    ])
    sk, pad, w, d = sized_plate(doc, body, -20, -10, 20, 10, 10, 'width', 'd')
    bind(sk, '.Constraints.width', '<<Maße #1>>.Width')
    bind(sk, '.Constraints.d', '<<Maße #1>>.width')
    bind(pad, 'Length', '<<Maße #1>>.d')
    # A constraint named like a unit (W, the watt): FreeCAD can't parse a path or an expression that names it.
    spare = sk.addGeometry(Part.LineSegment(App.Vector(0, -30, 0), App.Vector(7, -30, 0)), True)
    extra = sk.addConstraint(Sketcher.Constraint('Distance', spare, 7))
    sk.renameConstraint(extra, 'W')
    bind(sk, '.Constraints.W', '<<Maße #1>>.Width')
    bind(pad, 'Length', 'Sketch.Constraints.W / 4')
    bind(pad, 'Length', '<<Maße #1>>.d')
    doc.recompute()
    ps = sketch(body, 'PocketSketch', 10)
    cx, cy, cr = held_circle(ps, 5, 0, 2)
    bind(ps, 'Constraints[%d]' % cr, 'Spreadsheet.sin_')
    bind(ps, 'Constraints[%d]' % cx, 'Spreadsheet.max + 1')
    p = body.newObject('PartDesign::Pocket', 'Pocket')
    p.Profile = ps; p.Length = 3
    bind(p, 'Length', 'Spreadsheet.cos')
case('names', names, 'a sheet whose label has a space, # and a letter outside ASCII; aliases that are words of Extrudo\'s expression language; an alias and a constraint of one name')

with open(os.path.join(OUT, 'fixtures.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'cases': cases, 'tables': TABLES}, fh, indent=1)
with open(os.path.join(OUT, 'log.txt'), 'w') as fh:
    fh.write('\n'.join(log) + '\n')
os._exit(0)
