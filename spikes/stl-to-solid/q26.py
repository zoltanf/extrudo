# q26.py log [log at fixed steps...]: Q26's tables (slice D11) from spike F/f logs run with Q26=1 (the first, at Auto)
# and Q26=2 (the others, at fixed steps: only the attempts table reads them).
import collections, re, sys

KIND = {0: 'plane', 1: 'cylinder', 2: 'cone', 3: 'sphere', 4: 'torus'}
FOCUS = ['own/spool-screw-v4.1', 'own/phone-stand-foldable', 'own/puzzle-insert-circle', 'own/battery-power-adapter',
         'third-party/sock-clips-6x', 'own/desk-organizer-module-small', 'third-party/spaghetti-measure',
         'third-party/micro-sd-keyring-inner']


def parse(path):
    files = collections.OrderedDict()
    cur = None
    for line in open(path, errors='replace'):
        m = re.match(r'== file (\S+?)(?:\.mesh|\.stl)? ', line)
        if m:
            cur = files.setdefault(m.group(1), {'regions': [], 'attempts': [], 'outcome': None, 'facets': None,
                                                'faces': None, 'summary': None, 'refusal': None})
            continue
        if cur is None:
            continue
        l = line.strip()
        if l.startswith('q26 region '):
            head, why = l[len('q26 region '):].split(' why ', 1)
            t = head.split()
            d = {t[i]: t[i + 1] for i in range(0, len(t) - 1, 2)}
            for k in ('id', 'kind', 'tris', 'loops', 'edges', 'chains', 'pinch', 'pieces', 'folded', 'selfx', 'crossx',
                      'facets', 'splitloops', 'attempt', 'periodic', 'seam', 'wrap', 'simple', 'open'):
                d[k] = int(d[k])
            for k in ('coincident', 'touch', 'across', 'local'):
                d[k] = int(d.get(k, 0))
            for k in ('T', 'share', 'area1', 'area2', 'side', 'normal', 'offplane', 'apart', 'apartmin'):
                d[k] = float(d.get(k, 0))
            d['why'] = why
            d['reason'] = re.sub(r' [-0-9.e]+( mm)?$', '', why).strip()
            cur['regions'].append(d)
        elif l.startswith('q26 attempt '):
            t = l.split()
            d = {t[i]: t[i + 1] for i in range(3, len(t) - 1, 2)}
            d['attempt'] = int(t[2])
            cur['attempts'].append(d)
        elif l.startswith('q26 outcome '):
            cur['outcome'] = l
        elif l.startswith('q26 summary '):
            t = l.split()
            cur['summary'] = {t[i]: float(t[i + 1]) for i in range(2, len(t) - 1, 2)}
        elif l.startswith('rebuild '):
            m = re.search(r'facets (\d+)', l)
            cur['facets'] = int(m.group(1)) if m else None
        elif l.startswith('prismatic ') and ' faces:' in l:
            cur['faces'] = int(l.split()[1])
        elif l.startswith('prismatic refused'):
            cur['faces'] = 'refused'
            cur['refusal'] = l
    return files


def table(head, rows):
    print('| ' + ' | '.join(head) + ' |')
    print('|' + '---|' * len(head))
    for r in rows:
        print('| ' + ' | '.join(str(x) for x in r) + ' |')
    print()


files = parse(sys.argv[1])
regions = [(f, r) for f, d in files.items() for r in d['regions']]
total = sum(r['tris'] for _, r in regions)
print(f"Q26 at Auto: {len(files)} files, {sum(1 for d in files.values() if d['regions'])} with exploded regions, "
      f"{len(regions)} exploded regions, {total} triangles; facets {sum(d['facets'] or 0 for d in files.values())}\n")

print('### Q1.1 Reason x kind (regions / triangles / files)\n')
g = collections.defaultdict(lambda: [0, 0, set()])
for f, r in regions:
    k = (r['reason'], KIND[r['kind']])
    g[k][0] += 1; g[k][1] += r['tris']; g[k][2].add(f)
