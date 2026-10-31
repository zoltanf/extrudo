# q25.py <log> [file ...]: the Q25 tables (ADR-0097 slice D10) from a spike f/F log run with Q25=1; with files, only those. AT=0.01 picks the deviation table's step (default each file's Auto step).
import re, sys, collections
log = open(sys.argv[1]).read().split('\n')
files = collections.OrderedDict(); cur = None
for line in log:
    m = re.match(r'== file (\S+?)(?:\.mesh)? ', line)
    if m: cur = files.setdefault(m.group(1), {'bands': [], 'steps': {}, 'exploded': 0, 'facets': None, 'auto': None, 'faces': None}); continue
    if cur is None: continue
    l = line.strip()
    if l.startswith('q25 auto'): cur['auto'] = float(l.split()[2])
    elif l.startswith('q25 band T'):
        t = l.split(); d = {'T': float(t[3]), 'src': t[4]}
        i = 5
        while i < len(t) - 1:
            if t[i] == 'dev/T': i += 1; continue
            if t[i] == 'fit' and t[i+1] == 'r': d['fitr'] = float(t[i+2]); i += 3; continue
            k, v = t[i], t[i+1]
            try: v = float(v)
            except ValueError: pass
            d[k] = v; i += 2
        cur['bands'].append(d)
    elif l.startswith('q25 step'):
        m = re.match(r'q25 step (\S+): unfit share (\S+) % \((\d+) surfaces, (\d+) triangles\).*pass unfit (\d+) bands / (\d+) tris / (\S+) %.*pass sub (\d+) / (\d+) tris; unfit share after (\S+) %, with sub-bands (\S+) %', l)
        if m: cur['steps'][float(m.group(1))] = dict(share=float(m.group(2)), tris=int(m.group(4)), passb=int(m.group(5)), passt=int(m.group(6)), subb=int(m.group(8)), subt=int(m.group(9)), after=float(m.group(10)), aftersub=float(m.group(11)))
    elif l.startswith('q25 exploded'):
        cur['exploded'] += int(re.search(r'(\d+) tris', l).group(1))
    elif l.startswith('rebuild '):
        m = re.search(r'facets (\d+)', l); cur['facets'] = int(m.group(1)) if m else None
    elif l.startswith('prismatic ') and ' faces:' in l: cur['faces'] = int(l.split()[1])
    elif l.startswith('prismatic refused'): cur['faces'] = 'refused'
def cls(b):
    if b['class'] == 'ff' and b['test'] == 'ok': return 'ff-pass' if b['pass'] == 1 else 'ff-dev'
    if b['class'] == 'ff': return 'ff-' + b['test']
    if b['class'] == 'pc': return 'pc'
    if b['class'] == 'ff?': return 'net'
    return 'net' if b['class'] == 'other:many' else 'other'
GROUPS = [('flat-flat accepted', ['ff-pass']), ('flat-flat, deviation too large', ['ff-dev']),
          ('flat-flat, a test fails (angle/area/normals/side)', ['ff-angle', 'ff-area', 'ff-normals', 'ff-side']),
          ('plane-cylinder', ['pc']), ('network (borders > 2 surfaces)', ['net']), ('other', ['other'])]
TARGET = set(sys.argv[2:])
def table(at):
    print(f"\n### Unfit bands at {at}: bands/triangles (% of the unfit area)\n")
    print('| file | T | facets | unfit tris | unfit share % | ' + ' | '.join(g for g, _ in GROUPS) + ' | sub-bands accepted | keep pieces (accepted) |')
    print('|---|---|---|---|---|' + '---|' * len(GROUPS) + '---|---|')
    tot = collections.Counter(); area = collections.Counter()
    for f, d in files.items():
        if TARGET and f not in TARGET: continue
        if d['auto'] is None: continue
        T = 0.01 if at == '0.01' else d['auto']
        if T not in d['steps']: continue
        bs = [b for b in d['bands'] if b['T'] == T and b['src'] == 'unfit']
        ks = [b for b in d['bands'] if b['T'] == T and b['src'] == 'keep']
        ua = sum(b['area'] for b in bs) or 1
        row = []
        for g, cs in GROUPS:
            sel = [b for b in bs if cls(b) in cs]; n = int(sum(b['tris'] for b in sel)); a = sum(b['area'] for b in sel)
            tot[g] += n; area[g] += a
            row.append(f"{len(sel)}/{n} ({100*a/ua:.0f})" if sel else '')
        st = d['steps'][T]; tot['sub'] += st['subt']; tot['unfit'] += st['tris']; area['unfit'] += sum(b['area'] for b in bs)
        kp = sum(1 for b in ks if b['pass'] == 1); tot['keep'] += len(ks); tot['keeppass'] += kp
        fac = d['facets'] if (at != '0.01' or d['auto'] == 0.01) else ''
        if isinstance(fac, int): tot['facets'] += fac
        print(f"| {f} | {T} | {fac} | {st['tris']} | {st['share']:.2f} | " + ' | '.join(row) + f" | {st['subb']}/{st['subt']} | {len(ks)} ({kp}) |")
    print(f"| **total** | | {tot['facets']} | {tot['unfit']} | | " + ' | '.join(f"{tot[g]} ({100*area[g]/(area['unfit'] or 1):.0f})" for g, _ in GROUPS) + f" | {tot['sub']} | {tot['keep']} ({tot['keeppass']}) |")
    return tot
