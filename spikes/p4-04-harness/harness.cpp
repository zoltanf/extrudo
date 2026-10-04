// Native harness for the P4-04 wrapOnCylinder (ADR-0060 §3). Built and run
// inside the pinned OCCT image by run.sh; prints one line per check and exits
// non-zero if any fails.
//
// The wrapped face on the near cylinder goes to OCCT's own simple offset
// (BRepOffset_MakeSimpleOffset), which maps it onto the coaxial cylinder of
// radius R ± depth with the same curves and makes the wall of each of its
// edges, sharing the radial edge at a corner between the two walls that meet
// there. Every case passes.
//
// The two that took the longest are the chord and an arc and the D: an arc's
// curve in space is the whole circle it sits on, so the B-spline the wrap falls
// back to for a curve the frame didn't line up with has to be built from the
// trimmed piece the edge runs along. Built from the whole circle instead, the
// cap's edge went all the way round and OCCT's shell came back "not closed".
//
// `report` prints what BRepCheck says about each face of a result that isn't
// sound, which is where a wrap that doesn't close up shows itself.
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

/** What BRepCheck says about each face of a handle that isn't sound. */
static void report(int h) {
  if (h <= 0) {
    std::printf("     (nothing built)\n");
    return;
  }
  int k = 0;
  for (TopExp_Explorer face(*f.find(h), TopAbs_FACE); face.More(); face.Next(), ++k) {
    BRepCheck_Analyzer check(face.Current());
    const bool ok = check.IsValid();
    std::printf("     face %d: %s", k, ok ? "valid" : "invalid");
    if (!ok) {
      const NCollection_List<BRepCheck_Status>& statuses = check.Result(face.Current())->Status();
      for (NCollection_List<BRepCheck_Status>::Iterator it(statuses); it.More(); it.Next()) {
        std::printf(" [%d]", static_cast<int>(it.Value()));
      }
    }
    std::printf("\n");
  }
}

static bool near(double a, double b, double rel) { return std::abs(a - b) <= rel * std::max(1.0, std::abs(b)); }

/**
 * The volume, with the integrator's tolerance given: OCCT's older two-argument
 * VolumeProperties (what the facade's volumeOf calls) is about 1% off on a solid
 * whose side faces are B-splines, the newer one is exact.
 */
static double volume(int h) {
  if (h <= 0) return 0;
  GProp_GProps props;
  BRepGProp::VolumeProperties(*f.find(h), props, 1e-12);
  return props.Mass();
}
static bool valid(int h) { return h > 0 && BRepCheck_Analyzer(*f.find(h)).IsValid(); }

/** The "is it a sound solid" check: lastError() when the build failed, the faces when it wasn't. */
static void checkSolid(int h, const char* what) {
  const bool ok = valid(h);
  check(ok, h > 0 || f.lastError_.empty() ? what : f.lastError_.c_str());
  if (!ok) report(h);
}
static int faces(int h) { return h > 0 ? f.count(h, 0) : -1; }

