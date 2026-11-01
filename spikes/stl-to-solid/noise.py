# noise.py meshes-dir [ladder-log] (slice D11, Q1b.1): each staged mesh's own noise.
# Up to SAMPLES nodes spread over the mesh (one per cell of a voxel grid sized for about that many), for each the
# least-squares plane (centroid, smallest covariance eigenvector) through the nodes within two triangle rings, and the
# node's distance to it; noise = 1.4826 x median |distance|. `smooth` repeats it over the samples whose two-ring
# facet normals all lie within 30 degrees of their mean (no crease inside), when there are 50 or more; `quadric` the
# residual of a quadric height field over the same patch instead of the plane (curvature taken out).
# With a ladder log (run.sh prismatic F with Q26LADDER=1) it prints one JSON line per file with the rungs' unfit
# shares and segmentation times too.
import json, os, re, struct, sys
import numpy as np

SAMPLES = 4000
MAD = 1.4826
SMOOTH_COS = np.cos(np.radians(30))


def read_mesh(path):
    data = open(path, 'rb').read()
    nodes, tris = struct.unpack_from('<II', data, 0)
    xyz = np.frombuffer(data, dtype='<f4', count=3 * nodes, offset=8).astype(np.float64).reshape(-1, 3)
    idx = np.frombuffer(data, dtype='<u4', count=3 * tris, offset=8 + 12 * nodes).astype(np.int64).reshape(-1, 3)
    return xyz, idx


def spread(xyz, count):
    """All nodes when there are at most `count`; else one per occupied cell of a voxel grid sized so that about
    `count` cells are occupied, the node nearest its cell's centre."""
    if len(xyz) <= count:
        return np.arange(len(xyz))
    lo, hi = xyz.min(0), xyz.max(0)
    size = float(np.max(hi - lo)) / 2
    for _ in range(80):
        cells = np.floor((xyz - lo) / size).astype(np.int64)
        keys = (cells[:, 0] * 2097152 + cells[:, 1]) * 2097152 + cells[:, 2]
        occupied = len(np.unique(keys))
        if 0.9 * count <= occupied <= count:
            break
        size *= 0.93 if occupied < 0.9 * count else 1.04
    centre = lo + (cells + 0.5) * size
    d = np.linalg.norm(xyz - centre, axis=1)
    order = np.lexsort((d, keys))
    first = np.ones(len(order), bool)
    first[1:] = keys[order][1:] != keys[order][:-1]
    return order[first][:count]


def noise_of(path):
    xyz, idx = read_mesh(path)
    n = len(xyz)
    tri_of = [[] for _ in range(n)]
    for t, (a, b, c) in enumerate(idx):
        tri_of[a].append(t); tri_of[b].append(t); tri_of[c].append(t)
    v1, v2 = xyz[idx[:, 1]] - xyz[idx[:, 0]], xyz[idx[:, 2]] - xyz[idx[:, 0]]
    normals = np.cross(v1, v2)
    lengths = np.linalg.norm(normals, axis=1)
    unit = normals / np.where(lengths > 0, lengths, 1)[:, None]
    dist, smooth, quad = [], [], []
    for s in spread(xyz, SAMPLES):
        ring1 = set(idx[tri_of[s]].ravel())
        tris = set()
        for m in ring1:
            tris.update(tri_of[m])
        tris = list(tris)
        nodes = np.unique(idx[tris].ravel())
        if len(nodes) < 4:
            continue
        p = xyz[nodes]
        c = p.mean(0)
        w, v = np.linalg.eigh((p - c).T @ (p - c))
        d = abs(float((xyz[s] - c) @ v[:, 0]))
        dist.append(d)
        if len(nodes) >= 8:
            # The same patch, a quadric height field over the plane: the node's residual without the curvature.
            q = (p - c) @ v
            x, y, z = q[:, 2], q[:, 1], q[:, 0]
            A = np.stack([x * x, x * y, y * y, x, y, np.ones_like(x)], 1)
            coef, *_ = np.linalg.lstsq(A, z, rcond=None)
            k = int(np.where(nodes == s)[0][0])
            quad.append(abs(float(z[k] - A[k] @ coef)))
        m = (unit[tris] * lengths[tris, None]).sum(0)
        if np.linalg.norm(m) > 0 and (unit[tris] @ (m / np.linalg.norm(m))).min() >= SMOOTH_COS:
            smooth.append(d)
    noise = MAD * float(np.median(dist)) if dist else 0.0
    noise_smooth = MAD * float(np.median(smooth)) if len(smooth) >= 50 else None
    noise_quadric = MAD * float(np.median(quad)) if quad else None
    return dict(nodes=n, triangles=len(idx), samples=len(dist), noise=noise, smooth_samples=len(smooth), noise_smooth=noise_smooth,
                noise_quadric=noise_quadric)


def ladder(path):
    out, cur = {}, None
    for line in open(path, errors='replace'):
        m = re.match(r'== file (\S+?)\.mesh', line)
        if m:
            cur = out.setdefault(m.group(1), {})
            continue
        m = re.search(r'q26 rung (\S+) unfit (\S+) % ms (\S+)', line)
        if m and cur is not None:
            cur[float(m.group(1))] = (float(m.group(2)), float(m.group(3)))
    return out


root = sys.argv[1]
rungs = ladder(sys.argv[2]) if len(sys.argv) > 2 else {}
for dirpath, _, names in sorted(os.walk(root)):
    for name in sorted(names):
        if not name.endswith('.mesh'):
            continue
        rel = os.path.relpath(os.path.join(dirpath, name), root)[:-5]
        r = noise_of(os.path.join(dirpath, name))
        r['file'] = rel
        if rel in rungs:
            r['rungs'] = {str(k): v for k, v in sorted(rungs[rel].items())}
        print(json.dumps(r), flush=True)
