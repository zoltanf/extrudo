# Authored fixtures for the FreeCAD import's S12b (ADR-0144): part containers, links, link
# arrays, compounds at the top, meshes. Our own parts, made with FreeCAD 1.1, so the property
# grammar, the placements, the link elements and the mesh entries are FreeCAD's own.
#
# Self-contained: the helpers are those of make-part-fixtures.py (everything above its
# builders), copied here.
#
# Run, from the repository's root (FreeCAD 1.1 for the first step):
#   1. freecadcmd packages/fcstd/scripts/make-structure-fixtures.py <dir>
#        writes <dir>/fixtures.json (and log.txt)
#   2. python3 packages/fcstd/scripts/structure-fixtures-to-module.py \
#        <dir>/fixtures.json packages/fcstd/src/structure-fixtures.ts
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

# --- the S12b helpers --------------------------------------------------------
import json
import FreeCAD as App, Part, Sketcher, Mesh
V = App.Vector
MESH = {}   # case -> object -> what FreeCAD says about its mesh
WORLD = {}  # case -> object -> the shape FreeCAD shows for it in the document's frame

def rot(axis, deg):
    return App.Rotation(V(*axis), deg)

def pl(base=(0, 0, 0), axis=(0, 0, 1), deg=0.0):
    return App.Placement(V(*base), rot(axis, deg))

def hide(*objs):
    for o in objs:
        o.Visibility = False

def box(doc, name, l, w, h, **k):
    o = doc.addObject('Part::Box', name)
    o.Length = l; o.Width = w; o.Height = h
    if k:
        o.Placement = pl(**k)
    return o

def cyl(doc, name, r, h, **k):
    o = doc.addObject('Part::Cylinder', name)
    o.Radius = r; o.Height = h
    if k:
        o.Placement = pl(**k)
    return o

def cut(doc, name, base, tool):
    o = doc.addObject('Part::Cut', name)
    o.Base = base; o.Tool = tool
    hide(base, tool)
    return o

def body(doc, name='Body', l=40, w=20, h=10, hole=True):
    b = doc.addObject('PartDesign::Body', name)
    sk = b.newObject('Sketcher::SketchObject', name + 'Sketch')
    xy = [o for o in b.Origin.OriginFeatures if o.Role == 'XY_Plane'][0]
    sk.AttachmentSupport = (xy, ['']); sk.MapMode = 'FlatFace'
    pts = [(0, 0), (l, 0), (l, w), (0, w)]
    for i in range(4):
        a, c = pts[i], pts[(i + 1) % 4]
        sk.addGeometry(Part.LineSegment(V(a[0], a[1], 0), V(c[0], c[1], 0)), False)
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint('Coincident', i, 2, (i + 1) % 4, 1))
    pad = b.newObject('PartDesign::Pad', name + 'Pad')
    pad.Profile = sk; pad.Length = h
    doc.recompute()
    if hole:
        ps = b.newObject('Sketcher::SketchObject', name + 'HoleSketch')
        ps.AttachmentSupport = (xy, ['']); ps.MapMode = 'FlatFace'
        ps.AttachmentOffset = App.Placement(V(0, 0, h), App.Rotation())
        ps.addGeometry(Part.Circle(V(l / 4.0, w / 2.0, 0), V(0, 0, 1), w / 5.0), False)
        p = b.newObject('PartDesign::Pocket', name + 'Hole')
        p.Profile = ps; p.Length = h / 2.0
    doc.recompute()
    return b

def link(doc, name, target, **k):
    o = doc.addObject('App::Link', name)
    o.LinkedObject = target
    if k:
        o.Placement = pl(**k)
    return o

def world(doc, *objs):
    # What FreeCAD itself shows for an object in the document's frame: its shape through
    # every container and link above it (Part.getShape follows them).
    doc.recompute()
    for o in objs:
        try:
            s = Part.getShape(o, '', needSubElement=False, transform=True)
            s = s.copy()
            g = o.getParentGeoFeatureGroup() if hasattr(o, 'getParentGeoFeatureGroup') else None
            n = 0
            while g is not None and n < 16:
                s.Placement = g.Placement.multiply(s.Placement)
                g = g.getParentGeoFeatureGroup() if hasattr(g, 'getParentGeoFeatureGroup') else None
                n += 1
            WORLD.setdefault(doc.Name, {})[o.Name] = measure(s)
        except Exception as e:
            WORLD.setdefault(doc.Name, {})[o.Name] = {'error': str(e)[:160]}

