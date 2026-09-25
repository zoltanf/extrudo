// The P0-02 scenario written against the raw OCCT API as bound by the
// libcascade toolchain. It runs unchanged on libcascade's full build and on
// replicad's trimmed build (reached through replicad's getOC()), so it only
// uses classes present in both.
//
// Box 40×30×20 → fillet the 4 vertical edges (r = 3) → cut a Ø8 through-hole
// → tessellate (with per-face triangle ranges and edge polylines) → STL + STEP
// → re-import the STEP. Along the way it tags the box's 6 faces and 12 edges
// and propagates the names through the fillet and cut builders' history
// (Modified / Generated / IsDeleted), which is what topological naming needs.

import { centroidKey, checkStl, meshToBinaryStl, timer } from '../shared/checks.ts';
import type { HistoryReport, MeshData, ScenarioResult, Timings } from '../shared/types.ts';
import { expectedVolume, SCENARIO } from '../shared/types.ts';

// Both builds expose the same embind surface but ship separate .d.ts files, so
// the shared scenario is typed loosely. libcascade.ts type-checks its own entry.
// biome-ignore lint/suspicious/noExplicitAny: two different generated type surfaces
type OC = any;
// biome-ignore lint/suspicious/noExplicitAny: embind handle
type Handle = any;

/** Collects embind objects and deletes them in reverse order on dispose. */
export class Scope {
  #items: { delete(): void }[] = [];
  t<T extends { delete(): void }>(x: T): T {
    this.#items.push(x);
    return x;
  }
  get size() {
    return this.#items.length;
  }
  [Symbol.dispose]() {
    for (let i = this.#items.length - 1; i >= 0; i--) this.#items[i].delete();
    this.#items = [];
  }
}

type Vec3 = [number, number, number];

/**
 * Track a BRepAlgoAPI boolean. embind's delete() alone leaks the boolean's
 * internal data structures (~130 KB per cut on this scenario; see
 * src/node/leak-bisect.ts), while Clear() before delete() frees them. The scope
 * disposes in reverse order, so the Clear() hook runs just before delete().
 */
function trackBoolean<T extends { delete(): void; Clear(): void }>(s: Scope, op: T): T {
  s.t(op);
  s.t({ delete: () => op.Clear() });
  return op;
}

/**
 * Fallback for builds where NCollection_IndexedMap is not constructible
 * (replicad's trimmed build leaves its NCollection_BaseMap base unbound).
 * Same 1-based interface, linear IsSame() lookups.
 */
class JsShapeIndex {
  #shapes: Handle[] = [];
  Add(x: Handle): number {
    const i = this.FindIndex(x);
    if (i > 0) return i;
    this.#shapes.push(x);
    return this.#shapes.length;
  }
  FindIndex(x: Handle): number {
    return this.#shapes.findIndex((y) => y.IsSame(x)) + 1;
  }
  FindKey(i: number): Handle {
    return this.#shapes[i - 1];
  }
  Extent(): number {
    return this.#shapes.length;
  }
  delete() {}
}

/** Notes about workarounds needed on the current build (read by runRaw). */
const buildNotes = new Set<string>();

function newShapeIndex(oc: OC, s: Scope): Handle {
  try {
    return s.t(new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher());
  } catch {
    buildNotes.add(
      'NCollection_IndexedMap is not constructible in this build (unbound base class); used a JS index with IsSame() lookups.',
    );
    return new JsShapeIndex();
  }
}

/** IndexedMap of sub-shapes (1-based, OCCT order) built with TopExp_Explorer. */
function indexSub(oc: OC, s: Scope, shape: Handle, kind: 'FACE' | 'EDGE'): Handle {
  const map = newShapeIndex(oc, s);
  const ex = s.t(new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum[`TopAbs_${kind}`]));
  for (; ex.More(); ex.Next()) map.Add(s.t(ex.Current()));
  return map;
}

