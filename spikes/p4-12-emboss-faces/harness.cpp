// Native harness for P4-12's emboss backlog (ADR-0060's amendment): the cone
// wrap (wrapOnCone), the projection onto spheres and free-form faces
// (projectOnFace) and wraps of more than half way round (wrapOnCylinder and
// wrapOnCone without the old |u| <= pi limit). Built and run inside the pinned
// OCCT image by run.sh; prints one line per check and exits non-zero if any
// fails. `run.sh leaks [n]` runs every case n times (default 300) and checks
// that the heap top stays flat, with a control that must grow.
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <chrono>
#include <cstdio>
#include <cstring>

static int failures = 0;
static ExtrudoFacade f;

static void check(bool ok, const char* what, double got = 0, double want = 0) {
  std::printf("%s %-60s got %.7f want %.7f\n", ok ? "ok  " : "FAIL", what, got, want);
  if (!ok) ++failures;
}

static bool near(double a, double b, double rel) { return std::abs(a - b) <= rel * std::max(1.0, std::abs(b)); }

static double volume(int h) {
  if (h <= 0) return 0;
  GProp_GProps props;
  BRepGProp::VolumeProperties(*f.find(h), props, 1e-12);
  return props.Mass();
}
static double volumeOf(const TopoDS_Shape& s) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(s, props, 1e-12);
  return props.Mass();
}
static bool valid(int h) { return h > 0 && BRepCheck_Analyzer(*f.find(h)).IsValid(); }
static void solid(int h, const char* what) {
  check(valid(h), h > 0 || f.lastError_.empty() ? what : f.lastError_.c_str());
}
static int faces(int h) { return h > 0 ? f.count(h, 0) : -1; }
static double area(int h) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(*f.find(h), props, 1e-12);
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

// The sketch plane of the wraps: x = 25, s along +Y from (25, 0, 0), z along +Z.
// The cylinder: axis Z through the origin, radius 20. The cone: the same axis,
// radius 20 at z = 0, opening upwards by 20 degrees.
static const double R = 20;
static const double ALPHA = 20 * M_PI / 180;
#define CYL(h, depth, out) f.wrapOnCylinder((h), 0, 0, 0, 0, 0, 1, 1, 0, 0, R, 25, 0, 0, 0, 1, 0, (depth), (out))
#define CONE(h, angle, depth, out) \
  f.wrapOnCone((h), 0, 0, 0, 0, 0, 1, 1, 0, 0, R, (angle), 25, 0, 0, 0, 1, 0, (depth), (out))

static int plate(std::vector<std::pair<double, double>> points, double x = 25) {
  BRepBuilderAPI_MakePolygon poly;
  for (const auto& [s, z] : points) poly.Add(gp_Pnt(x, s, z));
  poly.Close();
  return f.store(BRepBuilderAPI_MakeFace(poly.Wire(), true).Face());
}
static int rect(double s0, double z0, double w, double h) {
  return plate({{s0, z0}, {s0 + w, z0}, {s0 + w, z0 + h}, {s0, z0 + h}});
}
/** A letter O: a ring of two circles in the sketch plane x = 25. */
static int ringO(double s, double z, double outer, double inner) {
  BRepBuilderAPI_MakeFace face(
      BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(25, s, z), gp_Dir(1, 0, 0)), outer)).Edge())
          .Wire(),
      true);
  face.Add(TopoDS::Wire(
      BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(25, s, z), gp_Dir(1, 0, 0)), inner)).Edge())
          .Wire()
          .Reversed()));
  return f.store(face.Face());
}
/** A closed B-spline loop (a glyph) in the plane x = 25: a wavy ring. */
static int glyph(double radius, double wave) {
  NCollection_Array1<gp_Pnt> points(1, 13);
  for (int i = 0; i < 13; ++i) {
    const double a = 2 * M_PI * i / 12;
    const double r = radius + wave * std::sin(3 * a);
    points.SetValue(i + 1, gp_Pnt(25, r * std::cos(a), 2 + r * std::sin(a)));
  }
  GeomAPI_PointsToBSpline spline(points, 3, 8, GeomAbs_C2, 1e-6);
  return f.store(BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(spline.Curve()).Edge()).Wire(),
                                         true)
                     .Face());
}
/** A circle of radius r at (y, z) in the plane x = at, its normal along +X. */
static int disc(double at, double y, double z, double r) {
  BRepBuilderAPI_MakeEdge edge(gp_Circ(gp_Ax2(gp_Pnt(at, y, z), gp_Dir(1, 0, 0)), r));
  return f.store(BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(edge.Edge()).Wire(), true).Face());
}

