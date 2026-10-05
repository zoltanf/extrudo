// Native harness for P4-12 H3 (ADR-0067 §H3): how far off the mass
// properties of a body whose faces are B-splines are with the facade's plain
// two-argument BRepGProp calls, and what the eps forms cost -- and, for a
// prism wall, which of the two is better (the facade's `needsTolerance` picks
// per shape, on what this prints).
//
// The bodies are the kinds that were off (ADR-0060 §3: a wrap's B-spline
// walls, a loft) and the two the ADR asks a test for (a loft and a conic
// extrude), plus a B5-sized rounded box with holes for the timing. Each is
// measured four ways: the fixed-order Gauss form the facade uses today (no
// eps), the eps form at four tolerances, and a fine tessellation (the
// triangles BRepMesh makes, summed as tetrahedra round the origin), which is
// the reference; where there is an exact value it is printed too.
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepAlgoAPI_Cut.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_Parabola.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <chrono>
#include <cstdio>

static ExtrudoFacade f;

/** The facade's own volume call today (the fixed-order Gauss integral), mm³. */
static double plainVolume(int h) {
  GProp_GProps volume;
  BRepGProp::VolumeProperties(*f.find(h), volume);
  return volume.Mass();
}

/** The volume with the integrator's relative error bound, mm³. */
static double epsVolume(int h, double eps) {
  GProp_GProps volume;
  BRepGProp::VolumeProperties(*f.find(h), volume, eps, false);
  return volume.Mass();
}

/** The area of a face the way `describe` does it (no eps), mm². */
static double plainArea(const TopoDS_Shape& s) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(s, props);
  return props.Mass();
}

/** The area of a shape with a relative error bound, mm². */
static double epsArea(const TopoDS_Shape& s, double eps) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(s, props, eps, false);
  return props.Mass();
}

/** The volume of the shape's own triangulation: the reference for a curved body. */
static double meshVolume(int h, double deflection) {
  if (h <= 0) return 0;
  BRepMesh_IncrementalMesh mesh(*f.find(h), deflection, false, 0.5, false);
  double total = 0;
  for (TopExp_Explorer face(*f.find(h), TopAbs_FACE); face.More(); face.Next()) {
    // A reversed face's triangles are wound the other way round.
    const double sign = face.Current().Orientation() == TopAbs_REVERSED ? -1.0 : 1.0;
    TopLoc_Location loc;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(TopoDS::Face(face.Current()), loc);
    if (tri.IsNull()) {
      continue;
    }
    const gp_Trsf trsf = loc.Transformation();
    for (int i = 1; i <= tri->NbTriangles(); ++i) {
      int a, b, c;
      tri->Triangle(i).Get(a, b, c);
      const gp_Pnt p0 = tri->Node(a).Transformed(trsf);
      const gp_Pnt p1 = tri->Node(b).Transformed(trsf);
      const gp_Pnt p2 = tri->Node(c).Transformed(trsf);
      total += sign * gp_Vec(p0.XYZ()).Dot(gp_Vec(p1.XYZ()).Crossed(p2.XYZ())) / 6.0;
    }
  }
  return total;
}

/** The mean ms one call takes over `runs`. */
static double timeOf(int h, double eps, int runs) {
  const auto start = std::chrono::steady_clock::now();
  for (int i = 0; i < runs; ++i) {
    if (eps > 0) {
      (void)epsVolume(h, eps);
    } else {
      (void)plainVolume(h);
    }
  }
  const double total =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
  return total / runs;
}

static double rel(double got, double want) { return std::abs(got / want - 1); }

/** Which form the facade would pick for this shape (see `needsTolerance`). */
static bool facadeAdaptive(int h) { return ExtrudoFacade::needsTolerance(*f.find(h)); }

