// Native harness for P4-12's taper on ellipse and spline sides (ADR-0028's
// amendment). Built and run inside the pinned OCCT image by run.sh; prints one
// line per check and exits non-zero if any fails.
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepFill.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <chrono>
#include <algorithm>
#include <cmath>
#include <cstdio>
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

/** A closed wavy B-spline face. */
static int splineFace(double radius, double wave) {
  NCollection_Array1<gp_Pnt> points(1, 13);
  for (int i = 0; i < 13; ++i) {
    const double a = 2 * M_PI * i / 12;
    const double r = radius + wave * std::sin(3 * a);
    points.SetValue(i + 1, gp_Pnt(r * std::cos(a), r * std::sin(a), 0));
  }
  GeomAPI_PointsToBSpline spline(points, 3, 8, GeomAbs_C2, 1e-6);
  return store(BRepBuilderAPI_MakeFace(
                   BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(spline.Curve()).Edge()).Wire(), true)
                   .Face());
}

// ---------------------------------------------------- offset exploration

/** Offsets the wires of `face` by `d` and prints what came back. */
static void exploreOffset(const char* name, int faceHandle, double d) {
  const TopoDS_Face& face = TopoDS::Face(*f.find(faceHandle));
  BRepOffsetAPI_MakeOffset off(face, GeomAbs_Arc);
  off.Perform(d);
  std::printf("--- offset %s by %.3f: done=%d\n", name, d, (int)off.IsDone());
  if (!off.IsDone()) return;
  const TopoDS_Shape& shape = off.Shape();
  std::printf("    shape type %d, faces %d, edges %d\n", (int)shape.ShapeType(),
              off.Shape().IsNull() ? -1 : f.count(store(shape), 0), f.count(store(shape), 1));
  int wi = 0;
  for (TopExp_Explorer w(shape, TopAbs_WIRE); w.More(); w.Next(), ++wi) {
    const TopoDS_Wire& wire = TopoDS::Wire(w.Current());
    Bnd_Box box;
    BRepBndLib::Add(wire, box);
    double x0, y0, z0, x1, y1, z1;
    box.Get(x0, y0, z0, x1, y1, z1);
    std::printf("    wire %d: bbox x[%.4f,%.4f] y[%.4f,%.4f] edges %d\n", wi, x0, x1, y0, y1,
                f.count(store(wire), 1));
  }
  // Generated mapping for each edge of the original face.
  int ei = 0;
  for (TopExp_Explorer e(face, TopAbs_EDGE); e.More(); e.Next(), ++ei) {
    const NCollection_List<TopoDS_Shape>& gen = off.Generated(e.Current());
    int n = 0;
    for (NCollection_List<TopoDS_Shape>::Iterator it(gen); it.More(); it.Next()) ++n;
    std::printf("    edge %d -> %d generated\n", ei, n);
  }
}

// ---------------------------------------------------- solid strategies

/** The offset of `face` by `d`, moved along `along`, as a shape (compound of wires). */
static TopoDS_Shape offsetMoved(const TopoDS_Face& face, double d, const gp_Vec& along) {
  BRepOffsetAPI_MakeOffset off(face, GeomAbs_Arc);
  off.Perform(d);
  if (!off.IsDone()) return TopoDS_Shape();
  gp_Trsf t;
  t.SetTranslation(along);
  return off.Shape().Moved(TopLoc_Location(t));
}

/** A face built from a compound of wires in the plane through `origin` with `normal`. */
static TopoDS_Face faceOfWires(const TopoDS_Shape& wires, const gp_Pnt& origin, const gp_Dir& normal) {
  gp_Pln pln(origin, normal);
  TopoDS_Wire outer;
  NCollection_List<TopoDS_Shape> holes;
  double best = -1;
  for (TopExp_Explorer w(wires, TopAbs_WIRE); w.More(); w.Next()) {
    Bnd_Box box;
    BRepBndLib::Add(w.Current(), box);
    double x0, y0, z0, x1, y1, z1;
    box.Get(x0, y0, z0, x1, y1, z1);
    const double a = (x1 - x0) * (y1 - y0);
    if (a > best) {
      if (!outer.IsNull()) holes.Append(outer);
      outer = TopoDS::Wire(w.Current());
      best = a;
    } else {
      holes.Append(w.Current());
    }
  }
  BRepBuilderAPI_MakeFace maker(pln, outer);
  for (NCollection_List<TopoDS_Shape>::Iterator it(holes); it.More(); it.Next()) {
    maker.Add(TopoDS::Wire(it.Value()));
  }
  return maker.Face();
}

