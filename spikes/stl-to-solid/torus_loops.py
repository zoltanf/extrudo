# torus_loops.py step-dir [harness-log] (slice D11, Q1b.2): do the torus faces' bounds in a written STEP file run the
# way their flags say?
#
# Each ADVANCED_FACE on a TOROIDAL_SURFACE is unrolled: every edge of every bound is sampled at 64 points between its
# vertices (LINE, CIRCLE, ELLIPSE, B_SPLINE_CURVE_WITH_KNOTS and the rational complex form; SURFACE_CURVE / SEAM_CURVE
# give their 3D curve; anything else: the face is "not unrolled"), in the direction the ORIENTED_EDGE, the EDGE_CURVE's
# same_sense and the bound's flag give together. Each point gets its (u, v) on the torus (AXIS2_PLACEMENT_3D: X the
# ref direction, Z the axis, Y = Z x X; u round the axis, v round the tube; in a right-handed placement du x dv points
# out of the tube), unwrapped along the loop. Expected: seen from the face's normal (the surface's, reversed when
# same_sense is .F.), the face lies left of every bound, so in (u, v) an outer loop that doesn't wrap has a positive
# signed area and an inner one a negative area (signs swapped when same_sense is .F.). A loop that wraps once in u
# (a round's rim) has no area; a face with two such loops (a band, a round between two circles) is checked by their
# direction in u: on the short v interval between them, the lower loop must run +u and the upper -u (swapped for
# .F.); "ambiguous" when the interval is within 0.05 rad of half a turn.
# Independently of the parameters, every EDGE_CURVE of a closed shell must be used by its two faces in opposite
# directions (`edge uses`): a bound whose flag is wrong makes its edges run the same way as the neighbour's.
# The harness log (STEP_OUT runs) gives each file's OCCT read-back (faces, valid).
import math, os, re, sys

SAMPLES = 64


def parse_args(text, i=0):
    """Parse a parenthesised Part 21 argument list starting at text[i] == '('; returns (list, next index)."""
    assert text[i] == '('
    i += 1
    out = []
    while True:
        while text[i] in ' \n\r\t,':
            i += 1
        c = text[i]
        if c == ')':
            return out, i + 1
        if c == '(':
            v, i = parse_args(text, i)
        elif c == "'":
            j = i + 1
            while True:
                if text[j] == "'" and text[j + 1:j + 2] == "'":
                    j += 2
                    continue
                if text[j] == "'":
                    break
                j += 1
            v, i = text[i + 1:j], j + 1
        elif c == '#':
            m = re.match(r'#(\d+)', text[i:])
            v, i = ('ref', int(m.group(1))), i + len(m.group(0))
        elif c == '.':
            j = text.index('.', i + 1)
            v, i = ('enum', text[i + 1:j]), j + 1
        elif c in '$*':
            v, i = None, i + 1
        else:
            m = re.match(r'[-+0-9.Ee]+', text[i:])
            if m and m.group(0) not in ('E', 'e'):
                s = m.group(0)
                v, i = (float(s) if any(ch in s for ch in '.Ee') else int(s)), i + len(s)
            else:
                m = re.match(r'([A-Z0-9_]+)\s*', text[i:])
                name = m.group(1)
                i += len(m.group(0))
                args, i = parse_args(text, i)
                v = ('typed', name, args)
        out.append(v)


ENTITY = re.compile(r"#(\d+)\s*=\s*(.*?);\s*(?=#\d+\s*=|ENDSEC)", re.S)


def read_step(path):
    """Every entity of the DATA section: id -> (TYPE, args), or ('complex', {TYPE: args}) for a complex entity."""
    text = open(path, errors='replace').read()
    data = text[text.index('DATA;') + 5:]
    ents = {}
    for m in ENTITY.finditer(data):
        body = m.group(2).strip()
        if body.startswith('('):
            parts, k = {}, 1
            while True:
                while body[k] in ' \n\r\t':
                    k += 1
                if body[k] == ')':
                    break
                n = re.match(r'([A-Z0-9_]+)\s*', body[k:])
                k += len(n.group(0))
                args, k = parse_args(body, k)
                parts[n.group(1)] = args
            ents[int(m.group(1))] = ('complex', parts)
        else:
            n = re.match(r'([A-Z0-9_]+)\s*', body)
            args, _ = parse_args(body, len(n.group(0)))
            ents[int(m.group(1))] = (n.group(1), args)
    return ents


