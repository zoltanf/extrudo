// Native harness for P4-12's taper on ellipse and spline sides (ADR-0028's
// amendment). Built and run inside the pinned OCCT image by run.sh; prints one
// line per check and exits non-zero if any fails.
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepBuilderAPI_MakePolygon.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <GC_MakeArcOfEllipse.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <chrono>
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

static int failures = 0;
static ExtrudoFacade f;

static void check(bool ok, const char* what, double got = 0, double want = 0) {
  std::printf("%s %-58s got %.9f want %.9f\n", ok ? "ok  " : "FAIL", what, got, want);
  if (!ok) ++failures;
}
static bool near(double a, double b, double rel) { return std::abs(a - b) <= rel * std::max(1.0, std::abs(b)); }

static double volumeOf(const TopoDS_Shape& s) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(s, props, 1e-12);
  return props.Mass();
}
static double areaOf(const TopoDS_Shape& s) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(s, props, 1e-12);
  return props.Mass();
}
static bool valid(const TopoDS_Shape& s) {
  return !s.IsNull() && BRepCheck_Analyzer(s).IsValid();
}

static int store(const TopoDS_Shape& s) { return f.store(s); }

static int faces(int h) { return h > 0 ? f.count(h, 0) : -1; }

/** Records of each relation: [modified, generated, deleted, kept, first, last]. */
static void relations(int counts[6]) {
  for (int k = 0; k < 6; ++k) counts[k] = 0;
  size_t i = 0;
  while (i < f.history_.size()) {
    counts[f.history_[i + 3]]++;
    i += 5 + 2 * f.history_[i + 4];
  }
}

/** An ellipse face centred at origin, semi-axes rx, ry, normal +Z. */
static int ellipseFace(double rx, double ry) {
  BRepBuilderAPI_MakeEdge e(gp_Elips(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), rx, ry));
  return store(BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(e.Edge()).Wire(), true).Face());
}

/** A circle face. */
static int circleFace(double r) {
  BRepBuilderAPI_MakeEdge e(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), r));
  return store(BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(e.Edge()).Wire(), true).Face());
}

/** An annulus face: circle r with a reversed circular hole h. */
static int annulusFace(double r, double h) {
  BRepBuilderAPI_MakeFace face(
      BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), r)).Edge())
          .Wire(),
      true);
  face.Add(TopoDS::Wire(BRepBuilderAPI_MakeWire(
                            BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), h)).Edge())
                            .Wire()
                            .Reversed()));
  return store(face.Face());
}

/** A closed wire with one B-spline side: a rectangle whose right side bulges (an open spline). */
static int splineSideFace() {
  NCollection_Array1<gp_Pnt> pts(1, 4);
  pts.SetValue(1, gp_Pnt(10, -10, 0));
  pts.SetValue(2, gp_Pnt(13, -3, 0));
  pts.SetValue(3, gp_Pnt(13, 3, 0));
  pts.SetValue(4, gp_Pnt(10, 10, 0));
  GeomAPI_PointsToBSpline spline(pts, 3, 8, GeomAbs_C2, 1e-6);
  BRepBuilderAPI_MakeWire wire;
  wire.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(-10, -10, 0), gp_Pnt(10, -10, 0)).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(spline.Curve()).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(10, 10, 0), gp_Pnt(-10, 10, 0)).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(-10, 10, 0), gp_Pnt(-10, -10, 0)).Edge());
  return store(BRepBuilderAPI_MakeFace(wire.Wire(), true).Face());
}

// ---------------------------------------------------- refusal exploration

/** splineSideFace's outline with a circular hole of radius `hole` at its centre. */
static int splineHoleFace(double hole) {
  TopoDS_Face face = TopoDS::Face(*f.find(splineSideFace()));
  BRepBuilderAPI_MakeFace maker(face);
  BRepBuilderAPI_MakeEdge e(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), hole));
  maker.Add(TopoDS::Wire(BRepBuilderAPI_MakeWire(e.Edge()).Wire().Reversed()));
  return store(maker.Face());
}

// ---------------------------------------------------- review cases (2026-10-07)

