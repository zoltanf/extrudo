# Authored fixtures for the FreeCAD import's S13 (ADR-0144): Part extrusions of sketches in every
# setting the importer reads, and bodies whose sketches FreeCAD attaches to faces. Our own parts,
# made with FreeCAD 1.1, so the stored shapes and the property grammar are FreeCAD's own.
#
# Self-contained: the helpers are those of make-part-fixtures.py (everything above its
# builders and the builders' own helpers), copied here; the output has its format.
#
# Run, from the repository's root (FreeCAD 1.1 for the first step):
#   1. freecadcmd packages/fcstd/scripts/make-final-fixtures.py <dir>
#        writes <dir>/fixtures.json (and log.txt)
#   2. python3 packages/fcstd/scripts/part-fixtures-to-module.py \
#        <dir>/fixtures.json packages/fcstd/src/final-fixtures.ts --keep-attachment
#      then rename its exports from PART_ to FINAL_ (sed -i 's/PART_/FINAL_/g' on that file)
#   3. pnpm biome format --write packages/fcstd/src/final-fixtures.ts
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


# --- S13 builders -------------------------------------------------------------

def sketch_rect(doc, name, x0, y0, x1, y1, z=0.0):
    sk = free_sketch(doc, name, z)
    rect(sk, x0, y0, x1, y1)
    return sk

def extrusion(doc, name, base, **settings):
    e = doc.addObject('Part::Extrusion', name)
    e.Base = base
    e.DirMode = settings.pop('DirMode', 'Normal')
    e.Solid = settings.pop('Solid', True)
    for k, v in settings.items():
        setattr(e, k, v)
    hide(base)
    return e

def extrusion_forward(doc):
    return [extrusion(doc, 'Extrude', sketch_rect(doc, 'Sketch', 0, 0, 30, 20), LengthFwd=12)]

def extrusion_both(doc):
    return [extrusion(doc, 'Extrude', sketch_rect(doc, 'Sketch', 0, 0, 30, 20), LengthFwd=12, LengthRev=5)]

def extrusion_symmetric(doc):
    return [extrusion(doc, 'Extrude', sketch_rect(doc, 'Sketch', 0, 0, 30, 20), LengthFwd=12, Symmetric=True)]

def extrusion_reversed(doc):
    return [extrusion(doc, 'Extrude', sketch_rect(doc, 'Sketch', 0, 0, 30, 20), LengthFwd=12, Reversed=True)]

def extrusion_tapered(doc):
    return [extrusion(doc, 'Extrude', sketch_rect(doc, 'Sketch', 0, 0, 30, 20), LengthFwd=12, TaperAngle=5)]

def extrusion_custom(doc):
    return [extrusion(doc, 'Extrude', sketch_rect(doc, 'Sketch', 0, 0, 30, 20), DirMode='Custom',
                      Dir=V(0, 1, 1), LengthFwd=12)]

def extrusion_of_face(doc):
    pl = doc.addObject('Part::Plane', 'Plane'); pl.Length = 30; pl.Width = 20
    e = doc.addObject('Part::Extrusion', 'Extrude')
    e.Base = pl; e.DirMode = 'Normal'; e.Solid = True; e.LengthFwd = 5
    return [e]

def extrusion_placed(doc):
    sk = sketch_rect(doc, 'Sketch', 0, 0, 30, 20)
    sk.Placement = App.Placement(V(10, 5, 7), App.Rotation(V(1, 0, 0), 30))
    return [extrusion(doc, 'Extrude', sk, LengthFwd=12)]

def extrusion_in_part(doc):
    part = doc.addObject('App::Part', 'Part')
    part.Placement = App.Placement(V(100, 0, 0), App.Rotation(V(0, 0, 1), 90))
    sk = sketch_rect(doc, 'Sketch', 0, 0, 30, 20)
    e = extrusion(doc, 'Extrude', sk, LengthFwd=12)
    part.addObject(sk); part.addObject(e)
    return [part]

def extrusion_under_cut(doc):
    sk = sketch_rect(doc, 'Sketch', 0, 0, 30, 20)
    sk.addGeometry(Part.Circle(V(15, 10, 0), V(0, 0, 1), 4), False)
    e = extrusion(doc, 'Extrude', sk, LengthFwd=12, LengthRev=3)
    c = cyl(doc, 'Cylinder', 3, 30, base=(5, 5, -5))
    return [two(doc, 'Cut', 'Cut', e, c)]

def extrusion_bound(doc):
    sheet = doc.addObject('Spreadsheet::Sheet', 'Sheet')
    sheet.set('A1', '12'); sheet.setAlias('A1', 'height')
    e = extrusion(doc, 'Extrude', sketch_rect(doc, 'Sketch', 0, 0, 30, 20), LengthFwd=12)
    e.setExpression('LengthFwd', 'Sheet.height')
    return [e]

def body_on_face(doc):
    # A pad whose second sketch FreeCAD attaches to the pad's top face, and a pocket from it.
    body = doc.addObject('PartDesign::Body', 'Body')
    sk = body.newObject('Sketcher::SketchObject', 'Sketch')
    xy = [o for o in body.Origin.OriginFeatures if o.Role == 'XY_Plane'][0]
    sk.AttachmentSupport = (xy, ['']); sk.MapMode = 'FlatFace'
    rect(sk, 0, 0, 40, 20)
    pad = body.newObject('PartDesign::Pad', 'Pad'); pad.Profile = sk; pad.Length = 10
    doc.recompute()
    top = [i + 1 for i, f in enumerate(pad.Shape.Faces) if abs(f.CenterOfMass.z - 10) < 1e-6][0]
    s2 = body.newObject('Sketcher::SketchObject', 'PocketSketch')
    s2.AttachmentSupport = (pad, ['Face%d' % top]); s2.MapMode = 'FlatFace'
    s2.addGeometry(Part.Circle(V(10, 10, 0), V(0, 0, 1), 4), False)
    pocket = body.newObject('PartDesign::Pocket', 'Pocket'); pocket.Profile = s2; pocket.Length = 5
    return [body]

case('extrusion_forward', extrusion_forward, 'a sketch extruded 12 mm along its normal')
case('extrusion_both', extrusion_both, 'a sketch extruded 12 mm forward and 5 back')
case('extrusion_symmetric', extrusion_symmetric, 'a sketch extruded 12 mm in all, symmetric')
case('extrusion_reversed', extrusion_reversed, 'a sketch extruded 12 mm, reversed')
case('extrusion_tapered', extrusion_tapered, 'a sketch extruded 12 mm with a 5 degree taper')
case('extrusion_custom', extrusion_custom, 'a sketch extruded along a custom direction')
case('extrusion_of_face', extrusion_of_face, 'a face of a box extruded')
case('extrusion_placed', extrusion_placed, 'a sketch moved and tilted, extruded')
case('extrusion_in_part', extrusion_in_part, 'a sketch and its extrusion in a moved and turned part')
case('extrusion_under_cut', extrusion_under_cut, 'a sketch with a hole extruded both ways, under a cut')
case('extrusion_bound', extrusion_bound, 'an extrusion whose length reads a spreadsheet alias')
case('body_on_face', body_on_face, "a body whose pocket's sketch is attached to its pad's top face")

with open(os.path.join(OUT, 'fixtures.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'cases': cases}, fh, indent=1)
with open(os.path.join(OUT, 'log.txt'), 'w') as fh:
    fh.write('\n'.join(log) + '\n')
os._exit(0)