table(['reason', 'kind', 'regions', 'triangles', 'files'],
      [(a, b, v[0], v[1], len(v[2])) for (a, b), v in sorted(g.items(), key=lambda x: -x[1][1])] +
      [('**total**', '', len(regions), total, len({f for f, _ in regions}))])

print('### Q1.1 Stage (regions / triangles)\n')
g = collections.defaultdict(lambda: [0, 0])
for f, r in regions:
    g[(r['stage'], r['reason'])][0] += 1; g[(r['stage'], r['reason'])][1] += r['tris']
table(['stage', 'reason', 'regions', 'triangles'], [(a, b, v[0], v[1]) for (a, b), v in sorted(g.items(), key=lambda x: -x[1][1])])

print('### Q1.1 Chart and loops, by reason (triangles)\n')
g = collections.defaultdict(collections.Counter)
for f, r in regions:
    c = g[r['reason']]
    c['tris'] += r['tris']; c['regions'] += 1
    c['periodic'] += r['tris'] * r['periodic']; c['seam'] += r['tris'] * r['seam']; c['wrap'] += r['tris'] * r['wrap']
    c['chains>0'] += r['tris'] * (r['chains'] > 0); c['loops>1'] += r['tris'] * (r['loops'] > 1)
    c['pinch>0'] += r['tris'] * (r['pinch'] > 0)
cols = ['regions', 'tris', 'periodic', 'seam', 'wrap', 'chains>0', 'loops>1', 'pinch>0']
table(['reason'] + cols, [(k,) + tuple(v[c] for c in cols) for k, v in sorted(g.items(), key=lambda x: -x[1]['tris'])])

reasons = [k for k, _ in collections.Counter({r['reason']: 0 for _, r in regions}).items()]
byr = collections.Counter()
for _, r in regions: byr[r['reason']] += r['tris']
reasons = [k for k, _ in byr.most_common()]
short = {'touches itself at node': 'touches', 'invalid face': 'invalid face', 'its outer loop runs the wrong way': 'outer wrong',
         'an inner loop runs the wrong way': 'inner wrong', 'invalid after unify': 'culprit', 'a node off its face': 'node off',
         'edge tolerance': 'edge tol', 'a loop that doesn\'t close': 'open loop', 'no boundary': 'no boundary'}


def perfile(sel):
    rows = []
    for f in sel:
        d = files.get(f)
        if not d:
            continue
        s = d['summary'] or {}
        c = collections.Counter()
        for r in d['regions']:
            c[r['reason']] += r['tris']
        T = d['regions'][0]['T'] if d['regions'] else s.get('T', '')
        rows.append([f, T, d['facets'], int(s.get('unfit', 0)), int(s.get('exploded', 0)), int(s.get('explodedregions', 0))] +
                    [c[x] or '' for x in reasons])
    table(['file', 'T', 'facets', 'unfit tris', 'exploded tris', 'exploded regions'] + [short.get(x, x) for x in reasons], rows)


print('### Q1.1 Per file: the ten facet-heavy files\n')
heavy = sorted([f for f, d in files.items() if isinstance(d['facets'], int)], key=lambda f: -files[f]['facets'])[:10]
perfile(heavy)
print('### Q1.1 Per file: every file with an exploded region\n')
perfile([f for f, d in files.items() if d['regions']])

print('### Q1.2 "touches itself": per kind\n')
tou = [(f, r) for f, r in regions if r['reason'] == 'touches itself at node']