def mesh_truth(doc, *objs):
    doc.recompute()
    for o in objs:
        m = o.Mesh
        bb = m.BoundBox
        MESH.setdefault(doc.Name, {})[o.Name] = {
            'points': m.CountPoints, 'facets': m.CountFacets, 'solid': bool(m.isSolid()),
            'components': len(m.getSeparateComponents()), 'volume': m.Volume, 'area': m.Area,
            'box': [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax],
            'selfIntersections': bool(m.hasSelfIntersections()),
            'nonManifolds': bool(m.hasNonManifolds()),
        }

# --- containers ---------------------------------------------------------------

def part_basic(doc):
    part = doc.addObject('App::Part', 'Part'); part.Label = 'Bracket'
    b = body(doc)
    bx = box(doc, 'Box', 30, 20, 10, base=(0, 40, 0))
    c = cyl(doc, 'Cylinder', 4, 10, base=(15, 50, 0))
    k = cut(doc, 'Cut', bx, c)
    part.addObjects([b, bx, c, k])
    loose = box(doc, 'Box001', 10, 10, 10, base=(60, 0, 0)); loose.Label = 'Spacer'
    world(doc, b, k, loose)
    return [b, k, loose]

def part_placed(doc):
    outer = doc.addObject('App::Part', 'Part'); outer.Label = 'Frame'
    outer.Placement = pl(base=(100, 50, 20), deg=45)
    b = body(doc)
    bx = box(doc, 'Box', 10, 10, 10, base=(0, 30, 0))
    inner = doc.addObject('App::Part', 'Part001'); inner.Label = 'Axle'
    inner.Placement = pl(base=(0, 0, 30), axis=(1, 0, 0), deg=90)
    c = cyl(doc, 'Cylinder', 3, 25)
    inner.addObject(c)
    outer.addObjects([b, bx, inner])
    world(doc, b, bx, c)
    return [b, bx, c]

def part_odd(doc):
    empty = doc.addObject('App::Part', 'Part'); empty.Label = 'Empty'
    grp = doc.addObject('App::DocumentObjectGroup', 'Group'); grp.Label = 'Folder'
    inside = doc.addObject('App::Part', 'Part001'); inside.Label = 'In a folder'
    bx = box(doc, 'Box', 10, 10, 10)
    inside.addObject(bx)
    grp.addObject(inside)
    same = doc.addObject('App::Part', 'Part002'); same.Label = 'in a FOLDER'
    c = cyl(doc, 'Cylinder', 4, 10, base=(30, 0, 0))
    same.addObject(c)
    hidden = doc.addObject('App::Part', 'Part003'); hidden.Label = 'Hidden part'
    hb = box(doc, 'Box001', 5, 5, 5, base=(60, 0, 0))
    hidden.addObject(hb); hidden.Visibility = False
    world(doc, bx, c, hb)
    return [bx, c, hb]

# --- links ----------------------------------------------------------------------

def links_basic(doc):
    bx = box(doc, 'Box', 10, 10, 10)
    l1 = link(doc, 'Link', bx, base=(30, 0, 0))
    b2 = box(doc, 'Box001', 30, 20, 10, base=(0, 40, 0))
    c = cyl(doc, 'Cylinder', 4, 10, base=(15, 50, 0))
    k = cut(doc, 'Cut', b2, c)
    l2 = link(doc, 'Link001', k, base=(60, 0, 0), deg=90)
    bd = body(doc)
    bd.Placement = pl(base=(0, 100, 0))
    l3 = link(doc, 'Link002', bd, base=(0, 100, 40), axis=(1, 0, 0), deg=180)
    world(doc, bx, l1, k, l2, bd, l3)
    return [bx, l1, k, l2, bd, l3]

def link_transform(doc):
    bx = box(doc, 'Box', 10, 20, 30, base=(50, 0, 0), deg=30)
    off = link(doc, 'Link', bx, base=(0, 60, 0))
    off.LinkTransform = False
    on = link(doc, 'Link001', bx, base=(0, 120, 0))
    on.LinkTransform = True
    world(doc, bx, off, on)
    return [bx, off, on]