/** Strategy: ThruSections per wire pair (outer + holes), caps, sewn into a solid. */
static TopoDS_Shape sewTaper(const TopoDS_Face& base, const gp_Vec& along, double taper) {
  const double length = along.Magnitude();
  const double d = length * std::tan(taper);
  BRepOffsetAPI_MakeOffset off(base, GeomAbs_Arc);
  off.Perform(d);
  if (!off.IsDone()) return TopoDS_Shape();
  gp_Trsf t;
  t.SetTranslation(along);
  const TopoDS_Shape offset = off.Shape().Moved(TopLoc_Location(t));
  const TopoDS_Face endCap = faceOfWires(offset, gp_Pnt(0, 0, length), gp_Dir(0, 0, 1));

  BRepBuilderAPI_Sewing sewing(1e-6);
  std::vector<TopoDS_Wire> starts, ends;
  for (TopExp_Explorer w(base, TopAbs_WIRE); w.More(); w.Next()) starts.push_back(TopoDS::Wire(w.Current()));
  for (TopExp_Explorer ow(offset, TopAbs_WIRE); ow.More(); ow.Next()) ends.push_back(TopoDS::Wire(ow.Current()));
  const auto bboxArea = [](const TopoDS_Shape& s) {
    Bnd_Box b;
    BRepBndLib::Add(s, b);
    double x0, y0, z0, x1, y1, z1;
    b.Get(x0, y0, z0, x1, y1, z1);
    return (x1 - x0) * (y1 - y0);
  };
  std::sort(starts.begin(), starts.end(), [&](const TopoDS_Wire& a, const TopoDS_Wire& b) { return bboxArea(a) > bboxArea(b); });
  std::sort(ends.begin(), ends.end(), [&](const TopoDS_Wire& a, const TopoDS_Wire& b) { return bboxArea(a) > bboxArea(b); });
  for (size_t i = 0; i < starts.size() && i < ends.size(); ++i) {
    const TopoDS_Wire& start = starts[i];
    BRepOffsetAPI_ThruSections loft(false, true, 1e-6);
    loft.AddWire(start);
    loft.AddWire(ends[i]);
    loft.Build();
    if (!loft.IsDone()) { std::printf("    !! sew ThruSections not done\n"); return TopoDS_Shape(); }
    for (TopExp_Explorer e(start, TopAbs_EDGE); e.More(); e.Next()) {
      for (NCollection_List<TopoDS_Shape>::Iterator it(loft.Generated(e.Current())); it.More(); it.Next()) {
        if (it.Value().ShapeType() == TopAbs_FACE) sewing.Add(it.Value());
      }
    }
  }
  sewing.Add(base);
  if (!endCap.IsNull()) sewing.Add(endCap);
  sewing.Perform();
  std::printf("    [sew] free edges %d, area(base) %.4f area(end) %.4f\n", sewing.NbFreeEdges(), areaOf(base),
              endCap.IsNull() ? -1.0 : areaOf(endCap));
  if (!endCap.IsNull() && !BRepCheck_Analyzer(endCap).IsValid()) std::printf("    [sew] end cap invalid\n");
  const TopoDS_Shape sewn = sewing.SewedShape();
  TopoDS_Shell shell;
  for (TopExp_Explorer e(sewn, TopAbs_SHELL); e.More() && shell.IsNull(); e.Next()) {
    shell = TopoDS::Shell(e.Current());
  }
  if (shell.IsNull()) return sewn;
  BRepBuilderAPI_MakeSolid mk(shell);
  TopoDS_Shape solid = mk.Solid();
  if (volumeOf(solid) < 0) solid.Reverse();
  return solid;
}

/** ThruSections between two closed wires, lined up with BRepFill_CompatibleWires first. */
static TopoDS_Shape pairSolid(const TopoDS_Wire& start, const TopoDS_Wire& end, bool& ok) {
  NCollection_Sequence<TopoDS_Shape> sections;
  sections.Append(start);
  sections.Append(end);
  BRepFill_CompatibleWires compatible(sections);
  compatible.Perform();
  if (!compatible.IsDone()) { ok = false; std::printf("    !! compatible not done\n"); return TopoDS_Shape(); }
  const NCollection_Sequence<TopoDS_Shape>& lined = compatible.Shape();
  BRepOffsetAPI_ThruSections loft(true, true, 1e-6);
  loft.AddWire(TopoDS::Wire(lined(1)));
  loft.AddWire(TopoDS::Wire(lined(2)));
  loft.CheckCompatibility(false);
  loft.Build();
  ok = loft.IsDone();
  if (!ok) std::printf("    !! pairSolid ThruSections not done\n");
  return loft.Shape();
}

