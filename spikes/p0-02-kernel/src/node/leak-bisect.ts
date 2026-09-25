// Which step of the libcascade rebuild loop leaks? Runs one step N times with
// full disposal in a fresh process and reports WASM memory growth (memory only
// grows when malloc runs out, so steady growth over thousands of iterations
// means live allocations are piling up).
// `[LIB=replicad|custom] node src/node/leak-bisect.ts <step name> [iterations]`; no args lists steps.

import { createInstance } from 'libcascade/single/init';
import { buildPart, Scope } from '../candidates/raw-occt.ts';

const which = process.argv[2];
const N = Number(process.argv[3] ?? 2000);
// LIB=replicad runs the same steps on replicad's trimmed build.
// LIB=custom runs them on our trimmed build in custom-build/dist.
const oc =
  process.env.LIB === 'replicad'
    ? // biome-ignore lint/suspicious/noExplicitAny: other build's types
      ((await (await import('replicad-opencascadejs')).default()) as any)
    : process.env.LIB === 'custom'
      ? await (await import('../../custom-build/dist/init.js')).createInstance()
      : await createInstance();
// biome-ignore lint/suspicious/noExplicitAny: loosely typed probe
const o = oc as any;
const heapMB = () => o.wasmMemory.buffer.byteLength / 1048576;

type Step = (s: Scope) => void;