static double faceArea(const TopoDS_Shape& s) {
  // With the tolerance: the plain two-argument call is a fixed-order integral, a good
  // 1e-4 out on a boundary that is a B-spline, which the glyph's is.
  GProp_GProps props;
  BRepGProp::SurfaceProperties(s, props, 1e-12);
  return props.Mass();
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

/** The area of the result face one record (input 0, a kind, index, relation) points to. */
static double recordArea(int h, int kind, int index, int relation) {
  if (h <= 0) return 0;
  const std::vector<int32_t> hist = f.history_;
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> map;
  TopExp::MapShapes(*f.find(h), TopAbs_FACE, map);
  size_t i = 0;
  double area = 0;
  while (i < hist.size()) {
    const int input = hist[i], k = hist[i + 1], at = hist[i + 2], rel = hist[i + 3], n = hist[i + 4];
    for (int k2 = 0; k2 < n; ++k2) {
      if (input == 0 && k == kind && at == index && rel == relation && hist[i + 5] == 0) {
        area += faceArea(map(hist[i + 6 + 2 * k2] + 1));
      }
    }
    i += 5 + 2 * n;
  }
  return area;
}

// The cylinder and the sketch plane of every case: the axis is Z through the
// origin, the sketch plane is the plane x = 20 (tangent to a cylinder of
// radius 20), s runs along +Y from (20, 0, 0) and z along +Z.
static const double R = 20;
#define WRAP(faceHandle, depth, out) \
  f.wrapOnCylinder((faceHandle), 0, 0, 0, 0, 0, 1, 1, 0, 0, R, 20, 0, 0, 0, 1, 0, (depth), (out))

/** A face in the sketch plane: the (s, z) corners in order. */
static int plate(std::vector<std::pair<double, double>> points) {
  BRepBuilderAPI_MakePolygon poly;
  for (const auto& [s, z] : points) poly.Add(gp_Pnt(20, s, z));
  poly.Close();
  BRepBuilderAPI_MakeFace face(poly.Wire(), true);
  return f.store(face.Face());
}

/** A rectangle in the sketch plane: s from s0 to s0 + w, z from z0 to z0 + h. */
static int rect(double s0, double z0, double w, double h) {
  return plate({{s0, z0}, {s0 + w, z0}, {s0 + w, z0 + h}, {s0, z0 + h}});
}

/** A circle in the sketch plane. */
static int circle(double s, double z, double r) {
  BRepBuilderAPI_MakeEdge edge(gp_Circ(gp_Ax2(gp_Pnt(20, s, z), gp_Dir(1, 0, 0)), r));
  BRepBuilderAPI_MakeFace face(BRepBuilderAPI_MakeWire(edge.Edge()).Wire(), true);
  return f.store(face.Face());
}

/** A square with a square hole, both in the sketch plane. */
static int ring(double half, double hole) {
  BRepBuilderAPI_MakePolygon poly;
  poly.Add(gp_Pnt(20, -half, 0));
  poly.Add(gp_Pnt(20, half, 0));
  poly.Add(gp_Pnt(20, half, 8));
  poly.Add(gp_Pnt(20, -half, 8));
  poly.Close();
  BRepBuilderAPI_MakePolygon inner;
  inner.Add(gp_Pnt(20, -hole, 3));
  inner.Add(gp_Pnt(20, hole, 3));
  inner.Add(gp_Pnt(20, hole, 5));
  inner.Add(gp_Pnt(20, -hole, 5));
  inner.Close();
  BRepBuilderAPI_MakeFace face(poly.Wire(), true);
  face.Add(TopoDS::Wire(inner.Wire().Reversed()));
  return f.store(face.Face());
}

/** A closed B-spline loop (a glyph) in the sketch plane: a wavy ring. */
static int glyph(double radius, double wave) {
  // Thirteen points round twelve steps, so the last one is the first and the loop closes.
  NCollection_Array1<gp_Pnt> points(1, 13);
  for (int i = 0; i < 13; ++i) {
    const double a = 2 * M_PI * i / 12;
    const double r = radius + wave * std::sin(3 * a);
    points.SetValue(i + 1, gp_Pnt(20, r * std::cos(a), 2 + r * std::sin(a)));
  }
  GeomAPI_PointsToBSpline spline(points, 3, 8, GeomAbs_C2, 1e-6);
  if (!spline.IsDone()) return 0;
  BRepBuilderAPI_MakeEdge edge(spline.Curve());
  if (!edge.IsDone()) return 0;
  BRepBuilderAPI_MakeWire wire(edge.Edge());
  if (!wire.IsDone()) return 0;
  BRepBuilderAPI_MakeFace face(wire.Wire(), true);
  if (!face.IsDone()) return 0;
  return f.store(face.Face());
}

/** Whether every vertex of a shape sits at radius `low` or `high` from the axis, and at those heights. */
static bool radii(int h, double low, double high, double zLow, double zHigh) {
  if (h <= 0) return false;
  for (TopExp_Explorer v(*f.find(h), TopAbs_VERTEX); v.More(); v.Next()) {
    const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(v.Current()));
    const double r = std::hypot(p.X(), p.Y());
    if (std::abs(r - low) > 1e-6 && std::abs(r - high) > 1e-6) return false;
    if (std::abs(p.Z() - zLow) > 1e-6 && std::abs(p.Z() - zHigh) > 1e-6) return false;
  }
  return true;
}

static double ms(std::chrono::steady_clock::time_point since) {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - since).count();
}

/** The exact volume of a profile of `area` mm² wrapped on radius R with `depth`. */
static double want(double area, double depth, bool outward) {
  return area * depth * (outward ? (R + depth / 2) / R : (R - depth / 2) / R);
}

/** One round of each case, for the leak check. */
static void round() {
  WRAP(rect(-5, 0, 10, 4), 1, true);
  WRAP(circle(0, 2, 3), 1, false);
  WRAP(ring(5, 2), 1, true);
  WRAP(glyph(4, 0.8), 0.5, true);
  f.releaseAll();
}