def h1rows(key):
    g = collections.defaultdict(collections.Counter)
    for f, r in tou:
        c = g[key(f, r)]
        c['regions'] += 1; c['tris'] += r['tris']; c['pinch'] += r['pinch']; c['pieces>1'] += r['pieces'] > 1
        c['simple'] += r['tris'] * r['simple']
        c['fan valid'] += r['tris'] * (r['fan'] == 'valid')
        c['split signs ok'] += r['tris'] * (r['splitsigns'] == 'ok')
        c['split valid'] += r['tris'] * (r['split'] == 'valid')
        c['split valid, signs ok'] += r['tris'] * (r['split'] == 'valid' and r['splitsigns'] == 'ok')
        c['would not build'] += r['tris'] * (not (r['split'] == 'valid' and r['splitsigns'] == 'ok'))
    cols = ['regions', 'tris', 'pinch', 'pieces>1', 'simple', 'fan valid', 'split signs ok', 'split valid', 'split valid, signs ok', 'would not build']
    tot = collections.Counter()
    for v in g.values(): tot.update(v)
    table(['group'] + cols, [(k,) + tuple(v[c] for c in cols) for k, v in sorted(g.items(), key=lambda x: -x[1]['tris'])] +
          [('**total**',) + tuple(tot[c] for c in cols)])


h1rows(lambda f, r: KIND[r['kind']])
print('### Q1.2 "touches itself": per file\n')
h1rows(lambda f, r: f)
print('### Q1.2 Split faces that fail: statuses (regions / triangles)\n')
g = collections.defaultdict(lambda: [0, 0])
for f, r in tou:
    if r['split'] != 'valid' or r['splitsigns'] != 'ok':
        k = (KIND[r['kind']], r['split'], r['splitsigns'])
        g[k][0] += 1; g[k][1] += r['tris']
table(['kind', 'split face', 'split signs', 'regions', 'triangles'], [k + tuple(v) for k, v in sorted(g.items(), key=lambda x: -x[1][1])])

print('### Q1.3 "invalid face" planes: pass 0 / pass 1 status patterns (regions / triangles)\n')
inv = [(f, r) for f, r in regions if r['reason'] == 'invalid face' and r['kind'] == 0]
g = collections.defaultdict(lambda: [0, 0, set()])
for f, r in inv:
    k = (r['p0'], r['p1'])
    g[k][0] += 1; g[k][1] += r['tris']; g[k][2].add(f)
table(['pass 0', 'pass 1', 'regions', 'triangles', 'files'], [k + (v[0], v[1], len(v[2])) for k, v in sorted(g.items(), key=lambda x: -x[1][1])])
print('### Q1.3 "invalid face" planes: ShapeAnalysis_Wire (pass 0 / pass 1) and the geometry\n')
g = collections.defaultdict(lambda: [0, 0])
for f, r in inv:
    k = (r['saw0'], r['saw1'], 'selfx' if r['selfx'] else '', 'crossx' if r['crossx'] else '', 'folded' if r['folded'] else '',
         'alone ' + r['fan'].split(':')[0])
    g[k][0] += 1; g[k][1] += r['tris']
table(['saw pass 0', 'saw pass 1', 'loop crosses itself (u, v)', 'loops cross', 'folded triangles', 'alone (polylines, own edges)', 'regions', 'triangles'],
      [k + tuple(v) for k, v in sorted(g.items(), key=lambda x: -x[1][1])])


def geometry(r):
    n = r['selfx'] + r['crossx']
    if abs(r['normal']) < 0.5:
        return 'degenerate fit: the plane square to its triangles (a wall strip under T high)'
    if n and r['apart'] < 1e-3:
        return 'micro zigzag: crossing segments under 0.001 mm apart in 3D'
    if n and r['local'] == n and r['apart'] <= 1.5 * r['T']:
        return 'absorbed step: local folds, segments within 1.5 T in 3D'
    if n == 0:
        return 'no crossing in (u, v)'
    return 'other crossings'


print('### Q1.3 "invalid face" planes: the geometry (regions / triangles / files)\n')
g = collections.defaultdict(lambda: [0, 0, set(), []])
for f, r in inv:
    k = geometry(r)
    g[k][0] += 1; g[k][1] += r['tris']; g[k][2].add(f); g[k][3].append((r['tris'], f, r['id']))
table(['geometry', 'regions', 'triangles', 'files', 'largest (file id triangles)'],
      [(k, v[0], v[1], len(v[2]), '; '.join(f'{f} {i} {t}' for t, f, i in sorted(v[3], reverse=True)[:3])) for k, v in sorted(g.items(), key=lambda x: -x[1][1])])