/** A circle wire centred at (cx, cy). */
static TopoDS_Wire circleWire(double cx, double cy, double r) {
  return BRepBuilderAPI_MakeWire(
             BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(cx, cy, 0), gp_Dir(0, 0, 1)), r)).Edge())
      .Wire();
}

/** A slot (stadium) wire: straight sides 2·half long, round ends of radius r, centred at (cx, cy). */
static TopoDS_Wire slotWire(double cx, double cy, double half, double r) {
  const gp_Pnt a(cx - half, cy - r, 0), b(cx + half, cy - r, 0), c(cx + half, cy + r, 0), d(cx - half, cy + r, 0);
  const gp_Circ right(gp_Ax2(gp_Pnt(cx + half, cy, 0), gp_Dir(0, 0, 1)), r);
  const gp_Circ left(gp_Ax2(gp_Pnt(cx - half, cy, 0), gp_Dir(0, 0, 1)), r);
  BRepBuilderAPI_MakeWire wire;
  wire.Add(BRepBuilderAPI_MakeEdge(a, b).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(right, b, c, true).Value()).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(c, d).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfCircle(left, d, a, true).Value()).Edge());
  return wire.Wire();
}

/** An ellipse face (semi-axes rx, ry at the origin) with the given hole wires. */
static int ellipseWithHoles(double rx, double ry, const std::vector<TopoDS_Wire>& holes) {
  BRepBuilderAPI_MakeEdge e(gp_Elips(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), rx, ry));
  BRepBuilderAPI_MakeFace face(BRepBuilderAPI_MakeWire(e.Edge()).Wire(), true);
  for (const TopoDS_Wire& hole : holes) face.Add(TopoDS::Wire(hole.Reversed()));
  return store(face.Face());
}

/** Two elliptical lobes (8 × 7 about (±12, 0)) joined by a neck 2 mm wide. */
static int dumbbellFace() {
  const double y = 1, x = 12 - 8 * std::sqrt(1 - y * y / 49);
  const gp_Elips left(gp_Ax2(gp_Pnt(-12, 0, 0), gp_Dir(0, 0, 1)), 8, 7);
  const gp_Elips right(gp_Ax2(gp_Pnt(12, 0, 0), gp_Dir(0, 0, 1)), 8, 7);
  const gp_Pnt lt(-x, y, 0), lb(-x, -y, 0), rb(x, -y, 0), rt(x, y, 0);
  BRepBuilderAPI_MakeWire wire;
  wire.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfEllipse(left, lt, lb, true).Value()).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(lb, rb).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(GC_MakeArcOfEllipse(right, rb, rt, true).Value()).Edge());
  wire.Add(BRepBuilderAPI_MakeEdge(rt, lt).Edge());
  return store(BRepBuilderAPI_MakeFace(wire.Wire(), true).Face());
}

/** The index (0-based, as the history counts) of `edge` among the edges of `base`. */
static int edgeIndexIn(int base, const TopoDS_Shape& edge) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
  TopExp::MapShapes(*f.find(base), TopAbs_EDGE, edges);
  return edges.FindIndex(edge) - 1;
}

/** The box of the result faces the last operation's history says the base edges `edges` generated. */
static Bnd_Box wallBox(int result, const std::vector<int>& edges) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(*f.find(result), TopAbs_FACE, faces);
  Bnd_Box box;
  size_t i = 0;
  while (i < f.history_.size()) {
    const int kind = f.history_[i + 1], index = f.history_[i + 2], relation = f.history_[i + 3];
    const int n = f.history_[i + 4];
    if (kind == 1 && relation == 1 && std::find(edges.begin(), edges.end(), index) != edges.end()) {
      for (int k = 0; k < n; ++k) {
        if (f.history_[i + 5 + 2 * k] == 0) BRepBndLib::AddOptimal(faces(f.history_[i + 6 + 2 * k] + 1), box, false, false);
      }
    }
    i += 5 + 2 * static_cast<size_t>(n);
  }
  return box;
}

