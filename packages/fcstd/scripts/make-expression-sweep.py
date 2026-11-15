# Truth for S10's fix round: FreeCAD's own value of each expression over a sweep of a cell's value.
# Run: freecadcmd make-expression-sweep.py <output directory>   (FreeCAD 1.1). Ours: no file of anyone else.
import json, math, os, sys
import FreeCAD as App
OUT = [a for a in sys.argv if os.path.isdir(a)][-1]
NS = [-27, -7.5, -7, -2.5, -1.5, -0.5, 0, 0.5, 1.5, 2.5, 7, 7.5, 27]
EXPRS = [
 'mod(n; 3)', 'mod(n; -3)', 'mod(7; n)', 'n % 3', 'n % -3', '7 % n',
 'mod(n * 1 mm; 3 mm)', '(n * 1 mm) % (3 mm)', 'mod(n * 1 mm; 3)', '(n * 1 mm) % 3',
 'round(n)', 'round(n / 2)', 'trunc(n)', 'trunc(n / 2)', 'floor(n)', 'ceil(n)', 'floor(n / 2)', 'ceil(n / 2)',
 'cbrt(n)', 'cbrt(n * 1 mm ^ 3)', 'sqrt(n)', 'sqrt(abs(n))', 'abs(n)', 'abs(n * 1 mm)',
 'n ^ 2', 'n ^ 3', '-n ^ 2', 'n ^ 0.5', 'n ^ -1', '2 ^ n', 'pow(n; 2)', 'pow(2; n)',
 'min(n; 2)', 'max(n; 2)', 'min(n; 2; -3)', 'sum(n; 2; 3)', 'average(n; 2; 3)',
 'sin(n)', 'cos(n)', 'tan(n)', 'sin(n * 1 deg)', 'sin(n * 1 rad)', 'asin(n / 27)', 'acos(n / 27)', 'atan(n)',
 'hypot(n; 4)', 'cath(30; n)', 'n / 4', '4 / n', 'n * 2 + 1', '-n', '+n', 'n - -n', '1 / 2 * n', 'n / 2 / 2',
 'round(n * 1 mm)', 'floor(n * 1 mm)', 'ceil(n * 1 mm)', 'trunc(n * 1 mm)', 'round(n * 1 deg)',
 'atan2(n; 2)', 'exp(n / 10)', 'log(abs(n) + 1)', 'log10(abs(n) + 1)', 'sinh(n / 10)', 'cosh(n / 10)', 'tanh(n / 10)',
 'n > 0 ? 1 : 2', 'n == 0 ? 5 : 6',
]
doc = App.newDocument('Sweep')
sh = doc.addObject('Spreadsheet::Sheet', 'Sh')
sh.set('A1', '0'); sh.setAlias('A1', 'n')
for i, e in enumerate(EXPRS): sh.set('B%d' % (i + 1), '=' + e)
doc.recompute()
rows = {e: {} for e in EXPRS}
for n in NS:
    sh.set('A1', repr(n)); doc.recompute()
    for i, e in enumerate(EXPRS):
        try:
            v = sh.get('B%d' % (i + 1))
            if hasattr(v, 'Value'):
                u = v.Unit.Type if hasattr(v.Unit, 'Type') else str(v.Unit)
                rows[e][repr(n)] = {'value': v.Value, 'unit': u}
            elif isinstance(v, (int, float)):
                rows[e][repr(n)] = {'value': float(v)} if math.isfinite(v) else {'error': repr(v)}
            else:
                rows[e][repr(n)] = {'error': 'type ' + type(v).__name__ + ' ' + str(v)[:60]}
        except Exception as ex:
            rows[e][repr(n)] = {'error': str(ex)[:120]}
with open(os.path.join(OUT, 'sweep.json'), 'w') as fh:
    json.dump({'freecad': '.'.join(App.Version()[:3]), 'n': NS, 'rows': rows}, fh, indent=1)
print('rows', len(rows))