/** Centroid and mass (area for faces, length for edges). */
function props(oc: OC, s: Scope, shape: Handle, kind: 'FACE' | 'EDGE'): { c: Vec3; m: number } {
  const g = s.t(new oc.GProp_GProps());
  if (kind === 'FACE') oc.BRepGProp.SurfaceProperties(shape, g, false, false);
  else oc.BRepGProp.LinearProperties(shape, g, false, false);
  const p = s.t(g.CentreOfMass());
  return { c: [p.X(), p.Y(), p.Z()], m: g.Mass() };
}

/** Copy an NCollection_List_TopoDS_Shape into a JS array (lists have no iterator binding). */
function listToArray(oc: OC, s: Scope, list: Handle): Handle[] {
  const copy = s.t(new oc.NCollection_List_TopoDS_Shape(list));
  list.delete();
  const out: Handle[] = [];
  while (!copy.IsEmpty()) {
    out.push(s.t(copy.First()));
    copy.RemoveFirst();
  }
  return out;
}

/** Name box faces by which side of the box their centroid is on. */
function boxTag(c: Vec3): string {
  const [X, Y, Z] = SCENARIO.box;
  const eps = 1e-6;
  const parts: string[] = [];
  const axis = ['x', 'y', 'z'];
  const max = [X, Y, Z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(c[i]) < eps) parts.push(`${axis[i]}-`);
    else if (Math.abs(c[i] - max[i]) < eps) parts.push(`${axis[i]}+`);
  }
  return parts.join('');
}

function kindOf(oc: OC, h: Handle): 'face' | 'edge' | 'vertex' | 'other' {
  const t = h.ShapeType();
  const E = oc.TopAbs_ShapeEnum;
  return t === E.TopAbs_FACE ? 'face' : t === E.TopAbs_EDGE ? 'edge' : t === E.TopAbs_VERTEX ? 'vertex' : 'other';
}

/** Names for the faces and edges of one intermediate shape. */
interface NameTable {
  faces: Handle; // IndexedMap
  edges: Handle; // IndexedMap
  faceNames: string[][]; // index-1 → names
  edgeNames: string[][];
}

function emptyTable(oc: OC, s: Scope, shape: Handle): NameTable {
  const faces = indexSub(oc, s, shape, 'FACE');
  const edges = indexSub(oc, s, shape, 'EDGE');
  return {
    faces,
    edges,
    faceNames: Array.from({ length: faces.Extent() }, () => []),
    edgeNames: Array.from({ length: edges.Extent() }, () => []),
  };
}

/** Put a name on an output sub-shape, whichever map it lives in. */
function assign(out: NameTable, shape: Handle, name: string): boolean {
  const fi = out.faces.FindIndex(shape);
  if (fi > 0) {
    out.faceNames[fi - 1].push(name);
    return true;
  }
  const ei = out.edges.FindIndex(shape);
  if (ei > 0) {
    out.edgeNames[ei - 1].push(name);
    return true;
  }
  return false;
}

/**
 * Carry names from `inp` (the input of `builder`) to `out` (its result) using
 * OCCT history. Splits get deterministic `#n` suffixes ordered by centroid.
 */
function propagate(
  oc: OC,
  s: Scope,
  builder: Handle,
  op: string,
  inputs: { shape: Handle; name: string; kind: 'FACE' | 'EDGE' }[],
  out: NameTable,
  lines: string[],
) {
  for (const { shape, name, kind } of inputs) {
    if (builder.IsDeleted(shape)) {
      lines.push(`${op}: ${name} → deleted`);
    }
    const mod = listToArray(oc, s, builder.Modified(shape));
    const gen = listToArray(oc, s, builder.Generated(shape));
    if (mod.length === 0 && !builder.IsDeleted(shape)) {
      // Unchanged: the same TopoDS entity is still in the result.
      if (assign(out, shape, name)) lines.push(`${op}: ${name} → unchanged`);
      else lines.push(`${op}: ${name} → (not in result, no history)`);
    }
    const order = (arr: Handle[]) => {
      const withKey = arr.map((h) => {
        const k = kindOf(oc, h);
        let c: Vec3;
        if (k === 'vertex') {
          const p = s.t(oc.BRep_Tool.Pnt(s.t(oc.TopoDS.Vertex(h))));
          c = [p.X(), p.Y(), p.Z()];
        } else c = props(oc, s, h, k === 'face' ? 'FACE' : 'EDGE').c;
        return { h, key: `${k}:${centroidKey(c)}` };
      });
      withKey.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return withKey.map((x) => x.h);
    };
    const sortedMod = order(mod);
    sortedMod.forEach((h, i) => {
      const n = sortedMod.length > 1 ? `${name}#${i + 1}` : name;
      assign(out, h, n);
    });
    if (mod.length) lines.push(`${op}: ${name} → modified into ${mod.length} ${kind.toLowerCase()}(s)`);
    const sortedGen = order(gen);
    sortedGen.forEach((h, i) => {
      const n = `${op}(${name})${sortedGen.length > 1 ? `#${i + 1}` : ''}`;
      const inResult = assign(out, h, n);
      lines.push(`${op}: ${name} → generated ${kindOf(oc, h)} ${n}${inResult ? '' : ' (not tracked: vertices are not indexed in this spike)'}`);
    });
  }
}