/** One row per integrator, against the fine tessellation and the exact value. */
static void report(const char* what, int h, double exact, double deflection) {
  if (h <= 0) {
    std::printf("%-28s nothing was built: %s\n", what, f.lastError_.c_str());
    return;
  }
  const double mesh = meshVolume(h, deflection);
  std::printf("%-28s %d faces, area %.4f mm2\n", what, f.count(h, 0), epsArea(*f.find(h), 1e-9));
  if (exact > 0) std::printf("%-28s   exact %.6f, mesh %.6f (%+.2e)\n", "", exact, mesh, rel(mesh, exact));
  std::printf("%-28s   no eps  %.6f (%+.2e)  %7.3f ms/call\n", "", plainVolume(h),
              rel(plainVolume(h), mesh), timeOf(h, 0, 10));
  for (double eps : {1e-5, 1e-7, 1e-9, 1e-12}) {
    const double got = epsVolume(h, eps);
    std::printf("%-28s   eps %-5.0e %.6f (%+.2e)  %7.3f ms/call\n", "", eps, got, rel(got, mesh),
                timeOf(h, eps, 10));
  }
  // What the facade returns: the form `needsTolerance` picks for this shape.
  const bool adaptive = facadeAdaptive(h);
  const double picked = adaptive ? epsVolume(h, ExtrudoFacade::MASS_EPS) : plainVolume(h);
  std::printf("%-28s   the facade picks the %s form: %.6f (%+.2e)\n", "", adaptive ? "eps" : "fixed",
              picked, rel(picked, mesh));
}

// The sketch plane of the wrap cases: x = 20, tangent to a cylinder of radius 20,
// s along +Y from (20, 0, 0) and z along +Z.
static const double R = 20;

static int circleFace(double s, double z, double r) {
  BRepBuilderAPI_MakeEdge edge(gp_Circ(gp_Ax2(gp_Pnt(20, s, z), gp_Dir(1, 0, 0)), r));
  BRepBuilderAPI_MakeFace face(BRepBuilderAPI_MakeWire(edge.Edge()).Wire(), true);
  return f.store(face.Face());
}

/** A glyph in the sketch plane: a closed B-spline loop (a letter's outline). */
static int glyphFace(double radius, double wave) {
  NCollection_Array1<gp_Pnt> points(1, 13);
  for (int i = 0; i < 13; ++i) {
    const double a = 2 * M_PI * i / 12;
    const double r = radius + wave * std::sin(3 * a);
    points.SetValue(i + 1, gp_Pnt(20, r * std::cos(a), 2 + r * std::sin(a)));
  }
  GeomAPI_PointsToBSpline spline(points, 3, 8, GeomAbs_C2, 1e-6);
  BRepBuilderAPI_MakeEdge edge(spline.Curve());
  BRepBuilderAPI_MakeWire wire(edge.Edge());
  BRepBuilderAPI_MakeFace face(wire.Wire(), true);
  return f.store(face.Face());
}

/** The exact volume of a region of `area` mm² wrapped on radius R with `depth`. */
static double wrapWant(double area, double depth, bool outward) {
  return area * depth * (outward ? (R + depth / 2) / R : (R - depth / 2) / R);
}

static int wrapFace(int face, double depth, bool outward) {
  return f.wrapOnCylinder(face, 0, 0, 0, 0, 0, 1, 1, 0, 0, R, 20, 0, 0, 0, 1, 0, depth, outward);
}

/** A loft between two circles: the side wall is a B-spline surface. */
static int loft(double r0, double r1, double height) {
  BRepOffsetAPI_ThruSections sections(true, false, 1e-6);
  for (int k = 0; k < 2; ++k) {
    Handle(Geom_Circle) curve =
        new Geom_Circle(gp_Ax2(gp_Pnt(0, 0, k == 0 ? 0 : height), gp_Dir(0, 0, 1)), k == 0 ? r0 : r1);
    sections.AddWire(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(curve).Edge()).Wire());
  }
  sections.Build();
  if (!sections.IsDone()) return 0;
  return f.store(sections.Shape());
}

/**
 * A conic profile extruded 5 mm (ADR-0063): the sketch's conic curve is a
 * non-rational cubic B-spline, so this is one B-spline edge in a planar face.
 * The parabola x = y²/(4a) between y = -2a and 2a encloses 8a²/3 of area
 * against its chord, so the prism's volume is that times the height.
 */
static int conicExtrude(double a, double height) {
  Handle(Geom_Parabola) curve = new Geom_Parabola(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), a);
  // OCCT parametrizes a parabola by its y coordinate: u = ±2a are the ends.
  const TopoDS_Edge arc = BRepBuilderAPI_MakeEdge(curve, -2 * a, 2 * a).Edge();
  TopoDS_Vertex first, last;
  TopExp::Vertices(arc, first, last);
  if (first.IsNull() || last.IsNull()) return 0;
  BRepBuilderAPI_MakeWire wire(arc);
  // Close it with the chord between the parabola's ends.
  wire.Add(BRepBuilderAPI_MakeEdge(BRep_Tool::Pnt(first), BRep_Tool::Pnt(last)).Edge());
  if (!wire.IsDone()) return 0;
  BRepBuilderAPI_MakeFace face(wire.Wire(), true);
  if (!face.IsDone()) return 0;
  BRepPrimAPI_MakePrism prism(face.Face(), gp_Vec(0, 0, height));
  if (!prism.IsDone()) return 0;
  return f.store(prism.Shape());
}