/** Strategy: ThruSections on the outer wire of base and its offset, plus a boolean per hole. */
static TopoDS_Shape thruTaper(const TopoDS_Face& base, const gp_Vec& along, double taper) {
  const double length = along.Magnitude();
  const double d = length * std::tan(taper);
  BRepOffsetAPI_MakeOffset off(base, GeomAbs_Arc);
  off.Perform(d);
  if (!off.IsDone()) return TopoDS_Shape();
  gp_Trsf t;
  t.SetTranslation(along);
  const TopoDS_Shape offset = off.Shape().Moved(TopLoc_Location(t));
  const TopoDS_Face endCap = faceOfWires(offset, gp_Pnt(0, 0, length), gp_Dir(0, 0, 1));

  bool ok = false;
  TopoDS_Shape result = pairSolid(BRepTools::OuterWire(base), BRepTools::OuterWire(endCap), ok);
  if (!ok) return TopoDS_Shape();
  // Cut each hole's frustum, pairing hole wires by sorted bbox area.
  std::vector<TopoDS_Wire> starts, ends;
  for (TopExp_Explorer w(base, TopAbs_WIRE); w.More(); w.Next()) {
    if (!TopoDS::Wire(w.Current()).IsSame(BRepTools::OuterWire(base))) starts.push_back(TopoDS::Wire(w.Current()));
  }
  for (TopExp_Explorer w(endCap, TopAbs_WIRE); w.More(); w.Next()) {
    if (!TopoDS::Wire(w.Current()).IsSame(BRepTools::OuterWire(endCap))) ends.push_back(TopoDS::Wire(w.Current()));
  }
  const auto bboxArea = [](const TopoDS_Shape& s) {
    Bnd_Box b;
    BRepBndLib::Add(s, b);
    double x0, y0, z0, x1, y1, z1;
    b.Get(x0, y0, z0, x1, y1, z1);
    return (x1 - x0) * (y1 - y0);
  };
  std::sort(starts.begin(), starts.end(), [&](const TopoDS_Wire& a, const TopoDS_Wire& b) { return bboxArea(a) > bboxArea(b); });
  std::sort(ends.begin(), ends.end(), [&](const TopoDS_Wire& a, const TopoDS_Wire& b) { return bboxArea(a) > bboxArea(b); });
  for (size_t i = 0; i < starts.size() && i < ends.size(); ++i) {
    TopoDS_Shape hole = pairSolid(starts[i], ends[i], ok);
    if (!ok) continue;
    BRepAlgoAPI_Cut cut(result, hole);
    if (cut.IsDone()) result = cut.Shape();
  }
  return result;
}

/** Numerically integrate the offset area of the profile over height 0..length. */
static double ellipseArea(double rx, double ry, double d) {
  if (rx + d <= 0 || ry + d <= 0) return 0;
  return M_PI * (rx + d) * (ry + d);
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

static void refusal(const char* name, int faceHandle, double d) {
  const TopoDS_Face& face = TopoDS::Face(*f.find(faceHandle));
  BRepOffsetAPI_MakeOffset off(face, GeomAbs_Arc);
  off.Perform(d);
  bool ok = off.IsDone() && !off.Shape().IsNull();
  int wires = 0;
  double area = 0;
  if (ok) {
    for (TopExp_Explorer w(off.Shape(), TopAbs_WIRE); w.More(); w.Next()) {
      ++wires;
      area += areaOf(BRepBuilderAPI_MakeFace(TopoDS::Wire(w.Current()), false).Face());
    }
  }
  std::printf("refusal %-20s d=%7.3f done=%d wires=%d area=%.4f\n", name, d, (int)(ok), wires, area);
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
      BRepGProp::LinearProperties(base, ep, 1e-12);
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
  } else {
    const double start = f.heapTop();
    double last = start;
    for (int i = 0; i < 300; ++i) {
      f.prism(ellipseFace(10, 5), 0, 0, 0, 0, 0, 20, 20 * M_PI / 180);
      f.prism(splineHoleFace(3), 0, 0, 0, 0, 0, 20, 5 * M_PI / 180);
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