/** Checks that the walls the edges of `wire` (in face `base`) generated stand round (cx, cy). */
static void checkWallAt(const char* what, int base, int result, const TopoDS_Wire& wire, double cx, double cy) {
  std::vector<int> edges;
  for (TopExp_Explorer e(wire, TopAbs_EDGE); e.More(); e.Next()) edges.push_back(edgeIndexIn(base, e.Current()));
  const Bnd_Box box = wallBox(result, edges);
  if (box.IsVoid()) {
    check(false, what);
    return;
  }
  double x0, y0, z0, x1, y1, z1;
  box.Get(x0, y0, z0, x1, y1, z1);
  const double off = std::hypot((x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy);
  check(off < 1e-3, what, off, 0);
}

/** How many offset wires `MakeOffset::Generated` names for each wire of `face`. */
static void probeGenerated(const char* name, int faceHandle, double d) {
  const TopoDS_Face& face = TopoDS::Face(*f.find(faceHandle));
  BRepOffsetAPI_MakeOffset off(face, GeomAbs_Arc);
  off.Perform(d);
  NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeWires;
  TopExp::MapShapesAndAncestors(off.Shape(), TopAbs_EDGE, TopAbs_WIRE, edgeWires);
  std::printf("    Generated %s d=%.3f:", name, d);
  for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) {
    NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> wires;
    int generated = 0;
    for (TopExp_Explorer e(w.Current(), TopAbs_EDGE); e.More(); e.Next()) {
      for (NCollection_List<TopoDS_Shape>::Iterator it(off.Generated(e.Current())); it.More(); it.Next()) {
        ++generated;
        const int at = edgeWires.FindIndex(it.Value());
        if (at > 0) wires.Add(edgeWires(at).First());
      }
    }
    std::printf(" [%d edges -> %d wires]", generated, wires.Extent());
  }
  std::printf("\n");
}

/** Whether a raw MakeOffset on `face` by `d` throws, fails, or how many wires it gives. */
static void probeOffset(const char* name, int faceHandle, double d) {
  const TopoDS_Face& face = TopoDS::Face(*f.find(faceHandle));
  try {
    BRepOffsetAPI_MakeOffset off(face, GeomAbs_Arc);
    off.Perform(d);
    if (!off.IsDone()) {
      std::printf("    offset %-14s d=%8.3f: not done\n", name, d);
      return;
    }
    int wires = 0;
    for (TopExp_Explorer w(off.Shape(), TopAbs_WIRE); w.More(); w.Next()) ++wires;
    std::printf("    offset %-14s d=%8.3f: %d wires\n", name, d, wires);
  } catch (const Standard_Failure& e) {
    std::printf("    offset %-14s d=%8.3f: throws %s\n", name, d, e.what());
  }
}