int main(int argc, char** argv) {
  const bool leaks = argc > 1 && std::strcmp(argv[1], "leaks") == 0;
  if (!leaks) {
    // 1. A rectangle wrapped on a cylinder: the exact annular sector.
    {
      const int face = rect(-5, 0, 10, 4);
      check(face > 0, "rectangle: face made", face, 1);
      const int out = WRAP(face, 1, true);
      check(out > 0, f.lastError_.empty() ? "rectangle out: built" : f.lastError_.c_str());
      checkSolid(out, "rectangle out: valid solid");
      check(faces(out) == 6, "rectangle out: 6 faces", faces(out), 6);
      check(near(volume(out), 41.0, 1e-6), "rectangle out: volume", volume(out), 41.0);
      check(radii(out, 20, 21, 0, 4), "rectangle out: vertices at r 20 and 21, z 0..4");
      int c[6];
      relations(c);
      check(c[1] == 4 && c[4] == 1 && c[5] == 1, "rectangle out: 4 generated, first, last",
            c[1] * 100 + c[4] * 10 + c[5], 411);
      // The cap on radius 20 spans 0.5 rad over 4 mm: 20 x 0.5 x 4.
      check(near(recordArea(out, 0, 0, 4), 40.0, 1e-6), "rectangle out: inner cap area", recordArea(out, 0, 0, 4),
            40.0);
      check(near(recordArea(out, 0, 0, 5), 42.0, 1e-6), "rectangle out: outer cap area", recordArea(out, 0, 0, 5),
            42.0);
      const int inward = WRAP(face, 1, false);
      checkSolid(inward, "rectangle in: valid solid");
      check(faces(inward) == 6, "rectangle in: 6 faces", faces(inward), 6);
      check(near(volume(inward), 39.0, 1e-6), "rectangle in: volume", volume(inward), 39.0);
      check(radii(inward, 19, 20, 0, 4), "rectangle in: vertices at r 19 and 20");
    }
    // 1b. A rectangle off the middle of the cylinder, and one on the other side of the axis.
    {
      const int far = WRAP(rect(20, 0, 6, 2), 0.5, true);
      checkSolid(far, "rectangle off: valid solid");
      check(near(volume(far), 6.0 / R / 2 * ((R + 0.5) * (R + 0.5) - R * R) * 2, 1e-6),
            "rectangle off: volume", volume(far), 0);
      const int back = WRAP(rect(-30, -3, 6, 2), 0.5, true);
      checkSolid(back, "rectangle behind: valid solid");
      check(back > 0 && radii(back, 20, 20.5, -3, -1), "rectangle behind: at r 20..20.5, z -3..-1");
    }
    // 2. A circle: an ellipse on the cylinder, the area-weighted volume.
    {
      const int face = circle(0, 2, 3);
      const double area = M_PI * 9;
      for (bool out : {true, false}) {
        const int solid = WRAP(face, 1, out);
        checkSolid(solid, "circle: valid solid");
        check(faces(solid) == 3, "circle: 3 faces", faces(solid), 3);
        check(near(volume(solid), want(area, 1, out), 1e-6), out ? "circle out: volume" : "circle in: volume",
              volume(solid), want(area, 1, out));
        check(radii(solid, out ? 20 : 19, out ? 21 : 20, -1, 5), "circle: vertices on the two cylinders");
      }
      int c[6];
      WRAP(face, 1, true);
      relations(c);
      check(c[1] == 1 && c[4] == 1 && c[5] == 1, "circle: 1 generated, first, last", c[1] * 100 + c[4] * 10 + c[5],
            111);
    }
    // 2b. A circle that isn't at the middle: still an ellipse, a ring of one side face.
    {
      const int face = circle(3, 6, 2);
      const int solid = WRAP(face, 2, true);
      checkSolid(solid, "circle off: valid solid");
      check(near(volume(solid), want(M_PI * 4, 2, true), 1e-6), "circle off: volume", volume(solid),
            want(M_PI * 4, 2, true));
    }
    // 3. A square with a square hole: one solid, a ring of inner side faces.
    {
      const int face = ring(5, 2);
      const double area = 10 * 8 - 4 * 2;
      const int solid = WRAP(face, 1.5, true);
      checkSolid(solid, "hole: valid solid");
      check(faces(solid) == 10, "hole: 10 faces (2 caps, 8 sides)", faces(solid), 10);
      check(near(volume(solid), want(area, 1.5, true), 1e-6), "hole: volume", volume(solid), want(area, 1.5, true));
      int c[6];
      relations(c);
      check(c[1] == 8 && c[4] == 1 && c[5] == 1, "hole: 8 generated, first, last", c[1] * 100 + c[4] * 10 + c[5],
            811);
    }
    // 4. A B-spline glyph: mapped pole by pole.
    {
      const int face = glyph(4, 0.8);
      check(face > 0, "glyph: face made", face, 1);
      const double area = faceArea(*f.find(face));
      // The wavy ring's outer radius is radius + wave, so its area is under that.
      check(area > M_PI * 4 && area < M_PI * 36, "glyph: area", area, M_PI * 36);
      const auto t0 = std::chrono::steady_clock::now();
      const int solid = WRAP(face, 0.5, true);
      check(solid > 0, f.lastError_.empty() ? "glyph: built" : f.lastError_.c_str());
      std::printf("     glyph: %.0f ms\n", ms(t0));
      checkSolid(solid, "glyph: valid solid");
      check(faces(solid) == 3, "glyph: 3 faces", faces(solid), 3);
      check(near(volume(solid), want(area, 0.5, true), 1e-4), "glyph: volume", volume(solid), want(area, 0.5, true));
      const int inward = WRAP(face, 0.5, false);
      checkSolid(inward, "glyph in: valid solid");
      check(near(volume(inward), want(area, 0.5, false), 1e-4), "glyph in: volume", volume(inward),
            want(area, 0.5, false));
    }
    // 4b. A rotated ellipse (its axes not along s), which becomes a B-spline.
    {
      // Its major axis along (0, 1, 1): diagonal in the sketch frame, so it becomes a B-spline.
      BRepBuilderAPI_MakeEdge edge(gp_Elips(gp_Ax2(gp_Pnt(20, 0, 3), gp_Dir(1, 0, 0), gp_Dir(0, 1, 1)), 4, 1.5));
      BRepBuilderAPI_MakeFace face(BRepBuilderAPI_MakeWire(edge.Edge()).Wire(), true);
      const int handle = f.store(face.Face());
      const double area = faceArea(*f.find(handle));
      const int solid = WRAP(handle, 1, true);
      checkSolid(solid, "rotated ellipse: valid solid");
      check(near(volume(solid), want(area, 1, true), 1e-4), "rotated ellipse: volume", volume(solid),
            want(area, 1, true));
      // An ellipse with its axes along z: its s semi-axis is the minor one.
      BRepBuilderAPI_MakeEdge tall(
          gp_Elips(gp_Ax2(gp_Pnt(20, 0, 4), gp_Dir(1, 0, 0), gp_Dir(0, 0, 1)), 4, 1.5));
      BRepBuilderAPI_MakeFace tallFace(BRepBuilderAPI_MakeWire(tall.Edge()).Wire(), true);
      const int tallHandle = f.store(tallFace.Face());
      const int tallSolid = WRAP(tallHandle, 1, true);
      const double tallArea = faceArea(*f.find(tallHandle));
      checkSolid(tallSolid, "tall ellipse: valid solid");
      check(near(volume(tallSolid), want(tallArea, 1, true), 1e-4), "tall ellipse: volume", volume(tallSolid),
            want(tallArea, 1, true));
    }
    // 4c. A chord and an arc: the D without its two uprights.
    {
      BRepBuilderAPI_MakeWire wire;
      wire.Add(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(20, 0, 4), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0)), 4), 0,
                                       M_PI)
                   .Edge());
      wire.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(20, -4, 4), gp_Pnt(20, 4, 4)).Edge());
      check(wire.IsDone(), "chord and arc: wire", (int)wire.IsDone(), 1);
      BRepBuilderAPI_MakeFace face(wire.Wire(), true);
      const int handle = f.store(face.Face());
      const double area = faceArea(*f.find(handle));
      check(near(area, M_PI * 8, 1e-6), "chord and arc: area", area, M_PI * 8);
      const int solid = WRAP(handle, 1, true);
      checkSolid(solid, "chord and arc: valid solid");
      check(faces(solid) == 4, "chord and arc: 4 faces", faces(solid), 4);
      check(near(volume(solid), want(area, 1, true), 1e-6), "chord and arc: volume", volume(solid),
            want(area, 1, true));
    }
    // 4d. Three lines and an arc in one outline (a letter's D).
    {
      BRepBuilderAPI_MakeWire wire;
      wire.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(20, -4, 0), gp_Pnt(20, 4, 0)).Edge());
      wire.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(20, 4, 0), gp_Pnt(20, 4, 4)).Edge());
      // A half circle of radius 4 about (s, z) = (0, 4), from (4, 4) up over to (-4, 4).
      wire.Add(BRepBuilderAPI_MakeEdge(
          gp_Circ(gp_Ax2(gp_Pnt(20, 0, 4), gp_Dir(1, 0, 0), gp_Dir(0, 1, 0)), 4), 0, M_PI)
          .Edge());
      wire.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(20, -4, 4), gp_Pnt(20, -4, 0)).Edge());
      check(wire.IsDone(), "D: wire", (int)wire.IsDone(), 1);
      BRepBuilderAPI_MakeFace face(wire.Wire(), true);
      const int handle = f.store(face.Face());
      const double area = faceArea(*f.find(handle));
      check(near(area, 32 + 8 * M_PI, 1e-6), "D: area", area, 32 + 8 * M_PI);
      const int solid = WRAP(handle, 1, true);
      checkSolid(solid, "D: valid solid");
      check(faces(solid) == 6, "D: 6 faces", faces(solid), 6);
      check(near(volume(solid), want(area, 1, true), 1e-6), "D: volume", volume(solid), want(area, 1, true));
    }
    // 5. Refusals.
    {
      const int long1 = WRAP(rect(0, 0, 8 * R, 2), 1, true);
      check(long1 == 0, "too long round: refused", long1, 0);
      std::printf("     too long round: %s\n", f.lastError_.c_str());
      const int deep = WRAP(rect(-2, 0, 4, 2), R, false);
      check(deep == 0, "inward at the radius: refused", deep, 0);
      std::printf("     inward at the radius: %s\n", f.lastError_.c_str());
      check(WRAP(rect(-2, 0, 4, 2), -1, true) == 0, "negative depth: refused");
      check(WRAP(rect(-2, 0, 4, 2), 1, true) > 0, "a normal wrap still works after refusals");
      // A face whose plane doesn't run along the axis.
      BRepBuilderAPI_MakePolygon poly;
      poly.Add(gp_Pnt(0, 0, 0));
      poly.Add(gp_Pnt(10, 0, 0));
      poly.Add(gp_Pnt(10, 4, 0));
      poly.Close();
      const int flat = f.store(BRepBuilderAPI_MakeFace(poly.Wire(), true).Face());
      check(WRAP(flat, 1, true) == 0, "sketch square to the axis: refused");
      std::printf("     sketch square to the axis: %s\n", f.lastError_.c_str());
      check(WRAP(f.makeBox(0, 0, 0, 1, 1, 1), 1, true) == 0, "a box (not one face): refused");
      check(f.wrapOnCylinder(999, 0, 0, 0, 0, 0, 1, 1, 0, 0, R, 20, 0, 0, 0, 1, 0, 1, true) == 0,
            "unknown face: refused");
    }
  } else {
    // Leak check: the four cases n/5 and n times (default n = 500); the heap top
    // must not keep growing, and must grow when the handles are kept.
    const int n = argc > 2 ? std::atoi(argv[2]) : 500;
    const auto t0 = std::chrono::steady_clock::now();
    round();
    std::printf("     one round: %.0f ms\n", ms(t0));
    for (int i = 1; i < n / 10; ++i) round();
    const double warm = f.heapTop();
    for (int i = n / 10; i < n / 5; ++i) round();
    const double early = f.heapTop();
    for (int i = n / 5; i < n; ++i) round();
    const double late = f.heapTop();
    std::printf("heap: warm %.1f MB, %d rounds %.1f MB, %d rounds %.1f MB\n", warm / 1e6, n / 5, early / 1e6, n,
                late / 1e6);
    check(late - early < 4e6, "leaks: heap flat from n/5 to n rounds", (late - early) / 1e6, 0);
    // The control: n boxes kept in the arena must take heap the measure can see.
    const double before = f.heapTop();
    for (int i = 0; i < 2000; ++i) f.makeBox(i, 0, 0, 1, 1, 1);
    check(f.heapTop() - before > 1e6, "leaks: control grows", (f.heapTop() - before) / 1e6, 1);
  }
  std::printf("%d failure(s)\n", failures);
  return failures == 0 ? 0 : 1;
}