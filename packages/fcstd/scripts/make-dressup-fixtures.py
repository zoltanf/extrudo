# Authored fixtures for the FreeCAD import's S6 (Fillet, Chamfer): our own
# parts, made here with FreeCAD, so the stored shapes and the EdgeN / FaceN
# numbering are FreeCAD's own. Writes fixtures.json (no file metadata).
import json, os, sys, traceback
import FreeCAD as App, Part, Sketcher

OUT = os.path.dirname(os.path.abspath(__file__))
log = []

def rect(sk, x0, y0, x1, y1):
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        sk.addGeometry(Part.LineSegment(App.Vector(a[0], a[1], 0), App.Vector(b[0], b[1], 0)), False)
    for i in range(4):
        sk.addConstraint(Sketcher.Constraint('Coincident', i, 2, (i + 1) % 4, 1))

def measure(shape):
    bb = shape.BoundBox
    return {
        'solids': len(shape.Solids), 'volume': shape.Volume, 'area': shape.Area,
        'box': [bb.XMin, bb.YMin, bb.ZMin, bb.XMax, bb.YMax, bb.ZMax],
        'faces': len(shape.Faces), 'edges': len(shape.Edges),
    }

def edge_info(shape, name):
    e = shape.getElement(name)
    c = e.Curve
    mid = e.valueAt((e.FirstParameter + e.LastParameter) / 2)
    return {
        'name': name, 'curve': type(c).__name__, 'length': e.Length,
        'mid': [mid.x, mid.y, mid.z],
        'ends': [[v.Point.x, v.Point.y, v.Point.z] for v in e.Vertexes],
    }

def face_info(shape, name):
    f = shape.getElement(name)
    c = f.CenterOfMass
    return {'name': name, 'surface': type(f.Surface).__name__, 'area': f.Area,
            'centre': [c.x, c.y, c.z], 'edges': len(f.Edges)}

def find_edge(shape, pred):
    return ['Edge%d' % (i + 1) for i, e in enumerate(shape.Edges) if pred(e)]

def find_face(shape, pred):
    return ['Face%d' % (i + 1) for i, f in enumerate(shape.Faces) if pred(f)]

def mid_of(e):
    return e.valueAt((e.FirstParameter + e.LastParameter) / 2)

cases = []

def case(name, build):
    doc = App.newDocument(name)
    try:
        body = doc.addObject('PartDesign::Body', 'Body')
        steps = build(doc, body)
        doc.recompute()
        out = {'name': name, 'features': []}
        for f, extra in steps:
            if f.State and 'Invalid' in f.State:
                raise RuntimeError('%s is invalid: %s' % (f.Name, f.State))
            rec = {
                'object': f.Name, 'type': f.TypeId,
                'stored': f.Shape.exportBrepToString(),
                'measure': measure(f.Shape),
            }
            rec.update(extra(f) if callable(extra) else extra)
            out['features'].append(rec)
        cases.append(out)
        log.append('%s ok' % name)
    except Exception:
        log.append('%s FAILED\n%s' % (name, traceback.format_exc()))
    finally:
        App.closeDocument(name)

def pad_box(doc, body, lx=10, ly=20, lz=30):
    sk = body.newObject('Sketcher::SketchObject', 'Sketch')
    sk.AttachmentSupport = (body.Origin.OriginFeatures[3], [''])  # XY plane
    sk.MapMode = 'FlatFace'
    rect(sk, 0, 0, lx, ly)
    pad = body.newObject('PartDesign::Pad', 'Pad')
    pad.Profile = sk
    pad.Length = lz
    doc.recompute()
    return sk, pad

def base_props(f):
    base = f.Base
    subs = list(base[1])
    info = []
    for s in subs:
        info.append(edge_info(base[0].Shape, s) if s.startswith('Edge') else face_info(base[0].Shape, s))
    return {'base': base[0].Name, 'subs': subs, 'subInfo': info}

def fillet_props(f):
    d = base_props(f)
    d.update({'Radius': float(f.Radius), 'UseAllEdges': bool(getattr(f, 'UseAllEdges', False))})
    return d

def chamfer_props(f):
    d = base_props(f)
    d.update({
        'ChamferType': str(f.ChamferType), 'ChamferTypeIndex': f.getEnumerationsOfProperty('ChamferType').index(str(f.ChamferType)),
        'Size': float(f.Size), 'Size2': float(f.Size2), 'Angle': float(f.Angle),
        'FlipDirection': bool(f.FlipDirection), 'UseAllEdges': bool(getattr(f, 'UseAllEdges', False)),
    })
    return d

def pad_props(lx, ly, lz):
    return {'box': [0, 0, 0, lx, ly, lz], 'Length': lz}

# 1. One vertical edge of a box filleted.
def one_edge(doc, body):
    sk, pad = pad_box(doc, body)
    e = find_edge(pad.Shape, lambda e: abs(mid_of(e).x) < 1e-9 and abs(mid_of(e).y) < 1e-9)
    f = body.newObject('PartDesign::Fillet', 'Fillet')
    f.Base = (pad, e)
    f.Radius = 2
    return [(pad, pad_props(10, 20, 30)), (f, fillet_props)]
case('fillet_one_edge', one_edge)