/**
 * The exact volume of a profile of sketch area `a` whose area centroid is `zBar`
 * along the axis from the frame's circle, wrapped `depth` out or in on a cone of
 * half-angle `alpha` (0: a cylinder): dV = (R(v) ± t cos(alpha)) du dv dt with
 * u = s / R and v = z, so V = a d / R (R + zBar sin(alpha) ± d cos(alpha) / 2).
 */
static double wrapped(double a, double zBar, double depth, double alpha, bool out) {
  return a * depth / R * (R + zBar * std::sin(alpha) + (out ? 1 : -1) * depth * std::cos(alpha) / 2);
}

/** The volume of the column of radius a between two concentric spheres of radii r0 < r1, on one side. */
static double column(double a, double r0, double r1) {
  const auto cap = [a](double r) { return (2 * M_PI / 3) * (r * r * r - std::pow(r * r - a * a, 1.5)); };
  return cap(r1) - cap(r0);
}

static int sphereBody() { return f.store(BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), R).Shape()); }

/** A lofted body with a free-form side: a circle at z = 0 up to an ellipse at z = 30. */
static int loftBody() {
  BRepOffsetAPI_ThruSections loft(true, false);
  loft.AddWire(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 20)).Edge())
                   .Wire());
  loft.AddWire(
      BRepBuilderAPI_MakeWire(
          BRepBuilderAPI_MakeEdge(gp_Elips(gp_Ax2(gp_Pnt(3, 0, 15), gp_Dir(0, 0, 1)), 26, 16)).Edge())
          .Wire());
  loft.AddWire(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 30), gp_Dir(0, 0, 1)), 18)).Edge())
                   .Wire());
  loft.Build();
  return f.store(loft.Shape());
}
/** The index of the first face of `h` whose surface isn't a plane. */
static int curvedFace(int h) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> map;
  TopExp::MapShapes(*f.find(h), TopAbs_FACE, map);
  for (int i = 1; i <= map.Extent(); ++i) {
    if (BRepAdaptor_Surface(TopoDS::Face(map(i))).GetType() != GeomAbs_Plane) return i - 1;
  }
  return -1;
}
/** A square of side w centred on (x, z) in the plane y = at, its normal along +Y. */
static int squareY(double at, double x, double z, double w) {
  BRepBuilderAPI_MakePolygon poly;
  poly.Add(gp_Pnt(x - w / 2, at, z - w / 2));
  poly.Add(gp_Pnt(x + w / 2, at, z - w / 2));
  poly.Add(gp_Pnt(x + w / 2, at, z + w / 2));
  poly.Add(gp_Pnt(x - w / 2, at, z + w / 2));
  poly.Close();
  return f.store(BRepBuilderAPI_MakeFace(poly.Wire(), true).Face());
}

/** The volume of `body` fused with (or cut by) `tool`, and whether the result is sound. */
static double booleanVolume(int body, int tool, bool join, bool& ok) {
  TopoDS_Shape result;
  if (join) {
    BRepAlgoAPI_Fuse op(*f.find(body), *f.find(tool));
    result = op.Shape();
    ok = op.IsDone();
  } else {
    BRepAlgoAPI_Cut op(*f.find(body), *f.find(tool));
    result = op.Shape();
    ok = op.IsDone();
  }
  ok = ok && BRepCheck_Analyzer(result).IsValid();
  return volumeOf(result);
}

static double ms(std::chrono::steady_clock::time_point since) {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - since).count();
}