function tableInputs(t: NameTable) {
  const inputs: { shape: Handle; name: string; kind: 'FACE' | 'EDGE' }[] = [];
  for (let i = 1; i <= t.faces.Extent(); i++)
    for (const name of t.faceNames[i - 1]) inputs.push({ shape: t.faces.FindKey(i), name, kind: 'FACE' });
  for (let i = 1; i <= t.edges.Extent(); i++)
    for (const name of t.edgeNames[i - 1]) inputs.push({ shape: t.edges.FindKey(i), name, kind: 'EDGE' });
  return inputs;
}

/** Tessellate and extract positions, normals, indices, face ranges, edge polylines. */
function tessellate(oc: OC, s: Scope, shape: Handle, faces: Handle, edges: Handle): MeshData {
  s.t(new oc.BRepMesh_IncrementalMesh(shape, SCENARIO.linDefl, false, SCENARIO.angDefl, false));
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const ranges: number[] = [];
  const edgePolys: (Float32Array | undefined)[] = new Array(edges.Extent());
  for (let i = 1; i <= faces.Extent(); i++) {
    using fs = new Scope();
    const face = fs.t(oc.TopoDS.Face(faces.FindKey(i)));
    const loc = fs.t(new oc.TopLoc_Location());
    const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
    const firstTri = idx.length / 3;
    if (!tri) {
      ranges.push(firstTri, 0);
      continue;
    }
    const trsf = fs.t(loc.Transformation());
    const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    if (!tri.HasNormals()) tri.ComputeNormals();
    const base = pos.length / 3;
    const nb = tri.NbNodes();
    const facePts: number[] = [];
    for (let n = 1; n <= nb; n++) {
      const p = fs.t(fs.t(tri.Node(n)).Transformed(trsf));
      pos.push(p.X(), p.Y(), p.Z());
      facePts.push(p.X(), p.Y(), p.Z());
      const d = fs.t(fs.t(tri.Normal(n)).Transformed(trsf));
      const sg = reversed ? -1 : 1;
      nrm.push(sg * d.X(), sg * d.Y(), sg * d.Z());
    }
    const nt = tri.NbTriangles();
    for (let t = 1; t <= nt; t++) {
      const T = fs.t(tri.Triangle(t));
      const a = T.Value(1) - 1;
      const b = T.Value(2) - 1;
      const c = T.Value(3) - 1;
      if (reversed) idx.push(base + a, base + c, base + b);
      else idx.push(base + a, base + b, base + c);
    }
    ranges.push(firstTri, nt);
    // Edge polylines share the face triangulation's nodes.
    const ex = fs.t(new oc.TopExp_Explorer(face, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
    for (; ex.More(); ex.Next()) {
      const e = fs.t(oc.TopoDS.Edge(fs.t(ex.Current())));
      const ei = edges.FindIndex(e);
      if (ei <= 0 || edgePolys[ei - 1]) continue;
      const poly = oc.BRep_Tool.PolygonOnTriangulation(e, tri, loc);
      if (!poly) continue;
      const line = new Float32Array(poly.NbNodes() * 3);
      for (let k = 1; k <= poly.NbNodes(); k++) {
        const ni = poly.Node(k) - 1;
        line.set(facePts.slice(ni * 3, ni * 3 + 3), (k - 1) * 3);
      }
      edgePolys[ei - 1] = line;
      poly.delete();
    }
    tri.delete();
  }
  return {
    positions: new Float32Array(pos),
    normals: new Float32Array(nrm),
    indices: new Uint32Array(idx),
    faceRanges: new Uint32Array(ranges),
    edges: edgePolys.map((e) => e ?? new Float32Array()),
  };
}

function volumeOf(oc: OC, s: Scope, shape: Handle): number {
  const g = s.t(new oc.GProp_GProps());
  oc.BRepGProp.VolumeProperties(shape, g, false, false, false);
  return g.Mass();
}

function countSub(oc: OC, s: Scope, shape: Handle, kind: 'FACE' | 'EDGE'): number {
  return indexSub(oc, s, shape, kind).Extent();
}

function writeStep(oc: OC, s: Scope, shape: Handle, schema: string): Uint8Array {
  const w = s.t(new oc.STEPControl_Writer());
  oc.Interface_Static.SetCVal('write.step.schema', schema);
  const progress = s.t(new oc.Message_ProgressRange());
  w.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress);
  const path = `/out-${schema}.step`;
  w.Write(path);
  const data = oc.FS.readFile(path) as Uint8Array;
  oc.FS.unlink(path);
  return data;
}

function readStep(oc: OC, s: Scope, data: Uint8Array): Handle {
  const path = '/in.step';
  oc.FS.writeFile(path, data);
  const r = s.t(new oc.STEPControl_Reader());
  r.ReadFile(path);
  const progress = s.t(new oc.Message_ProgressRange());
  r.TransferRoots(progress);
  oc.FS.unlink(path);
  return s.t(r.OneShape());
}

/** The geometry part only (no history): used by the memory and timing loops. */
export function buildPart(oc: OC, s: Scope) {
  const [X, Y, Z] = SCENARIO.box;
  const mk = s.t(new oc.BRepPrimAPI_MakeBox(X, Y, Z));
  const box = s.t(mk.Shape());
  const fil = s.t(new oc.BRepFilletAPI_MakeFillet(box, oc.ChFi3d_FilletShape.ChFi3d_Rational));
  const ex = s.t(new oc.TopExp_Explorer(box, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
  const seen = newShapeIndex(oc, s);
  for (; ex.More(); ex.Next()) {
    const e = s.t(oc.TopoDS.Edge(s.t(ex.Current())));
    if (seen.Add(e) !== seen.Extent()) continue; // explorer visits shared edges twice
    const { c } = props(oc, s, e, 'EDGE');
    // Vertical edges have their centroid at mid-height on two box sides.
    if (Math.abs(c[2] - Z / 2) < 1e-6) fil.Add(SCENARIO.filletRadius, e);
  }
  fil.Build();
  if (!fil.IsDone()) throw new Error('fillet failed');
  const filleted = s.t(fil.Shape());
  const r = SCENARIO.holeDiameter / 2;
  const origin = s.t(new oc.gp_Pnt(X / 2, Y / 2, -1));
  const dir = s.t(new oc.gp_Dir(0, 0, 1));
  const ax = s.t(new oc.gp_Ax2(origin, dir));
  const cylMk = s.t(new oc.BRepPrimAPI_MakeCylinder(ax, r, Z + 2));
  const cyl = s.t(cylMk.Shape());
  const progress = s.t(new oc.Message_ProgressRange());
  const cut = trackBoolean(s, new oc.BRepAlgoAPI_Cut(filleted, cyl, progress));
  if (!cut.IsDone()) throw new Error('cut failed');
  const result = s.t(cut.Shape());
  return { box, fil, filleted, cyl, cut, result };
}

export function runRaw(oc: OC, candidate: 'libcascade' | 'replicad' | 'custom', layer: string): ScenarioResult {
  using s = new Scope();
  const lap = timer();
  const tStart = performance.now();
  const timings = {} as Timings;
  const lines: string[] = [];
  const notes: string[] = [];

  // --- box
  const [X, Y, Z] = SCENARIO.box;
  const mk = s.t(new oc.BRepPrimAPI_MakeBox(X, Y, Z));
  const box = s.t(mk.Shape());
  timings.box = lap();

  // Tag the box: 6 faces, 12 edges, by position.
  const t0 = emptyTable(oc, s, box);
  for (let i = 1; i <= t0.faces.Extent(); i++)
    t0.faceNames[i - 1].push(`box:${boxTag(props(oc, s, t0.faces.FindKey(i), 'FACE').c)}`);
  for (let i = 1; i <= t0.edges.Extent(); i++)
    t0.edgeNames[i - 1].push(`box:${boxTag(props(oc, s, t0.edges.FindKey(i), 'EDGE').c)}`);
  lap(); // tagging is not part of the op timings

  // --- fillet the 4 vertical edges
  const fil = s.t(new oc.BRepFilletAPI_MakeFillet(box, oc.ChFi3d_FilletShape.ChFi3d_Rational));
  for (let i = 1; i <= t0.edges.Extent(); i++) {
    const e = s.t(oc.TopoDS.Edge(t0.edges.FindKey(i)));
    const { c } = props(oc, s, e, 'EDGE');
    if (Math.abs(c[2] - Z / 2) < 1e-6) fil.Add(SCENARIO.filletRadius, e);
  }
  fil.Build();
  if (!fil.IsDone()) throw new Error('fillet failed');
  const filleted = s.t(fil.Shape());
  timings.fillet = lap();

  const t1 = emptyTable(oc, s, filleted);
  propagate(oc, s, fil, 'fillet', tableInputs(t0), t1, lines);
  lap();

  // --- cut a Ø8 through-hole along Z
  const r = SCENARIO.holeDiameter / 2;
  const ax = s.t(new oc.gp_Ax2(s.t(new oc.gp_Pnt(X / 2, Y / 2, -1)), s.t(new oc.gp_Dir(0, 0, 1))));
  const cylMk = s.t(new oc.BRepPrimAPI_MakeCylinder(ax, r, Z + 2));
  const cyl = s.t(cylMk.Shape());
  const progress = s.t(new oc.Message_ProgressRange());
  const cut = trackBoolean(s, new oc.BRepAlgoAPI_Cut(filleted, cyl, progress));
  if (!cut.IsDone()) throw new Error('cut failed');
  const result = s.t(cut.Shape());
  timings.cut = lap();

  // Tag the tool's faces so the hole wall gets a name too.
  const tc = emptyTable(oc, s, cyl);
  for (let i = 1; i <= tc.faces.Extent(); i++) {
    const { c } = props(oc, s, tc.faces.FindKey(i), 'FACE');
    const tag = Math.abs(c[2] - (Z + 2) - -1) < 1e-6 ? 'top' : Math.abs(c[2] + 1) < 1e-6 ? 'bottom' : 'side';
    tc.faceNames[i - 1].push(`hole:${tag}`);
  }
  const t2 = emptyTable(oc, s, result);
  propagate(oc, s, cut, 'cut', [...tableInputs(t1), ...tableInputs(tc)], t2, lines);
  lap();

  // --- tessellate
  const mesh = tessellate(oc, s, result, t2.faces, t2.edges);
  timings.tessellate = lap();

  // --- STL (binary, written in JS from the tessellation: the likely production path)
  const stl = meshToBinaryStl(mesh);
  timings.stl = lap();

  // --- STEP
  const step = writeStep(oc, s, result, 'AP214IS');
  timings.step = lap();
  const reimported = readStep(oc, s, step);
  timings.stepReimport = lap();
  timings.total = performance.now() - tStart;

  // AP242 as well, outside the timings.
  const step242 = writeStep(oc, s, result, 'AP242DIS');
  const re242 = readStep(oc, s, step242);
  notes.push(
    `AP242DIS: ${step242.length} bytes, re-import volume ${volumeOf(oc, s, re242).toFixed(3)}, faces ${countSub(oc, s, re242, 'FACE')}`,
  );

  // Also check OCCT's own STL writer, which defaults to ASCII.
  try {
    const w = s.t(new oc.StlAPI_Writer());
    const pr = s.t(new oc.Message_ProgressRange());
    w.Write(result, '/occt.stl', pr);
    const occtStl = oc.FS.readFile('/occt.stl') as Uint8Array;
    oc.FS.unlink('/occt.stl');
    const ascii = new TextDecoder().decode(occtStl.slice(0, 5)) === 'solid';
    notes.push(`OCCT StlAPI_Writer: ${occtStl.length} bytes, ${ascii ? 'ASCII' : 'binary'} (ASCIIMode() is a getter returning a reference; it cannot be set from JS)`);
  } catch (e) {
    notes.push(`OCCT StlAPI_Writer failed: ${String(e)}`);
  }

  // --- checks
  const analyzer = s.t(new oc.BRepCheck_Analyzer(result, true, false));
  const stlCheck = checkStl(stl);
  notes.push(...buildNotes);
  const history = historyReport(oc, s, t2, lines, notes);

  return {
    candidate,
    layer,
    timings,
    checks: {
      valid: analyzer.IsValid(),
      volume: volumeOf(oc, s, result),
      expectedVolume: expectedVolume(),
      faces: t2.faces.Extent(),
      edges: t2.edges.Extent(),
      triangles: mesh.indices.length / 3,
      stlBytes: stl.length,
      stlWatertight: stlCheck.watertight,
      stlVolume: stlCheck.volume,
      stepBytes: step.length,
      stepSchema: 'AP214IS',
      stepReimportFaces: countSub(oc, s, reimported, 'FACE'),
      stepReimportVolume: volumeOf(oc, s, reimported),
    },
    history,
    mesh,
    stl,
    step,
  };
}

function historyReport(oc: OC, s: Scope, t: NameTable, lines: string[], notes: string[]): HistoryReport {
  const finalFaces: HistoryReport['finalFaces'] = [];
  let namedF = 0;
  let ambF = 0;
  for (let i = 1; i <= t.faces.Extent(); i++) {
    const names = t.faceNames[i - 1];
    if (names.length) namedF++;
    if (names.length > 1) ambF++;
    finalFaces.push({ index: i, area: props(oc, s, t.faces.FindKey(i), 'FACE').m, names });
  }
  // Edges without a history name: derive one from the two adjacent face names.
  const adj: string[][] = Array.from({ length: t.edges.Extent() }, () => []);
  for (let i = 1; i <= t.faces.Extent(); i++) {
    const ex = s.t(new oc.TopExp_Explorer(t.faces.FindKey(i), oc.TopAbs_ShapeEnum.TopAbs_EDGE));
    for (; ex.More(); ex.Next()) {
      const ei = t.edges.FindIndex(s.t(ex.Current()));
      const fname = t.faceNames[i - 1][0] ?? `?face${i}`;
      if (ei > 0 && !adj[ei - 1].includes(fname)) adj[ei - 1].push(fname);
    }
  }
  let namedE = 0;
  let derivedE = 0;
  let ambE = 0;
  const derivedNames = new Map<string, number>();
  const finalEdges: NonNullable<HistoryReport['finalEdges']> = [];
  for (let i = 1; i <= t.edges.Extent(); i++) {
    const names = t.edgeNames[i - 1];
    if (names.length) namedE++;
    if (names.length > 1) ambE++;
    let shown = names;
    if (!names.length) {
      derivedE++;
      const d = `edge[${adj[i - 1].sort().join('|')}]`;
      derivedNames.set(d, (derivedNames.get(d) ?? 0) + 1);
      shown = [d];
    }
    finalEdges.push({ index: i, length: props(oc, s, t.edges.FindKey(i), 'EDGE').m, names: shown });
  }
  const dup = [...derivedNames].filter(([, n]) => n > 1);
  if (dup.length)
    notes.push(`Derived edge names that are not unique (need a geometric suffix): ${dup.map(([k, n]) => `${k}×${n}`).join(', ')}`);
  return {
    available: true,
    tracks: { faces: true, edges: true },
    lines,
    coverage: {
      faces: { total: t.faces.Extent(), named: namedF, ambiguous: ambF },
      edges: { total: t.edges.Extent(), named: namedE, derived: derivedE, multiNamed: ambE },
    },
    finalFaces,
    finalEdges,
    notes,
  };
}
