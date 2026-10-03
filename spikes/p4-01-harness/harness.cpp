// Native harness for the P4-01 facade methods (paths, helix, sweep, loft).
// Built and run inside the pinned OCCT image by run.sh; prints one line per
// check and exits non-zero if any fails.
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepBuilderAPI_MakePolygon.hxx>
#include <chrono>
#include <cstdio>
#include <cstring>

static int failures = 0;
static ExtrudoFacade f;

static void check(bool ok, const char* what, double got = 0, double want = 0) {
  std::printf("%s %-58s got %.4f want %.4f\n", ok ? "ok  " : "FAIL", what, got, want);
  if (!ok) ++failures;
}

static bool near(double a, double b, double rel) { return std::abs(a - b) <= rel * std::max(1.0, std::abs(b)); }

static int faceOfWire(const TopoDS_Wire& wire) {
  BRepBuilderAPI_MakeFace face(wire, true);
  return f.store(face.Face());
}

/** A disc of radius r about `centre`, square to `normal`. */
static int disc(gp_Pnt centre, gp_Dir normal, double r) {
  BRepBuilderAPI_MakeEdge edge(gp_Circ(gp_Ax2(centre, normal), r));
  return faceOfWire(BRepBuilderAPI_MakeWire(edge.Edge()).Wire());
}

/** An annulus: radii r (outside) and h (hole). */
static int annulus(gp_Pnt centre, gp_Dir normal, double r, double h) {
  BRepBuilderAPI_MakeEdge outer(gp_Circ(gp_Ax2(centre, normal), r));
  BRepBuilderAPI_MakeEdge inner(gp_Circ(gp_Ax2(centre, normal), h));
  BRepBuilderAPI_MakeFace face(BRepBuilderAPI_MakeWire(outer.Edge()).Wire(), true);
  TopoDS_Wire hole = BRepBuilderAPI_MakeWire(inner.Edge()).Wire();
  hole.Reverse();
  face.Add(hole);
  return f.store(face.Face());
}

/** A w × h rectangle centred on `frame`'s origin, in its XY. */
static int rect(const gp_Ax2& frame, double w, double h) {
  const gp_Pnt o = frame.Location();
  const gp_Vec x(frame.XDirection());
  const gp_Vec y(frame.YDirection());
  BRepBuilderAPI_MakePolygon poly;
  poly.Add(o.Translated(x * (-w / 2) + y * (-h / 2)));
  poly.Add(o.Translated(x * (w / 2) + y * (-h / 2)));
  poly.Add(o.Translated(x * (w / 2) + y * (h / 2)));
  poly.Add(o.Translated(x * (-w / 2) + y * (h / 2)));
  poly.Close();
  return faceOfWire(poly.Wire());
}

static double volume(int h) { return h > 0 ? ExtrudoFacade::volumeOf(*f.find(h)) : 0; }
static bool valid(int h) { return h > 0 && BRepCheck_Analyzer(*f.find(h)).IsValid(); }
static int faces(int h) { return h > 0 ? f.count(h, 0) : -1; }

static double faceArea(const TopoDS_Shape& s) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(s, props);
  return props.Mass();
}

/** The area of the result face a record (relation) of input 0's face 0 points to. */
static double recordArea(int h, int relation) {
  const std::vector<int32_t> hist = f.history_;
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> map;
  TopExp::MapShapes(*f.find(h), TopAbs_FACE, map);
  size_t i = 0;
  double area = 0;
  while (i < hist.size()) {
    const int input = hist[i], kind = hist[i + 1], index = hist[i + 2], rel = hist[i + 3], n = hist[i + 4];
    for (int k = 0; k < n; ++k) {
      if (input == 0 && kind == 0 && index == 0 && rel == relation) area += faceArea(map(hist[i + 6 + 2 * k] + 1));
    }
    i += 5 + 2 * n;
  }
  return area;
}

/** Records of each relation: [modified, generated, deleted, kept, first, last]. */
static void relations(int counts[6]) {
  for (int k = 0; k < 6; ++k) counts[k] = 0;
  size_t i = 0;
  while (i < f.history_.size()) {
    counts[f.history_[i + 3]]++;
    i += 5 + 2 * f.history_[i + 4];
  }
}