/**
 * A prism of a B-spline-bounded region standing away from the origin: the
 * case the text test found (its walls' volume contributions cancel, and the
 * integrator's own origin is the shape's barycentre).
 */
static int offsetPrism(double s, double depth, double* exact) {
  const int face = glyphFace(s, 0.8);
  *exact = epsArea(*f.find(face), 1e-9) * depth;
  // The sketch plane is x = 20, so a sketch's extrude runs along +x.
  BRepPrimAPI_MakePrism prism(*f.find(face), gp_Vec(depth, 0, 0));
  if (!prism.IsDone()) return 0;
  return f.store(prism.Shape());
}

/** A B5-sized body: an 80 x 60 x 40 box, four filleted corners, three holes. */
static int enclosure() {
  BRepBuilderAPI_MakePolygon poly;
  poly.Add(gp_Pnt(0, 0, 0));
  poly.Add(gp_Pnt(80, 0, 0));
  poly.Add(gp_Pnt(80, 60, 0));
  poly.Add(gp_Pnt(0, 60, 0));
  poly.Close();
  BRepPrimAPI_MakePrism prism(BRepBuilderAPI_MakeFace(poly.Wire(), true).Face(), gp_Vec(0, 0, 40));
  TopoDS_Shape box = prism.Shape();
  BRepFilletAPI_MakeFillet fillet(box);
  for (TopExp_Explorer it(box, TopAbs_EDGE); it.More(); it.Next()) {
    const TopoDS_Edge e = TopoDS::Edge(it.Current());
    if (BRep_Tool::Degenerated(e)) continue;
    TopoDS_Vertex a, b;
    TopExp::Vertices(e, a, b);
    if (a.IsNull() || b.IsNull()) continue;
    if (std::abs(BRep_Tool::Pnt(a).Z() - 40) < 1e-9 && std::abs(BRep_Tool::Pnt(b).Z() - 40) < 1e-9) {
      fillet.Add(5.0, e);
    }
  }
  fillet.Build();
  if (fillet.IsDone()) box = fillet.Shape();
  for (double x : {20.0, 40.0, 60.0}) {
    BRepBuilderAPI_MakeEdge rim(gp_Circ(gp_Ax2(gp_Pnt(x, 30, -5), gp_Dir(0, 0, 1)), 3.0));
    BRepBuilderAPI_MakeFace round(BRepBuilderAPI_MakeWire(rim.Edge()).Wire(), true);
    BRepPrimAPI_MakePrism drill(round.Face(), gp_Vec(0, 0, 50));
    BRepAlgoAPI_Cut cut(box, drill.Shape());
    if (cut.IsDone()) box = cut.Shape();
  }
  return f.store(box);
}

/** Runs one case; an OCCT exception is printed instead of killing the run. */
static void caseOf(const char* what, void (*body)()) {
  try {
    body();
  } catch (const Standard_Failure& e) {
    std::printf("%-28s threw: %s\n", what, e.what());
  } catch (...) {
    std::printf("%-28s threw\n", what);
  }
}

static void box() {
  BRepBuilderAPI_MakePolygon poly;
  poly.Add(gp_Pnt(0, 0, 0));
  poly.Add(gp_Pnt(10, 0, 0));
  poly.Add(gp_Pnt(10, 20, 0));
  poly.Add(gp_Pnt(0, 20, 0));
  poly.Close();
  BRepPrimAPI_MakePrism prism(BRepBuilderAPI_MakeFace(poly.Wire(), true).Face(), gp_Vec(0, 0, 30));
  const int shape = f.store(prism.Shape());
  std::printf("%-28s mesh %.6f, plain %.6f, eps 1e-7 %.6f (exact 6000)\n", "sanity: a 10x20x30 box",
              meshVolume(shape, 0.001), plainVolume(shape), epsVolume(shape, 1e-7));
  f.releaseAll();
}

static void wrapOut() {
  const int face = circleFace(0, 2, 3);
  report("wrap of a circle, 1 out", wrapFace(face, 1.0, true), wrapWant(M_PI * 9, 1.0, true), 0.001);
  f.releaseAll();
}