print('### Q1.3 Every "invalid face" region, any kind: the geometry (regions / triangles)\n')
g = collections.defaultdict(lambda: [0, 0])
for f, r in regions:
    if r['reason'] == 'invalid face':
        k = (KIND[r['kind']], geometry(r) if r['kind'] == 0 else ('crossings' if r['selfx'] + r['crossx'] else 'no crossing') + (', wraps' if r['wrap'] else ''), r['p0'], r['p1'])
        g[k][0] += 1; g[k][1] += r['tris']
table(['kind', 'geometry', 'pass 0', 'pass 1', 'regions', 'triangles'], [k + tuple(v) for k, v in sorted(g.items(), key=lambda x: -x[1][1])])
print('### Q1.3 "invalid face" planes: the largest regions\n')
table(['file', 'id', 'tris', 'loops', 'edges', 'chains', 'area1', 'area2', 'selfx', 'crossx', 'folded', 'offplane', 'normal', 'alone', 'p0', 'p1'],
      [(f, r['id'], r['tris'], r['loops'], r['edges'], r['chains'], f"{r['area1']:.4g}", f"{r['area2']:.4g}", r['selfx'], r['crossx'],
        r['folded'], f"{r['offplane']:.3g}", f"{r['normal']:.4f}", r['fan'], r['p0'], r['p1'])
       for f, r in sorted(inv, key=lambda x: -x[1]['tris'])[:25]])

print('### Q1.3 "wrong way" regions\n')
ww = [(f, r) for f, r in regions if 'wrong way' in r['reason']]
table(['file', 'T', 'id', 'kind', 'tris', 'reason', 'loop sizes', 'signed areas (u, v)', 'side', 'normal', 'folded', 'selfx', 'crossx', 'wrap', 'alone'],
      [(f, r['T'], r['id'], KIND[r['kind']], r['tris'], short.get(r['reason'], r['reason']), r.get('loopsizes', ''), r.get('loopareas', ''),
        int(r['side']), f"{r['normal']:.4f}", r['folded'], r['selfx'], r['crossx'], r['wrap'], r['fan'])
       for f, r in sorted(ww, key=lambda x: -x[1]['tris'])])

print('### Q1.5 The files with nothing unfit: facets by reason (triangles; facets these regions make on their own)\n')
rows = []
for f in FOCUS:
    d = files.get(f)
    if not d:
        continue
    s = d['summary'] or {}
    c = collections.Counter(); e = collections.Counter()
    for r in d['regions']:
        c[r['reason']] += r['tris']; e[r['reason']] += r['facets']
    rows.append([f, d['facets'], int(s.get('unfit', 0)), int(s.get('exploded', 0)), sum(e.values())] +
                [f"{c[x]} ({e[x]})" if c[x] else '' for x in reasons])
table(['file', 'facets', 'unfit tris', 'exploded tris', 'facets, regions alone'] + [short.get(x, x) for x in reasons], rows)

print('### Q1.4 Attempts (every file whose hybrid ran more than one attempt, or refused)\n')
for path in sys.argv[1:]:
    fs = parse(path)
    rows = []
    for f, d in fs.items():
        if not d['attempts'] or (len(d['attempts']) == 1 and d['faces'] != 'refused'):
            continue
        out = d['outcome'] or ''
        m = re.search(r'stages \[(.*)\] refusal (.*)$', out)
        for a in d['attempts']:
            rows.append([f, a['T'], a['attempt'], a['estimate'], a['invalid'], a.get('cellsvalid', '?'), a['invalidfaces'], a['healed'], a['valid'], a['undone'],
                         a['faces'], a['facets'], a['volume'], a['nodesoff'],
                         ('converted' if 'converted' in out else 'refused: ' + (m.group(2) if m else '')) if a is d['attempts'][-1] else ''])
    print(f'#### {path}\n')
    table(['file', 'T', 'attempt', 'estimate', 'invalid', 'cells valid', 'invalid faces', 'healed', 'valid', 'unify undone', 'faces', 'facets', 'volume ok', 'nodes off', 'outcome'], rows)