def vec(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def unit(a):
    n = math.sqrt(dot(a, a))
    return [x / n for x in a]


class Step:
    def __init__(self, path):
        self.e = ents = read_step(path)

    def get(self, ref):
        return self.e[ref[1]]

    def point(self, ref):
        t, a = self.get(ref)
        if t == 'VERTEX_POINT':
            return self.point(a[1])
        return list(a[1])

    def direction(self, ref):
        return unit(list(self.get(ref)[1][1]))

    def frame(self, ref):
        _, a = self.get(ref)
        o = self.point(a[1])
        z = self.direction(a[2]) if a[2] else [0, 0, 1]
        x = self.direction(a[3]) if a[3] else ([1, 0, 0] if abs(z[0]) < 0.9 else [0, 1, 0])
        x = unit(vec(x, [dot(x, z) * c for c in z]))
        return o, x, cross(z, x), z

    def curve(self, ref):
        """A sampler: (kind, f(points of the two vertices, same_sense) -> list of points), or None."""
        ent = self.get(ref)
        if ent[0] in ('SURFACE_CURVE', 'SEAM_CURVE'):
            return self.curve(ent[1][1])
        if ent[0] == 'LINE':
            return 'line', lambda p, q, s, closed: [[p[k] + (q[k] - p[k]) * i / SAMPLES for k in range(3)] for i in range(SAMPLES + 1)]
        if ent[0] in ('CIRCLE', 'ELLIPSE'):
            o, x, y, z = self.frame(ent[1][1])
            a = ent[1][2]
            b = ent[1][3] if ent[0] == 'ELLIPSE' else a

            def angle(p):
                d = vec(p, o)
                return math.atan2(dot(d, y) / b, dot(d, x) / a)

            def sample(p, q, s, closed):
                t0, t1 = angle(p), angle(q)
                if s:
                    span = (t1 - t0) % (2 * math.pi)
                    if closed or span < 1e-12:
                        span = 2 * math.pi
                else:
                    span = -((t0 - t1) % (2 * math.pi))
                    if closed or span > -1e-12:
                        span = -2 * math.pi
                out = []
                for i in range(SAMPLES + 1):
                    t = t0 + span * i / SAMPLES
                    out.append([o[k] + a * math.cos(t) * x[k] + b * math.sin(t) * y[k] for k in range(3)])
                return out
            return ent[0].lower(), sample
        if ent[0] == 'B_SPLINE_CURVE_WITH_KNOTS':
            a = ent[1]
            return 'bspline', self.bspline(a[1], [self.point(r) for r in a[2]], a[6], a[7], None, a[5])
        if ent[0] == 'complex' and 'B_SPLINE_CURVE' in ent[1]:
            bs, kn = ent[1]['B_SPLINE_CURVE'], ent[1].get('B_SPLINE_CURVE_WITH_KNOTS')
            if kn is None:
                return None
            w = ent[1].get('RATIONAL_B_SPLINE_CURVE', [None])[0]
            return 'bspline', self.bspline(bs[0], [self.point(r) for r in bs[1]], kn[0], kn[1], w, bs[3])
        return None

    def bspline(self, degree, poles, mults, knots, weights, closed):
        U = []
        for m, k in zip(mults, knots):
            U += [k] * m
        w = weights or [1.0] * len(poles)

        def at(t):
            n = len(poles)
            k = degree
            while k < n - 1 and U[k + 1] <= t:
                k += 1
            d = [[poles[j][c] * w[j] for c in range(3)] + [w[j]] for j in range(k - degree, k + 1)]
            for r in range(1, degree + 1):
                for j in range(degree, r - 1, -1):
                    i = j + k - degree
                    den = U[i + degree - r + 1] - U[i]
                    a = 0 if den == 0 else (t - U[i]) / den
                    d[j] = [(1 - a) * d[j - 1][c] + a * d[j][c] for c in range(4)]
            return [d[degree][c] / d[degree][3] for c in range(3)]

        lo, hi = U[degree], U[len(poles)]
        dense = [lo + (hi - lo) * i / 400 for i in range(401)]
        pts = [at(t) for t in dense]

        def param(p):
            i = min(range(len(pts)), key=lambda j: dot(vec(pts[j], p), vec(pts[j], p)))
            return dense[i]

        def sample(p, q, s, closedEdge):
            t0, t1 = param(p), param(q)
            if s and t1 <= t0 and (closedEdge or t1 < t0):
                t1 += hi - lo
            if not s and t1 >= t0 and (closedEdge or t1 > t0):
                t1 -= hi - lo
            out = []
            for i in range(SAMPLES + 1):
                t = t0 + (t1 - t0) * i / SAMPLES
                t = lo + (t - lo) % (hi - lo) if (t < lo or t > hi) else t
                out.append(at(t))
            return out
        return sample


def torus_uv(frame, R, p):
    o, x, y, z = frame
    d = vec(p, o)
    u = math.atan2(dot(d, y), dot(d, x))
    rho = math.hypot(dot(d, x), dot(d, y))
    v = math.atan2(dot(d, z), rho - R)
    return u, v


def unwrap(vals):
    out = [vals[0]]
    for a in vals[1:]:
        b = out[-1]
        out.append(a + 2 * math.pi * round((b - a) / (2 * math.pi)))
    return out


def analyse(path):
    st = Step(path)
    e = st.e
    faces = [(k, a) for k, (t, a) in e.items() if t == 'ADVANCED_FACE']
    res = dict(faces=len(faces), torus=0, unrolled=0, loops=0, disagree=0, ambiguous=0, details=[], left_handed=0,
               edge_uses_bad=0, edge_uses=0)
    uses = {}
    for fid, a in faces:
        surf = st.get(a[2])
        same = a[3][1] == 'T'
        bounds = []
        for b in a[1]:
            bt, ba = st.get(b)
            flag = ba[2][1] == 'T'
            loop = st.get(ba[1])
            edges = []
            if loop[0] != 'EDGE_LOOP':
                # A VERTEX_LOOP (a sphere's pole, a cone's apex): no edges; a torus face with one isn't unrolled.
                bounds.append((bt, flag, None))
                continue
            for oe in loop[1][1]:
                ot, oa = st.get(oe)
                if ot != 'ORIENTED_EDGE':
                    continue
                ec = st.get(oa[3])
                fwd = oa[4][1] == 'T'
                edges.append((oa[3][1], ec, fwd))
                along = (fwd == flag)
                uses.setdefault(oa[3][1], []).append(along)
            bounds.append((bt, flag, edges))
        if surf[0] != 'TOROIDAL_SURFACE':
            continue
        res['torus'] += 1
        frame = st.frame(surf[1][1])
        R, r = surf[1][2], surf[1][3]
        loops = []
        ok = True
        for bt, flag, edges in bounds:
            if edges is None:
                ok = False
                break
            pts = []
            for eid, ec, fwd in edges:
                ea = ec[1]
                c = st.curve(ea[3])
                if c is None:
                    ok = False
                    break
                p, q = st.point(ea[1]), st.point(ea[2])
                closed = ea[1][1] == ea[2][1]
                seg = c[1](p, q, ea[4][1] == 'T', closed)
                if not fwd:
                    seg = seg[::-1]
                pts += seg[:-1]
            if not ok or len(pts) < 3:
                ok = False
                break
            if not flag:
                pts = pts[::-1]
            uv = [torus_uv(frame, R, p) for p in pts]
            us, vs = unwrap([t[0] for t in uv]), unwrap([t[1] for t in uv])
            # The turns a loop makes round each parameter: its unwrapped change plus the step back to its start.
            def turns(vals):
                back = vals[0] - vals[-1]
                back -= 2 * math.pi * round(back / (2 * math.pi))
                return round((vals[-1] - vals[0] + back) / (2 * math.pi))
            wraps_u, wraps_v = turns(us), turns(vs)
            area = 0.5 * sum(us[i] * vs[(i + 1) % len(us)] - us[(i + 1) % len(us)] * vs[i] for i in range(len(us)))
            loops.append(dict(kind=bt, flag=flag, wraps_u=wraps_u, wraps_v=wraps_v, area=area, v=sum(vs) / len(vs),
                              edges=len(edges), curves=[st.get(ec[1][3])[0] for _, ec, _ in edges]))
        if not ok:
            continue
        res['unrolled'] += 1
        # du x dv against the tube's outward direction at a loop point (a right-handed placement: always out).
        o, x, y, z = frame
        p0 = st.point(bounds[0][2][0][1][1][1])  # the first edge's start vertex
        u0, v0 = torus_uv(frame, R, p0)
        du_ = [(R + r * math.cos(v0)) * (-math.sin(u0) * x[k] + math.cos(u0) * y[k]) for k in range(3)]
        dv_ = [r * (-math.sin(v0) * (math.cos(u0) * x[k] + math.sin(u0) * y[k]) + math.cos(v0) * z[k]) for k in range(3)]
        out = [math.cos(v0) * (math.cos(u0) * x[k] + math.sin(u0) * y[k]) + math.sin(v0) * z[k] for k in range(3)]
        left = dot(cross(du_, dv_), out) < 0
        res['left_handed'] += left
        sign = (1 if same else -1) * (-1 if left else 1)
        band = [l for l in loops if l['wraps_u'] != 0 and l['wraps_v'] == 0]
        full_round = len(loops) == 2 and len(band) == 2 and all(l['edges'] == 1 and l['curves'][0] in ('CIRCLE', 'SURFACE_CURVE', 'SEAM_CURVE') for l in loops)
        # The outer loop: the FACE_OUTER_BOUND, else (OCCT writes FACE_BOUND only) the largest |area|; with a loop that
        # wraps the torus, every loop that doesn't is a hole.
        plain = [l for l in loops if l['wraps_u'] == 0 and l['wraps_v'] == 0]
        outer = None
        if len(plain) == len(loops):
            marked = [l for l in plain if l['kind'] == 'FACE_OUTER_BOUND']
            outer = marked[0] if marked else max(plain, key=lambda l: abs(l['area']))
        for l in loops:
            res['loops'] += 1
            bad = None
            if l['wraps_u'] == 0 and l['wraps_v'] == 0:
                want = 1 if l is outer else -1
                bad = sign * l['area'] * want < 0
            elif len(band) == 2 and l in band:
                other = band[1] if l is band[0] else band[0]
                gap = (other['v'] - l['v']) % (2 * math.pi)
                if abs(gap - math.pi) < 0.05:
                    res['ambiguous'] += 1
                    continue
                lower = gap < math.pi  # the short interval runs from this loop up to the other
                want = 1 if lower else -1
                bad = sign * l['wraps_u'] * want < 0
            if bad:
                res['disagree'] += 1
                res['details'].append(dict(face=fid, outer=l is outer, R=R, r=r, same_sense=same, flag=l['flag'], kind=l['kind'], wraps_u=l['wraps_u'],
                                           wraps_v=l['wraps_v'], area=round(l['area'], 6), left_handed=left, full_round=full_round,
                                           loops=len(loops)))
    for eid, u in uses.items():
        res['edge_uses'] += 1
        if len(u) == 2 and u[0] == u[1]:
            res['edge_uses_bad'] += 1
    return res


def readback(log):
    out = {}
    if not log:
        return out
    for line in open(log, errors='replace'):
        m = re.search(r'q26 step (\S+) bytes \d+ faces (\d+) back faces (-?\d+) back valid (\d)', line)
        if m:
            out[os.path.basename(m.group(1))[:-5]] = (int(m.group(2)), int(m.group(3)), int(m.group(4)))
    return out


root = sys.argv[1]
back = readback(sys.argv[2] if len(sys.argv) > 2 else None)
tot = dict(files=0, faces=0, torus=0, unrolled=0, loops=0, disagree=0, ambiguous=0, edge_uses=0, edge_uses_bad=0)
details = []
print('| file | faces | torus faces | unrolled | loops | disagree | ambiguous | edge uses the same way | read-back faces / valid |')
print('|---|---|---|---|---|---|---|---|---|')
for dirpath, _, names in sorted(os.walk(root)):
    for name in sorted(names):
        if not name.endswith('.step'):
            continue
        rel = os.path.relpath(os.path.join(dirpath, name), root)[:-5]
        r = analyse(os.path.join(dirpath, name))
        tot['files'] += 1
        for k in ('faces', 'torus', 'unrolled', 'loops', 'disagree', 'ambiguous', 'edge_uses', 'edge_uses_bad'):
            tot[k] += r[k]
        b = back.get(os.path.basename(rel), None)
        if r['torus'] or r['edge_uses_bad']:
            print(f"| {rel} | {r['faces']} | {r['torus']} | {r['unrolled']} | {r['loops']} | {r['disagree']} | {r['ambiguous']} | {r['edge_uses_bad']} / {r['edge_uses']} | {f'{b[1]} / {b[2]}' if b else ''} |")
        for d in r['details']:
            details.append((rel, d))
print(f"\nTotals: {tot}")
print('\nDisagreeing loops (largest |area| first):')
for rel, d in sorted(details, key=lambda x: -abs(x[1]['area']))[:20]:
    print(rel, d)