t_auto = table('auto'); t_001 = table('0.01')
import os
AT = os.environ.get('AT', 'auto')
# Deviation distribution over flat-flat bands whose geometry tests pass (unfit and keep), at every probed step.
ffb = [b for d in files.values() for b in d['bands'] if b['class'] == 'ff' and b['test'] == 'ok' and b['src'] != 'cyl' and b['T'] == (d['auto'] if AT == 'auto' else 0.01)]
print(f"\n### Deviation from the rolling-ball cylinder at {AT}: the {len(ffb)} flat-flat bands that pass tests 1-4\n")
print('| k | p75 <= k T (bands / tris) | max <= k T | p75 <= k T and max <= 2.5 k T |')
print('|---|---|---|---|')
for k in [1, 2, 3, 5, 10]:
    a = [b for b in ffb if b['p75'] <= k]; m = [b for b in ffb if b['max'] <= k]; c = [b for b in ffb if b['p75'] <= k and b['max'] <= 2.5 * k]
    s = lambda x: f"{len(x)} / {int(sum(b['tris'] for b in x))}"
    print(f"| {k} | {s(a)} | {s(m)} | {s(c)} |")
print('\nbands (src T file tris r p50 p75 max spread badnormals):')
for f, d in files.items():
    for b in d['bands']:
        if b['class'] == 'ff' and b['test'] == 'ok' and b['src'] != 'cyl':
            print(f"  {b['src']} {b['T']} {f} {int(b['tris'])} r {b['r']} p50 {b['p50']} p75 {b['p75']} max {b['max']} spread {b['spread']} pass {int(b['pass'])}")
# Climbs.
print('\n### Climbs (files above 0.01)\n')
print('| file | Auto | 0.01 share | 0.01 after | 0.01 after with sub-bands | 0.02 share | 0.02 after | 0.02 after with sub-bands | passing tris at Auto (whole + sub) / unfit tris at Auto | facets |')
print('|---|---|---|---|---|---|---|---|---|---|')
for f, d in files.items():
    if not d['auto'] or d['auto'] <= 0.01: continue
    s1, s2 = d['steps'].get(0.01), d['steps'].get(0.02)
    sa = d['steps'].get(d['auto'])
    g = lambda s, k: f"{s[k]:.2f}" if s else ''
    print(f"| {f} | {d['auto']} | {g(s1,'share')} | {g(s1,'after')} | {g(s1,'aftersub')} | {g(s2,'share')} | {g(s2,'after')} | {g(s2,'aftersub')} | {sa['passt'] + sa['subt']} / {sa['tris']} | {d['facets']} |")
# The method check: fitted cylinders through the same test.
cy = [b for d in files.values() for b in d['bands'] if b['src'] == 'cyl' and b['class'] == 'ff' and b['test'] == 'ok' and b.get('fitr', 0) > 0]
if cy:
    errs = sorted(abs(b['r'] - b['fitr']) / b['fitr'] for b in cy)
    print(f"\ncylinders through the test: {len(cy)} pass tests 1-4; |r - fit r| / fit r: p50 {errs[len(errs)//2]:.4f}, p90 {errs[int(0.9*(len(errs)-1))]:.4f}, max {errs[-1]:.4f}; dev pass {sum(b['pass'] for b in cy)}")
    allcy = [b for d in files.values() for b in d['bands'] if b['src'] == 'cyl']
    print('cylinders by class/test:', collections.Counter(b['class'] + ':' + str(b['test']) for b in allcy))