static void wrapIn() {
  const int face = circleFace(0, 2, 3);
  report("wrap of a circle, 1 in", wrapFace(face, 1.0, false), wrapWant(M_PI * 9, 1.0, false), 0.001);
  f.releaseAll();
}

static void wrapGlyph() {
  const int face = glyphFace(4, 0.8);
  // The glyph's area the way the profile detector computes it (no eps).
  const double area = plainArea(*f.find(face));
  report("wrap of a B-spline glyph", wrapFace(face, 0.5, true), wrapWant(area, 0.5, true), 0.001);
  f.releaseAll();
}

static void loftCase() {
  report("loft between two circles", loft(20, 12, 40),
         M_PI * 40.0 / 3.0 * (20.0 * 20.0 + 20.0 * 12.0 + 12.0 * 12.0), 0.005);
  f.releaseAll();
}

static void conicCase() {
  report("conic parabola extruded", conicExtrude(10, 5), 8.0 * 100.0 / 3.0 * 5.0, 0.001);
  f.releaseAll();
}

static void offsetCase() {
  for (double s : {0.0, 9.0, 40.0}) {
    double exact = 0;
    const int shape = offsetPrism(s, 2, &exact);
    if (shape <= 0) {
      std::printf("\nprism at s=%.0f: nothing was built\n", s);
      continue;
    }
    // Two references: the profile's area times the distance, and a fine mesh.
    const double mesh = meshVolume(shape, 0.0005);
    std::printf("\nprism of a B-spline region at s=%.0f: %d faces, area x depth %.6f, mesh %.6f\n", s,
                f.count(shape, 0), exact, mesh);
    std::printf("  no eps  %12.6f  (%+.2e vs mesh, %+.2e vs area)\n", plainVolume(shape),
                std::abs(plainVolume(shape) / mesh - 1), std::abs(plainVolume(shape) / exact - 1));
    for (double eps : {1e-5, 1e-7, 1e-9, 1e-11, 1e-13}) {
      const double got = epsVolume(shape, eps);
      std::printf("  eps %-5.0e%12.6f  (%+.2e vs mesh, %+.2e vs area)\n", eps, got,
                  std::abs(got / mesh - 1), std::abs(got / exact - 1));
    }
    const bool adaptive = facadeAdaptive(shape);
    std::printf("  the facade picks the %s form: %12.6f  (%+.2e vs area)\n", adaptive ? "eps" : "fixed",
                adaptive ? epsVolume(shape, ExtrudoFacade::MASS_EPS) : plainVolume(shape),
                std::abs((adaptive ? epsVolume(shape, ExtrudoFacade::MASS_EPS) : plainVolume(shape)) /
                             exact - 1));
    f.releaseAll();
  }
}

static void enclosureCase() {
  const int shape = enclosure();
  if (shape <= 0) {
    std::printf("\nenclosure: nothing was built: %s\n", f.lastError_.c_str());
    return;
  }
  const double mesh = meshVolume(shape, 0.01);
  std::printf("\nenclosure: %d faces, mesh volume %.6f (the reference has the mesh's own error)\n",
              f.count(shape, 0), mesh);
  std::printf("enclosure: no eps %.6f (%+.2e), eps 1e-7 %.6f (%+.2e)\n", plainVolume(shape),
              rel(plainVolume(shape), mesh), epsVolume(shape, 1e-7), rel(epsVolume(shape, 1e-7), mesh));
  std::printf("enclosure: no eps %.3f ms/call, eps 1e-5 %.3f, eps 1e-7 %.3f, eps 1e-9 %.3f, eps 1e-12 %.3f\n",
              timeOf(shape, 0, 20), timeOf(shape, 1e-5, 20), timeOf(shape, 1e-7, 20),
              timeOf(shape, 1e-9, 20), timeOf(shape, 1e-12, 20));
  f.releaseAll();
}

int main() {
  std::printf("=== BRepGProp volume: the plain form against the eps forms ===\n\n");
  caseOf("sanity", box);
  caseOf("wrap out", wrapOut);
  caseOf("wrap in", wrapIn);
  caseOf("wrap glyph", wrapGlyph);
  caseOf("loft", loftCase);
  caseOf("conic", conicCase);
  caseOf("offset prisms", offsetCase);
  caseOf("enclosure", enclosureCase);
  return 0;
}