function fillet4(s: Scope, mesh: boolean, reset: boolean) {
  const b = s.t(s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20)).Shape());
  const f = s.t(new oc.BRepFilletAPI_MakeFillet(b, oc.ChFi3d_FilletShape.ChFi3d_Rational));
  if (reset) s.t({ delete: () => f.Reset() });
  const ex = s.t(new oc.TopExp_Explorer(b, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
  const seen: { IsSame(x: unknown): boolean }[] = [];
  for (; ex.More(); ex.Next()) {
    const e = s.t(oc.TopoDS.Edge(s.t(ex.Current())));
    const g = s.t(new oc.GProp_GProps());
    oc.BRepGProp.LinearProperties(e, g, false, false);
    const c = s.t(g.CentreOfMass());
    if (Math.abs(c.Z() - 10) < 1e-6 && !seen.some((x) => x.IsSame(e))) {
      seen.push(e);
      f.Add(3, e);
    }
  }
  f.Build();
  const r = s.t(f.Shape());
  if (mesh) s.t(new oc.BRepMesh_IncrementalMesh(r, 0.05, false, 0.3, false));
}
const steps: Record<string, Step> = {
  'gp_Pnt only': (s) => {
    s.t(new oc.gp_Pnt(1, 2, 3));
  },
  'MakeBox + Shape()': (s) => {
    const mk = s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
    s.t(mk.Shape());
  },
  'MakeBox + Build(), no Shape()': (s) => {
    const mk = s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
    mk.Build(s.t(new oc.Message_ProgressRange()));
  },
  'MakeBox + Shape() x3': (s) => {
    const mk = s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
    for (let i = 0; i < 3; i++) s.t(mk.Shape());
  },
  'MakeBox + Shape(), Nullify() before delete': (s) => {
    const mk = s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
    const sh = s.t(mk.Shape());
    s.t({ delete: () => sh.Nullify() });
  },
  'Array1<gp_Pnt> of 100k': (s) => {
    s.t(new oc.NCollection_Array1_gp_Pnt(1, 100_000));
  },
  'MakeBox, no Shape()': (s) => {
    s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
  },
  'box + explorer over edges': (s) => {
    const mk = s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
    const b = s.t(mk.Shape());
    const ex = s.t(new oc.TopExp_Explorer(b, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
    for (; ex.More(); ex.Next()) s.t(ex.Current());
  },
  'box + GProp per edge': (s) => {
    const mk = s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
    const b = s.t(mk.Shape());
    const ex = s.t(new oc.TopExp_Explorer(b, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
    for (; ex.More(); ex.Next()) {
      const g = s.t(new oc.GProp_GProps());
      oc.BRepGProp.LinearProperties(s.t(ex.Current()), g, false, false);
      s.t(g.CentreOfMass());
    }
  },
  'box + fillet': (s) => {
    const mk = s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
    const b = s.t(mk.Shape());
    const f = s.t(new oc.BRepFilletAPI_MakeFillet(b, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    const ex = s.t(new oc.TopExp_Explorer(b, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
    f.Add(3, s.t(oc.TopoDS.Edge(s.t(ex.Current()))));
    f.Build();
    s.t(f.Shape());
  },
  'fillet: Add only, no Build': (s) => {
    const b = s.t(s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20)).Shape());
    const f = s.t(new oc.BRepFilletAPI_MakeFillet(b, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    const ex = s.t(new oc.TopExp_Explorer(b, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
    f.Add(3, s.t(oc.TopoDS.Edge(s.t(ex.Current()))));
  },
  'fillet: Build, no Shape()': (s) => {
    const b = s.t(s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20)).Shape());
    const f = s.t(new oc.BRepFilletAPI_MakeFillet(b, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    const ex = s.t(new oc.TopExp_Explorer(b, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
    f.Add(3, s.t(oc.TopoDS.Edge(s.t(ex.Current()))));
    f.Build();
  },
  'box + cylinder cut': (s) => {
    const mk = s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
    const b = s.t(mk.Shape());
    const ax = s.t(new oc.gp_Ax2(s.t(new oc.gp_Pnt(20, 15, -1)), s.t(new oc.gp_Dir(0, 0, 1))));
    const cm = s.t(new oc.BRepPrimAPI_MakeCylinder(ax, 4, 22));
    const c = s.t(cm.Shape());
    const pr = s.t(new oc.Message_ProgressRange());
    const cut = s.t(new oc.BRepAlgoAPI_Cut(b, c, pr));
    s.t(cut.Shape());
  },
  'cylinder only': (s) => {
    const ax = s.t(new oc.gp_Ax2(s.t(new oc.gp_Pnt(20, 15, -1)), s.t(new oc.gp_Dir(0, 0, 1))));
    const cm = s.t(new oc.BRepPrimAPI_MakeCylinder(ax, 4, 22));
    s.t(cm.Shape());
  },
  'cut, no Shape() call': (s) => {
    const b = s.t(s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20)).Shape());
    const ax = s.t(new oc.gp_Ax2(s.t(new oc.gp_Pnt(20, 15, -1)), s.t(new oc.gp_Dir(0, 0, 1))));
    const c = s.t(s.t(new oc.BRepPrimAPI_MakeCylinder(ax, 4, 22)).Shape());
    s.t(new oc.BRepAlgoAPI_Cut(b, c, s.t(new oc.Message_ProgressRange())));
  },
  'cut, history off': (s) => {
    const b = s.t(s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20)).Shape());
    const ax = s.t(new oc.gp_Ax2(s.t(new oc.gp_Pnt(20, 15, -1)), s.t(new oc.gp_Dir(0, 0, 1))));
    const c = s.t(s.t(new oc.BRepPrimAPI_MakeCylinder(ax, 4, 22)).Shape());
    const cut = s.t(new oc.BRepAlgoAPI_Cut());
    cut.SetToFillHistory(false);
    const a1 = s.t(new oc.NCollection_List_TopoDS_Shape());
    a1.Append(b);
    const t1 = s.t(new oc.NCollection_List_TopoDS_Shape());
    t1.Append(c);
    cut.SetArguments(a1);
    cut.SetTools(t1);
    cut.Build(s.t(new oc.Message_ProgressRange()));
    s.t(cut.Shape());
  },
  'cut, default ctor + Build': (s) => {
    const b = s.t(s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20)).Shape());
    const ax = s.t(new oc.gp_Ax2(s.t(new oc.gp_Pnt(20, 15, -1)), s.t(new oc.gp_Dir(0, 0, 1))));
    const c = s.t(s.t(new oc.BRepPrimAPI_MakeCylinder(ax, 4, 22)).Shape());
    const cut = s.t(new oc.BRepAlgoAPI_Cut());
    const a1 = s.t(new oc.NCollection_List_TopoDS_Shape());
    a1.Append(b);
    const t1 = s.t(new oc.NCollection_List_TopoDS_Shape());
    t1.Append(c);
    cut.SetArguments(a1);
    cut.SetTools(t1);
    cut.Build(s.t(new oc.Message_ProgressRange()));
    s.t(cut.Shape());
  },
  'cut + Clear() before delete': (s) => {
    const b = s.t(s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20)).Shape());
    const ax = s.t(new oc.gp_Ax2(s.t(new oc.gp_Pnt(20, 15, -1)), s.t(new oc.gp_Dir(0, 0, 1))));
    const c = s.t(s.t(new oc.BRepPrimAPI_MakeCylinder(ax, 4, 22)).Shape());
    const cut = s.t(new oc.BRepAlgoAPI_Cut(b, c, s.t(new oc.Message_ProgressRange())));
    s.t(cut.Shape());
    cut.Clear();
  },
  'full part (buildPart)': (s) => {
    buildPart(oc, s);
  },
  'full part + mesh': (s) => {
    const { result } = buildPart(oc, s);
    s.t(new oc.BRepMesh_IncrementalMesh(result, 0.05, false, 0.3, false));
  },
  'fillet 4 edges': (s) => fillet4(s, false, false),
  'fillet 4 edges + Reset()': (s) => fillet4(s, false, true),
  'fillet 4 edges + mesh + Reset()': (s) => fillet4(s, true, true),
  'fillet 4 edges + mesh': (s) => {
    const b = s.t(s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20)).Shape());
    const f = s.t(new oc.BRepFilletAPI_MakeFillet(b, oc.ChFi3d_FilletShape.ChFi3d_Rational));
    const ex = s.t(new oc.TopExp_Explorer(b, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
    const seen: unknown[] = [];
    for (; ex.More(); ex.Next()) {
      const e = s.t(oc.TopoDS.Edge(s.t(ex.Current())));
      const g = s.t(new oc.GProp_GProps());
      oc.BRepGProp.LinearProperties(e, g, false, false);
      const c = s.t(g.CentreOfMass());
      if (Math.abs(c.Z() - 10) < 1e-6 && !seen.some((x) => (x as typeof e).IsSame(e))) {
        seen.push(e);
        f.Add(3, e);
      }
    }
    f.Build();
    const r = s.t(f.Shape());
    s.t(new oc.BRepMesh_IncrementalMesh(r, 0.05, false, 0.3, false));
  },
  'box + mesh': (s) => {
    const mk = s.t(new oc.BRepPrimAPI_MakeBox(40, 30, 20));
    const b = s.t(mk.Shape());
    s.t(new oc.BRepMesh_IncrementalMesh(b, 0.05, false, 0.3, false));
  },
};

if (!which) {
  console.log(Object.keys(steps).join('\n'));
  process.exit(0);
}
const step = steps[which];
for (let i = 0; i < 20; i++) {
  using s = new Scope();
  step(s);
}
const h0 = heapMB();
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  using s = new Scope();
  step(s);
}
const growth = heapMB() - h0;
console.log(
  `${which.padEnd(28)} heap ${h0.toFixed(0)} → ${heapMB().toFixed(0)} MB over ${N} (${((growth * 1024) / N).toFixed(1)} KB/iter, ${((performance.now() - t0) / N).toFixed(2)} ms/iter)`,
);