def link_hidden_target(doc):
    bx = box(doc, 'Box', 10, 10, 10); bx.Label = 'Master'
    hide(bx)
    a = link(doc, 'Link', bx, base=(20, 0, 0))
    b = link(doc, 'Link001', bx, base=(40, 0, 0), deg=45)
    world(doc, a, b)
    return [a, b]

def link_to_part(doc):
    part = doc.addObject('App::Part', 'Part'); part.Label = 'Wheel'
    bx = box(doc, 'Box', 20, 20, 5)
    c = cyl(doc, 'Cylinder', 3, 15, base=(10, 10, 5))
    part.addObjects([bx, c])
    l = link(doc, 'Link', part, base=(50, 0, 0), deg=90); l.Label = 'Wheel 2'
    world(doc, bx, c, l)
    return [bx, c, l]

def link_chain(doc):
    bx = box(doc, 'Box', 10, 10, 10)
    a = link(doc, 'Link', bx, base=(20, 0, 0))
    b = link(doc, 'Link001', a, base=(0, 30, 0))
    world(doc, bx, a, b)
    return [bx, a, b]

def link_array(doc):
    bx = box(doc, 'Box', 10, 10, 10)
    packed = link(doc, 'Link', bx, base=(0, 30, 0))
    packed.ShowElement = False
    packed.ElementCount = 3
    doc.recompute()
    packed.PlacementList = [pl(base=(20 * i, 0, 0), deg=15 * i) for i in range(3)]
    c = cyl(doc, 'Cylinder', 3, 10, base=(0, 80, 0))
    shown = link(doc, 'Link001', c)
    shown.ShowElement = True
    shown.ElementCount = 3
    doc.recompute()
    for i, e in enumerate(shown.ElementList):
        e.Placement = pl(base=(15 * i, 100, 0))
    world(doc, bx, packed, c, shown)
    return [bx, packed, c, shown]

def link_scaled(doc):
    bx = box(doc, 'Box', 10, 10, 10)
    l = link(doc, 'Link', bx, base=(30, 0, 0))
    l.ScaleVector = V(2, 2, 2)
    world(doc, bx, l)
    return [bx, l]

# --- compounds at the top ---------------------------------------------------------

def compound_top(doc):
    a = box(doc, 'Box', 10, 10, 10)
    b = cyl(doc, 'Cylinder', 4, 10, base=(30, 5, 0))
    plain = doc.addObject('Part::Compound', 'Compound'); plain.Links = [a, b]; hide(a, b)
    bd = body(doc)
    bd.Placement = pl(base=(0, 40, 0))
    b2 = box(doc, 'Box001', 30, 20, 10, base=(60, 40, 0))
    c2 = cyl(doc, 'Cylinder001', 4, 10, base=(75, 50, 0))
    k = cut(doc, 'Cut', b2, c2)
    placed = doc.addObject('Part::Compound', 'Compound001'); placed.Links = [bd, k]; hide(bd, k)
    placed.Placement = pl(base=(0, 0, 50), deg=30)
    p = box(doc, 'Box002', 5, 5, 5, base=(0, 120, 0))
    q = box(doc, 'Box003', 5, 5, 5, base=(10, 120, 0))
    inner = doc.addObject('Part::Compound', 'Compound002'); inner.Links = [p, q]; hide(p, q)
    r = cyl(doc, 'Cylinder002', 2, 5, base=(25, 122, 0))
    outer = doc.addObject('Part::Compound', 'Compound003'); outer.Links = [inner, r]; hide(inner, r)
    world(doc, plain, placed, outer)
    return [plain, placed, outer]

def compound_touching(doc):
    a = box(doc, 'Box', 10, 10, 10)
    b = box(doc, 'Box001', 10, 10, 10, base=(5, 5, 5))
    over = doc.addObject('Part::Compound', 'Compound'); over.Links = [a, b]; hide(a, b)
    world(doc, over)
    return [over]

# --- meshes -----------------------------------------------------------------------

def mesh_obj(doc, name, m, **k):
    o = doc.addObject('Mesh::Feature', name)
    o.Mesh = m
    if k:
        o.Placement = pl(**k)
    return o