# 2. Two edges that meet in a corner (a blend corner), then a chamfer on another edge.
def corner(doc, body):
    sk, pad = pad_box(doc, body)
    v = find_edge(pad.Shape, lambda e: abs(mid_of(e).x - 10) < 1e-9 and abs(mid_of(e).y - 20) < 1e-9)
    t = find_edge(pad.Shape, lambda e: abs(mid_of(e).z - 30) < 1e-9 and abs(mid_of(e).y - 20) < 1e-9)
    f = body.newObject('PartDesign::Fillet', 'Fillet')
    f.Base = (pad, v + t)
    f.Radius = 3
    doc.recompute()
    c = body.newObject('PartDesign::Chamfer', 'Chamfer')
    b = find_edge(f.Shape, lambda e: abs(mid_of(e).z) < 1e-9 and abs(mid_of(e).y) < 1e-9)
    c.Base = (f, b)
    c.Size = 1.5
    return [(pad, pad_props(10, 20, 30)), (f, fillet_props), (c, chamfer_props)]
case('fillet_corner_then_chamfer', corner)

# 3. A face as the reference: every edge of the top face.
def top_face(doc, body):
    sk, pad = pad_box(doc, body)
    top = find_face(pad.Shape, lambda f: abs(f.CenterOfMass.z - 30) < 1e-9)
    f = body.newObject('PartDesign::Fillet', 'Fillet')
    f.Base = (pad, top)
    f.Radius = 1
    return [(pad, pad_props(10, 20, 30)), (f, fillet_props)]
case('fillet_face', top_face)

# 4. Chamfers: equal, two distances, distance and angle, each with and without the flip.
def chamfers(kind, flip):
    def build(doc, body):
        sk, pad = pad_box(doc, body)
        e = find_edge(pad.Shape, lambda e: abs(mid_of(e).z - 30) < 1e-9 and abs(mid_of(e).x) < 1e-9)
        c = body.newObject('PartDesign::Chamfer', 'Chamfer')
        c.Base = (pad, e)
        c.ChamferType = kind
        c.Size = 2
        if kind == 'Two distances':
            c.Size2 = 4
        if kind == 'Distance and Angle':
            c.Angle = 30
        c.FlipDirection = flip
        return [(pad, pad_props(10, 20, 30)), (c, chamfer_props)]
    return build
for kind, tag in (('Equal distance', 'equal'), ('Two distances', 'two'), ('Distance and Angle', 'angle')):
    for flip in (False, True):
        if kind == 'Equal distance' and flip:
            continue
        case('chamfer_%s%s' % (tag, '_flip' if flip else ''), chamfers(kind, flip))

# 5. A round pad: the circular top edge filleted, the bottom one chamfered.
def round_pad(doc, body):
    sk = body.newObject('Sketcher::SketchObject', 'Sketch')
    sk.AttachmentSupport = (body.Origin.OriginFeatures[3], [''])
    sk.MapMode = 'FlatFace'
    sk.addGeometry(Part.Circle(App.Vector(0, 0, 0), App.Vector(0, 0, 1), 8), False)
    pad = body.newObject('PartDesign::Pad', 'Pad')
    pad.Profile = sk
    pad.Length = 12
    doc.recompute()
    top = find_edge(pad.Shape, lambda e: type(e.Curve).__name__ == 'Circle' and abs(e.Curve.Center.z - 12) < 1e-9)
    f = body.newObject('PartDesign::Fillet', 'Fillet')
    f.Base = (pad, top)
    f.Radius = 2
    doc.recompute()
    bottom = find_edge(f.Shape, lambda e: type(e.Curve).__name__ == 'Circle' and abs(e.Curve.Center.z) < 1e-9)
    c = body.newObject('PartDesign::Chamfer', 'Chamfer')
    c.Base = (f, bottom)
    c.Size = 1
    return [(pad, {'cylinder': {'radius': 8, 'height': 12}, 'Length': 12}), (f, fillet_props), (c, chamfer_props)]
case('round_pad_fillet_chamfer', round_pad)

# 6. Tangent edges: a slot-shaped pad (two lines, two arcs); one top edge referenced, the fillet runs round the chain.
def slot(doc, body):
    sk = body.newObject('Sketcher::SketchObject', 'Sketch')
    sk.AttachmentSupport = (body.Origin.OriginFeatures[3], [''])
    sk.MapMode = 'FlatFace'
    import math
    sk.addGeometry(Part.LineSegment(App.Vector(0, -5, 0), App.Vector(20, -5, 0)), False)
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(App.Vector(20, 0, 0), App.Vector(0, 0, 1), 5), -math.pi / 2, math.pi / 2), False)
    sk.addGeometry(Part.LineSegment(App.Vector(20, 5, 0), App.Vector(0, 5, 0)), False)
    sk.addGeometry(Part.ArcOfCircle(Part.Circle(App.Vector(0, 0, 0), App.Vector(0, 0, 1), 5), math.pi / 2, 3 * math.pi / 2), False)
    pad = body.newObject('PartDesign::Pad', 'Pad')
    pad.Profile = sk
    pad.Length = 6
    doc.recompute()
    e = find_edge(pad.Shape, lambda e: type(e.Curve).__name__ == 'Line' and abs(mid_of(e).z - 6) < 1e-9 and abs(mid_of(e).y + 5) < 1e-9)
    f = body.newObject('PartDesign::Fillet', 'Fillet')
    f.Base = (pad, e)
    f.Radius = 1.5
    return [(pad, {'slot': {'length': 20, 'radius': 5, 'height': 6}, 'Length': 6}), (f, fillet_props)]
case('fillet_tangent_chain', slot)

with open(os.path.join(OUT, 'fixtures.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'cases': cases}, fh, indent=1)
with open(os.path.join(OUT, 'log.txt'), 'w') as fh:
    fh.write('\n'.join(log) + '\n')
os._exit(0)