int main(int argc, char** argv) {
  try {
  const bool leaks = argc > 1 && std::strcmp(argv[1], "leaks") == 0;
  if (!leaks) {
    // 1. Circle: all sides are cylinders, so the DraftAngle route (byte-identical).
    {
      const double R = 10, L = 20, taper = 20 * M_PI / 180;
      const int h = f.prism(circleFace(R), 0, 0, 0, 0, 0, L, taper);
      const double r = R + L * std::tan(taper);
      const double exact = M_PI * L / 3 * (R * R + R * r + r * r);
      check(valid(*f.find(h)) && near(volumeOf(*f.find(h)), exact, 1e-9), "circle DraftAngle volume",
            volumeOf(*f.find(h)), exact);
      check(faces(h) == 3, "circle DraftAngle: 3 faces", faces(h), 3);
    }
    // 2. Ellipse through the loft: A(z) = A + P d(z) + pi d(z)^2 (Steiner).
    {
      const double rx = 10, ry = 5, L = 20, taper = 10 * M_PI / 180;
      const double tanT = std::tan(taper);
      const double A = M_PI * rx * ry;
      const double hh = std::pow(rx - ry, 2) / std::pow(rx + ry, 2);
      const double P = M_PI * (rx + ry) * (1 + 3 * hh / (10 + std::sqrt(4 - 3 * hh)));
      int steps = 100000;
      double exact = 0;
      for (int i = 0; i < steps; ++i) {
        const double d = L * (i + 0.5) / steps * tanT;
        exact += (A + P * d + M_PI * d * d) * L / steps;
      }
      const int h = f.prism(ellipseFace(rx, ry), 0, 0, 0, 0, 0, L, taper);
      check(valid(*f.find(h)), "ellipse loft valid", f.lastError_.empty() ? 1 : 0);
      check(near(volumeOf(*f.find(h)), exact, 1e-6), "ellipse loft volume (exact)", volumeOf(*f.find(h)), exact);
      int c[6];
      relations(c);
      check(c[1] >= 1 && c[4] == 1 && c[5] == 1, "ellipse loft: generated, first, last",
            c[1] * 100 + c[4] * 10 + c[5]);
      std::printf("    ellipse: %.4f faces, volume %.6f (exact %.6f)\n", (double)faces(h), volumeOf(*f.find(h)),
                  exact);
    }
    // 3. A profile with a B-spline outline and a circular hole; the hole wall is
    // named from its circle. Steiner for the outer, a shrinking disc for the hole.
    {
      const double L = 20, taper = 5 * M_PI / 180, hole = 3;
      const double tanT = std::tan(taper);
      const TopoDS_Face base = TopoDS::Face(*f.find(splineHoleFace(hole)));
      const double A = areaOf(base) + M_PI * hole * hole;  // the outer wire's region
      GProp_GProps ep;
      BRepGProp::LinearProperties(base, ep);
      const double P = ep.Mass() - 2 * M_PI * hole;  // outer perimeter (LinearProperties sums the hole too)
      int steps = 100000;
      double exact = 0;
      for (int i = 0; i < steps; ++i) {
        const double d = L * (i + 0.5) / steps * tanT;
        const double outer = A + P * d + M_PI * d * d;
        const double inner = M_PI * (hole - d) * (hole - d);
        exact += (outer - inner) * L / steps;
      }
      const int h = f.prism(splineHoleFace(hole), 0, 0, 0, 0, 0, L, taper);
      check(valid(*f.find(h)), "spline-hole loft valid", f.lastError_.empty() ? 1 : 0);
      check(near(volumeOf(*f.find(h)), exact, 2e-3), "spline-hole loft volume", volumeOf(*f.find(h)), exact);
      std::printf("    spline-hole: %.4f faces, volume %.6f (Steiner %.6f)\n", (double)faces(h),
                  volumeOf(*f.find(h)), exact);
    }
    // 4. Annulus with a circular hole (all-arc hole wall) widened and narrowed.
    {
      const double R = 10, hole = 4, L = 20;
      const auto frustum = [&](double r0, double r1) { return M_PI * L / 3 * (r0 * r0 + r0 * r1 + r1 * r1); };
      for (double taper : {5.0 * M_PI / 180, -5.0 * M_PI / 180}) {
        const double tanT = std::tan(taper);
        const double exact = frustum(R, R + L * tanT) - frustum(hole, hole - L * tanT);
        const int h = f.prism(annulusFace(R, hole), 0, 0, 0, 0, 0, L, taper);
        check(valid(*f.find(h)) && near(volumeOf(*f.find(h)), exact, 1e-6),
              taper > 0 ? "annulus widen volume" : "annulus narrow volume", volumeOf(*f.find(h)), exact);
      }
    }
    // 5. Refusals.
    {
      f.prism(ellipseFace(10, 5), 0, 0, 0, 0, 0, 20, -45 * M_PI / 180);
      check(f.lastError_.find("too steep") != std::string::npos, f.lastError_.c_str());
      f.prism(splineHoleFace(4), 0, 0, 0, 0, 0, 20, 15 * M_PI / 180);
      check(f.lastError_.find("closes a hole") != std::string::npos, f.lastError_.c_str());
    }
    // 6. Two equal Ø6 holes in an ellipse 40 × 20, +5°: each hole's wall stays
    // round its own hole (a pairing by box area ties here), Steiner less two cones.
    {
      const double rx = 20, ry = 10, L = 20, taper = 5 * M_PI / 180, hole = 3;
      const double tanT = std::tan(taper);
      const TopoDS_Wire left = circleWire(-10, 0, hole), right = circleWire(10, 0, hole);
      const int base = ellipseWithHoles(rx, ry, {left, right});
      probeGenerated("two holes", base, L * tanT);
      const double hh = std::pow(rx - ry, 2) / std::pow(rx + ry, 2);
      const double P = M_PI * (rx + ry) * (1 + 3 * hh / (10 + std::sqrt(4 - 3 * hh)));
      double exact = 0;
      const int steps = 100000;
      for (int i = 0; i < steps; ++i) {
        const double d = L * (i + 0.5) / steps * tanT;
        exact += (M_PI * rx * ry + P * d + M_PI * d * d - 2 * M_PI * (hole - d) * (hole - d)) * L / steps;
      }
      const int h = f.prism(base, 0, 0, 0, 0, 0, L, taper);
      check(h > 0 && valid(*f.find(h)), "two holes: valid", h > 0 ? 1 : 0);
      if (h > 0) {
        check(near(volumeOf(*f.find(h)), exact, 1e-6), "two holes: volume (Steiner less two cones)",
              volumeOf(*f.find(h)), exact);
        // The base's wires as the face holds them (the reversed copies).
        std::vector<TopoDS_Wire> wires;
        for (TopExp_Explorer w(*f.find(base), TopAbs_WIRE); w.More(); w.Next()) wires.push_back(TopoDS::Wire(w.Current()));
        checkWallAt("two holes: wall of the hole at (-10, 0) stays there", base, h, wires[1], -10, 0);
        checkWallAt("two holes: wall of the hole at (10, 0) stays there", base, h, wires[2], 10, 0);
        const auto t0 = std::chrono::steady_clock::now();
        const bool crosses = ExtrudoFacade::crossesItself(*f.find(h));
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
        check(!crosses, "two holes: crossesItself is false", ms, 0);
        std::printf("    crossesItself on the two-hole result: %.1f ms\n", ms);
      }
    }
    // 7. A thin slot and a round hole at -5°: the holes grow, and their box
    // areas swap ranks (32 vs 36 mm² at the start, 107 vs 90 at the end).
    {
      const double rx = 30, ry = 15, L = 20, taper = -5 * M_PI / 180, r = 3, half = 7, sr = 1;
      const double grow = -std::tan(taper);
      const TopoDS_Wire slot = slotWire(-12, 0, half, sr), round = circleWire(12, 0, r);
      const int base = ellipseWithHoles(rx, ry, {slot, round});
      probeGenerated("slot + hole", base, L * std::tan(taper));
      const double hh = std::pow(rx - ry, 2) / std::pow(rx + ry, 2);
      const double P = M_PI * (rx + ry) * (1 + 3 * hh / (10 + std::sqrt(4 - 3 * hh)));
      const double slotArea = 4 * half * sr + M_PI * sr * sr, slotPerimeter = 4 * half + 2 * M_PI * sr;
      double exact = 0;
      const int steps = 100000;
      for (int i = 0; i < steps; ++i) {
        const double d = L * (i + 0.5) / steps * grow;
        const double outer = M_PI * rx * ry - P * d + M_PI * d * d;
        const double slotNow = slotArea + slotPerimeter * d + M_PI * d * d;
        exact += (outer - slotNow - M_PI * (r + d) * (r + d)) * L / steps;
      }
      const int h = f.prism(base, 0, 0, 0, 0, 0, L, taper);
      check(h > 0 && valid(*f.find(h)), "slot + hole at -5 deg: valid", h > 0 ? 1 : 0);
      if (h > 0) {
        check(near(volumeOf(*f.find(h)), exact, 1e-6), "slot + hole at -5 deg: volume", volumeOf(*f.find(h)),
              exact);
        std::vector<TopoDS_Wire> wires;
        for (TopExp_Explorer w(*f.find(base), TopAbs_WIRE); w.More(); w.Next()) wires.push_back(TopoDS::Wire(w.Current()));
        checkWallAt("slot + hole: the slot's walls stay round (-12, 0)", base, h, wires[1], -12, 0);
        checkWallAt("slot + hole: the hole's wall stays round (12, 0)", base, h, wires[2], 12, 0);
      }
    }
    // 8. A dumbbell whose 2 mm neck the inward offset pinches in two.
    {
      const int base = dumbbellFace();
      for (double d : {-0.5, -1.75, -3.5}) probeOffset("dumbbell", base, d);
      const int ok = f.prism(base, 0, 0, 0, 0, 0, 20, 1 * M_PI / 180);
      check(ok > 0, "dumbbell at +1 deg: ok", ok > 0 ? 1 : 0);
      const int h = f.prism(base, 0, 0, 0, 0, 0, 20, -5 * M_PI / 180);
      check(h <= 0 && f.lastError_.find("pinches the outline in two") != std::string::npos,
            ("dumbbell at -5 deg refused: " + f.lastError_).c_str());
    }
    // 9. The B-spline-sided outline alone at 5° against the Steiner value.
    {
      const double L = 20, taper = 5 * M_PI / 180;
      const double tanT = std::tan(taper);
      const int base = splineSideFace();
      const TopoDS_Shape& face = *f.find(base);
      GProp_GProps ep;
      BRepGProp::LinearProperties(face, ep);
      const double A = areaOf(face), P = ep.Mass();
      double exact = 0;
      const int steps = 100000;
      for (int i = 0; i < steps; ++i) {
        const double d = L * (i + 0.5) / steps * tanT;
        exact += (A + P * d + M_PI * d * d) * L / steps;
      }
      const auto t0 = std::chrono::steady_clock::now();
      const int h = f.prism(base, 0, 0, 0, 0, 0, L, taper);
      const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
      check(h > 0 && valid(*f.find(h)), "spline outline: valid", h > 0 ? 1 : 0);
      if (h > 0) {
        const double v = volumeOf(*f.find(h));
        check(near(v, exact, 2e-3), "spline outline: volume (ruled, within 2e-3)", v, exact);
        std::printf("    spline outline: relative %.2e, prism %.1f ms\n", std::abs(v - exact) / exact, ms);
      }
    }
    // 10. The ellipse's time with crossesItself in the check, and alone.
    {
      const auto t0 = std::chrono::steady_clock::now();
      const int h = f.prism(ellipseFace(10, 5), 0, 0, 0, 0, 0, 20, 10 * M_PI / 180);
      const double total = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
      const auto t1 = std::chrono::steady_clock::now();
      const bool crosses = h > 0 && ExtrudoFacade::crossesItself(*f.find(h));
      const double alone = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t1).count();
      check(h > 0 && !crosses, "ellipse: crossesItself is false", alone, total);
      std::printf("    ellipse prism %.1f ms, of which crossesItself about %.1f ms\n", total, alone);
    }
    // 11. Where does a raw offset throw? (the throw path's candidates)
    {
      const int ellipse = ellipseFace(10, 5), spline = splineSideFace(), dumbbell = dumbbellFace();
      for (double d : {-4.9, -5.0, -5.1, -9.9, -10.0, -20.0}) probeOffset("ellipse 10x5", ellipse, d);
      for (double d : {-9.9, -10.0, -12.0, -100.0}) probeOffset("spline side", spline, d);
      for (double d : {-7.0, -8.0, -100.0}) probeOffset("dumbbell", dumbbell, d);
    }
  } else {
    const double start = f.heapTop();
    double last = start;
    const int rounds = argc > 2 ? std::atoi(argv[2]) : 300;
    for (int i = 0; i < rounds; ++i) {
      f.prism(ellipseFace(10, 5), 0, 0, 0, 0, 0, 20, 20 * M_PI / 180);
      f.prism(splineHoleFace(3), 0, 0, 0, 0, 0, 20, 5 * M_PI / 180);
      f.prism(ellipseWithHoles(20, 10, {circleWire(-10, 0, 3), circleWire(10, 0, 3)}), 0, 0, 0, 0, 0, 20,
              5 * M_PI / 180);
      f.prism(dumbbellFace(), 0, 0, 0, 0, 0, 20, -5 * M_PI / 180);
      f.releaseAll();
      if ((i + 1) % 100 == 0) {
        const double now = f.heapTop();
        std::printf("    round %d: heap top %.0f (+%.0f)\n", i + 1, now, now - last);
        last = now;
      }
    }
    std::printf("leak: heap top %.0f -> %.0f (grew %.0f)\n", start, last, last - start);
  }
  std::printf("%s: %d failures\n", failures ? "FAIL" : "ok", failures);
  return failures ? 1 : 0;
  } catch (const std::exception& e) {
    std::printf("FAIL: uncaught exception: %s\n", e.what());
    return 2;
  } catch (...) {
    std::printf("FAIL: uncaught unknown exception\n");
    return 2;
  }
}