def meshes(doc):
    cube = mesh_obj(doc, 'Mesh', Mesh.createBox(10, 20, 30)); cube.Label = 'Cube'
    turned = mesh_obj(doc, 'Mesh001', Mesh.createCylinder(5, 20, True, 1.0, 24), base=(40, 0, 0), axis=(0, 1, 0), deg=90)
    turned.Label = 'Turned'
    ball = mesh_obj(doc, 'Mesh002', Mesh.createSphere(8, 16), base=(0, 60, 0)); ball.Label = 'Ball'
    hide(ball)
    mesh_truth(doc, cube, turned, ball)
    return [cube, turned, ball]

def mesh_in_part(doc):
    part = doc.addObject('App::Part', 'Part'); part.Label = 'Scan'
    part.Placement = pl(base=(100, 0, 0), deg=90)
    m = mesh_obj(doc, 'Mesh', Mesh.createBox(10, 20, 30), base=(0, 0, 5))
    part.addObject(m)
    bx = box(doc, 'Box', 10, 10, 10, base=(0, 40, 0))
    part.addObject(bx)
    mesh_truth(doc, m)
    return [m, bx]

def mesh_odd(doc):
    two = Mesh.createBox(10, 10, 10)
    other = Mesh.createBox(5, 5, 5)
    other.translate(30, 0, 0)
    two.addMesh(other)
    pieces = mesh_obj(doc, 'Mesh', two); pieces.Label = 'Two pieces'
    opened = Mesh.createBox(10, 10, 10)
    opened.removeFacets([0, 1])
    hole = mesh_obj(doc, 'Mesh001', opened, base=(0, 40, 0)); hole.Label = 'Open'
    flat = Mesh.createPlane(10, 10)
    sheet = mesh_obj(doc, 'Mesh002', flat, base=(0, 80, 0)); sheet.Label = 'Sheet'
    empty = mesh_obj(doc, 'Mesh003', Mesh.Mesh()); empty.Label = 'Nothing'
    mesh_truth(doc, pieces, hole, sheet, empty)
    return [pieces, hole, sheet, empty]

def mesh_and_solid(doc):
    m = mesh_obj(doc, 'Mesh', Mesh.createBox(10, 10, 10)); m.Label = 'Scanned'
    b = body(doc)
    b.Placement = pl(base=(0, 30, 0))
    mesh_truth(doc, m)
    return [m, b]

case('part_basic', part_basic, 'an App::Part holding a body and a Part cut, and a box outside it')
case('part_placed', part_placed, 'a moved and turned App::Part with a body, a box and a tilted App::Part inside it')
case('part_odd', part_odd, 'an empty part, a part in a folder, two parts whose names differ only by case, a hidden part')
case('links_basic', links_basic, 'links to a box, to a Part cut and to a body, each moved or turned; targets visible')
case('link_transform', link_transform, 'a placed box linked with LinkTransform off and on')
case('link_hidden_target', link_hidden_target, 'a hidden box linked twice')
case('link_to_part', link_to_part, 'a link to an App::Part of two shapes')
case('link_chain', link_chain, 'a link to a link')
case('link_array', link_array, 'a link array of three with a placement list; one of three with link elements')
case('link_scaled', link_scaled, 'a link with a scale of 2')
case('compound_top', compound_top, 'a compound of a box and a cylinder; a placed compound of a body and a cut; a compound of a compound')
case('compound_touching', compound_touching, 'a compound of two boxes that overlap')
case('meshes', meshes, 'a mesh box, a turned mesh cylinder, a hidden mesh sphere')
case('mesh_in_part', mesh_in_part, 'a placed mesh inside a moved and turned App::Part, beside a box')
case('mesh_odd', mesh_odd, 'a mesh of two pieces, an open mesh, a flat sheet, an empty mesh')
case('mesh_and_solid', mesh_and_solid, 'a mesh beside a body')

for c in cases:
    for rec in c['objects']:
        m = MESH.get(c['name'], {}).get(rec['object'])
        if m is not None:
            rec['mesh'] = m
        w = WORLD.get(c['name'], {}).get(rec['object'])
        if w is not None:
            rec['world'] = w

with open(os.path.join(OUT, 'fixtures.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'cases': cases}, fh, indent=1)
with open(os.path.join(OUT, 'log.txt'), 'w') as fh:
    fh.write('\n'.join(log) + '\n')
os._exit(0)