/** XZ-plane sketch frame: sketch (u, v) is world (u, 0, v). */
static int xzPath(void (*stage)()) {
  f.sketchClear();
  stage();
  f.pathClear();
  if (f.pathSketch(0, 0, 0, 1, 0, 0, 0, -1, 0) == 0) return 0;
  return f.pathWire(1e-6);
}

static int lineZ(double from, double to) {
  f.pathClear();
  BRepBuilderAPI_MakeEdge e(gp_Pnt(0, 0, from), gp_Pnt(0, 0, to));
  f.pathEdges_.push_back(e.Edge());
  return f.pathWire(1e-6);
}

static void lPath() {
  f.sketchLine(0, 0, 0, 30);
  f.sketchArc(20, 30, 20, M_PI / 2, M_PI / 2);  // (20, 50) → (0, 30), against the path
  f.sketchLine(20, 50, 60, 50);
}

static double ms(std::chrono::steady_clock::time_point since) {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - since).count();
}

int main(int argc, char** argv) {
  const bool leaks = argc > 1 && std::strcmp(argv[1], "leaks") == 0;
  const gp_Dir Z(0, 0, 1);
  if (!leaks) {
    // 1. A disc along a straight line.
    {
      const int path = lineZ(0, 50);
      const int profile = disc(gp_Pnt(0, 0, 0), Z, 5);
      const int s = f.sweep(profile, path, 0, 0, 1, true, 0, 0, 0);
      check(valid(s), "straight: valid");
      check(near(volume(s), M_PI * 25 * 50, 1e-6), "straight: volume", volume(s), M_PI * 25 * 50);
      check(faces(s) == 3, "straight: 3 faces", faces(s), 3);
      int c[6];
      relations(c);
      check(c[1] == 1 && c[4] == 1 && c[5] == 1, "straight: generated, first, last records", c[1] * 100 + c[4] * 10 + c[5], 111);
      check(near(recordArea(s, 5), M_PI * 25, 1e-6), "straight: last cap area", recordArea(s, 5), M_PI * 25);
    }
    // 2. A disc along a line, a tangent arc and a line (pieces in mixed directions).
    const double lLength = 30 + 20 * M_PI / 2 + 40;
    {
      const int path = xzPath(lPath);
      check(path > 0, "L path: wire", path, 1);
      const int profile = disc(gp_Pnt(0, 0, 0), Z, 5);
      const int s = f.sweep(profile, path, 0, 0, 1, true, 0, 0, 0);
      check(valid(s), "L path: valid");
      check(near(volume(s), M_PI * 25 * lLength, 1e-4), "L path: volume", volume(s), M_PI * 25 * lLength);
      check(faces(s) == 5, "L path: 5 faces", faces(s), 5);
    }
    // 3. A square twisted a quarter turn along a line: same volume, the end turned.
    {
      const int path = lineZ(0, 50);
      const int profile = rect(gp_Ax2(gp_Pnt(0, 0, 0), Z), 10, 10);
      const auto t0 = std::chrono::steady_clock::now();
      const int s = f.sweep(profile, path, 0, M_PI / 2, 1, true, 0, 0, 0);
      check(s > 0, f.lastError_.empty() ? "twist: built" : f.lastError_.c_str());
      check(valid(s), "twist: valid");
      check(near(volume(s), 5000, 1e-3), "twist: volume", volume(s), 5000);
      check(faces(s) == 6, "twist: 6 faces", faces(s), 6);
      std::printf("     twist took %.0f ms\n", ms(t0));
    }
    // 3b. A twist along the L path (smooth), and refused along a corner.
    {
      const int path = xzPath(lPath);
      const int profile = rect(gp_Ax2(gp_Pnt(0, 0, 0), Z), 6, 6);
      const int s = f.sweep(profile, path, 0, M_PI, 1, true, 0, 0, 0);
      check(valid(s), f.lastError_.empty() ? "twist L: valid" : f.lastError_.c_str());
      check(near(volume(s), 36 * lLength, 2e-3), "twist L: volume", volume(s), 36 * lLength);
      f.pathClear();
      f.pathEdges_.push_back(BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 30)).Edge());
      f.pathEdges_.push_back(BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 30), gp_Pnt(30, 0, 30)).Edge());
      const int corner = f.pathWire(1e-6);
      const int t = f.sweep(profile, corner, 0, 1, 1, true, 0, 0, 0);
      check(t == 0 && f.geometry_.size() == 1 && f.geometry_[0] == 3, "twist corner: refused (status 3)", t, 0);
    }
    // 4. Scaled to half along a line: a frustum.
    {
      const int path = lineZ(0, 50);
      const int profile = rect(gp_Ax2(gp_Pnt(0, 0, 0), Z), 10, 10);
      const int s = f.sweep(profile, path, 0, 0, 0.5, true, 0, 0, 0);
      const double want = 100 * 50 * (1 + 0.5 + 0.25) / 3;
      check(valid(s), f.lastError_.empty() ? "scale: valid" : f.lastError_.c_str());
      check(near(volume(s), want, 1e-3), "scale: volume", volume(s), want);
      check(near(recordArea(s, 5), 25, 1e-4), "scale: end cap area", recordArea(s, 5), 25);
    }
    // 4b. Scaled along the 3-piece L path: the end cap is a quarter.
    {
      const int path = xzPath(lPath);
      const int profile = disc(gp_Pnt(0, 0, 0), Z, 5);
      const int s = f.sweep(profile, path, 0, 0, 0.5, true, 0, 0, 0);
      check(valid(s), f.lastError_.empty() ? "scale L: valid" : f.lastError_.c_str());
      check(near(recordArea(s, 5), M_PI * 25 / 4, 1e-3), "scale L: end cap area", recordArea(s, 5), M_PI * 25 / 4);
      // The middle piece starts at 30 of ~101.4 mm: its area there is (1 - 0.5·30/101.4)² of the start.
      check(volume(s) < M_PI * 25 * lLength && volume(s) > M_PI * 25 * lLength / 4, "scale L: volume between", volume(s), 0);
    }
    // 5. Fixed orientation along the L path: the end cap stays square to Z.
    {
      const int path = xzPath(lPath);
      const int profile = disc(gp_Pnt(0, 0, 0), Z, 3);
      const int s = f.sweep(profile, path, 1, 0, 1, true, 0, 0, 0);
      check(valid(s), f.lastError_.empty() ? "fixed: valid" : f.lastError_.c_str());
      check(near(recordArea(s, 5), M_PI * 9, 1e-4), "fixed: end cap area unchanged", recordArea(s, 5), M_PI * 9);
    }
    // 6. A tube: an annulus along the L path.
    {
      const int path = xzPath(lPath);
      const int profile = annulus(gp_Pnt(0, 0, 0), Z, 5, 3);
      const int s = f.sweep(profile, path, 0, 0, 1, true, 0, 0, 0);
      check(valid(s), f.lastError_.empty() ? "tube: valid" : f.lastError_.c_str());
      check(near(volume(s), M_PI * 16 * lLength, 1e-4), "tube: volume", volume(s), M_PI * 16 * lLength);
      int c[6];
      relations(c);
      check(c[1] == 2 && c[4] == 1 && c[5] == 1, "tube: 2 generated, first, last", c[1] * 100 + c[4] * 10 + c[5], 211);
      check(near(recordArea(s, 4), M_PI * 16, 1e-4), "tube: start cap area", recordArea(s, 4), M_PI * 16);
    }
    // 7. The profile at the path's far end: the path is walked from there.
    {
      const int path = lineZ(-50, 0);
      const int profile = disc(gp_Pnt(0, 0, 0), Z, 5);
      const int s = f.sweep(profile, path, 0, 0, 0.5, true, 0, 0, 0);
      check(valid(s), "far end: valid");
      Bnd_Box box;
      BRepBndLib::Add(*f.find(s), box);
      double x0, y0, z0, x1, y1, z1;
      box.Get(x0, y0, z0, x1, y1, z1);
      check(z0 < -49.9 && z1 < 0.1 && z1 > -0.1, "far end: spans z -50..0", z0, -50);
      check(near(recordArea(s, 4), M_PI * 25, 1e-4), "far end: start cap at the profile", recordArea(s, 4), M_PI * 25);
    }
    // 8. Too tight a bend for the profile: refused.
    {
      f.sketchClear();
      f.sketchArc(3, 0, 3, M_PI / 2, M_PI);  // a half turn of radius 3 through (0, 0)
      f.pathClear();
      f.pathSketch(0, 0, 0, 1, 0, 0, 0, -1, 0);
      const int path = f.pathWire(1e-6);
      const int profile = disc(gp_Pnt(0, 0, 0), Z, 5);
      const auto t0 = std::chrono::steady_clock::now();
      const int s = f.sweep(profile, path, 0, 0, 1, true, 0, 0, 0);
      check(s == 0 && f.geometry_.size() == 1, "tight bend: refused", f.geometry_.empty() ? -1 : f.geometry_[0], 2);
      std::printf("     tight bend: %s (%.0f ms)\n", f.lastError_.c_str(), ms(t0));
    }
    // 9. A sharp corner: mitred.
    {
      f.pathClear();
      f.pathEdges_.push_back(BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 30)).Edge());
      f.pathEdges_.push_back(BRepBuilderAPI_MakeEdge(gp_Pnt(30, 0, 30), gp_Pnt(0, 0, 30)).Edge());
      const int path = f.pathWire(1e-6);
      const int profile = disc(gp_Pnt(0, 0, 0), Z, 3);
      const int s = f.sweep(profile, path, 0, 0, 1, true, 0, 0, 0);
      check(valid(s), f.lastError_.empty() ? "corner: valid" : f.lastError_.c_str());
      check(near(volume(s), M_PI * 9 * 60, 1e-4), "corner: volume", volume(s), M_PI * 9 * 60);
    }
    // 9b. Pieces that don't meet.
    {
      f.pathClear();
      f.pathEdges_.push_back(BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 30)).Edge());
      f.pathEdges_.push_back(BRepBuilderAPI_MakeEdge(gp_Pnt(30, 0, 31), gp_Pnt(0, 0, 31)).Edge());
      const int path = f.pathWire(1e-6);
      check(path == 0 && f.geometry_.size() == 1 && f.geometry_[0] == 1, "gap: refused, 1 piece apart", path, 0);
    }
    // 9c. A closed path (a circle): a torus without caps.
    {
      f.sketchClear();
      f.sketchArc(20, 0, 20, 0, 2 * M_PI);
      f.pathClear();
      f.pathSketch(0, 0, 0, 1, 0, 0, 0, -1, 0);
      const int path = f.pathWire(1e-6);
      const int profile = disc(gp_Pnt(40, 0, 0), gp_Dir(0, 0, 1), 3);
      const int s = f.sweep(profile, path, 0, 0, 1, true, 0, 0, 0);
      check(valid(s), f.lastError_.empty() ? "ring: valid" : f.lastError_.c_str());
      check(near(volume(s), M_PI * 9 * 2 * M_PI * 20, 1e-3), "ring: volume", volume(s), M_PI * 9 * 2 * M_PI * 20);
      const int t = f.sweep(profile, path, 0, 0, 0.5, true, 0, 0, 0);
      check(t == 0 && f.geometry_[0] == 4, "ring: scale refused (status 4)", t, 0);
    }
    // 10. A coil: a circle section along a helix, the section turning with the axis.
    for (int turns : {3, 20}) {
      const double radius = 10, pitch = 5, r = 1;
      const int helix = f.helix(0, 0, 0, 0, 0, 1, 1, 0, 0, radius, pitch, turns, 0, false);
      check(helix > 0, "coil: helix", helix, 1);
      const int profile = disc(gp_Pnt(radius, 0, 0), gp_Dir(0, 1, 0), r);
      const auto t0 = std::chrono::steady_clock::now();
      const int s = f.sweep(profile, helix, 2, 0, 1, false, 0, 0, 1);
      const double build = ms(t0);
      const double length = turns * std::sqrt(std::pow(2 * M_PI * radius, 2) + pitch * pitch);
      const auto t1 = std::chrono::steady_clock::now();
      const bool ok = valid(s);
      check(ok, f.lastError_.empty() ? "coil: valid" : f.lastError_.c_str());
      // A circle swept square to a helix: πr² per unit length (to within the helix's slope).
      // The section lies in the axial plane, not square to the helix: πr² per unit of turn round the axis.
      (void)length;
      const double want = M_PI * r * r * turns * 2 * M_PI * radius;
      check(near(volume(s), want, 1e-4), "coil: volume", volume(s), want);
      std::printf("     coil %d turns: sweep %.0f ms, check %.0f ms, %d faces\n", turns, build, ms(t1), faces(s));
    }
    // 10a. A triangle pointing in, its wire starting with the edge along the axis: OCCT sweeps
    // that start into an invalid solid counter-clockwise; the facade starts at the next edge.
    for (bool left : {false, true}) {
      const double h = std::sqrt(3) / 2;
      BRepBuilderAPI_MakePolygon poly;
      poly.Add(gp_Pnt(10 + h, 0, -1));
      poly.Add(gp_Pnt(10 + h, 0, 1));
      poly.Add(gp_Pnt(10 - h, 0, 0));
      poly.Close();
      const int profile = faceOfWire(poly.Wire());
      const int helix = f.helix(0, 0, 0, 0, 0, 1, 1, 0, 0, 10, 4, 2.5, 0, left);
      const int s = f.sweep(profile, helix, 2, 0, 1, false, 0, 0, 1);
      // Pappus: area 2h (base 2, height 2h); the centroid lies a third of the height in from the base.
      const double want = 2 * h * 2.5 * 2 * M_PI * (10 + h - 2 * h / 3);
      check(valid(s), left ? "triangle-in coil, clockwise: valid" : "triangle-in coil, counter-clockwise: valid");
      check(near(volume(s), want, 1e-4), "triangle-in coil: volume", volume(s), want);
    }
    // 10b. Left-handed and tapered coils.
    {
      const int left = f.helix(0, 0, 0, 0, 0, 1, 1, 0, 0, 10, 4, 2, 0, true);
      const TopoDS_Shape& wire = *f.find(left);
      gp_Pnt a;
      gp_Pnt b;
      ExtrudoFacade::wireEnds(TopoDS::Wire(wire), a, b);
      BRepAdaptor_CompCurve curve(TopoDS::Wire(wire));
      const gp_Pnt quarter = curve.Value(curve.FirstParameter() + (curve.LastParameter() - curve.FirstParameter()) / 8);
      check(quarter.Y() < -9.9 && std::abs(b.Z() - 8) < 1e-6, "left coil: clockwise, 8 mm high", quarter.Y(), -10);
      const int tapered = f.helix(0, 0, 0, 0, 0, 1, 1, 0, 0, 10, 4, 3, 10 * M_PI / 180, false);
      ExtrudoFacade::wireEnds(TopoDS::Wire(*f.find(tapered)), a, b);
      const double want = 10 + std::tan(10 * M_PI / 180) * 12;
      check(std::abs(std::hypot(b.X(), b.Y()) - want) < 1e-5 && std::abs(b.Z() - 12) < 1e-6, "tapered coil: end radius", std::hypot(b.X(), b.Y()), want);
      const int profile = rect(gp_Ax2(gp_Pnt(10, 0, 0), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0)), 1.5, 1.5);
      const int s = f.sweep(profile, tapered, 2, 0, 1, false, 0, 0, 1);
      check(valid(s), f.lastError_.empty() ? "tapered coil: valid" : f.lastError_.c_str());
      check(f.helix(0, 0, 0, 0, 0, 1, 1, 0, 0, 10, 4, 3, -80 * M_PI / 180, false) == 0, "tapered coil: narrowing to nothing refused");
    }
    // 11. Lofts.
    {
      f.clearArgs();
      f.pushArg(rect(gp_Ax2(gp_Pnt(0, 0, 0), Z), 20, 20));
      f.pushArg(rect(gp_Ax2(gp_Pnt(0, 0, 20), Z), 10, 10));
      const int ruled = f.loft(true, false);
      check(valid(ruled), f.lastError_.empty() ? "loft ruled: valid" : f.lastError_.c_str());
      check(near(volume(ruled), 20.0 / 3 * (400 + 100 + 200), 1e-6), "loft ruled: frustum volume", volume(ruled), 20.0 / 3 * 700);
      check(faces(ruled) == 6, "loft ruled: 6 faces", faces(ruled), 6);
      int c[6];
      relations(c);
      check(c[4] == 1 && c[5] == 1 && c[1] == 8, "loft ruled: caps + 8 generated", c[1] * 100 + c[4] * 10 + c[5], 811);

      f.clearArgs();
      f.pushArg(rect(gp_Ax2(gp_Pnt(0, 0, 0), Z), 20, 20));
      f.pushArg(disc(gp_Pnt(0, 0, 30), Z, 8));
      const int smooth = f.loft(false, false);
      check(valid(smooth), f.lastError_.empty() ? "loft square→circle: valid" : f.lastError_.c_str());
      std::printf("     square→circle volume %.1f, %d faces\n", volume(smooth), faces(smooth));

      f.clearArgs();
      f.clearNumbers();
      f.pushArg(rect(gp_Ax2(gp_Pnt(0, 0, 0), Z), 20, 20));
      f.pushArg(0);
      f.pushNumber(0);
      f.pushNumber(0);
      f.pushNumber(30);
      const int pyramid = f.loft(true, false);
      check(valid(pyramid), f.lastError_.empty() ? "loft to point: valid" : f.lastError_.c_str());
      check(near(volume(pyramid), 4000, 1e-6), "loft to point: pyramid volume", volume(pyramid), 4000);

      f.clearArgs();
      f.pushArg(rect(gp_Ax2(gp_Pnt(0, 0, 0), Z), 20, 20));
      f.pushArg(disc(gp_Pnt(0, 0, 10), Z, 6));
      f.pushArg(rect(gp_Ax2(gp_Pnt(0, 0, 20), Z), 10, 10));
      const int three = f.loft(false, false);
      check(valid(three), f.lastError_.empty() ? "loft three: valid" : f.lastError_.c_str());
      relations(c);
      std::printf("     three sections: %d faces, generated %d\n", faces(three), c[1]);

      // A ring of four circles about Z: a closed loft.
      f.clearArgs();
      for (int k = 0; k < 4; ++k) {
        const double a = k * M_PI / 2;
        const gp_Pnt centre(20 * std::cos(a), 20 * std::sin(a), 0);
        f.pushArg(disc(centre, gp_Dir(-std::sin(a), std::cos(a), 0), 3));
      }
      {
        // Why a closed loft fails: the raw ThruSections result.
        BRepOffsetAPI_ThruSections raw(true, false, 1e-6);
        std::vector<int> handles(f.args_.begin(), f.args_.end());
        NCollection_Sequence<TopoDS_Shape> sections;
        for (int h : handles) sections.Append(BRepTools::OuterWire(TopoDS::Face(*f.find(h))));
        BRepFill_CompatibleWires compatible(sections);
        compatible.Perform();
        for (int i = 1; i <= compatible.Shape().Length(); ++i) raw.AddWire(TopoDS::Wire(compatible.Shape()(i)));
        raw.AddWire(TopoDS::Wire(compatible.Shape()(1)));
        raw.CheckCompatibility(false);
        raw.Build();
        if (raw.IsDone()) {
          const TopoDS_Shape s = raw.Shape();
          std::printf("     raw ring: type %d valid %d volume %.1f crosses %d faces %d\n", (int)s.ShapeType(),
                      (int)BRepCheck_Analyzer(s).IsValid(), ExtrudoFacade::volumeOf(s), (int)ExtrudoFacade::crossesItself(s),
                      f.count(f.store(s), 0));
          for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) {
            BRepAdaptor_Surface surface(TopoDS::Face(e.Current()));
            std::printf("     face type %d area %.1f uper %d vper %d\n", (int)surface.GetType(), faceArea(e.Current()),
                        (int)surface.IsUPeriodic(), (int)surface.IsVPeriodic());
          }
          BOPAlgo_ArgumentAnalyzer analyzer;
          analyzer.SetShape1(s);
          analyzer.SelfInterMode() = true;
          analyzer.ArgumentTypeMode() = false;
          analyzer.SmallEdgeMode() = false;
          analyzer.RebuildFaceMode() = false;
          analyzer.TangentMode() = false;
          analyzer.MergeVertexMode() = false;
          analyzer.MergeEdgeMode() = false;
          analyzer.ContinuityMode() = false;
          analyzer.CurveOnSurfaceMode() = false;
          analyzer.Perform();
          for (const BOPAlgo_CheckResult& r : analyzer.GetCheckResult()) {
            std::printf("     faulty: status %d, %d shapes:", (int)r.GetCheckStatus(), r.GetFaultyShapes1().Extent());
            for (const TopoDS_Shape& x : r.GetFaultyShapes1()) std::printf(" %d", (int)x.ShapeType());
            std::printf("\n");
          }
        } else {
          std::printf("     raw ring: not done\n");
        }
      }
      const int ring = f.loft(false, true);
      check(valid(ring), f.lastError_.empty() ? "loft ring: valid" : f.lastError_.c_str());
      std::printf("     ring volume %.1f (torus %.1f), %d faces\n", volume(ring), M_PI * 9 * 2 * M_PI * 20, faces(ring));

      f.clearArgs();
      f.pushArg(annulus(gp_Pnt(0, 0, 0), Z, 5, 2));
      f.pushArg(disc(gp_Pnt(0, 0, 10), Z, 5));
      check(f.loft(false, false) == 0 && f.geometry_[0] == 3, "loft with a hole: refused (status 3)");

      // Sections that cross each other: a twisted bow tie.
      f.clearArgs();
      f.pushArg(rect(gp_Ax2(gp_Pnt(0, 0, 0), Z), 20, 2));
      f.pushArg(rect(gp_Ax2(gp_Pnt(0, 0, 0.5), gp_Dir(0, 1, 0)), 20, 2));
      const int crossed = f.loft(false, false);
      std::printf("     crossed sections: %s\n", crossed ? "built" : f.lastError_.c_str());
    }
  } else {
    // Leak check: the same work n/5 and n times (default n = 500); the heap top must not keep growing.
    const int n = argc > 2 ? std::atoi(argv[2]) : 500;
    auto round = [&]() {
      const int path = xzPath(lPath);
      const int profile = annulus(gp_Pnt(0, 0, 0), Z, 5, 3);
      const int s = f.sweep(profile, path, 0, 0.5, 0.8, true, 0, 0, 0);
      const int square = rect(gp_Ax2(gp_Pnt(10, 0, 0), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0)), 1.2, 1.2);
      const int spring = f.helix(0, 0, 0, 0, 0, 1, 1, 0, 0, 10, 4, 1, 0, false);
      const int squareCoil = f.sweep(square, spring, 2, 0, 1, false, 0, 0, 1);
      if (!squareCoil) std::printf("square coil failed: %s\n", f.lastError_.c_str());
      const int helix = f.helix(0, 0, 0, 0, 0, 1, 1, 0, 0, 10, 5, 2, 0, false);
      const int section = disc(gp_Pnt(10, 0, 0), gp_Dir(0, 1, 0), 1);
      const int coil = f.sweep(section, helix, 2, 0, 1, false, 0, 0, 1);
      f.clearArgs();
      const int a = rect(gp_Ax2(gp_Pnt(0, 0, 0), Z), 20, 20);
      const int b = disc(gp_Pnt(0, 0, 30), Z, 8);
      f.pushArg(a);
      f.pushArg(b);
      const int loft = f.loft(false, false);
      if (!s || !coil || !loft) std::printf("round failed: %s\n", f.lastError_.c_str());
      f.releaseAll();
    };
    const auto t0 = std::chrono::steady_clock::now();
    round();
    std::printf("     one round: %.0f ms\n", ms(t0));
    for (int i = 1; i < n / 10; ++i) round();
    const double warm = f.heapTop();
    for (int i = n / 10; i < n / 5; ++i) round();
    const double early = f.heapTop();
    for (int i = n / 5; i < n; ++i) round();
    const double late = f.heapTop();
    std::printf("heap: warm %.1f MB, %d rounds %.1f MB, %d rounds %.1f MB\n", warm / 1e6, n / 5,
                early / 1e6, n, late / 1e6);
    check(late - early < 4e6, "leaks: heap flat from n/5 to n rounds", (late - early) / 1e6, 0);
  }
  std::printf("%d failure(s)\n", failures);
  return failures == 0 ? 0 : 1;
}