static void round() {
  CONE(rect(-5, -2, 10, 4), ALPHA, 1, true);
  CONE(ringO(0, 3, 4, 2), -ALPHA, 0.8, false);
  CYL(rect(0, 0, 300 * M_PI / 180 * R, 4), 1, true);
  const int sphere = sphereBody();
  f.projectOnFace(disc(30, 0, 0, 5), sphere, 0, 1, true);
  f.projectOnFace(disc(30, 0, 0, 5), sphere, 0, 1, false);
  f.releaseAll();
}

int main(int argc, char** argv) {
  const bool leaks = argc > 1 && std::strcmp(argv[1], "leaks") == 0;
  if (!leaks) {
    // 1. A rectangle wrapped on a 20-degree cone, centred on the frame's circle and off it.
    for (bool out : {true, false}) {
      const int face = rect(-5, -2, 10, 4);
      const auto t0 = std::chrono::steady_clock::now();
      const int h = CONE(face, ALPHA, 1, out);
      std::printf("     cone rectangle: %.0f ms\n", ms(t0));
      solid(h, out ? "cone rectangle out: valid solid" : "cone rectangle in: valid solid");
      check(faces(h) == 6, "cone rectangle: 6 faces", faces(h), 6);
      check(near(volume(h), wrapped(40, 0, 1, ALPHA, out), 1e-7), "cone rectangle: volume", volume(h),
            wrapped(40, 0, 1, ALPHA, out));
      int c[6];
      relations(c);
      check(c[1] == 4 && c[4] == 1 && c[5] == 1, "cone rectangle: 4 generated, first, last",
            c[1] * 100 + c[4] * 10 + c[5], 411);
    }
    {
      const int h = CONE(rect(-3, 1, 6, 4), ALPHA, 0.5, true);
      solid(h, "cone rectangle above: valid solid");
      check(near(volume(h), wrapped(24, 3, 0.5, ALPHA, true), 1e-7), "cone rectangle above: volume", volume(h),
            wrapped(24, 3, 0.5, ALPHA, true));
      const int narrowing = CONE(rect(-3, 1, 6, 4), -ALPHA, 0.5, false);
      solid(narrowing, "narrowing cone, inward: valid solid");
      check(near(volume(narrowing), wrapped(24, 3, 0.5, -ALPHA, false), 1e-7), "narrowing cone, inward: volume",
            volume(narrowing), wrapped(24, 3, 0.5, -ALPHA, false));
    }
    // 2. A letter O (a ring with its counter) and a B-spline glyph on the cone.
    {
      const double a = M_PI * (16 - 4);
      for (bool out : {true, false}) {
        const int h = CONE(ringO(0, 3, 4, 2), ALPHA, 0.8, out);
        solid(h, "cone O: valid solid");
        check(faces(h) == 4, "cone O: 4 faces (two caps, two walls)", faces(h), 4);
        check(near(volume(h), wrapped(a, 3, 0.8, ALPHA, out), 1e-6), "cone O: volume", volume(h),
              wrapped(a, 3, 0.8, ALPHA, out));
      }
      const int g = glyph(4, 0.8);
      GProp_GProps props;
      BRepGProp::SurfaceProperties(*f.find(g), props, 1e-12);
      const double ga = props.Mass();
      const double gz = gp_Vec(props.CentreOfMass().XYZ()).Dot(gp_Vec(0, 0, 1));
      const int h = CONE(g, ALPHA, 0.5, true);
      solid(h, "cone glyph: valid solid");
      check(near(volume(h), wrapped(ga, gz, 0.5, ALPHA, true), 1e-5), "cone glyph: volume", volume(h),
            wrapped(ga, gz, 0.5, ALPHA, true));
    }
    // 2b. A cone body with the wrap joined to it: the volumes add up.
    {
      // The cone frustum through radius 20 at z = 0, from z = -8 to z = 8, opening upwards.
      const double r0 = R - 8 * std::tan(ALPHA), r1 = R + 8 * std::tan(ALPHA);
      const int body = f.store(
          BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(0, 0, -8), gp_Dir(0, 0, 1)), r0, r1, 16).Shape());
      const int tool = CONE(rect(-5, -2, 10, 4), ALPHA, 1, true);
      bool ok = false;
      const double v = booleanVolume(body, tool, true, ok);
      check(ok && near(v, volume(body) + volume(tool), 1e-7), "cone body + wrap: volumes add", v,
            volume(body) + volume(tool));
      const int cut = CONE(rect(-5, -2, 10, 4), ALPHA, 1, false);
      const double w = booleanVolume(body, cut, false, ok);
      check(ok && near(w, volume(body) - volume(cut), 1e-7), "cone body - wrap: volumes subtract", w,
            volume(body) - volume(cut));
    }
    // 2c. The tip: a profile past the apex, and an inward depth past the axis.
    {
      // The tip of the cone is at z = -R / tan(alpha) along the axis: v = -R / sin(alpha).
      const double tip = -R / std::sin(ALPHA);
      const int past = CONE(rect(-1, tip - 2, 2, 4), ALPHA, 0.5, true);
      check(past == 0, "cone: a profile past the tip is refused", past, 0);
      std::printf("     %s\n", f.lastError_.c_str());
      const int deep = CONE(rect(-1, tip + 1, 2, 2), ALPHA, 3, false);
      check(deep == 0, "cone: an inward depth past the axis is refused", deep, 0);
      std::printf("     %s\n", f.lastError_.c_str());
      check(CONE(rect(-1, 0, 2, 2), 0, 1, true) == 0, "cone: a half-angle of 0 is refused");
    }
    // 3. More than half way round: 300 degrees round the cylinder, starting at the frame.
    {
      const double w = 300 * M_PI / 180 * R;
      const auto t0 = std::chrono::steady_clock::now();
      const int h = CYL(rect(0, 0, w, 4), 1, true);
      std::printf("     300 degrees: %.0f ms\n", ms(t0));
      solid(h, "300 degrees out: valid solid");
      check(near(volume(h), wrapped(w * 4, 2, 1, 0, true), 1e-7), "300 degrees out: volume", volume(h),
            wrapped(w * 4, 2, 1, 0, true));
      const int in = CYL(rect(-w / 2 - 20, 0, w, 4), 1, false);
      solid(in, "300 degrees in, past the back: valid solid");
      check(near(volume(in), wrapped(w * 4, 2, 1, 0, false), 1e-7), "300 degrees in: volume", volume(in),
            wrapped(w * 4, 2, 1, 0, false));
      // Joined to a cylinder and cut from it: the boolean takes the wide tool.
      const int body = f.store(BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, -5), gp_Dir(0, 0, 1)), R, 15).Shape());
      bool ok = false;
      const double joined = booleanVolume(body, h, true, ok);
      check(ok && near(joined, volume(body) + volume(h), 1e-7), "300 degrees joined to a cylinder", joined,
            volume(body) + volume(h));
      const double cut = booleanVolume(body, in, false, ok);
      check(ok && near(cut, volume(body) - volume(in), 1e-7), "300 degrees cut from a cylinder", cut,
            volume(body) - volume(in));
      const int cone = CONE(rect(10, -2, 300 * M_PI / 180 * R, 4), ALPHA, 1, true);
      solid(cone, "300 degrees on the cone: valid solid");
      check(near(volume(cone), wrapped(300 * M_PI / 180 * R * 4, 0, 1, ALPHA, true), 1e-7),
            "300 degrees on the cone: volume", volume(cone), wrapped(300 * M_PI / 180 * R * 4, 0, 1, ALPHA, true));
      const int whole = CYL(rect(0, 0, 2 * M_PI * R + 1, 4), 1, true);
      check(whole == 0, "past a whole turn: refused", whole, 0);
      std::printf("     %s\n", f.lastError_.c_str());
      const int just = CYL(rect(0, 0, 2 * M_PI * R - 0.005, 4), 1, true);
      check(just == 0, "within 0.01 mm of a whole turn: refused", just, 0);
    }
    // 4. A circle projected onto a sphere: a column between concentric spheres, exactly.
    {
      const int sphere = sphereBody();
      for (bool out : {true, false}) {
        const auto t0 = std::chrono::steady_clock::now();
        const int h = f.projectOnFace(disc(30, 0, 0, 5), sphere, 0, 1, out);
        std::printf("     sphere projection: %.0f ms\n", ms(t0));
        solid(h, out ? "sphere emboss: valid solid" : "sphere deboss: valid solid");
        const double want = out ? column(5, R, R + 1) : column(5, R - 1, R);
        check(near(volume(h), want, 1e-7), out ? "sphere emboss: volume" : "sphere deboss: volume", volume(h), want);
        check(faces(h) == 3, "sphere: 3 faces (two caps, a wall)", faces(h), 3);
        int c[6];
        relations(c);
        check(c[1] == 1 && c[4] == 1 && c[5] == 1, "sphere: 1 generated, first, last", c[1] * 100 + c[4] * 10 + c[5],
              111);
        bool ok = false;
        const double v = booleanVolume(sphere, h, out, ok);
        const double whole = 4 * M_PI / 3 * R * R * R;
        check(ok && near(v, out ? whole + want : whole - want, 1e-7), "sphere: the boolean adds up", v,
              out ? whole + want : whole - want);
      }
      // From the other side: the sketch at x = -30 projects onto the sphere's -X side.
      const int other = f.projectOnFace(disc(-30, 0, 0, 5), sphere, 0, 1, true);
      solid(other, "sphere from -X: valid solid");
      check(other > 0 && f.find(other) != nullptr, "sphere from -X: built");
      if (other > 0) {
        Bnd_Box box;
        BRepBndLib::Add(*f.find(other), box);
        double x0, y0, z0, x1, y1, z1;
        box.Get(x0, y0, z0, x1, y1, z1);
        check(x1 < -R * 0.9, "sphere from -X: on the -X side", x1, -R);
      }
      // A sketch inside the sphere's outline... reaching past it, and missing it.
      const int past = f.projectOnFace(disc(30, 17, 0, 5), sphere, 0, 1, true);
      check(past == 0, "sphere: past the silhouette refused", past, 0);
      std::printf("     %s\n", f.lastError_.c_str());
      const int band = f.projectOnFace(disc(30, 0, 0, 19.5), sphere, 0, 1, false);
      check(band == 0, "sphere deboss: past the inner sphere's outline refused", band, 0);
      std::printf("     %s\n", f.lastError_.c_str());
      const int miss = f.projectOnFace(disc(30, 40, 0, 5), sphere, 0, 1, true);
      check(miss == 0, "sphere: a profile off it refused", miss, 0);
      std::printf("     %s\n", f.lastError_.c_str());
      // A ring (a letter O) keeps its counter.
      BRepBuilderAPI_MakeFace o(
          BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(30, 0, 0), gp_Dir(1, 0, 0)), 6)).Edge())
              .Wire(),
          true);
      o.Add(TopoDS::Wire(
          BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(gp_Circ(gp_Ax2(gp_Pnt(30, 0, 0), gp_Dir(1, 0, 0)), 3)).Edge())
              .Wire()
              .Reversed()));
      const int ring = f.projectOnFace(f.store(o.Face()), sphere, 0, 1, true);
      solid(ring, "sphere O: valid solid");
      check(faces(ring) == 4, "sphere O: 4 faces", faces(ring), 4);
      check(near(volume(ring), column(6, R, R + 1) - column(3, R, R + 1), 1e-7), "sphere O: volume", volume(ring),
            column(6, R, R + 1) - column(3, R, R + 1));
    }
    // 4b. The Sphere primitive's own shape (a half disc turned about Z) with a circle
    // straight above it: the line through its centre lands on the pole.
    {
      BRepBuilderAPI_MakeWire half;
      half.Add(BRepBuilderAPI_MakeEdge(
                   gp_Circ(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, -1, 0), gp_Dir(0, 0, -1)), R), 0, M_PI)
                   .Edge());
      half.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, R), gp_Pnt(0, 0, -R)).Edge());
      const TopoDS_Face disk = BRepBuilderAPI_MakeFace(half.Wire(), true).Face();
      const int ball = f.store(BRepPrimAPI_MakeRevol(disk, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))).Shape());
      const int index = curvedFace(ball);
      check(index >= 0 && BRepAdaptor_Surface(TopoDS::Face(*f.find(f.subShape(ball, 0, index)))).GetType() ==
                              GeomAbs_Sphere,
            "revolved ball: its face is a sphere");
      // A circle of radius 3 in the plane z = 30.
      BRepBuilderAPI_MakeEdge edge(gp_Circ(gp_Ax2(gp_Pnt(0, 0, 30), gp_Dir(0, 0, 1)), 3));
      for (bool out : {true, false}) {
        const int top = f.store(BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(edge.Edge()).Wire(), true).Face());
        const int h = f.projectOnFace(top, ball, index, 1, out);
        solid(h, out ? "pole emboss: valid solid" : "pole deboss: valid solid");
        const double want = out ? column(3, R, R + 1) : column(3, R - 1, R);
        check(near(volume(h), want, 1e-7), "pole: volume", volume(h), want);
        check(faces(h) == 3, "pole: 3 faces", faces(h), 3);
      }
    }
    // 4c. A torus (major 15, tube 5) with a circle above its tube: the shell between
    // two tori on the same centre circle.
    {
      const int ring = f.store(BRepPrimAPI_MakeTorus(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 15, 5).Shape());
      BRepBuilderAPI_MakeEdge edge(gp_Circ(gp_Ax2(gp_Pnt(15, 0, 20), gp_Dir(0, 0, 1)), 2));
      for (bool out : {true, false}) {
        const int top = f.store(BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakeWire(edge.Edge()).Wire(), true).Face());
        const int h = f.projectOnFace(top, ring, 0, 0.5, out);
        solid(h, out ? "torus emboss: valid solid" : "torus deboss: valid solid");
        check(faces(h) == 3, "torus: 3 faces", faces(h), 3);
        // About the disc's area times the depth (the tube is nearly flat under it).
        const double v = volume(h);
        check(v > M_PI * 4 * 0.5 * 0.95 && v < M_PI * 4 * 0.5 * 1.1, "torus: volume near area x depth", v,
              M_PI * 4 * 0.5);
        bool ok = false;
        const double after = booleanVolume(ring, h, out, ok);
        check(ok && near(after, out ? volume(ring) + v : volume(ring) - v, 1e-7), "torus: the boolean adds up",
              after, out ? volume(ring) + v : volume(ring) - v);
      }
    }
    // 5. A square projected onto a lofted (B-spline) face.
    {
      const int body = loftBody();
      const int index = curvedFace(body);
      check(index >= 0, "loft: has a curved face", index, 0);
      const double side = 8;
      for (bool out : {true, false}) {
        const auto t0 = std::chrono::steady_clock::now();
        const int h = f.projectOnFace(squareY(-40, 0, 12, side), body, index, 1, out);
        std::printf("     loft projection: %.0f ms\n", ms(t0));
        solid(h, out ? "loft emboss: valid solid" : "loft deboss: valid solid");
        check(faces(h) == 6, "loft: 6 faces", faces(h), 6);
        // The column's walls are side x side across; along the normal it is 1 mm deep,
        // so along the ray at least 1 mm and at most 1 / cos of the face's slope there.
        const double v = volume(h);
        check(v > side * side * 1 * 0.9 && v < side * side * 1 * 1.3, "loft: volume between the bounds", v,
              side * side);
        bool ok = false;
        const double after = booleanVolume(body, h, out, ok);
        check(ok && near(after, out ? volume(body) + v : volume(body) - v, 1e-6), "loft: the boolean adds up", after,
              out ? volume(body) + v : volume(body) - v);
      }
      const int over = f.projectOnFace(squareY(-40, 0, 28, side), body, index, 1, true);
      check(over == 0, "loft: past the face's edge refused", over, 0);
      std::printf("     %s\n", f.lastError_.c_str());
    }
  } else {
    const int n = argc > 2 ? std::atoi(argv[2]) : 300;
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
    const double before = f.heapTop();
    for (int i = 0; i < 2000; ++i) f.makeBox(i, 0, 0, 1, 1, 1);
    check(f.heapTop() - before > 1e6, "leaks: control grows", (f.heapTop() - before) / 1e6, 1);
  }
  std::printf("%d failure(s)\n", failures);
  return failures == 0 ? 0 : 1;
}
