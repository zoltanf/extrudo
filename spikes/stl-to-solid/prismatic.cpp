// Mesh to Solid, prismatic (ADR-0097 §3, slices 3, 4a1 and 4a2): the facade's own
// meshToSolid(1, tolerance) on the test matrix of the slice, natively in the
// pinned OCCT image; case r runs meshRegions (the region preview, slice 4).
// run.sh copies the facade with its private members made
// public into build/facade_public.cpp, which this file includes.
#include "facade_public.cpp"  // in build/ (or BUILD), on the include path

#include <BRepAlgoAPI_Cut.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <Interface_Static.hxx>
#include <NCollection_DataMap.hxx>
#include <STEPControl_Controller.hxx>
#include <RWStl.hxx>
#include <StlAPI_Writer.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <ShapeAnalysis_Wire.hxx>
#include <ShapeExtend_WireData.hxx>
#include <BRepCheck_Wire.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <IntRes2d_IntersectionPoint.hxx>
#include <ShapeFix_ShapeTolerance.hxx>
#include <ShapeFix_Face.hxx>
#include <ShapeFix_Shell.hxx>
#include <ShapeFix_Wire.hxx>
#include <ShapeProcess.hxx>
#include <ShapeAnalysis_Curve.hxx>
#include <BRepAdaptor_Curve2d.hxx>
#include <unordered_map>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <Geom_ElementarySurface.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <functional>
#include <chrono>
#include <array>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <set>
#include <iomanip>
#include <iostream>
#include <map>

static double now() {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

struct Mesh {
  std::vector<double> nodes;
  std::vector<uint32_t> triangles;
};

/** An OCCT shape meshed, written as binary STL and read back welded (as an import would be). */
static Mesh meshOf(const TopoDS_Shape& shape, double deflection, double angle) {
  BRepMesh_IncrementalMesh(shape, deflection, false, angle);
  StlAPI_Writer writer;
  writer.ASCIIMode() = false;
  writer.Write(shape, "/tmp/prismatic.stl");
  Handle(Poly_Triangulation) tri = RWStl::ReadFile("/tmp/prismatic.stl");
  Mesh m;
  for (int i = 1; i <= tri->NbNodes(); ++i) {
    const gp_Pnt p = tri->Node(i);
    m.nodes.insert(m.nodes.end(), {p.X(), p.Y(), p.Z()});
  }
  for (int i = 1; i <= tri->NbTriangles(); ++i) {
    int a, b, c;
    tri->Triangle(i).Get(a, b, c);
    m.triangles.insert(m.triangles.end(), {uint32_t(a - 1), uint32_t(b - 1), uint32_t(c - 1)});
  }
  return m;
}

static Mesh stlFile(const char* path) {
  const std::string name(path);
  if (name.size() > 5 && name.compare(name.size() - 5, 5, ".mesh") == 0) {
    // A mesh as Kernel.meshFrom keeps it (manifold's order): uint32 nodes, uint32 triangles, float32 xyz, uint32 corners.
    std::ifstream in(path, std::ios::binary);
    uint32_t counts[2] = {0, 0};
    in.read(reinterpret_cast<char*>(counts), 8);
    std::vector<float> xyz(3 * size_t(counts[0]));
    in.read(reinterpret_cast<char*>(xyz.data()), std::streamsize(xyz.size() * 4));
    Mesh m;
    m.nodes.assign(xyz.begin(), xyz.end());
    m.triangles.resize(3 * size_t(counts[1]));
    in.read(reinterpret_cast<char*>(m.triangles.data()), std::streamsize(m.triangles.size() * 4));
    return m;
  }
  Handle(Poly_Triangulation) tri = RWStl::ReadFile(path);
  Mesh m;
  for (int i = 1; i <= tri->NbNodes(); ++i) {
    const gp_Pnt p = tri->Node(i);
    m.nodes.insert(m.nodes.end(), {p.X(), p.Y(), p.Z()});
  }
  for (int i = 1; i <= tri->NbTriangles(); ++i) {
    int a, b, c;
    tri->Triangle(i).Get(a, b, c);
    m.triangles.insert(m.triangles.end(), {uint32_t(a - 1), uint32_t(b - 1), uint32_t(c - 1)});
  }
  return m;
}

/** A cylinder like manifold's: two rings, caps triangulated from their boundary only. `noise(ring, i)` moves a node radially. */
static Mesh cylinder(double r, double h, int segments, double (*noise)(int, int) = nullptr) {
  Mesh m;
  for (int ring = 0; ring < 2; ++ring) {
    for (int i = 0; i < segments; ++i) {
      const double a = 2 * M_PI * i / segments, rr = r + (noise ? noise(ring, i) : 0);
      m.nodes.insert(m.nodes.end(), {rr * std::cos(a), rr * std::sin(a), ring * h});
    }
  }
  auto bottom = [&](int i) { return uint32_t(i % segments); };
  auto top = [&](int i) { return uint32_t(segments + i % segments); };
  for (int i = 0; i < segments; ++i) {
    m.triangles.insert(m.triangles.end(), {bottom(i), bottom(i + 1), top(i + 1)});
    m.triangles.insert(m.triangles.end(), {bottom(i), top(i + 1), top(i)});
  }
  for (int i = 1; i + 1 < segments; ++i) {
    m.triangles.insert(m.triangles.end(), {bottom(0), bottom(i + 1), bottom(i)});
    m.triangles.insert(m.triangles.end(), {top(0), top(i), top(i + 1)});
  }
  return m;
}

/** A UV sphere with `rings` x `segments` quads. */
static Mesh sphere(double r, int rings, int segments) {
  Mesh m;
  m.nodes.insert(m.nodes.end(), {0, 0, -r});
  for (int j = 1; j < rings; ++j) {
    const double phi = -M_PI / 2 + M_PI * j / rings;
    for (int i = 0; i < segments; ++i) {
      const double a = 2 * M_PI * i / segments;
      m.nodes.insert(m.nodes.end(), {r * std::cos(phi) * std::cos(a), r * std::cos(phi) * std::sin(a), r * std::sin(phi)});
    }
  }
  m.nodes.insert(m.nodes.end(), {0, 0, r});
  const uint32_t northPole = uint32_t(m.nodes.size() / 3 - 1);
  auto at = [&](int j, int i) { return uint32_t(1 + (j - 1) * segments + i % segments); };
  for (int i = 0; i < segments; ++i) m.triangles.insert(m.triangles.end(), {0, at(1, i + 1), at(1, i)});
  for (int j = 1; j + 1 < rings; ++j) {
    for (int i = 0; i < segments; ++i) {
      m.triangles.insert(m.triangles.end(), {at(j, i), at(j, i + 1), at(j + 1, i + 1)});
      m.triangles.insert(m.triangles.end(), {at(j, i), at(j + 1, i + 1), at(j + 1, i)});
    }
  }
  for (int i = 0; i < segments; ++i) m.triangles.insert(m.triangles.end(), {at(rings - 1, i), at(rings - 1, i + 1), northPole});
  return m;
}

static std::string kinds(const TopoDS_Shape& s) {
  std::map<int, int> k;
  for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) k[BRepAdaptor_Surface(TopoDS::Face(e.Current())).GetType()]++;
  std::string out;
  for (auto& [t, n] : k)
    out += " " + std::to_string(n) +
           (t == GeomAbs_Plane      ? " plane"
            : t == GeomAbs_Cylinder ? " cyl"
            : t == GeomAbs_Cone     ? " cone"
            : t == GeomAbs_Sphere   ? " sphere"
            : t == GeomAbs_Torus    ? " torus"
                                    : " other");
  return out;
}

static int failures = 0;

/** Case g diagnostics (FACETED_DEBUG): degenerate/duplicate triangles, coincident nodes, open and non-manifold edges. */
static void analyzeMesh(const Mesh& m) {
  const int n = int(m.nodes.size() / 3), t = int(m.triangles.size() / 3);
  auto P = [&](uint32_t i) { return std::array<double, 3>{m.nodes[3 * i], m.nodes[3 * i + 1], m.nodes[3 * i + 2]}; };
  int degenerate = 0, duplicate = 0;
  std::map<std::pair<uint32_t, uint32_t>, int> edges;
  std::map<std::array<uint32_t, 3>, int> tris;
  for (int i = 0; i < t; ++i) {
    uint32_t a = m.triangles[3 * i], b = m.triangles[3 * i + 1], c = m.triangles[3 * i + 2];
    auto A = P(a), B = P(b), C = P(c);
    double ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    double vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (a == b || b == c || a == c || std::sqrt(nx * nx + ny * ny + nz * nz) * 0.5 <= 1e-12) ++degenerate;
    const uint32_t lo = std::min({a, b, c}), hi = std::max({a, b, c});
    std::array<uint32_t, 3> key{lo, a + b + c - lo - hi, hi};
    if (++tris[key] > 1) ++duplicate;
    for (auto e : {std::pair<uint32_t, uint32_t>{a, b}, {b, c}, {c, a}}) edges[{std::min(e.first, e.second), std::max(e.first, e.second)}]++;
  }
  int edges1 = 0, nonManifold = 0;
  for (auto& [e, count] : edges) {
    if (count == 1) ++edges1;
    if (count > 2) ++nonManifold;
  }
  int coincidentNodes = 0;
  std::map<std::array<long long, 3>, int> grid;
  for (int i = 0; i < n; ++i) {
    auto p = P(uint32_t(i));
    std::array<long long, 3> k{llround(p[0] * 1e6), llround(p[1] * 1e6), llround(p[2] * 1e6)};
    if (++grid[k] > 1) ++coincidentNodes;
  }
  std::cout << "   mesh: nodes " << n << ", triangles " << t << ", degenerate " << degenerate << ", duplicate " << duplicate
            << ", coincident nodes " << coincidentNodes << ", edges used once " << edges1 << ", >2 " << nonManifold << "\n";
}

/** Case g: runs faceted (meshToSolid(0)) on a file staged through stlFile(); prints the time, the report and, on refusal, the error. */
static int runFaceted(ExtrudoFacade& f, const char* name, const Mesh& m, double tolerance) {
  const char* flag = std::getenv("FACETED_DEBUG");
  if (flag != nullptr && *flag != '\0') analyzeMesh(m);
  const double t0 = now();
  f.meshNodes(int(m.nodes.size() / 3));
  // Float32, as Kernel.meshFrom keeps a mesh body's nodes (and STL stores them).
  double* nodes = reinterpret_cast<double*>(f.meshNodesPtr());
  for (size_t i = 0; i < m.nodes.size(); ++i) nodes[i] = static_cast<float>(m.nodes[i]);
  f.meshTriangles(int(m.triangles.size() / 3));
  std::memcpy(reinterpret_cast<void*>(f.meshTrianglesPtr()), m.triangles.data(), m.triangles.size() * sizeof(uint32_t));
  const int h = f.meshToSolid(0, tolerance);
  const double ms = now() - t0;
  std::cout << "== faceted " << name << " (" << m.triangles.size() / 3 << " triangles, tol " << tolerance << "): " << ms << " ms\n";
  const auto& r = f.meshReport_;
  if (r.size() >= 10) std::cout << "   report: faces " << r[0] << ", planes " << r[1] << "\n";
  if (!h) {
    std::cout << "   refused: " << f.lastError() << "\n";
    return 0;
  }
  const TopoDS_Shape& s = *f.find(h);
  std::cout << "   faces " << f.count(h, 0) << ":" << kinds(s) << ", valid " << BRepCheck_Analyzer(s).IsValid()
            << ", volume " << ExtrudoFacade::volumeOf(s) << "\n";
  return h;
}

/** Runs prismatic on `m`; prints the result; returns the handle (0 on refusal). */
static int run(ExtrudoFacade& f, const char* name, const Mesh& m, double tolerance, double expectVolume = 0) {
  const double t0 = now();
  f.meshNodes(int(m.nodes.size() / 3));
  // Float32, as Kernel.meshFrom keeps a mesh body's nodes (and STL stores them).
  double* nodes = reinterpret_cast<double*>(f.meshNodesPtr());
  for (size_t i = 0; i < m.nodes.size(); ++i) nodes[i] = static_cast<float>(m.nodes[i]);
  f.meshTriangles(int(m.triangles.size() / 3));
  std::memcpy(reinterpret_cast<void*>(f.meshTrianglesPtr()), m.triangles.data(), m.triangles.size() * sizeof(uint32_t));
  const int h = f.meshToSolid(1, tolerance);
  const double ms = now() - t0;
  std::cout << "== " << name << " (" << m.triangles.size() / 3 << " triangles, tol " << tolerance << "): " << ms << " ms\n";
  const auto& r = f.meshReport_;
  if (r.size() >= 10) {
    std::cout << "   report: faces " << r[0] << ", planes " << r[1] << ", cylinders " << r[2] << ", cones " << r[3] << ", spheres " << r[4]
              << ", tori " << r[5] << ", unfit " << r[6] << " regions / "
              << r[7] << " triangles / " << r[8] << ", suggested " << r[9];
    if (r.size() >= 12) std::cout << ", rebuild " << (r[10] == 1 ? "hybrid" : r[10] == 0 ? "exact" : "-") << ", facets " << r[11];
    std::cout << "\n";
  }
  if (getenv("FACES") && *getenv("FACES"))
    for (const auto& line : f.hybridFaces_) std::cout << "   hybrid " << line << "\n";
  if (!h) {
    std::cout << "   refused: " << f.lastError() << "\n";
    return 0;
  }
  const TopoDS_Shape& s = *f.find(h);
  const double v = ExtrudoFacade::volumeOf(s);
  std::cout << "   faces " << f.count(h, 0) << ":" << kinds(s) << ", valid " << BRepCheck_Analyzer(s).IsValid() << ", volume " << v;
  if (expectVolume > 0) std::cout << " (expect " << expectVolume << ", " << 100 * (v - expectVolume) / expectVolume << " %)";
  std::cout << "\n";
  for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) {
    BRepAdaptor_Surface a(TopoDS::Face(e.Current()));
    if (a.GetType() == GeomAbs_Cylinder) std::cout << "   cylinder radius " << std::setprecision(12) << a.Cylinder().Radius() << std::setprecision(6) << "\n";
    if (a.GetType() == GeomAbs_Sphere)
      std::cout << "   sphere radius " << std::setprecision(12) << a.Sphere().Radius() << " at " << a.Sphere().Location().X() << ","
                << a.Sphere().Location().Y() << "," << a.Sphere().Location().Z() << std::setprecision(6) << "\n";
    if (a.GetType() == GeomAbs_Cone)
      std::cout << "   cone semi-angle " << std::setprecision(12) << a.Cone().SemiAngle() * 180 / M_PI << " deg, apex " << a.Cone().Apex().X()
                << "," << a.Cone().Apex().Y() << "," << a.Cone().Apex().Z() << std::setprecision(6) << "\n";
    if (a.GetType() == GeomAbs_Torus) {
      const gp_Torus t = a.Torus();
      std::cout << "   torus R " << std::setprecision(12) << t.MajorRadius() << " r " << t.MinorRadius() << " at " << t.Location().X() << ","
                << t.Location().Y() << "," << t.Location().Z() << " axis " << t.Axis().Direction().X() << "," << t.Axis().Direction().Y()
                << "," << t.Axis().Direction().Z() << std::setprecision(6) << "\n";
    }
    if (getenv("FACES") && *getenv("FACES")) {
      GProp_GProps g;
      BRepGProp::SurfaceProperties(e.Current(), g);
      std::cout << "     face type " << a.GetType() << " area " << std::setprecision(10) << g.Mass() << std::setprecision(6);
      if (a.GetType() == GeomAbs_Plane) { gp_Pln pl = a.Plane(); std::cout << " n " << pl.Axis().Direction().X() << "," << pl.Axis().Direction().Y() << "," << pl.Axis().Direction().Z() << " d " << std::setprecision(12) << pl.Location().XYZ().Dot(pl.Axis().Direction().XYZ()) << std::setprecision(6); }
      if (a.GetType() == GeomAbs_Cylinder) { gp_Cylinder c = a.Cylinder(); std::cout << std::setprecision(12) << " axis " << c.Axis().Direction().X() << "," << c.Axis().Direction().Y() << "," << c.Axis().Direction().Z() << " at " << c.Location().X() << "," << c.Location().Y() << "," << c.Location().Z() << std::setprecision(6); }
      std::cout << "\n";
    }
  }
  return h;
}

// ------------------------------------------ STEP round trip diagnosis (s/S) --
// ADR-0097's D7 amendment: a converted body is written to STEP and read back.
// Cases s (one FILE) and S (every file) measure why the read-back misses the
// bar: where the tolerances sit, what BRepCheck rejects, where the volume goes
// and whether a ShapeFix_Shape pass at the written tolerances repairs it.

/** The name of a BRepCheck_Status, for the dump (ADR-0097 D7 diagnosis). */
static const char* statusName(BRepCheck_Status st) {
  switch (st) {
    case BRepCheck_NoError: return "NoError";
    case BRepCheck_InvalidPointOnCurve: return "InvalidPointOnCurve";
    case BRepCheck_InvalidPointOnCurveOnSurface: return "InvalidPointOnCurveOnSurface";
    case BRepCheck_InvalidPointOnSurface: return "InvalidPointOnSurface";
    case BRepCheck_No3DCurve: return "No3DCurve";
    case BRepCheck_Multiple3DCurve: return "Multiple3DCurve";
    case BRepCheck_Invalid3DCurve: return "Invalid3DCurve";
    case BRepCheck_NoCurveOnSurface: return "NoCurveOnSurface";
    case BRepCheck_InvalidCurveOnSurface: return "InvalidCurveOnSurface";
    case BRepCheck_InvalidCurveOnClosedSurface: return "InvalidCurveOnClosedSurface";
    case BRepCheck_InvalidSameRangeFlag: return "InvalidSameRangeFlag";
    case BRepCheck_InvalidSameParameterFlag: return "InvalidSameParameterFlag";
    case BRepCheck_InvalidDegeneratedFlag: return "InvalidDegeneratedFlag";
    case BRepCheck_FreeEdge: return "FreeEdge";
    case BRepCheck_InvalidMultiConnexity: return "InvalidMultiConnexity";
    case BRepCheck_InvalidRange: return "InvalidRange";
    case BRepCheck_EmptyWire: return "EmptyWire";
    case BRepCheck_RedundantEdge: return "RedundantEdge";
    case BRepCheck_SelfIntersectingWire: return "SelfIntersectingWire";
    case BRepCheck_NoSurface: return "NoSurface";
    case BRepCheck_InvalidWire: return "InvalidWire";
    case BRepCheck_RedundantWire: return "RedundantWire";
    case BRepCheck_IntersectingWires: return "IntersectingWires";
    case BRepCheck_InvalidImbricationOfWires: return "InvalidImbricationOfWires";
    case BRepCheck_EmptyShell: return "EmptyShell";
    case BRepCheck_RedundantFace: return "RedundantFace";
    case BRepCheck_InvalidImbricationOfShells: return "InvalidImbricationOfShells";
    case BRepCheck_UnorientableShape: return "UnorientableShape";
    case BRepCheck_NotClosed: return "NotClosed";
    case BRepCheck_NotConnected: return "NotConnected";
    case BRepCheck_SubshapeNotInShape: return "SubshapeNotInShape";
    case BRepCheck_BadOrientation: return "BadOrientation";
    case BRepCheck_BadOrientationOfSubshape: return "BadOrientationOfSubshape";
    case BRepCheck_InvalidPolygonOnTriangulation: return "InvalidPolygonOnTriangulation";
    case BRepCheck_InvalidToleranceValue: return "InvalidToleranceValue";
    case BRepCheck_EnclosedRegion: return "EnclosedRegion";
    case BRepCheck_CheckFail: return "CheckFail";
  }
  return "Unknown";
}

/** An edge's curve kind, or "degenerate" (ADR-0097 D7 diagnosis). */
static std::string curveKind(const TopoDS_Edge& edge) {
  if (BRep_Tool::Degenerated(edge)) return "degenerate";
  switch (BRepAdaptor_Curve(edge).GetType()) {
    case GeomAbs_Line: return "line";
    case GeomAbs_Circle: return "circle";
    case GeomAbs_Ellipse: return "ellipse";
    case GeomAbs_BSplineCurve: return "bspline";
    default: return "other";
  }
}

/** A face's kind: "facet" for a 3-edge plane (a hybrid facet), else its surface kind. */
static std::string faceKind(const TopoDS_Face& face) {
  const BRepAdaptor_Surface surface(face);
  if (surface.GetType() == GeomAbs_Plane) {
    int edges = 0;
    for (TopExp_Explorer e(face, TopAbs_EDGE); e.More(); e.Next()) ++edges;
    return edges == 3 ? "facet" : "plane";
  }
  switch (surface.GetType()) {
    case GeomAbs_Cylinder: return "cylinder";
    case GeomAbs_Cone: return "cone";
    case GeomAbs_Sphere: return "sphere";
    case GeomAbs_Torus: return "torus";
    default: return "other";
  }
}

/** The GeomAbs_SurfaceType's name, for Q14 (the faces my classifier calls "other"). */
static const char* surfaceTypeName(GeomAbs_SurfaceType type) {
  switch (type) {
    case GeomAbs_Plane: return "Plane";
    case GeomAbs_Cylinder: return "Cylinder";
    case GeomAbs_Cone: return "Cone";
    case GeomAbs_Sphere: return "Sphere";
    case GeomAbs_Torus: return "Torus";
    case GeomAbs_BezierSurface: return "BezierSurface";
    case GeomAbs_BSplineSurface: return "BSplineSurface";
    case GeomAbs_SurfaceOfRevolution: return "SurfaceOfRevolution";
    case GeomAbs_SurfaceOfExtrusion: return "SurfaceOfExtrusion";
    case GeomAbs_OffsetSurface: return "OffsetSurface";
    case GeomAbs_OtherSurface: return "OtherSurface";
  }
  return "Unknown";
}

/** The bucket an edge tolerance falls in: ≤0.002, ≤0.01, ≤0.05, ≤0.1, ≤0.5, ≤1, >1 mm. */
static int bucketIndex(double tol) {
  if (tol <= 0.002) return 0;
  if (tol <= 0.01) return 1;
  if (tol <= 0.05) return 2;
  if (tol <= 0.1) return 3;
  if (tol <= 0.5) return 4;
  if (tol <= 1.0) return 5;
  return 6;
}

static const char* const BUCKET_NAMES[7] = {"<=0.002", "<=0.01", "<=0.05", "<=0.1", "<=0.5", "<=1", ">1"};

struct ClassStat {
  int count = 0;
  int invalid = 0;
  int buckets[7] = {0, 0, 0, 0, 0, 0, 0};
  double maxTol = 0;
};

/**
 * Every edge of `shape` by class `<curve> <A>|<B>` (A ≤ B, the two faces around
 * it), with the tolerance buckets and the max (ADR-0097 D7 diagnosis). Also
 * returns the max vertex tolerance.
 */
static std::map<std::string, ClassStat> edgeClasses(const TopoDS_Shape& shape, double& maxVertex) {
  std::map<std::string, ClassStat> out;
  maxVertex = 0;
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices;
  TopExp::MapShapes(shape, TopAbs_VERTEX, vertices);
  for (int i = 1; i <= vertices.Extent(); ++i)
    maxVertex = std::max(maxVertex, BRep_Tool::Tolerance(TopoDS::Vertex(vertices(i))));
  NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
  TopExp::MapShapesAndUniqueAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  BRepCheck_Analyzer analyzer(shape);
  for (int i = 1; i <= edgeFaces.Extent(); ++i) {
    const TopoDS_Edge edge = TopoDS::Edge(edgeFaces.FindKey(i));
    std::vector<std::string> faces;
    for (const TopoDS_Shape& face : edgeFaces(i)) faces.push_back(faceKind(TopoDS::Face(face)));
    std::string a = "none", b = "none";
    if (faces.size() == 1) a = b = faces[0];
    else if (faces.size() >= 2) { a = faces[0]; b = faces[1]; if (b < a) std::swap(a, b); }
    ClassStat& stat = out[curveKind(edge) + " " + a + "|" + b];
    ++stat.count;
    const double tol = BRep_Tool::Tolerance(edge);
    ++stat.buckets[bucketIndex(tol)];
    stat.maxTol = std::max(stat.maxTol, tol);
    if (!analyzer.IsValid(edge)) ++stat.invalid;
  }
  return out;
}

/** The read-back faces that BRepCheck rejects, by kind (ADR-0097 D7 diagnosis). */
static std::map<std::string, int> invalidFacesByKind(const TopoDS_Shape& shape, int& invalid) {
  std::map<std::string, int> out;
  invalid = 0;
  for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next()) {
    if (BRepCheck_Analyzer(e.Current()).IsValid()) continue;
    ++invalid;
    ++out[faceKind(TopoDS::Face(e.Current()))];
  }
  return out;
}

/** Summed face area and count per face kind, for the volume-drift question. */
static std::map<std::string, std::pair<double, int>> areaByKind(const TopoDS_Shape& shape) {
  std::map<std::string, std::pair<double, int>> out;
  for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next()) {
    GProp_GProps props;
    BRepGProp::SurfaceProperties(e.Current(), props);
    auto& entry = out[faceKind(TopoDS::Face(e.Current()))];
    entry.first += props.Mass();
    entry.second += 1;
  }
  return out;
}

/** BRepCheck's non-NoError statuses on `shape`, per sub-shape kind, own and in context, by name. */
static std::map<std::string, int> bRepCheckCounts(const TopoDS_Shape& shape) {
  std::map<std::string, int> counts;
  BRepCheck_Analyzer analyzer(shape);
  const std::pair<TopAbs_ShapeEnum, const char*> types[] = {{TopAbs_VERTEX, "vertex"}, {TopAbs_EDGE, "edge"},
                                                            {TopAbs_WIRE, "wire"},   {TopAbs_FACE, "face"},
                                                            {TopAbs_SHELL, "shell"}, {TopAbs_SOLID, "solid"}};
  for (const auto& [type, name] : types) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> shapes;
    TopExp::MapShapes(shape, type, shapes);
    for (int i = 1; i <= shapes.Extent(); ++i) {
      Handle(BRepCheck_Result) result = analyzer.Result(shapes(i));
      if (result.IsNull()) continue;
      for (BRepCheck_Status st : result->Status())
        if (st != BRepCheck_NoError) counts[std::string(name) + " " + statusName(st)]++;
      for (result->InitContextIterator(); result->MoreShapeInContext(); result->NextShapeInContext())
        for (BRepCheck_Status st : result->StatusOnShape())
          if (st != BRepCheck_NoError) counts[std::string(name) + " in context " + statusName(st)]++;
    }
  }
  return counts;
}

/** The STEP reader/writer settings in force (ADR-0097 D7 diagnosis, once per run). */
static void printStepSettings() {
  // The Interface_Static parameters only exist once STEPControl_Controller::Init()
  // has run (a STEPControl_Writer/Reader constructor does it); without it every
  // value reads back as 0 (ADR-0097 2026-10-30b).
  STEPControl_Controller::Init();
  std::cout << "   step settings: write.precision.mode " << Interface_Static::IVal("write.precision.mode")
            << ", write.precision.val " << Interface_Static::RVal("write.precision.val") << ", write.surfacecurve.mode "
            << Interface_Static::IVal("write.surfacecurve.mode") << ", read.precision.mode "
            << Interface_Static::IVal("read.precision.mode") << ", read.precision.val "
            << Interface_Static::RVal("read.precision.val") << ", read.surfacecurve.mode "
            << Interface_Static::IVal("read.surfacecurve.mode") << ", read.stdsameparameter.mode "
            << Interface_Static::IVal("read.stdsameparameter.mode") << std::endl;
}

/** One file's summary row for the s/S table (ADR-0097 D7 diagnosis). */
struct RoundTripRow {
  std::string file;
  std::string rebuild = "refused";
  double tol = 0;
  int faces = 0, facets = 0;
  double maxEdge = 0, maxVertex = 0;
  bool backValid = false;
  int backFaces = 0, backSolids = 0;
  double ratio = 0;
  int backInvalidEdges = 0, backInvalidFaces = 0;
  std::string topStatus = "-";
  bool fixValid = false;
  int fixFaces = 0;
  int fixSolidCount = 0;
  double fixRatio = 0;
  // Q7: the same round trip with write.precision.mode = Greatest, and the
  // global uncertainty the file carries.
  bool u2Valid = false;
  int u2Faces = 0, u2Solids = 0;
  double u2Ratio = 0;
  double uncertainty = -1;
  double ms = 0;  // the conversion's own time (meshToSolid)
  // Q9: the BREP round trip (keeps tolerances and pcurves).
  bool brepValid = false;
  int brepFaces = 0, brepSolids = 0;
  double brepRatio = 0;
  // Q10: heal a copy, then the STEP round trip of the healed body.
  bool healedValid = false;
  int healedFaces = 0;
  bool healedRtValid = false;
  int healedRtFaces = 0, healedRtSolids = 0;
  double healedRtRatio = 0;
  // Q11: no pcurves written, and prefer 2D on read.
  bool nopcValid = false;
  int nopcFaces = 0, nopcSolids = 0;
  double nopcRatio = 0;
  bool pref2dValid = false;
  int pref2dFaces = 0, pref2dSolids = 0;
  double pref2dRatio = 0;
  // Q12: the flagged wires and their small edges.
  int flaggedWires = 0;
  int q18Written = -1;
  /** Q19: per variant (read-user-1e-3, write-least, write-session-1e-3) the flagged wires and the kernel bar. */
  int q19Flagged[3] = {-1, -1, -1};
  bool q19Pass[3] = {false, false, false};
  bool defaultPass = false;
  int q19FaceDelta[3] = {0, 0, 0}, q19SolidDelta[3] = {0, 0, 0};
  double minFlaggedEdge = 0;
  int flaggedEdgesBelowUncertainty = 0;
  int writtenVertices = 0, writtenEdges = 0, backVertices = 0, backEdges = 0;
  // Q15-Q17 (ADR-0097 2026-10-30b): the flagged wires' self-intersecting pairs,
  // classified, and whether the written body carries the same crossings.
  int q15SameEdge = 0, q15Adjacent = 0, q15NonAdjacent = 0;
  int q17Hairpin = 0, q17ThreeDClose = 0, q17TwoDOnly = 0;
  int q16PairsOneE7 = 0, q16PairsTol = 0;
  int q16Unmatched = 0;
  // Q15b/Q17b: BRepCheck_Wire::SelfIntersect's own first intersecting pair per
  // flagged wire, classified (it is a separate algorithm from ShapeAnalysis).
  int q15bPairs = 0;
  int q17bSameEdge = 0, q17bHairpin = 0, q17bThreeDClose = 0, q17bTwoDOnly = 0;
};

/** The number in the STEP text's UNCERTAINTY_MEASURE_WITH_UNIT, or -1 (ADR-0097 D7 diagnosis). */
static double uncertaintyOf(const std::string& text) {
  const std::string marker = "UNCERTAINTY_MEASURE_WITH_UNIT";
  const size_t at = text.find(marker);
  if (at == std::string::npos) return -1;
  const size_t measure = text.find("LENGTH_MEASURE(", at);
  if (measure == std::string::npos) return -1;
  return std::strtod(text.c_str() + measure + std::string("LENGTH_MEASURE(").size(), nullptr);
}

/**
 * Writes `shape` with a plain STEPControl_Writer that honours the Interface_Static
 * write parameters. The facade's writeStep() overwrites the model's
 * DESTEP_Parameters with its own (stepParameters()), so write-side statics have
 * no effect there; this path is how the Q7/Q11 write levers can actually be
 * pulled. Schema AP242DIS, millimetres, as the facade writes. Returns the text,
 * or "" on failure (ADR-0097 2026-10-30b).
 */
static std::string stepDirect(const TopoDS_Shape& shape) {
  Interface_Static::SetCVal("write.step.schema", "AP242DIS");
  Interface_Static::SetCVal("write.step.unit", "MM");
  STEPControl_Writer writer;
  if (writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone) return "";
  std::ostringstream out;
  if (writer.WriteStream(out) != IFSelect_RetDone) return "";
  return out.str();
}

/** What Q8/Q12 found on one read-back body: flagged wires and faces and the wires' edges. */
struct FlaggedInfo {
  int wires = 0;
  int wiresWithArc = 0;
  int wiresOnlyLines = 0;
  int unorientableFaces = 0;
  int badOrientationFaces = 0;
  double minEdge = 0;  // the shortest edge in a flagged wire (mm); 0 = none
  int edgesBelowUncertainty = 0;
  int edgesBelow005 = 0;
  std::map<std::string, int> wireEdgeClasses;
  std::map<std::string, int> faceKinds;
};

/**
 * Q8/Q12 (ADR-0097 2026-10-30b): every wire BRepCheck flags SelfIntersectingWire
 * and every face it flags UnorientableShape/BadOrientationOfSubshape on `shape`,
 * with the wire's edge classes, its max edge tolerance and whether it holds a
 * circle or ellipse edge; and the flagged wires' shortest edge, how many of
 * their edges are shorter than `uncertainty` and how many shorter than 0.05 mm.
 * Prints when `detail`.
 */
static FlaggedInfo flaggedWiresAndFaces(const TopoDS_Shape& shape, bool detail, double uncertainty) {
  FlaggedInfo info;
  BRepCheck_Analyzer analyzer(shape);
  // Every edge's class on the whole body, so a wire's edges read as Q1's.
  NCollection_DataMap<TopoDS_Shape, std::string, TopTools_ShapeMapHasher> edgeClass;
  {
    NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
    TopExp::MapShapesAndUniqueAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    for (int i = 1; i <= edgeFaces.Extent(); ++i) {
      const TopoDS_Edge edge = TopoDS::Edge(edgeFaces.FindKey(i));
      std::vector<std::string> faces;
      for (const TopoDS_Shape& face : edgeFaces(i)) faces.push_back(faceKind(TopoDS::Face(face)));
      std::string a = "none", b = "none";
      if (faces.size() == 1) a = b = faces[0];
      else if (faces.size() >= 2) { a = faces[0]; b = faces[1]; if (b < a) std::swap(a, b); }
      edgeClass.Bind(edge, curveKind(edge) + " " + a + "|" + b);
    }
  }
  auto hasStatus = [&](const TopoDS_Shape& sub, BRepCheck_Status want) {
    Handle(BRepCheck_Result) result = analyzer.Result(sub);
    if (result.IsNull()) return false;
    for (BRepCheck_Status st : result->Status()) if (st == want) return true;
    return false;
  };
  for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next()) {
    const TopoDS_Face face = TopoDS::Face(e.Current());
    const bool unorientable = hasStatus(face, BRepCheck_UnorientableShape);
    const bool badOrientation = hasStatus(face, BRepCheck_BadOrientationOfSubshape) ||
                                hasStatus(face, BRepCheck_BadOrientation);
    if (!unorientable && !badOrientation) continue;
    if (unorientable) ++info.unorientableFaces;
    if (badOrientation) ++info.badOrientationFaces;
    ++info.faceKinds[faceKind(face)];
    if (detail) std::cout << "     flagged face " << faceKind(face) << (unorientable ? " UnorientableShape" : "")
                          << (badOrientation ? " BadOrientationOfSubshape" : "") << "\n";
  }
  for (TopExp_Explorer e(shape, TopAbs_WIRE); e.More(); e.Next()) {
    const TopoDS_Wire wire = TopoDS::Wire(e.Current());
    if (!hasStatus(wire, BRepCheck_SelfIntersectingWire)) continue;
    ++info.wires;
    std::map<std::string, int> classes;
    double maxTol = 0, minWireEdge = 0;
    bool arc = false;
    for (TopExp_Explorer edge(wire, TopAbs_EDGE); edge.More(); edge.Next()) {
      const TopoDS_Edge ed = TopoDS::Edge(edge.Current());
      const std::string cls = edgeClass.IsBound(ed) ? edgeClass.Find(ed) : curveKind(ed) + " ?";
      ++classes[cls];
      ++info.wireEdgeClasses[cls];
      maxTol = std::max(maxTol, BRep_Tool::Tolerance(ed));
      const GeomAbs_CurveType type = BRepAdaptor_Curve(ed).GetType();
      if (!BRep_Tool::Degenerated(ed) && (type == GeomAbs_Circle || type == GeomAbs_Ellipse)) arc = true;
      GProp_GProps length;
      BRepGProp::LinearProperties(ed, length);
      const double len = length.Mass();
      minWireEdge = minWireEdge == 0 ? len : std::min(minWireEdge, len);
      info.minEdge = info.minEdge == 0 ? len : std::min(info.minEdge, len);
      if (uncertainty >= 0 && len < uncertainty) ++info.edgesBelowUncertainty;
      if (len < 0.05) ++info.edgesBelow005;
    }
    if (arc) ++info.wiresWithArc; else ++info.wiresOnlyLines;
    if (detail) {
      std::cout << "     flagged wire (max tol " << maxTol << ", shortest edge " << minWireEdge
                << (arc ? ", has circle/ellipse" : ", lines only") << "):";
      for (const auto& [cls, n] : classes) std::cout << " " << cls << " x" << n;
      std::cout << "\n";
    }
  }
  return info;
}

/**
 * One self-intersection between two edges of a wire (ADR-0097 2026-10-30b
 * Q15/Q17): `kind` 0 = same-edge, 1 = adjacent, 2 = non-adjacent.
 */
struct IntersectPair {
  int kind = 0;
  int i = 0, j = 0;
  double len1 = 0, len2 = 0;
  std::string cls1, cls2;
  double err = 0;
  gp_Pnt p3d;
};

/** The edge-class map `<curve> <A>|<B>` over a whole body (as Q1's). */
static NCollection_DataMap<TopoDS_Shape, std::string, TopTools_ShapeMapHasher> buildEdgeClass(const TopoDS_Shape& shape) {
  NCollection_DataMap<TopoDS_Shape, std::string, TopTools_ShapeMapHasher> edgeClass;
  NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
  TopExp::MapShapesAndUniqueAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  for (int i = 1; i <= edgeFaces.Extent(); ++i) {
    const TopoDS_Edge edge = TopoDS::Edge(edgeFaces.FindKey(i));
    std::vector<std::string> faces;
    for (const TopoDS_Shape& face : edgeFaces(i)) faces.push_back(faceKind(TopoDS::Face(face)));
    std::string a = "none", b = "none";
    if (faces.size() == 1) a = b = faces[0];
    else if (faces.size() >= 2) { a = faces[0]; b = faces[1]; if (b < a) std::swap(a, b); }
    edgeClass.Bind(edge, curveKind(edge) + " " + a + "|" + b);
  }
  return edgeClass;
}

/**
 * The pairs ShapeAnalysis_Wire finds self-intersecting on `wire` over `face` at
 * `precision` (ADR-0097 2026-10-30b Q15): each edge with itself, each adjacent
 * pair (i-1, i) and each non-adjacent pair (i, j), j > i+1, skipping the
 * closing pair 1/N. `agrees` reports CheckSelfIntersection() once for the wire.
 */
static std::vector<IntersectPair> findWirePairs(
    const TopoDS_Wire& wire, const TopoDS_Face& face, double precision,
    const NCollection_DataMap<TopoDS_Shape, std::string, TopTools_ShapeMapHasher>& edgeClass, bool& agrees) {
  std::vector<IntersectPair> pairs;
  agrees = false;
  ShapeAnalysis_Wire saw(wire, face, precision);
  if (!saw.IsReady()) return pairs;
  agrees = saw.CheckSelfIntersection();
  Handle(ShapeExtend_WireData) wd = saw.WireData();
  const int n = wd->NbEdges();
  auto edgeLen = [](const TopoDS_Edge& e) { GProp_GProps g; BRepGProp::LinearProperties(e, g); return g.Mass(); };
  auto cls = [&](const TopoDS_Edge& e) {
    return edgeClass.IsBound(e) ? edgeClass.Find(e) : curveKind(e) + " ?";
  };
  NCollection_Sequence<IntRes2d_IntersectionPoint> points2d;
  NCollection_Sequence<gp_Pnt> points3d;
  NCollection_Sequence<double> errors;
  auto add = [&](int kind, int i, int j, double err) {
    IntersectPair p;
    p.kind = kind;
    p.i = i;
    p.j = j;
    p.err = err;
    const TopoDS_Edge e1 = wd->Edge(i), e2 = wd->Edge(j);
    p.len1 = edgeLen(e1);
    p.len2 = edgeLen(e2);
    p.cls1 = cls(e1);
    p.cls2 = cls(e2);
    p.p3d = points3d.Length() > 0 ? points3d.Last() : gp_Pnt(0, 0, 0);
    pairs.push_back(p);
  };
  auto maxError = [&]() {
    double m = 0;
    for (int k = 1; k <= errors.Length(); ++k) m = std::max(m, errors.Value(k));
    return m;
  };
  for (int i = 1; i <= n; ++i) {
    if (saw.CheckSelfIntersectingEdge(i, points2d, points3d)) add(0, i, i, 0);
    if (saw.CheckIntersectingEdges(i, points2d, points3d, errors)) add(1, i > 1 ? i - 1 : n, i, maxError());
    for (int j = i + 2; j <= n; ++j) {
      if (i == 1 && j == n) continue;  // the closing pair 1/N is the same seam
      if (saw.CheckIntersectingEdges(i, j, points2d, points3d, errors)) add(2, i, j, maxError());
    }
  }
  return pairs;
}

/** A written face's centre of mass and area, for Q16's match. */
struct WrittenFace {
  TopoDS_Face face;
  gp_Pnt centre;
  double area = 0;
};

/**
 * The written face matching `back` by centre of mass (nearest within 0.05 mm)
 * and area (within 1 %), or -1; sets `outerTol` to the matched face's outer
 * wire max edge tolerance (ADR-0097 2026-10-30b Q16).
 */
static int matchWrittenFace(const TopoDS_Face& back, const std::vector<WrittenFace>& writtenFaces, double& outerTol) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(back, props);
  const gp_Pnt c = props.CentreOfMass();
  const double a = props.Mass();
  int best = -1;
  double bestDistance = 1e100;
  for (int i = 0; i < int(writtenFaces.size()); ++i) {
    const double distance = c.Distance(writtenFaces[i].centre);
    if (distance > 0.05) continue;
    if (writtenFaces[i].area != 0 && std::abs(a - writtenFaces[i].area) / std::abs(writtenFaces[i].area) > 0.01) continue;
    if (distance < bestDistance) { bestDistance = distance; best = i; }
  }
  if (best >= 0) {
    const TopoDS_Wire outer = BRepTools::OuterWire(writtenFaces[best].face);
    outerTol = 0;
    for (TopExp_Explorer e(outer, TopAbs_EDGE); e.More(); e.Next())
      outerTol = std::max(outerTol, BRep_Tool::Tolerance(TopoDS::Edge(e.Current())));
  }
  return best;
}

/** The turning angle at the shared vertex `v` of adjacent edges e1, e2, 0 = straight on, 180 = reversed (Q17). */
static double turningAngleAtVertex(const TopoDS_Edge& e1, const TopoDS_Edge& e2, const TopoDS_Vertex& v) {
  const gp_Pnt vertex = BRep_Tool::Pnt(v);
  BRepAdaptor_Curve c1(e1), c2(e2);
  auto farEnd = [](BRepAdaptor_Curve& c, const gp_Pnt& vt) {
    const gp_Pnt a = c.Value(c.FirstParameter()), b = c.Value(c.LastParameter());
    return a.Distance(vt) <= b.Distance(vt) ? b : a;
  };
  const gp_Vec into(farEnd(c1, vertex), vertex);  // direction arriving at the vertex
  const gp_Vec out(vertex, farEnd(c2, vertex));   // direction leaving it
  if (into.Magnitude() == 0 || out.Magnitude() == 0) return 0;
  return into.Angle(out) * 180.0 / M_PI;
}

/** The distance of a point from the face's surface, location applied (Q17). */
static double pointOffSurface(const gp_Pnt& point, const TopoDS_Face& face) {
  TopLoc_Location location;
  Handle(Geom_Surface) surface = BRep_Tool::Surface(face, location);
  if (surface.IsNull()) return -1;
  const gp_Pnt local = point.Transformed(location.Transformation().Inverted());
  GeomAPI_ProjectPointOnSurf projection(local, surface);
  return projection.IsDone() ? projection.LowerDistance() : -1;
}

/** The four vertices of the two edges of a pair (Q17). */
static std::array<TopoDS_Vertex, 4> pairVertices(const TopoDS_Edge& e1, const TopoDS_Edge& e2) {
  std::array<TopoDS_Vertex, 4> out;
  TopoDS_Vertex a, b;
  TopExp::Vertices(e1, a, b);
  out[0] = a;
  out[1] = b;
  TopExp::Vertices(e2, a, b);
  out[2] = a;
  out[3] = b;
  return out;
}

/** BRepCheck_Wire::SelfIntersect's first intersecting pair of a wire (Q15b). */
struct BRepCheckPair {
  bool found = false;
  bool sameEdge = false;
  TopoDS_Edge e1, e2;
};

/** BRepCheck_Wire::SelfIntersect's own first pair over `face`, or `found` false (Q15b). */
static BRepCheckPair brepCheckFirstPair(const TopoDS_Wire& wire, const TopoDS_Face& face) {
  BRepCheckPair out;
  BRepCheck_Wire checker(wire);
  TopoDS_Edge e1, e2;
  if (checker.SelfIntersect(face, e1, e2, false) == BRepCheck_SelfIntersectingWire) {
    out.found = true;
    out.e1 = e1;
    out.e2 = e2;
    out.sameEdge = e2.IsNull();
  }
  return out;
}

/** The vertex two edges share topologically, or null (Q17b). */
static TopoDS_Vertex sharedVertex(const TopoDS_Edge& e1, const TopoDS_Edge& e2) {
  TopoDS_Vertex a1, b1, a2, b2;
  TopExp::Vertices(e1, a1, b1);
  TopExp::Vertices(e2, a2, b2);
  const TopoDS_Vertex first[2] = {a1, b1};
  const TopoDS_Vertex second[2] = {a2, b2};
  for (int i = 0; i < 2; ++i)
    for (int j = 0; j < 2; ++j)
      if (first[i].IsSame(second[j])) return first[i];
  return TopoDS_Vertex();
}

/**
 * Q15-Q17 (ADR-0097 2026-10-30b): for every read-back wire BRepCheck flags
 * SelfIntersectingWire, find its face and the pairs ShapeAnalysis_Wire reports
 * (Q15), match the face to the written body and re-run the pair search on the
 * written outer wire at 1e-7 and at its edge tolerance (Q16), and classify
 * each pair into hairpin / 3D-close / 2D-only (Q17). Prints when `detail` and
 * fills `row`.
 */
static void classifySelfIntersections(const TopoDS_Shape& written, const TopoDS_Shape& readBack, bool detail,
                                      RoundTripRow& row) {
  const NCollection_DataMap<TopoDS_Shape, std::string, TopTools_ShapeMapHasher> backClass = buildEdgeClass(readBack);
  const NCollection_DataMap<TopoDS_Shape, std::string, TopTools_ShapeMapHasher> writtenClass = buildEdgeClass(written);
  NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> wireFaces;
  TopExp::MapShapesAndAncestors(readBack, TopAbs_WIRE, TopAbs_FACE, wireFaces);
  std::vector<WrittenFace> writtenFaces;
  for (TopExp_Explorer e(written, TopAbs_FACE); e.More(); e.Next()) {
    GProp_GProps props;
    BRepGProp::SurfaceProperties(e.Current(), props);
    writtenFaces.push_back({TopoDS::Face(e.Current()), props.CentreOfMass(), props.Mass()});
  }
  BRepCheck_Analyzer analyzer(readBack);
  for (TopExp_Explorer e(readBack, TopAbs_WIRE); e.More(); e.Next()) {
    const TopoDS_Wire wire = TopoDS::Wire(e.Current());
    Handle(BRepCheck_Result) result = analyzer.Result(wire);
    bool flagged = false;
    if (!result.IsNull())
      for (BRepCheck_Status st : result->Status())
        if (st == BRepCheck_SelfIntersectingWire) flagged = true;
    if (!flagged) continue;
    if (!wireFaces.Contains(wire) || wireFaces.FindFromKey(wire).IsEmpty()) continue;
    const TopoDS_Face face = TopoDS::Face(wireFaces.FindFromKey(wire).First());
    bool agrees = false;
    const std::vector<IntersectPair> pairs = findWirePairs(wire, face, 0.001, backClass, agrees);
    int sameEdge = 0, adjacent = 0, nonAdjacent = 0;
    for (const IntersectPair& p : pairs) {
      if (p.kind == 0) ++sameEdge;
      else if (p.kind == 1) ++adjacent;
      else ++nonAdjacent;
      if (detail)
        std::cout << "     q15 pair " << (p.kind == 0 ? "same-edge" : p.kind == 1 ? "adjacent" : "non-adjacent")
                  << " edges " << p.i << "," << p.j << " len " << p.len1 << "," << p.len2 << " classes " << p.cls1 << ";"
                  << p.cls2 << " err " << p.err << " p3d " << p.p3d.X() << " " << p.p3d.Y() << " " << p.p3d.Z() << "\n";
    }
    row.q15SameEdge += sameEdge;
    row.q15Adjacent += adjacent;
    row.q15NonAdjacent += nonAdjacent;
    if (detail)
      std::cout << "     q15 wire: same-edge " << sameEdge << ", adjacent " << adjacent << ", non-adjacent " << nonAdjacent
                << " (ShapeAnalysis CheckSelfIntersection " << (agrees ? "true" : "false") << ", BRepCheck flagged)\n";

    // Q16: is the crossing in the written body too?
    double outerTol = 0.001;
    const int match = matchWrittenFace(face, writtenFaces, outerTol);
    if (match >= 0) {
      const TopoDS_Wire outer = BRepTools::OuterWire(writtenFaces[match].face);
      bool a1 = false, a2 = false;
      const int atE7 = int(findWirePairs(outer, writtenFaces[match].face, 1e-7, writtenClass, a1).size());
      const int atTol = int(findWirePairs(outer, writtenFaces[match].face, outerTol, writtenClass, a2).size());
      row.q16PairsOneE7 += atE7;
      row.q16PairsTol += atTol;
      if (detail)
        std::cout << "     q16 written: pairs@1e-7 " << atE7 << ", pairs@tol " << atTol << " (tol " << outerTol << ")\n";
    } else {
      ++row.q16Unmatched;
      if (detail) {
        GProp_GProps backProps;
        BRepGProp::SurfaceProperties(face, backProps);
        const gp_Pnt backCentre = backProps.CentreOfMass();
        const double backArea = backProps.Mass();
        int nearest = -1;
        double nearestDistance = 1e100;
        for (int i = 0; i < int(writtenFaces.size()); ++i) {
          const double distance = backCentre.Distance(writtenFaces[i].centre);
          if (distance < nearestDistance) { nearestDistance = distance; nearest = i; }
        }
        std::cout << "     q16 written: unmatched (back " << faceKind(face) << " area " << backArea << ", nearest written "
                  << (nearest >= 0 ? faceKind(writtenFaces[nearest].face) : "none") << " centre distance "
                  << (nearest >= 0 ? nearestDistance : -1) << ", area "
                  << (nearest >= 0 ? writtenFaces[nearest].area : -1) << ")\n";
      }
    }

    // Q17: the mechanism of each pair.
    ShapeAnalysis_Wire saw(wire, face, 0.001);
    Handle(ShapeExtend_WireData) wd = saw.WireData();
    for (const IntersectPair& p : pairs) {
      const TopoDS_Edge e1 = wd->Edge(p.i), e2 = wd->Edge(p.j);
      if (p.kind == 1) {
        const double angle = turningAngleAtVertex(e1, e2, TopExp::LastVertex(e1, false));
        if (angle >= 150) {
          ++row.q17Hairpin;
          if (detail) std::cout << "     q17 hairpin angle " << angle << "\n";
        } else if (detail) {
          std::cout << "     q17 adjacent angle " << angle << "\n";
        }
      } else {
        BRepExtrema_DistShapeShape distance(e1, e2);
        distance.Perform();
        const double d = distance.IsDone() ? distance.Value() : -1;
        const bool close = d >= 0 && d <= outerTol;
        if (close) {
          ++row.q17ThreeDClose;
          if (detail) std::cout << "     q17 3D-close dist3d " << d << "\n";
        } else {
          ++row.q17TwoDOnly;
          const std::array<TopoDS_Vertex, 4> vs = pairVertices(e1, e2);
          if (detail) {
            std::cout << "     q17 2D-only dist3d " << d << " vertexOffSurface " << pointOffSurface(BRep_Tool::Pnt(vs[0]), face)
                      << " " << pointOffSurface(BRep_Tool::Pnt(vs[1]), face) << " "
                      << pointOffSurface(BRep_Tool::Pnt(vs[2]), face) << " "
                      << pointOffSurface(BRep_Tool::Pnt(vs[3]), face) << "\n";
          }
        }
      }
    }

    // Q15b/Q17b: BRepCheck_Wire::SelfIntersect's own first pair. It is a
    // separate algorithm from ShapeAnalysis (tolint 1e-10, Geom2dInt_GInter),
    // so it is the faithful reproduction of the status BRepCheck reports.
    const BRepCheckPair bc = brepCheckFirstPair(wire, face);
    if (bc.found) {
      ++row.q15bPairs;
      if (bc.sameEdge) {
        ++row.q17bSameEdge;
        if (detail) std::cout << "     q17b same-edge (one edge crosses itself)\n";
      } else {
        const TopoDS_Vertex shared = sharedVertex(bc.e1, bc.e2);
        if (!shared.IsNull()) {
          const double angle = turningAngleAtVertex(bc.e1, bc.e2, shared);
          if (angle >= 150) {
            ++row.q17bHairpin;
            if (detail) std::cout << "     q17b hairpin angle " << angle << "\n";
          } else if (detail) {
            std::cout << "     q17b adjacent angle " << angle << "\n";
          }
        } else {
          BRepExtrema_DistShapeShape distance(bc.e1, bc.e2);
          distance.Perform();
          const double d = distance.IsDone() ? distance.Value() : -1;
          if (d >= 0 && d <= outerTol) {
            ++row.q17bThreeDClose;
            if (detail) std::cout << "     q17b 3D-close dist3d " << d << "\n";
          } else {
            ++row.q17bTwoDOnly;
            if (detail) {
              const std::array<TopoDS_Vertex, 4> vs = pairVertices(bc.e1, bc.e2);
              std::cout << "     q17b 2D-only dist3d " << d << " vertexOffSurface "
                        << pointOffSurface(BRep_Tool::Pnt(vs[0]), face) << " " << pointOffSurface(BRep_Tool::Pnt(vs[1]), face)
                        << " " << pointOffSurface(BRep_Tool::Pnt(vs[2]), face) << " "
                        << pointOffSurface(BRep_Tool::Pnt(vs[3]), face) << "\n";
            }
          }
        }
      }
    } else if (detail) {
      std::cout << "     q17b BRepCheck SelfIntersect found no pair on this wire\n";
    }
  }
  if (detail)
    std::cout << "   q15: same-edge " << row.q15SameEdge << ", adjacent " << row.q15Adjacent << ", non-adjacent "
              << row.q15NonAdjacent << "\n"
              << "   q17: hairpin " << row.q17Hairpin << ", 3D-close " << row.q17ThreeDClose << ", 2D-only " << row.q17TwoDOnly
              << "\n"
              << "   q17b: same-edge " << row.q17bSameEdge << ", hairpin " << row.q17bHairpin << ", 3D-close "
              << row.q17bThreeDClose << ", 2D-only " << row.q17bTwoDOnly << " (of " << row.q15bPairs << " BRepCheck pairs)"
              << std::endl;
}


/**
 * Q20 (ADR-0097 slice D8 follow-up): the STEP reader's own healing. OCCT 8's
 * reader runs the ShapeProcess operator FixShape (STEPControl_Reader's default
 * process flags) with DESTEP_Parameters' default DE_ShapeFixParameters, which
 * mirror the FromSTEP lines of XSTEPResource/STEP; precision is the file's
 * uncertainty, max tolerance max(precision, read.maxprecision.val).
 */
static TopoDS_Shape readStepUnhealed(const std::string& text) {
  std::istringstream in(text);
  STEPControl_Reader reader;
  if (reader.ReadStream("q20.step", in) != IFSelect_RetDone) return TopoDS_Shape();
  // No ShapeProcess operator: the translated shape as is.
  reader.SetShapeProcessFlags(ShapeProcess::OperationsFlags());
  TopoDS_Shape shape;
  if (reader.TransferRoots() > 0) shape = reader.OneShape();
  // The actor is shared: back to the default (FixShape) for every later read.
  ShapeProcess::OperationsFlags defaults;
  defaults.set(ShapeProcess::Operation::FixShape);
  reader.SetShapeProcessFlags(defaults);
  return shape;
}

/** ShapeProcess's fixshape operator with FromSTEP's values, then `tweak` (one mode off); the fixed shape. */
static TopoDS_Shape fixLikeReader(const TopoDS_Shape& shape, double precision, double maxTol,
                                  const std::function<void(ShapeFix_Shape&)>& tweak, Handle(ShapeBuild_ReShape)* history = nullptr,
                                  TopoDS_Shape* input = nullptr) {
  // ShapeFix changes shared geometry and tolerances in place: every run on its own copy.
  const TopoDS_Shape copy = BRepBuilderAPI_Copy(shape).Shape();
  if (input) *input = copy;
  Handle(ShapeFix_Shape) sfs = new ShapeFix_Shape;
  Handle(ShapeFix_Face) sff = sfs->FixFaceTool();
  Handle(ShapeFix_Wire) sfw = sfs->FixWireTool();
  sfs->SetPrecision(precision);
  sfs->SetMinTolerance(1e-7);
  sfs->SetMaxTolerance(maxTol);
  sfs->FixFreeShellMode() = -1;
  sfs->FixFreeFaceMode() = -1;
  sfs->FixFreeWireMode() = -1;
  sfs->FixSameParameterMode() = -1;
  sfs->FixSolidMode() = -1;
  sfs->FixVertexPositionMode() = 0;
  sfs->FixVertexTolMode() = -1;
  sfs->FixSolidTool()->FixShellMode() = -1;
  sfs->FixSolidTool()->FixShellOrientationMode() = -1;
  sfs->FixSolidTool()->CreateOpenSolidMode() = false;
  sfs->FixShellTool()->FixFaceMode() = -1;
  sfs->FixShellTool()->SetNonManifoldFlag(false);
  sfs->FixShellTool()->FixOrientationMode() = -1;
  sff->FixWireMode() = -1;
  sff->FixOrientationMode() = -1;
  sff->FixAddNaturalBoundMode() = -1;
  sff->FixMissingSeamMode() = -1;
  sff->FixSmallAreaWireMode() = -1;
  sff->RemoveSmallAreaFaceMode() = -1;
  sff->FixIntersectingWiresMode() = -1;
  sff->FixLoopWiresMode() = -1;
  sff->FixSplitFaceMode() = -1;
  sfw->ModifyTopologyMode() = false;
  sfw->ModifyGeometryMode() = true;
  sfw->ClosedWireMode() = true;
  sfw->PreferencePCurveMode() = true;
  sfw->FixReorderMode() = -1;
  sfw->FixSmallMode() = -1;
  sfw->FixConnectedMode() = -1;
  sfw->FixEdgeCurvesMode() = -1;
  sfw->FixDegeneratedMode() = -1;
  sfw->FixLackingMode() = -1;
  sfw->FixSelfIntersectionMode() = -1;
  sfw->ModifyRemoveLoopMode() = -1;
  sfw->FixReversed2dMode() = -1;
  sfw->FixRemovePCurveMode() = -1;
  sfw->FixRemoveCurve3dMode() = -1;
  sfw->FixAddPCurveMode() = -1;
  sfw->FixAddCurve3dMode() = -1;
  sfw->FixShiftedMode() = -1;
  sfw->FixSeamMode() = -1;
  sfw->FixSameParameterMode() = 0;  // FixEdgeSameParameterMode
  sfw->FixNotchedEdgesMode() = -1;
  sfw->FixTailMode() = 0;
  sfw->SetMaxTailAngle(0);
  sfw->SetMaxTailWidth(-1);
  sfw->FixSelfIntersectingEdgeMode() = -1;
  sfw->FixIntersectingEdgesMode() = -1;
  sfw->FixNonAdjacentIntersectingEdgesMode() = -1;
  if (tweak) tweak(*sfs);
  sfs->Init(copy);
  sfs->Perform();
  if (history) *history = sfs->Context();
  return sfs->Shape();
}

/** The Q20 modes switched off one at a time: a name and the switch. */
static const std::vector<std::pair<std::string, std::function<void(ShapeFix_Shape&)>>>& q20Modes() {
  static const std::vector<std::pair<std::string, std::function<void(ShapeFix_Shape&)>>> modes = {
      {"wire FixSmallMode", [](ShapeFix_Shape& s) { s.FixWireTool()->FixSmallMode() = 0; }},
      {"wire FixNotchedEdgesMode", [](ShapeFix_Shape& s) { s.FixWireTool()->FixNotchedEdgesMode() = 0; }},
      {"wire FixSelfIntersectingEdgeMode", [](ShapeFix_Shape& s) { s.FixWireTool()->FixSelfIntersectingEdgeMode() = 0; }},
      {"wire FixIntersectingEdgesMode", [](ShapeFix_Shape& s) { s.FixWireTool()->FixIntersectingEdgesMode() = 0; }},
      {"wire FixNonAdjacentIntersectingEdgesMode",
       [](ShapeFix_Shape& s) { s.FixWireTool()->FixNonAdjacentIntersectingEdgesMode() = 0; }},
      {"wire FixSelfIntersectionMode", [](ShapeFix_Shape& s) { s.FixWireTool()->FixSelfIntersectionMode() = 0; }},
      {"wire FixLackingMode", [](ShapeFix_Shape& s) { s.FixWireTool()->FixLackingMode() = 0; }},
      {"wire FixConnectedMode", [](ShapeFix_Shape& s) { s.FixWireTool()->FixConnectedMode() = 0; }},
      {"wire FixDegeneratedMode", [](ShapeFix_Shape& s) { s.FixWireTool()->FixDegeneratedMode() = 0; }},
      {"wire FixReorderMode", [](ShapeFix_Shape& s) { s.FixWireTool()->FixReorderMode() = 0; }},
      {"shape FixSameParameterMode", [](ShapeFix_Shape& s) { s.FixSameParameterMode() = 0; }},
      {"face FixWireMode", [](ShapeFix_Shape& s) { s.FixFaceTool()->FixWireMode() = 0; }},
      {"face FixSplitFaceMode", [](ShapeFix_Shape& s) { s.FixFaceTool()->FixSplitFaceMode() = 0; }},
      {"face FixLoopWiresMode", [](ShapeFix_Shape& s) { s.FixFaceTool()->FixLoopWiresMode() = 0; }},
      {"face FixIntersectingWiresMode", [](ShapeFix_Shape& s) { s.FixFaceTool()->FixIntersectingWiresMode() = 0; }},
      {"face FixSmallAreaWireMode", [](ShapeFix_Shape& s) { s.FixFaceTool()->FixSmallAreaWireMode() = 0; }},
      {"face RemoveSmallAreaFaceMode", [](ShapeFix_Shape& s) { s.FixFaceTool()->RemoveSmallAreaFaceMode() = 0; }},
      {"face FixMissingSeamMode", [](ShapeFix_Shape& s) { s.FixFaceTool()->FixMissingSeamMode() = 0; }},
      {"face FixOrientationMode", [](ShapeFix_Shape& s) { s.FixFaceTool()->FixOrientationMode() = 0; }},
      {"shell FixOrientationMode", [](ShapeFix_Shape& s) { s.FixShellTool()->FixOrientationMode() = 0; }},
      {"solid FixShellMode", [](ShapeFix_Shape& s) { s.FixSolidTool()->FixShellMode() = 0; }},
  };
  return modes;
}

/** One Q20 line's numbers. */
struct Q20Result {
  bool ok = false, valid = false, pass = false;
  int faces = 0, solids = 0, flagged = 0;
  double ratio = 0;
  std::string top = "-";
};

static int countOf(const TopoDS_Shape& s, TopAbs_ShapeEnum type) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> m;
  TopExp::MapShapes(s, type, m);
  return m.Extent();
}

static Q20Result q20Measure(const TopoDS_Shape& s, int writtenFaces, int writtenSolids, double writtenVolume, double u) {
  Q20Result r;
  if (s.IsNull()) return r;
  r.ok = true;
  r.valid = BRepCheck_Analyzer(s).IsValid();
  r.faces = countOf(s, TopAbs_FACE);
  r.solids = countOf(s, TopAbs_SOLID);
  r.ratio = writtenVolume != 0 ? ExtrudoFacade::volumeOf(s) / writtenVolume : 0;
  r.flagged = flaggedWiresAndFaces(s, false, u).wires;
  r.pass = r.valid && r.faces == writtenFaces && r.solids == writtenSolids && std::fabs(r.ratio - 1) < 1e-4;
  if (!r.valid) {
    int top = 0;
    for (const auto& [key, n] : bRepCheckCounts(s))
      if (n > top) { top = n; r.top = key + " x" + std::to_string(n); }
  }
  return r;
}

static void q20Print(const std::string& name, const Q20Result& r, int writtenFaces, const char* tag = "q20") {
  if (!r.ok) { std::cout << "   " << tag << " " << name << ": no shape" << std::endl; return; }
  std::cout << "   " << tag << " " << name << ": read back " << (r.valid ? "valid" : "invalid") << ", faces " << r.faces << " (written "
            << writtenFaces << "), solids " << r.solids << ", ratio " << r.ratio << ", flagged wires " << r.flagged
            << ", kernel bar " << (r.pass ? "pass" : "fail") << (r.valid ? "" : ", top status " + r.top) << std::endl;
}

/** Q20 step 5: a face's edges, its shortest edge, edges below `u`, and whether two of its vertices sit within `u`. */
static std::string q20FaceTraits(const TopoDS_Face& face, double u) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges, vertices;
  TopExp::MapShapes(face, TopAbs_EDGE, edges);
  TopExp::MapShapes(face, TopAbs_VERTEX, vertices);
  double shortest = 1e100;
  int below = 0;
  for (int i = 1; i <= edges.Extent(); ++i) {
    const TopoDS_Edge& e = TopoDS::Edge(edges(i));
    if (BRep_Tool::Degenerated(e)) continue;
    const double len = GCPnts_AbscissaPoint::Length(BRepAdaptor_Curve(e));
    shortest = std::min(shortest, len);
    below += len < u;
  }
  int close = 0;
  double closest = 1e100;
  if (vertices.Extent() <= 4000)
    for (int i = 1; i <= vertices.Extent(); ++i)
      for (int j = i + 1; j <= vertices.Extent(); ++j) {
        const double d = BRep_Tool::Pnt(TopoDS::Vertex(vertices(i))).Distance(BRep_Tool::Pnt(TopoDS::Vertex(vertices(j))));
        closest = std::min(closest, d);
        close += d < u;
      }
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  int wires = 0;
  for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) ++wires;
  std::ostringstream out;
  out << faceKind(face) << ", area " << props.Mass() << ", wires " << wires << ", edges " << edges.Extent() << ", shortest "
      << shortest << ", edges < " << u << ": " << below << ", vertex pairs within " << u << ": " << close << " (closest "
      << closest << ")";
  return out.str();
}


/** Q21: a pcurve's type name, through a trimmed curve to its basis. */
static std::string pcurveType(Handle(Geom2d_Curve) c) {
  if (c.IsNull()) return "none";
  Handle(Geom2d_TrimmedCurve) trimmed = Handle(Geom2d_TrimmedCurve)::DownCast(c);
  if (!trimmed.IsNull()) c = trimmed->BasisCurve();
  return c->DynamicType()->Name();
}

/** Q21: the elementary surface's location (its "centre"), or false when the face's surface isn't elementary. */
static bool surfaceCentre(const TopoDS_Face& face, gp_Pnt& centre) {
  Handle(Geom_Surface) s = BRep_Tool::Surface(face);
  Handle(Geom_RectangularTrimmedSurface) rts = Handle(Geom_RectangularTrimmedSurface)::DownCast(s);
  if (!rts.IsNull()) s = rts->BasisSurface();
  Handle(Geom_ElementarySurface) e = Handle(Geom_ElementarySurface)::DownCast(s);
  if (e.IsNull()) return false;
  centre = e->Position().Location();
  return true;
}

/** Q21 step 2: the STEP text's entity counts and what its EDGE_CURVEs reference. */
static void q21Entities(const std::string& text) {
  std::unordered_map<long, std::string> typeOf;
  std::vector<long> edgeCurveTargets;
  std::istringstream in(text);
  std::string line, entity;
  auto handle = [&](const std::string& e) {
    if (e.empty() || e[0] != '#') return;
    const size_t eq = e.find('=');
    if (eq == std::string::npos) return;
    const long id = std::atol(e.c_str() + 1);
    size_t start = e.find_first_not_of(' ', eq + 1);
    if (start == std::string::npos) return;
    std::string type;
    if (e[start] == '(') {
      type = "(complex)";
    } else {
      const size_t paren = e.find('(', start);
      type = e.substr(start, paren - start);
      while (!type.empty() && type.back() == ' ') type.pop_back();
    }
    typeOf[id] = type;
    if (type == "EDGE_CURVE") {
      // EDGE_CURVE('',#v1,#v2,#curve,.T.): the third reference.
      size_t pos = e.find('(', start);
      int refs = 0;
      while ((pos = e.find('#', pos + 1)) != std::string::npos)
        if (++refs == 3) { edgeCurveTargets.push_back(std::atol(e.c_str() + pos + 1)); break; }
    }
  };
  while (std::getline(in, line)) {
    entity += line;
    if (!entity.empty() && entity.find(';') != std::string::npos) {
      handle(entity);
      entity.clear();
    }
  }
  std::map<std::string, int> counts;
  for (const auto& [id, type] : typeOf) counts[type]++;
  std::map<std::string, int> targets;
  for (long id : edgeCurveTargets) targets[typeOf.count(id) ? typeOf[id] : "?"]++;
  std::cout << "   q21 entities: PCURVE " << counts["PCURVE"] << ", SURFACE_CURVE " << counts["SURFACE_CURVE"]
            << ", SEAM_CURVE " << counts["SEAM_CURVE"] << ", EDGE_CURVE " << counts["EDGE_CURVE"] << ", LINE " << counts["LINE"]
            << ", CIRCLE " << counts["CIRCLE"] << ", PLANE " << counts["PLANE"] << "; EDGE_CURVE geometry:";
  for (const auto& [type, n] : targets) std::cout << " " << type << " " << n;
  std::cout << std::endl;
}

/**
 * Q21 step 1: every edge of a flagged raw (unhealed) wire against the written
 * edge with the same endpoints, on the written face with the same surface.
 */
static void q21Pcurves(const TopoDS_Shape& written, const TopoDS_Shape& raw, double u) {
  // The written edges by endpoint, on a 1e-4 grid (then checked at 1e-6).
  auto cell = [](const gp_Pnt& p) {
    return std::to_string(std::llround(p.X() * 1e4)) + "," + std::to_string(std::llround(p.Y() * 1e4)) + "," +
           std::to_string(std::llround(p.Z() * 1e4));
  };
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> writtenEdges;
  TopExp::MapShapes(written, TopAbs_EDGE, writtenEdges);
  NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
  TopExp::MapShapesAndAncestors(written, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  std::unordered_map<std::string, std::vector<int>> byCell;
  for (int i = 1; i <= writtenEdges.Extent(); ++i) {
    TopoDS_Vertex a, b;
    TopExp::Vertices(TopoDS::Edge(writtenEdges(i)), a, b);
    if (a.IsNull()) continue;
    byCell[cell(BRep_Tool::Pnt(a))].push_back(i);
  }
  struct Line {
    double uvMax = 0;
    std::string text;
  };
  std::vector<Line> lines;
  int n = 0, d = 0, typeChanged = 0, unmatched = 0, dBelow = 0, dAbove = 0;
  for (TopExp_Explorer fe(raw, TopAbs_FACE); fe.More(); fe.Next()) {
    const TopoDS_Face face = TopoDS::Face(fe.Current());
    for (TopExp_Explorer we(face, TopAbs_WIRE); we.More(); we.Next()) {
      const TopoDS_Wire wire = TopoDS::Wire(we.Current());
      if (!brepCheckFirstPair(wire, face).found) continue;
      const GeomAbs_SurfaceType kind = BRepAdaptor_Surface(face).GetType();
      gp_Pnt centre;
      const bool hasCentre = surfaceCentre(face, centre);
      for (TopExp_Explorer ee(wire, TopAbs_EDGE); ee.More(); ee.Next()) {
        const TopoDS_Edge re = TopoDS::Edge(ee.Current());
        if (BRep_Tool::Degenerated(re)) continue;
        ++n;
        TopoDS_Vertex ra, rb;
        TopExp::Vertices(re, ra, rb);
        const gp_Pnt pa = BRep_Tool::Pnt(ra), pb = BRep_Tool::Pnt(rb);
        // The written edge: same two endpoints (either way round), on a face with the same surface.
        TopoDS_Edge we2;
        TopoDS_Face wf;
        bool sameWay = true;
        const auto it = byCell.find(cell(pa)), it2 = byCell.find(cell(pb));
        std::vector<int> candidates;
        if (it != byCell.end()) candidates.insert(candidates.end(), it->second.begin(), it->second.end());
        if (it2 != byCell.end()) candidates.insert(candidates.end(), it2->second.begin(), it2->second.end());
        for (int i : candidates) {
          const TopoDS_Edge& w = TopoDS::Edge(writtenEdges(i));
          TopoDS_Vertex wa, wb;
          TopExp::Vertices(w, wa, wb);
          const gp_Pnt qa = BRep_Tool::Pnt(wa), qb = BRep_Tool::Pnt(wb);
          bool same = qa.Distance(pa) <= 1e-6 && qb.Distance(pb) <= 1e-6;
          bool reversed = qa.Distance(pb) <= 1e-6 && qb.Distance(pa) <= 1e-6;
          if (!same && !reversed) continue;
          for (const TopoDS_Shape& fs : edgeFaces.FindFromKey(w)) {
            const TopoDS_Face f2 = TopoDS::Face(fs);
            if (BRepAdaptor_Surface(f2).GetType() != kind) continue;
            gp_Pnt c2;
            if (hasCentre && (!surfaceCentre(f2, c2) || c2.Distance(centre) > 1e-6)) continue;
            we2 = w;
            wf = f2;
            sameWay = same;
            break;
          }
          if (!wf.IsNull()) break;
        }
        if (wf.IsNull()) {
          ++unmatched;
          continue;
        }
        double rf, rl, wfp, wlp;
        const Handle(Geom2d_Curve) rc = BRep_Tool::CurveOnSurface(re, face, rf, rl);
        const Handle(Geom2d_Curve) wc = BRep_Tool::CurveOnSurface(we2, wf, wfp, wlp);
        const std::string rType = pcurveType(rc), wType = pcurveType(wc);
        if (rType != wType) ++typeChanged;
        if (rc.IsNull() || wc.IsNull()) continue;
        // Parameter-first vertices: does the raw edge run the same way as the written one?
        TopoDS_Vertex rFirst = TopExp::FirstVertex(re, false), wFirst = TopExp::FirstVertex(we2, false);
        const bool forward = BRep_Tool::Pnt(rFirst).Distance(BRep_Tool::Pnt(wFirst)) <= 1e-6;
        (void)sameWay;
        const Handle(Geom_Surface) ws = BRep_Tool::Surface(wf), rs = BRep_Tool::Surface(face);
        double c3f, c3l, r3f, r3l;
        TopLoc_Location wl, rl3;
        const Handle(Geom_Curve) w3 = BRep_Tool::Curve(we2, wl, c3f, c3l);
        const Handle(Geom_Curve) r3 = BRep_Tool::Curve(re, rl3, r3f, r3l);
        double uvMax = 0, mmMax = 0, uvFirst = 0, uvLast = 0, w3d = 0, r3d = 0;
        for (int k = 0; k <= 8; ++k) {
          const double t = k / 8.0;
          const double pw = wfp + t * (wlp - wfp);
          const double pr = forward ? rf + t * (rl - rf) : rl - t * (rl - rf);
          const gp_Pnt2d uw = wc->Value(pw), ur = rc->Value(pr);
          const double duv = uw.Distance(ur);
          gp_Pnt p;
          gp_Vec su, sv;
          ws->D1(uw.X(), uw.Y(), p, su, sv);
          const double mm = (su * (ur.X() - uw.X()) + sv * (ur.Y() - uw.Y())).Magnitude();
          uvMax = std::max(uvMax, duv);
          mmMax = std::max(mmMax, mm);
          if (k == 0) uvFirst = duv;
          if (k == 8) uvLast = duv;
          if (!w3.IsNull()) w3d = std::max(w3d, ws->Value(uw.X(), uw.Y()).Distance(w3->Value(pw).Transformed(wl.Transformation())));
          if (!r3.IsNull()) r3d = std::max(r3d, rs->Value(ur.X(), ur.Y()).Distance(r3->Value(pr).Transformed(rl3.Transformation())));
        }
        const double tol = BRep_Tool::Tolerance(we2);
        if (uvMax > 1e-6) {
          ++d;
          (tol < u ? dBelow : dAbove)++;
        }
        std::ostringstream out;
        out << "     q21 edge on " << faceKind(wf) << ": written " << wType << ", raw " << rType << ", uv ends " << uvFirst
            << " " << uvLast << ", uv max " << uvMax << " (" << mmMax << " mm), written tol " << tol << ", written 2d->3d "
            << w3d << ", raw 2d->3d " << r3d << ", length " << BRep_Tool::Pnt(ra).Distance(BRep_Tool::Pnt(rb));
        lines.push_back({uvMax, out.str()});
      }
    }
  }
  std::sort(lines.begin(), lines.end(), [](const Line& a, const Line& b) { return a.uvMax > b.uvMax; });
  for (size_t i = 0; i < lines.size() && i < 40; ++i) std::cout << lines[i].text << "\n";
  std::cout << "   q21 summary: edges in flagged raw wires " << n << ", matched " << n - unmatched << ", raw pcurve differs (> 1e-6 uv) "
            << d << " (written tol < " << u << ": " << dBelow << ", >= " << u << ": " << dAbove << "), type changed "
            << typeChanged << std::endl;
}


/** Q22: a shape's edges by end point (on a 1e-4 grid, neighbouring cells searched; matched within 1e-6). */
struct Q22EdgeIndex {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
  NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> faces;
  std::unordered_map<std::string, std::vector<int>> byCell;
  static std::string key(long x, long y, long z) { return std::to_string(x) + "," + std::to_string(y) + "," + std::to_string(z); }
  static void ends(const TopoDS_Edge& e, gp_Pnt& a, gp_Pnt& b) {
    TopoDS_Vertex va, vb;
    TopExp::Vertices(e, va, vb);
    a = va.IsNull() ? gp_Pnt() : BRep_Tool::Pnt(va);
    b = vb.IsNull() ? a : BRep_Tool::Pnt(vb);
  }
  void build(const TopoDS_Shape& shape) {
    TopExp::MapShapes(shape, TopAbs_EDGE, edges);
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, faces);
    for (int i = 1; i <= edges.Extent(); ++i) {
      gp_Pnt a, b;
      ends(TopoDS::Edge(edges(i)), a, b);
      for (const gp_Pnt& p : {a, b}) {
        std::vector<int>& v = byCell[key(std::llround(p.X() * 1e4), std::llround(p.Y() * 1e4), std::llround(p.Z() * 1e4))];
        if (v.empty() || v.back() != i) v.push_back(i);
      }
    }
  }
  /** Edges with an end within 1e-6 of p. */
  std::vector<int> touching(const gp_Pnt& p) const {
    std::vector<int> out;
    const long x = std::llround(p.X() * 1e4), y = std::llround(p.Y() * 1e4), z = std::llround(p.Z() * 1e4);
    for (long dx = -1; dx <= 1; ++dx)
      for (long dy = -1; dy <= 1; ++dy)
        for (long dz = -1; dz <= 1; ++dz) {
          const auto it = byCell.find(key(x + dx, y + dy, z + dz));
          if (it == byCell.end()) continue;
          for (int i : it->second) {
            gp_Pnt a, b;
            ends(TopoDS::Edge(edges(i)), a, b);
            if ((a.Distance(p) <= 1e-6 || b.Distance(p) <= 1e-6) && std::find(out.begin(), out.end(), i) == out.end())
              out.push_back(i);
          }
        }
    return out;
  }
  /** The edges whose two ends are p and q (either way). */
  std::vector<int> find(const gp_Pnt& p, const gp_Pnt& q) const {
    std::vector<int> out;
    for (int i : touching(p)) {
      gp_Pnt a, b;
      ends(TopoDS::Edge(edges(i)), a, b);
      if ((a.Distance(p) <= 1e-6 && b.Distance(q) <= 1e-6) || (a.Distance(q) <= 1e-6 && b.Distance(p) <= 1e-6)) out.push_back(i);
    }
    return out;
  }
};

static std::string q22CurveType(const TopoDS_Edge& e) {
  switch (BRepAdaptor_Curve(e).GetType()) {
    case GeomAbs_Line: return "line";
    case GeomAbs_Circle: return "circle";
    case GeomAbs_Ellipse: return "ellipse";
    case GeomAbs_BSplineCurve: return "bspline";
    default: return "other";
  }
}

static double q22Length(const TopoDS_Edge& e) {
  if (BRep_Tool::Degenerated(e)) return 0;
  return GCPnts_AbscissaPoint::Length(BRepAdaptor_Curve(e));
}

/** The diag record (hybridEdges_) of an edge from p to q, or null. */
static const ExtrudoFacade::HybridEdgeRecord* q22Record(const ExtrudoFacade& f, const gp_Pnt& p, const gp_Pnt& q) {
  for (const auto& r : f.hybridEdges_)
    if ((r.a.Distance(p) <= 1e-6 && r.b.Distance(q) <= 1e-6) || (r.a.Distance(q) <= 1e-6 && r.b.Distance(p) <= 1e-6)) return &r;
  return nullptr;
}

static std::string q22Describe(const ExtrudoFacade& f, const TopoDS_Edge& e) {
  gp_Pnt a, b;
  Q22EdgeIndex::ends(e, a, b);
  std::ostringstream out;
  out << q22CurveType(e) << " " << q22Length(e);
  int records = 0;
  for (const auto& r : f.hybridEdges_) {
    if (!((r.a.Distance(a) <= 1e-6 && r.b.Distance(b) <= 1e-6) || (r.a.Distance(b) <= 1e-6 && r.b.Distance(a) <= 1e-6))) continue;
    out << (records++ ? "; " : " records: ") << (r.chain ? "chain" : "chord") << " regions " << r.left << "|" << r.right;
    if (r.chain) out << " type " << r.type;
    if (r.widened > 0) out << " widened " << r.widened;
  }
  if (!records) out << " (no build record)";
  return out.str();
}

/** The unit tangent leaving vertex point v along the edge, in 3D (face null) or in the face's UV. */
static gp_Vec2d q22Out2d(const TopoDS_Edge& e, const TopoDS_Face& face, const gp_Pnt& v) {
  BRepAdaptor_Curve c(e);
  const bool atFirst = c.Value(c.FirstParameter()).Distance(v) <= c.Value(c.LastParameter()).Distance(v);
  BRepAdaptor_Curve2d c2(e, face);
  gp_Pnt2d p;
  gp_Vec2d d;
  c2.D1(atFirst ? c2.FirstParameter() : c2.LastParameter(), p, d);
  if (!atFirst) d.Reverse();
  return d.Magnitude() > 0 ? d.Normalized() : d;
}
static gp_Vec q22Out3d(const TopoDS_Edge& e, const gp_Pnt& v) {
  BRepAdaptor_Curve c(e);
  const bool atFirst = c.Value(c.FirstParameter()).Distance(v) <= c.Value(c.LastParameter()).Distance(v);
  gp_Pnt p;
  gp_Vec d;
  c.D1(atFirst ? c.FirstParameter() : c.LastParameter(), p, d);
  if (!atFirst) d.Reverse();
  return d.Magnitude() > 0 ? d.Normalized() : d;
}

/** How much of the shorter edge lies within 1e-6 of the longer one (mm; 101 samples). */
static double q22Overlap(const TopoDS_Edge& e1, const TopoDS_Edge& e2) {
  const double l1 = q22Length(e1), l2 = q22Length(e2);
  const TopoDS_Edge& shorter = l1 <= l2 ? e1 : e2;
  const TopoDS_Edge& longer = l1 <= l2 ? e2 : e1;
  BRepAdaptor_Curve s(shorter);
  double lf = 0, ll = 0;
  TopLoc_Location loc;
  Handle(Geom_Curve) lc = BRep_Tool::Curve(longer, loc, lf, ll);
  if (lc.IsNull()) return -1;
  lc = Handle(Geom_Curve)::DownCast(lc->Transformed(loc.Transformation()));
  ShapeAnalysis_Curve sac;
  int within = 0;
  for (int i = 0; i <= 100; ++i) {
    const gp_Pnt p = s.Value(s.FirstParameter() + (s.LastParameter() - s.FirstParameter()) * i / 100.0);
    gp_Pnt proj;
    double param = 0;
    if (sac.Project(lc, p, 1e-9, proj, param, lf, ll) <= 1e-6) ++within;
  }
  return std::min(l1, l2) * within / 101.0;
}

/** Is a wire of `face` (vertex tolerances at 1e-7 when `tight`) flagged, and on the pair with these ends? "no", "yes", "yes, other pair". */
static std::string q22Flagged(const TopoDS_Face& face, bool tight, const gp_Pnt ends1[2], const gp_Pnt ends2[2]) {
  TopoDS_Face use = face;
  if (tight) {
    use = TopoDS::Face(BRepBuilderAPI_Copy(face).Shape());
    ShapeFix_ShapeTolerance().SetTolerance(use, Precision::Confusion(), TopAbs_VERTEX);
  }
  std::string out = "no";
  for (TopExp_Explorer w(use, TopAbs_WIRE); w.More(); w.Next()) {
    const BRepCheckPair pair = brepCheckFirstPair(TopoDS::Wire(w.Current()), use);
    if (!pair.found) continue;
    if (pair.sameEdge) { out = "yes, one edge"; continue; }
    gp_Pnt a1, b1, a2, b2;
    Q22EdgeIndex::ends(pair.e1, a1, b1);
    Q22EdgeIndex::ends(pair.e2, a2, b2);
    auto same = [](const gp_Pnt& a, const gp_Pnt& b, const gp_Pnt e[2]) {
      return (a.Distance(e[0]) <= 1e-6 && b.Distance(e[1]) <= 1e-6) || (a.Distance(e[1]) <= 1e-6 && b.Distance(e[0]) <= 1e-6);
    };
    if ((same(a1, b1, ends1) && same(a2, b2, ends2)) || (same(a1, b1, ends2) && same(a2, b2, ends1))) return "yes";
    out = "yes, other pair";
  }
  return out;
}

/** The face both edges of a shape bound (by index), or null. */
static TopoDS_Face q22CommonFace(const Q22EdgeIndex& index, int i, int j) {
  if (!i || !j) return TopoDS_Face();
  for (const TopoDS_Shape& a : index.faces.FindFromKey(index.edges(i)))
    for (const TopoDS_Shape& b : index.faces.FindFromKey(index.edges(j)))
      if (a.IsSame(b)) return TopoDS::Face(a);
  return TopoDS_Face();
}

static std::string q22Touching(const ExtrudoFacade& f, const Q22EdgeIndex& index, const gp_Pnt& p) {
  std::ostringstream out;
  for (int i : index.touching(p)) out << " [" << q22Describe(f, TopoDS::Edge(index.edges(i))) << "]";
  return out.str();
}

/**
 * Q22a: every hairpin pair (adjacent, turning >= 150 degrees) BRepCheck finds
 * on the default read: both edges matched to the written body, the angles
 * and overlap at the shared vertex, and whether the pair is flagged written,
 * raw and healed. Saves the pairs' end points to `pairsFile` for the old build.
 */
static void q22Hairpins(const ExtrudoFacade& f, const TopoDS_Shape& written, const TopoDS_Shape& readBack, const std::string& text,
                        const std::string& pairsFile) {
  Q22EdgeIndex writtenIndex, rawIndex;
  writtenIndex.build(written);
  const TopoDS_Shape raw = readStepUnhealed(text);
  if (!raw.IsNull()) rawIndex.build(raw);
  std::ofstream pairs(pairsFile);
  pairs << std::setprecision(17);
  int count = 0;
  for (TopExp_Explorer fe(readBack, TopAbs_FACE); fe.More(); fe.Next()) {
    const TopoDS_Face face = TopoDS::Face(fe.Current());
    for (TopExp_Explorer we(face, TopAbs_WIRE); we.More(); we.Next()) {
      const BRepCheckPair pair = brepCheckFirstPair(TopoDS::Wire(we.Current()), face);
      if (!pair.found || pair.sameEdge) continue;
      const TopoDS_Vertex shared = sharedVertex(pair.e1, pair.e2);
      if (shared.IsNull()) continue;
      const double turning = turningAngleAtVertex(pair.e1, pair.e2, shared);
      if (turning < 150) continue;
      ++count;
      const gp_Pnt v = BRep_Tool::Pnt(shared);
      gp_Pnt e1[2], e2[2];
      Q22EdgeIndex::ends(pair.e1, e1[0], e1[1]);
      Q22EdgeIndex::ends(pair.e2, e2[0], e2[1]);
      std::cout << "   q22a pair " << count << ": read-back turning " << turning << ", vertex " << v.X() << " " << v.Y() << " "
                << v.Z() << ", read-back edges " << q22CurveType(pair.e1) << " " << q22Length(pair.e1) << " / "
                << q22CurveType(pair.e2) << " " << q22Length(pair.e2) << "\n";
      // 1. The written edges.
      const std::vector<int> w1 = writtenIndex.find(e1[0], e1[1]), w2 = writtenIndex.find(e2[0], e2[1]);
      for (int k = 0; k < 2; ++k) {
        const std::vector<int>& w = k == 0 ? w1 : w2;
        const gp_Pnt* e = k == 0 ? e1 : e2;
        if (!w.empty()) {
          std::cout << "     q22a edge " << k + 1 << " written: " << q22Describe(f, TopoDS::Edge(writtenIndex.edges(w[0])))
                    << (w.size() > 1 ? " (+" + std::to_string(w.size() - 1) + " with the same ends)" : "") << "\n";
        } else {
          std::cout << "     q22a edge " << k + 1 << " written: no match; at its ends:" << q22Touching(f, writtenIndex, e[0])
                    << " |" << q22Touching(f, writtenIndex, e[1]) << "\n";
        }
      }
      // 2. Angles, overlap, edges at the vertex: on the written edges when both match on one face, else the read-back's.
      // Two distinct written edges when both ends are the same pair of nodes.
      const int i1 = w1.empty() ? 0 : w1[0];
      int i2 = 0;
      for (int i : w2)
        if (i != i1) { i2 = i; break; }
      const TopoDS_Face wf = q22CommonFace(writtenIndex, i1, i2);
      const bool onWritten = !wf.IsNull();
      const TopoDS_Edge a = onWritten ? TopoDS::Edge(writtenIndex.edges(i1)) : pair.e1;
      const TopoDS_Edge b = onWritten ? TopoDS::Edge(writtenIndex.edges(i2)) : pair.e2;
      const TopoDS_Face af = onWritten ? wf : face;
      const double angle3d = q22Out3d(a, v).Angle(q22Out3d(b, v)) * 180 / M_PI;
      const double angleUv = std::fabs(q22Out2d(a, af, v).Angle(q22Out2d(b, af, v))) * 180 / M_PI;
      int atVertex = 0;
      if (onWritten) {
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faceEdges;
        TopExp::MapShapes(wf, TopAbs_EDGE, faceEdges);
        for (int i = 1; i <= faceEdges.Extent(); ++i) {
          gp_Pnt p, q;
          Q22EdgeIndex::ends(TopoDS::Edge(faceEdges(i)), p, q);
          if (p.Distance(v) <= 1e-6 || q.Distance(v) <= 1e-6) ++atVertex;
        }
      }
      std::cout << "     q22a at the vertex (" << (onWritten ? "written" : "read-back") << " edges): angle 3d " << angle3d
                << ", angle uv " << angleUv << ", overlap " << q22Overlap(a, b) << " of " << std::min(q22Length(a), q22Length(b))
                << ", face " << faceKind(af) << " edges at the vertex " << (onWritten ? std::to_string(atVertex) : "-");
      {
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> all, wires;
        TopExp::MapShapes(af, TopAbs_EDGE, all);
        TopExp::MapShapes(af, TopAbs_WIRE, wires);
        GProp_GProps props;
        BRepGProp::SurfaceProperties(af, props);
        int inWire = -1;
        for (TopExp_Explorer w(af, TopAbs_WIRE); w.More() && inWire < 0; w.Next()) {
          NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> we;
          TopExp::MapShapes(w.Current(), TopAbs_EDGE, we);
          if (we.Contains(a) && we.Contains(b)) inWire = we.Extent();
        }
        std::cout << ", face edges " << all.Extent() << " in " << wires.Extent() << " wires (the pair's wire " << inWire
                  << " edges), face area " << props.Mass();
      }
      std::cout << "\n";
      // 3. Flagged written (vertex tolerance 1e-7), raw (no healing), healed (this read).
      std::string rawFlag = "no raw face";
      if (!raw.IsNull()) {
        const std::vector<int> r1 = rawIndex.find(e1[0], e1[1]), r2 = rawIndex.find(e2[0], e2[1]);
        const TopoDS_Face rf = q22CommonFace(rawIndex, r1.empty() ? 0 : r1[0], r2.empty() ? 0 : r2[0]);
        if (!rf.IsNull()) rawFlag = q22Flagged(rf, false, e1, e2);
      }
      std::cout << "     q22a flagged: written " << (onWritten ? q22Flagged(wf, true, e1, e2) : "no written face") << ", raw "
                << rawFlag << ", healed yes\n";
      pairs << e1[0].X() << " " << e1[0].Y() << " " << e1[0].Z() << " " << e1[1].X() << " " << e1[1].Y() << " " << e1[1].Z() << " "
            << e2[0].X() << " " << e2[0].Y() << " " << e2[0].Z() << " " << e2[1].X() << " " << e2[1].Y() << " " << e2[1].Z() << " "
            << v.X() << " " << v.Y() << " " << v.Z() << "\n";
    }
  }
  pairs.close();
  std::cout << "   q22a hairpin pairs: " << count << std::endl;
}

/** Q22a step 4, on the old build: the saved pairs' edges in this written body. */
static void q22OldPairs(const ExtrudoFacade& f, const TopoDS_Shape& written, const std::string& pairsFile) {
  std::ifstream in(pairsFile);
  if (!in) {
    std::cout << "   q22a old: no pairs file " << pairsFile << std::endl;
    return;
  }
  Q22EdgeIndex index;
  index.build(written);
  double c[15];
  int n = 0;
  while (in >> c[0]) {
    for (int k = 1; k < 15; ++k) in >> c[k];
    ++n;
    const gp_Pnt e1[2] = {gp_Pnt(c[0], c[1], c[2]), gp_Pnt(c[3], c[4], c[5])};
    const gp_Pnt e2[2] = {gp_Pnt(c[6], c[7], c[8]), gp_Pnt(c[9], c[10], c[11])};
    const gp_Pnt v(c[12], c[13], c[14]);
    const std::vector<int> w1 = index.find(e1[0], e1[1]), w2 = index.find(e2[0], e2[1]);
    const int i1 = w1.empty() ? 0 : w1[0];
    int i2 = 0;
    for (int i : w2)
      if (i != i1) { i2 = i; break; }
    std::cout << "   q22a old pair " << n << ": written edges with edge 1's ends " << w1.size() << ", with edge 2's " << w2.size()
              << "; edge 1 " << (i1 ? q22Describe(f, TopoDS::Edge(index.edges(i1))) : "absent") << ", edge 2 "
              << (i2 ? q22Describe(f, TopoDS::Edge(index.edges(i2))) : "absent");
    if (i1 && i2) {
      const TopoDS_Edge a = TopoDS::Edge(index.edges(i1)), b = TopoDS::Edge(index.edges(i2));
      std::cout << ", angle 3d " << q22Out3d(a, v).Angle(q22Out3d(b, v)) * 180 / M_PI << ", overlap " << q22Overlap(a, b);
      const TopoDS_Face wf = q22CommonFace(index, i1, i2);
      if (!wf.IsNull())
        std::cout << ", angle uv " << std::fabs(q22Out2d(a, wf, v).Angle(q22Out2d(b, wf, v))) * 180 / M_PI << ", written flagged "
                  << q22Flagged(wf, true, e1, e2);
      else
        std::cout << ", no common face";
    }
    std::cout << "\n     q22a old at the vertex:" << q22Touching(f, index, v) << std::endl;
  }
}

/** Q22b: volumes written / raw / read, and the faces whose area moves on the read. */
static void q22Faces(const ExtrudoFacade& f, const TopoDS_Shape& written, const TopoDS_Shape& readBack, const std::string& text) {
  const TopoDS_Shape raw = readStepUnhealed(text);
  std::cout << std::setprecision(12) << "   q22b volume written " << ExtrudoFacade::volumeOf(written) << ", raw "
            << (raw.IsNull() ? 0.0 : ExtrudoFacade::volumeOf(raw)) << ", read " << ExtrudoFacade::volumeOf(readBack)
            << std::setprecision(6) << std::endl;
  std::cout << "   q22b widened circles " << f.hybridWidened_ << ", largest " << f.hybridWidenedMax_ << " mm" << std::endl;
  struct F {
    TopoDS_Face face;
    GeomAbs_SurfaceType type;
    gp_Pnt centre;
    double area;
    bool used = false;
  };
  auto list = [](const TopoDS_Shape& s) {
    std::vector<F> out;
    for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) {
      GProp_GProps props;
      BRepGProp::SurfaceProperties(e.Current(), props);
      out.push_back({TopoDS::Face(e.Current()), BRepAdaptor_Surface(TopoDS::Face(e.Current())).GetType(), props.CentreOfMass(),
                     props.Mass()});
    }
    return out;
  };
  auto describe = [](const F& x) {
    std::map<std::string, int> types;
    for (TopExp_Explorer e(x.face, TopAbs_EDGE); e.More(); e.Next()) types[q22CurveType(TopoDS::Edge(e.Current()))]++;
    std::ostringstream out;
    out << std::setprecision(10) << faceKind(x.face) << " area " << x.area << " centre " << x.centre.X() << " " << x.centre.Y() << " "
        << x.centre.Z() << ", edges";
    for (const auto& [t, n] : types) out << " " << t << " " << n;
    return out.str();
  };
  // The raw read against the written body: the same match, counts only.
  if (!raw.IsNull()) {
    std::vector<F> w0 = list(written), r0 = list(raw);
    int movedRaw = 0, unmatchedRaw = 0;
    for (F& x : w0) {
      int best = -1;
      double bestD = 1e-3;
      for (size_t i = 0; i < r0.size(); ++i) {
        if (r0[i].used || r0[i].type != x.type) continue;
        const double d = r0[i].centre.Distance(x.centre);
        if (d <= bestD) { bestD = d; best = static_cast<int>(i); }
      }
      if (best < 0) {
        ++unmatchedRaw;
        std::cout << "     q22b raw unmatched written face " << describe(x) << "\n";
        continue;
      }
      r0[best].used = true;
      if (std::fabs(std::fabs(r0[best].area) - x.area) / std::max(x.area, 1e-300) > 1e-6) {
        ++movedRaw;
        std::cout << std::setprecision(10) << "     q22b raw moved: written " << describe(x) << " -> raw area " << r0[best].area
                  << std::setprecision(6) << "\n";
      }
    }
    for (const F& x : r0)
      if (!x.used) std::cout << "     q22b raw unmatched raw face " << describe(x) << "\n";
    std::cout << "   q22b raw read: faces with |area| moved > 1e-6 rel " << movedRaw << ", unmatched written " << unmatchedRaw << std::endl;
    int curvedEdges = 0, noPcurve = 0;
    for (TopExp_Explorer fe(raw, TopAbs_FACE); fe.More(); fe.Next()) {
      const TopoDS_Face face = TopoDS::Face(fe.Current());
      if (BRepAdaptor_Surface(face).GetType() == GeomAbs_Plane) continue;
      for (TopExp_Explorer ee(face, TopAbs_EDGE); ee.More(); ee.Next()) {
        double a = 0, b = 0;
        ++curvedEdges;
        if (BRep_Tool::CurveOnSurface(TopoDS::Edge(ee.Current()), face, a, b).IsNull()) ++noPcurve;
      }
    }
    std::cout << "   q22b raw read: edges on curved faces " << curvedEdges << ", without a pcurve " << noPcurve << std::endl;
  }
  std::vector<F> w = list(written), r = list(readBack);
  int moved = 0, unmatched = 0;
  for (F& x : w) {
    int best = -1;
    double bestD = 1e-3;
    for (size_t i = 0; i < r.size(); ++i) {
      if (r[i].used || r[i].type != x.type) continue;
      const double d = r[i].centre.Distance(x.centre);
      if (d <= bestD) { bestD = d; best = static_cast<int>(i); }
    }
    if (best < 0) {
      ++unmatched;
      std::cout << "     q22b unmatched written face " << describe(x) << "\n";
      continue;
    }
    r[best].used = true;
    const double rel = std::fabs(r[best].area - x.area) / std::max(x.area, 1e-300);
    if (rel <= 1e-6) continue;
    ++moved;
    std::map<std::string, int> types;
    bool widened = false;
    for (TopExp_Explorer e(x.face, TopAbs_EDGE); e.More(); e.Next()) {
      const TopoDS_Edge edge = TopoDS::Edge(e.Current());
      types[q22CurveType(edge)]++;
      gp_Pnt a, b;
      Q22EdgeIndex::ends(edge, a, b);
      const ExtrudoFacade::HybridEdgeRecord* rec = q22Record(f, a, b);
      if (rec && rec->widened > 0) widened = true;
    }
    std::cout << std::setprecision(10) << "     q22b face " << faceKind(x.face) << ": written area " << x.area << ", read " << r[best].area
              << " (rel " << rel << "), edges";
    for (const auto& [t, n] : types) std::cout << " " << t << " " << n;
    std::cout << (widened ? ", a widened circle" : ", no widened circle") << std::setprecision(6) << "\n";
  }
  int readUnmatched = 0;
  for (const F& x : r)
    if (!x.used) {
      ++readUnmatched;
      std::cout << "     q22b unmatched read face " << describe(x) << "\n";
    }
  std::cout << "   q22b faces with area moved > 1e-6 rel: " << moved << " of " << w.size() << " (unmatched written " << unmatched
            << ", read " << readUnmatched << ")" << std::endl;
}


/**
 * Q23 (slice D8): the cone faces whose area moves on the default read: UV
 * bounds and area written against read, per edge the pcurves (types, UV
 * distance at the ends and over 9 samples, by the edges' own parameters run
 * the same way), the tolerance, and for a circle its distance to the cone,
 * its axis against the cone's, and its written pcurve against the exact
 * projection (ElSLib's cone parameters of the circle's points).
 */
static void q23Cones(const TopoDS_Shape& written, const TopoDS_Shape& readBack) {
  Q22EdgeIndex readIndex;
  readIndex.build(readBack);
  struct C {
    TopoDS_Face face;
    gp_Pnt centre;
    double area;
  };
  auto cones = [](const TopoDS_Shape& s) {
    std::vector<C> out;
    for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) {
      const TopoDS_Face face = TopoDS::Face(e.Current());
      if (BRepAdaptor_Surface(face).GetType() != GeomAbs_Cone) continue;
      GProp_GProps props;
      BRepGProp::SurfaceProperties(face, props);
      out.push_back({face, props.CentreOfMass(), props.Mass()});
    }
    return out;
  };
  const std::vector<C> w = cones(written), r = cones(readBack);
  int n = 0;
  for (const C& x : w) {
    int best = -1;
    double bestD = 0.05;
    for (size_t i = 0; i < r.size(); ++i) {
      const double d = r[i].centre.Distance(x.centre);
      if (d < bestD) { bestD = d; best = static_cast<int>(i); }
    }
    if (best < 0 || std::fabs(r[best].area - x.area) / x.area <= 1e-6) continue;
    const C& y = r[best];
    ++n;
    double wu0, wu1, wv0, wv1, ru0, ru1, rv0, rv1;
    BRepTools::UVBounds(x.face, wu0, wu1, wv0, wv1);
    BRepTools::UVBounds(y.face, ru0, ru1, rv0, rv1);
    const gp_Cone cone = BRepAdaptor_Surface(x.face).Cone();
    std::cout << std::setprecision(9) << "   q23 cone face " << n << ": area written " << x.area << ", read " << y.area << " ("
              << (y.area / x.area - 1) * 100 << " %), centre moved " << bestD << "; uv written [" << wu0 << ", " << wu1 << "] x ["
              << wv0 << ", " << wv1 << "], read [" << ru0 << ", " << ru1 << "] x [" << rv0 << ", " << rv1 << "]; cone semi-angle "
              << cone.SemiAngle() * 180 / M_PI << " deg, radius " << cone.RefRadius() << "\n";
    for (TopExp_Explorer ee(x.face, TopAbs_EDGE); ee.More(); ee.Next()) {
      const TopoDS_Edge we = TopoDS::Edge(ee.Current());
      gp_Pnt a, b;
      Q22EdgeIndex::ends(we, a, b);
      // The read edge with those ends that bounds the read face.
      TopoDS_Edge re;
      for (int i : readIndex.find(a, b))
        for (const TopoDS_Shape& f : readIndex.faces.FindFromKey(readIndex.edges(i)))
          if (f.IsSame(y.face)) re = TopoDS::Edge(readIndex.edges(i));
      std::cout << "     q23 edge " << q22CurveType(we) << " " << q22Length(we) << ", tol " << BRep_Tool::Tolerance(we);
      if (re.IsNull()) {
        std::cout << ", no read edge on the read face\n";
        continue;
      }
      double wf, wl, rf, rl;
      const Handle(Geom2d_Curve) wc = BRep_Tool::CurveOnSurface(we, x.face, wf, wl);
      const Handle(Geom2d_Curve) rc = BRep_Tool::CurveOnSurface(re, y.face, rf, rl);
      std::cout << ", pcurve written " << pcurveType(wc) << " read " << pcurveType(rc) << ", read tol " << BRep_Tool::Tolerance(re);
      if (!wc.IsNull() && !rc.IsNull()) {
        const bool forward = BRep_Tool::Pnt(TopExp::FirstVertex(re, false)).Distance(BRep_Tool::Pnt(TopExp::FirstVertex(we, false))) <= 1e-6;
        double first = 0, last = 0, mx = 0;
        for (int k = 0; k <= 8; ++k) {
          const double t = k / 8.0;
          const gp_Pnt2d pw = wc->Value(wf + t * (wl - wf));
          gp_Pnt2d pr = rc->Value(forward ? rf + t * (rl - rf) : rl - t * (rl - rf));
          pr.SetX(pr.X() + 2 * M_PI * std::round((pw.X() - pr.X()) / (2 * M_PI)));
          const double d = pw.Distance(pr);
          mx = std::max(mx, d);
          if (k == 0) first = d;
          if (k == 8) last = d;
        }
        std::cout << ", uv ends " << first << " " << last << ", max " << mx;
      }
      if (BRepAdaptor_Curve(we).GetType() == GeomAbs_Circle) {
        const gp_Circ circle = BRepAdaptor_Curve(we).Circle();
        double cf, cl;
        TopLoc_Location loc;
        const Handle(Geom_Curve) c3 = BRep_Tool::Curve(we, loc, cf, cl);
        const Handle(Geom_Surface) surface = BRep_Tool::Surface(x.face);
        double off = 0, exact = 0;
        for (int k = 0; k <= 8; ++k) {
          const double t = cf + (cl - cf) * k / 8.0;
          const gp_Pnt p = c3->Value(t);
          GeomAPI_ProjectPointOnSurf proj(p, surface);
          if (proj.IsDone() && proj.NbPoints() > 0) off = std::max(off, proj.LowerDistance());
          if (!wc.IsNull()) {
            double u = 0, v = 0;
            ElSLib::Parameters(cone, p, u, v);
            const gp_Pnt2d pw = wc->Value(t);
            u += 2 * M_PI * std::round((pw.X() - u) / (2 * M_PI));
            exact = std::max(exact, pw.Distance(gp_Pnt2d(u, v)));
          }
        }
        std::cout << ", circle to cone " << off << " mm, axis angle " << circle.Axis().Angle(cone.Axis()) * 180 / M_PI
                  << " deg, written pcurve vs exact projection " << exact;
      }
      std::cout << "\n";
    }
  }
  std::cout << std::setprecision(6) << "   q23 cone faces whose area moves: " << n << std::endl;
}

/**
 * Converts one file and diagnoses its STEP round trip (ADR-0097 D7): Q1 the
 * written body's edge classes, Q2 what the reader rejects, Q3 the areas by
 * kind, Q4 a ShapeFix_Shape pass at the written tolerances. Prints everything
 * when `detail`, and always returns the summary row.
 */
static RoundTripRow stepOne(ExtrudoFacade& f, const std::string& path, double tolerance, bool detail) {
  RoundTripRow row;
  row.file = path.size() > 5 ? path.substr(5) : path;
  row.tol = tolerance;
  const Mesh m = stlFile(path.c_str());
  f.keepHybridFaces_ = getenv("FACES") && *getenv("FACES");
  if (detail) std::cout << "== step " << row.file << " (" << m.triangles.size() / 3 << " triangles, tol " << tolerance << ")\n";
  f.meshNodes(int(m.nodes.size() / 3));
  double* nodes = reinterpret_cast<double*>(f.meshNodesPtr());
  for (size_t i = 0; i < m.nodes.size(); ++i) nodes[i] = static_cast<float>(m.nodes[i]);
  f.meshTriangles(int(m.triangles.size() / 3));
  std::memcpy(reinterpret_cast<void*>(f.meshTrianglesPtr()), m.triangles.data(), m.triangles.size() * sizeof(uint32_t));
  const double conversionStart = now();
  const int h = f.meshToSolid(1, tolerance);
  row.ms = now() - conversionStart;
  const auto& rep = f.meshReport_;
  if (rep.size() >= 11) row.rebuild = rep[10] == 1 ? "hybrid" : rep[10] == 0 ? "exact" : "refused";
  if (rep.size() >= 12) row.facets = int(rep[11]);
  if (rep.size() >= 13) row.tol = rep[12];
  if (!h) {
    row.rebuild = "refused";
    if (detail) std::cout << "   refused: " << f.lastError() << std::endl;
    return row;
  }
  const TopoDS_Shape& written = *f.find(h);

  // Q1: the written body's edges by class and tolerance.
  double maxVertex = 0;
  const std::map<std::string, ClassStat> classes = edgeClasses(written, maxVertex);
  row.faces = f.count(h, 0);
  if (rep.size() < 12)
    for (TopExp_Explorer e(written, TopAbs_FACE); e.More(); e.Next())
      if (faceKind(TopoDS::Face(e.Current())) == "facet") ++row.facets;
  double maxEdge = 0;
  for (const auto& [cls, st] : classes) maxEdge = std::max(maxEdge, st.maxTol);
  row.maxEdge = maxEdge;
  row.maxVertex = maxVertex;
  {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices, edges;
    TopExp::MapShapes(written, TopAbs_VERTEX, vertices);
    TopExp::MapShapes(written, TopAbs_EDGE, edges);
    row.writtenVertices = vertices.Extent();
    row.writtenEdges = edges.Extent();
  }
  if (detail) {
    std::cout << "   written: faces " << row.faces << ", facets " << row.facets << ", solids " << f.count(h, 3)
              << ", vertices " << row.writtenVertices << ", edges " << row.writtenEdges << ", max edge tol " << maxEdge
              << ", max vertex tol " << maxVertex << ", converted in " << row.ms << " ms\n";
    if (row.rebuild == "hybrid" && !f.hybridChains_.empty())
      std::cout << "   " << f.hybridChains_ << "; kept as polylines: "
                << (f.hybridChainsKept_.empty() ? "none" : f.hybridChainsKept_) << "\n";
    if (row.rebuild == "hybrid" && !f.hybridEnds_.empty()) std::cout << "   " << f.hybridEnds_ << "\n";
    std::cout << "   edge classes (written):\n";
    for (const auto& [cls, st] : classes) {
      std::cout << "     " << cls << ": " << st.count << " edges, invalid " << st.invalid << ", tolerances";
      for (int b = 0; b < 7; ++b) std::cout << " " << BUCKET_NAMES[b] << ":" << st.buckets[b];
      std::cout << ", max " << st.maxTol << "\n";
    }
  }

  // Write to STEP and read back.
  f.clearArgs();
  f.pushArg(h);
  const int size = f.writeStep();
  std::string text;
  if (size > 0) text.assign(reinterpret_cast<const char*>(f.exportTextPtr()), static_cast<size_t>(size));
  f.clearExport();
  const int back = text.empty() ? 0 : f.readStep(text.c_str());
  if (!back) {
    row.backValid = false;
    if (detail) std::cout << "   read back: FAILED (" << f.lastError() << ")\n";
    f.release(h);
    return row;
  }
  const TopoDS_Shape& readBack = *f.find(back);
  row.backValid = BRepCheck_Analyzer(readBack).IsValid();
  row.backFaces = f.count(back, 0);
  row.backSolids = f.count(back, 3);
  {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices, edges;
    TopExp::MapShapes(readBack, TopAbs_VERTEX, vertices);
    TopExp::MapShapes(readBack, TopAbs_EDGE, edges);
    row.backVertices = vertices.Extent();
    row.backEdges = edges.Extent();
  }
  const double writtenVolume = ExtrudoFacade::volumeOf(written);
  row.ratio = writtenVolume != 0 ? ExtrudoFacade::volumeOf(readBack) / writtenVolume : 0;

  // Q2: shapeDiagnose's summary, then BRepCheck's statuses by name.
  f.shapeDiagnose(back);
  if (detail) {
    std::cout << "   step: " << size << " bytes -> read back " << (row.backValid ? "valid" : "invalid") << ", faces "
              << row.backFaces << ", solids " << row.backSolids << ", volume ratio " << row.ratio << "\n";
    if (f.geometry_.size() >= 12)
      std::cout << "   read-back diagnose: max tol vertex " << f.geometry_[0] << ", edge " << f.geometry_[1] << ", face "
                << f.geometry_[2] << "; " << f.geometry_[3] << " vertices, " << f.geometry_[4] << " edges (" << f.geometry_[6]
                << " not same-parameter, " << f.geometry_[11] << " invalid), " << f.geometry_[5] << " faces (" << f.geometry_[7]
                << " split, " << f.geometry_[10] << " invalid), " << f.geometry_[8] << " free, " << f.geometry_[9] << " over-shared\n";
  }
  const std::map<std::string, int> counts = bRepCheckCounts(readBack);
  if (detail && !counts.empty()) {
    std::cout << "   read-back BRepCheck:\n";
    for (const auto& [key, n] : counts) std::cout << "     " << key << " x" << n << "\n";
  }
  if (!counts.empty()) {
    int top = 0;
    for (const auto& [key, n] : counts)
      if (n > top) { top = n; row.topStatus = key + " x" + std::to_string(n); }
  }

  // Q2: the invalid edges by class (on the read-back body) and faces by kind.
  double ignoredVertex = 0;
  const std::map<std::string, ClassStat> backClasses = edgeClasses(readBack, ignoredVertex);
  for (const auto& [cls, st] : backClasses) row.backInvalidEdges += st.invalid;
  int invalidFaces = 0;
  const std::map<std::string, int> badFaces = invalidFacesByKind(readBack, invalidFaces);
  row.backInvalidFaces = invalidFaces;
  if (detail) {
    std::cout << "   invalid edges by class (read back):\n";
    bool any = false;
    for (const auto& [cls, st] : backClasses)
      if (st.invalid) { std::cout << "     " << cls << " x" << st.invalid << "\n"; any = true; }
    if (!any) std::cout << "     none\n";
    std::cout << "   invalid faces by kind (read back):\n";
    if (badFaces.empty()) std::cout << "     none\n";
    for (const auto& [kind, n] : badFaces) std::cout << "     " << kind << " x" << n << "\n";
  }

  // Q3: the summed area per face kind, written against read back.
  const std::map<std::string, std::pair<double, int>> writtenAreas = areaByKind(written);
  const std::map<std::string, std::pair<double, int>> backAreas = areaByKind(readBack);
  if (detail) {
    std::cout << "   area by kind (written -> read back), every file:\n";
    std::set<std::string> kinds;
    for (const auto& [kind, v] : writtenAreas) kinds.insert(kind);
    for (const auto& [kind, v] : backAreas) kinds.insert(kind);
    for (const std::string& kind : kinds) {
      const auto w = writtenAreas.find(kind) == writtenAreas.end() ? std::make_pair(0.0, 0) : writtenAreas.at(kind);
      const auto r = backAreas.find(kind) == backAreas.end() ? std::make_pair(0.0, 0) : backAreas.at(kind);
      std::cout << "     " << kind << ": " << w.first << " (" << w.second << " faces) -> " << r.first << " (" << r.second
                << " faces), delta " << r.first - w.first << "\n";
    }
  }

  // Q14: the read-back faces my classifier calls "other", and the written tori.
  if (detail) {
    for (TopExp_Explorer e(readBack, TopAbs_FACE); e.More(); e.Next()) {
      const TopoDS_Face face = TopoDS::Face(e.Current());
      if (faceKind(face) != "other") continue;
      std::cout << "   q14 other face: read-back " << surfaceTypeName(BRepAdaptor_Surface(face).GetType()) << "\n";
    }
    for (TopExp_Explorer e(written, TopAbs_FACE); e.More(); e.Next()) {
      const TopoDS_Face face = TopoDS::Face(e.Current());
      const BRepAdaptor_Surface surface(face);
      if (surface.GetType() != GeomAbs_Torus) continue;
      const gp_Torus torus = surface.Torus();
      std::cout << "   q14 written torus: R " << torus.MajorRadius() << ", r " << torus.MinorRadius()
                << (torus.MinorRadius() >= torus.MajorRadius() ? " (degenerate)" : "") << "\n";
    }
  }

  // Q4: ShapeFix_Shape on the read-back body at the written tolerances.
  try {
    ShapeFix_Shape fixer(readBack);
    fixer.SetPrecision(maxEdge);
    fixer.SetMaxTolerance(std::max(1.0, 2.0 * maxEdge));
    fixer.Perform();
    const TopoDS_Shape fixed = fixer.Shape();
    row.fixValid = !fixed.IsNull() && BRepCheck_Analyzer(fixed).IsValid();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> fixedFaces;
    TopExp::MapShapes(fixed, TopAbs_FACE, fixedFaces);
    row.fixFaces = fixedFaces.Extent();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> fixedSolids;
    TopExp::MapShapes(fixed, TopAbs_SOLID, fixedSolids);
    row.fixSolidCount = fixedSolids.Extent();
    row.fixRatio = writtenVolume != 0 ? ExtrudoFacade::volumeOf(fixed) / writtenVolume : 0;
  } catch (...) {
    row.fixValid = false;
    row.fixFaces = 0;
    row.fixRatio = 0;
  }
  if (detail)
    std::cout << "   shapefix (precision " << maxEdge << ", max tol " << std::max(1.0, 2.0 * maxEdge) << "): valid "
              << row.fixValid << ", faces " << row.fixFaces << " (of " << row.faces << "), solids " << row.fixSolidCount
              << ", ratio " << row.fixRatio << std::endl;

  // Q7: the same round trip with the writer's global uncertainty set to the
  // body's greatest tolerance ("Greatest"; write.precision.mode 1, the header's
  // enum is Least -1 / Average 0 / Greatest 1 / Session 2). Written with
  // stepDirect: the facade's writeStep() overwrites the transfer parameters, so
  // the static has no effect there.
  try {
    const int previousMode = Interface_Static::IVal("write.precision.mode");
    Interface_Static::SetIVal("write.precision.mode", 1);  // Greatest
    const std::string text2 = stepDirect(written);
    Interface_Static::SetIVal("write.precision.mode", previousMode);
    row.uncertainty = uncertaintyOf(text2);
    const double defaultUncertainty = uncertaintyOf(text);
    if (detail)
      std::cout << "     q7 uncertainty: facade default " << defaultUncertainty << ", greatest (direct writer) "
                << row.uncertainty << ", " << text2.size() << " bytes\n";
    const int back2 = text2.empty() ? 0 : f.readStep(text2.c_str());
    if (back2) {
      const TopoDS_Shape& readBack2 = *f.find(back2);
      row.u2Valid = BRepCheck_Analyzer(readBack2).IsValid();
      row.u2Faces = f.count(back2, 0);
      row.u2Solids = f.count(back2, 3);
      row.u2Ratio = writtenVolume != 0 ? ExtrudoFacade::volumeOf(readBack2) / writtenVolume : 0;
      if (detail) {
        const std::map<std::string, int> counts2 = bRepCheckCounts(readBack2);
        int invalid2 = 0;
        invalidFacesByKind(readBack2, invalid2);
        std::string top2 = "-";
        int topN = 0;
        for (const auto& [key, n] : counts2)
          if (n > topN) { topN = n; top2 = key + " x" + std::to_string(n); }
        std::cout << "   q7 greatest (uncertainty " << row.uncertainty << ", default " << defaultUncertainty
                  << "): read back " << (row.u2Valid ? "valid" : "invalid") << ", faces " << row.u2Faces << ", solids "
                  << row.u2Solids << ", ratio " << row.u2Ratio << ", invalid faces " << invalid2 << ", top status " << top2
                  << std::endl;
      }
      f.release(back2);
    } else if (detail) {
      std::cout << "   q7 greatest: read back FAILED (" << f.lastError() << ")\n";
    }
  } catch (...) {
    Interface_Static::SetIVal("write.precision.mode", 0);
  }

  // Q8/Q12: where the flagged wires and faces are, and their small edges. The
  // "edges < uncertainty" count uses the default round trip's file uncertainty.
  const double defaultUncertainty = uncertaintyOf(text);
  const FlaggedInfo flagged = flaggedWiresAndFaces(readBack, detail, defaultUncertainty);
  row.flaggedWires = flagged.wires;
  row.minFlaggedEdge = flagged.minEdge;
  row.flaggedEdgesBelowUncertainty = flagged.edgesBelowUncertainty;
  if (detail) {
    std::cout << "   q8 flagged: wires " << flagged.wires << " (" << flagged.wiresWithArc << " with a circle/ellipse, "
              << flagged.wiresOnlyLines << " lines only), faces unorientable " << flagged.unorientableFaces
              << ", bad orientation " << flagged.badOrientationFaces << std::endl;
    std::cout << "   q12 small edges: shortest in a flagged wire " << flagged.minEdge << ", edges < uncertainty ("
              << defaultUncertainty << ") " << flagged.edgesBelowUncertainty << ", edges < 0.05 " << flagged.edgesBelow005
              << std::endl;
  }

  // Q15-Q17: classify the flagged wires' self-intersections and check whether
  // the written body already carries them (ADR-0097 2026-10-30b).
  classifySelfIntersections(written, readBack, detail, row);

  // Q18 (slice D8): does the written body's own UV outline cross itself once
  // the vertex tolerances no longer cover the crossing? A copy with every
  // vertex at Precision::Confusion(), BRepCheck_Wire::SelfIntersect per wire.
  {
    TopoDS_Shape tight = BRepBuilderAPI_Copy(written).Shape();
    ShapeFix_ShapeTolerance().SetTolerance(tight, Precision::Confusion(), TopAbs_VERTEX);
    row.q18Written = 0;
    for (TopExp_Explorer fe(tight, TopAbs_FACE); fe.More(); fe.Next()) {
      const TopoDS_Face face = TopoDS::Face(fe.Current());
      for (TopExp_Explorer we(face, TopAbs_WIRE); we.More(); we.Next())
        if (brepCheckFirstPair(TopoDS::Wire(we.Current()), face).found) {
          ++row.q18Written;
          if (detail) std::cout << "     q18 written wire on " << faceKind(face) << "\n";
        }
    }
    if (detail)
      std::cout << "   q18 written wires self-intersecting at vertex tol 1e-7: " << row.q18Written << " (read back flagged "
                << row.flaggedWires << ")" << std::endl;
  }

  // Q19 (slice D8 follow-up): the same written body round-tripped with other
  // STEP precision settings. a) the default file read at a user precision of
  // 1e-3; b) written with the least uncertainty; c) written with a session
  // uncertainty of 1e-3. Each static restored afterwards, as Q7 does.
  {
    row.defaultPass = row.backValid && row.backFaces == row.faces && row.backSolids == f.count(h, 3) &&
                      std::fabs(row.ratio - 1) < 1e-4;
    const char* names[3] = {"read-user-1e-3", "write-least", "write-session-1e-3"};
    const int writeMode = Interface_Static::IVal("write.precision.mode");
    const double writeVal = Interface_Static::RVal("write.precision.val");
    const int readMode = Interface_Static::IVal("read.precision.mode");
    const double readVal = Interface_Static::RVal("read.precision.val");
    for (int v = 0; v < 3; ++v) {
      std::string file = text;
      try {
        if (v == 0) {
          Interface_Static::SetIVal("read.precision.mode", 1);
          Interface_Static::SetRVal("read.precision.val", 1e-3);
        } else {
          Interface_Static::SetIVal("write.precision.mode", v == 1 ? -1 : 2);
          if (v == 2) Interface_Static::SetRVal("write.precision.val", 1e-3);
          file = stepDirect(written);
          Interface_Static::SetIVal("write.precision.mode", writeMode);
          Interface_Static::SetRVal("write.precision.val", writeVal);
        }
        const int b = file.empty() ? 0 : f.readStep(file.c_str());
        Interface_Static::SetIVal("read.precision.mode", readMode);
        Interface_Static::SetRVal("read.precision.val", readVal);
        const double u = uncertaintyOf(file);
        if (!b) {
          if (detail) std::cout << "   q19 " << names[v] << ": file uncertainty " << u << ", read back FAILED" << std::endl;
          continue;
        }
        const TopoDS_Shape& rb = *f.find(b);
        const bool valid = BRepCheck_Analyzer(rb).IsValid();
        const int faces = f.count(b, 0), solids = f.count(b, 3), writtenSolids = f.count(h, 3);
        const double ratio = writtenVolume != 0 ? ExtrudoFacade::volumeOf(rb) / writtenVolume : 0;
        row.q19Flagged[v] = flaggedWiresAndFaces(rb, false, u).wires;
        row.q19Pass[v] = valid && faces == row.faces && solids == writtenSolids && std::fabs(ratio - 1) < 1e-4;
        row.q19FaceDelta[v] = faces - row.faces;
        row.q19SolidDelta[v] = solids - writtenSolids;
        if (detail)
          std::cout << "   q19 " << names[v] << ": file uncertainty " << u << ", read back " << (valid ? "valid" : "invalid")
                    << ", faces " << faces << " (written " << row.faces << "), solids " << solids << ", ratio " << ratio
                    << ", flagged wires " << row.q19Flagged[v] << ", kernel bar " << (row.q19Pass[v] ? "pass" : "fail")
                    << std::endl;
        f.release(b);
      } catch (...) {
        Interface_Static::SetIVal("write.precision.mode", writeMode);
        Interface_Static::SetRVal("write.precision.val", writeVal);
        Interface_Static::SetIVal("read.precision.mode", readMode);
        Interface_Static::SetRVal("read.precision.val", readVal);
        if (detail) std::cout << "   q19 " << names[v] << ": threw" << std::endl;
      }
    }
  }

  // Q20: the reader's healing, operator by operator (FILE=... or Q20=1 on S).
  if (detail && getenv("Q20") && *getenv("Q20")) {
    const double u = uncertaintyOf(text);
    const double maxTol = std::max(u, Interface_Static::RVal("read.maxprecision.val"));
    const int writtenSolids = f.count(h, 3);
    std::cout << "   q20 precision " << u << ", max tolerance " << maxTol << std::endl;
    const TopoDS_Shape raw = readStepUnhealed(text);
    // Measured on a copy too: BRepCheck and the volume don't change it, but be sure.
    const Q20Result off = q20Measure(raw, row.faces, writtenSolids, writtenVolume, u);
    q20Print("healing off", off, row.faces);
    if (!raw.IsNull()) {
      const char* only = getenv("Q20OFF");
      Handle(ShapeBuild_ReShape) history;
      TopoDS_Shape fixedInput;
      const TopoDS_Shape all = fixLikeReader(raw, u, maxTol, nullptr, &history, &fixedInput);
      const Q20Result fixAll = q20Measure(all, row.faces, writtenSolids, writtenVolume, u);
      q20Print("fix all", fixAll, row.faces);
      std::cout << "   q20 fix all vs default read: faces " << fixAll.faces - row.backFaces << ", solids "
                << fixAll.solids - row.backSolids << ", flagged wires " << fixAll.flagged - row.flaggedWires << std::endl;
      std::vector<std::string> restoring;
      for (const auto& [name, tweak] : q20Modes()) {
        if (only && *only && name.find(only) == std::string::npos) continue;
        const Q20Result r = q20Measure(fixLikeReader(raw, u, maxTol, tweak), row.faces, writtenSolids, writtenVolume, u);
        q20Print("fix without " + name, r, row.faces);
      }
      // Step 5: the raw faces the healing splits or changes (image not one face, or other edge count).
      if (getenv("Q20FACES") && *getenv("Q20FACES")) {
        std::vector<WrittenFace> writtenFaces;
        for (TopExp_Explorer e(written, TopAbs_FACE); e.More(); e.Next()) {
          GProp_GProps props;
          BRepGProp::SurfaceProperties(e.Current(), props);
          writtenFaces.push_back({TopoDS::Face(e.Current()), props.CentreOfMass(), props.Mass()});
        }
        std::vector<std::pair<double, std::string>> changed;
        int changedCount = 0, splitCount = 0, goneCount = 0;
        for (TopExp_Explorer e(fixedInput, TopAbs_FACE); e.More(); e.Next()) {
          const TopoDS_Face face = TopoDS::Face(e.Current());
          const TopoDS_Shape image = history->Apply(face);
          const int imageFaces = image.IsNull() ? 0 : countOf(image, TopAbs_FACE);
          const int before = countOf(face, TopAbs_EDGE), after = image.IsNull() ? 0 : countOf(image, TopAbs_EDGE);
          if (imageFaces == 1 && before == after) continue;
          ++changedCount;
          splitCount += imageFaces > 1;
          goneCount += imageFaces == 0;
          double tol = 0.001;
          const int match = matchWrittenFace(face, writtenFaces, tol);
          const TopoDS_Face& source = match >= 0 ? writtenFaces[match].face : face;
          GProp_GProps props;
          BRepGProp::SurfaceProperties(source, props);
          changed.push_back({props.Mass(), std::string(match >= 0 ? "written " : "raw (unmatched) ") +
                                               q20FaceTraits(source, u) + "; healed into " + std::to_string(imageFaces) +
                                               " faces, edges " + std::to_string(before) + " -> " + std::to_string(after)});
        }
        std::sort(changed.begin(), changed.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
        std::cout << "   q20 faces the healing changes: " << changedCount << " (split " << splitCount << ", removed "
                  << goneCount << ")" << std::endl;
        for (size_t i = 0; i < changed.size() && i < 20; ++i) std::cout << "     q20 face " << changed[i].second << std::endl;
      }
    }
  }

  // Q21: the reader's pcurves against ours, and the read-mode matrix (Q21=1).
  if (detail && getenv("Q21") && *getenv("Q21")) {
    const double u = uncertaintyOf(text);
    const int writtenSolids = f.count(h, 3);
    const TopoDS_Shape raw = readStepUnhealed(text);
    if (!raw.IsNull()) q21Pcurves(written, raw, u);
    q21Entities(text);
    const int readMode = Interface_Static::IVal("read.surfacecurve.mode");
    const int writeMode = Interface_Static::IVal("write.precision.mode");
    auto row21 = [&](const std::string& name, const std::string& file, int mode, bool healing) {
      Interface_Static::SetIVal("read.surfacecurve.mode", mode);
      Q20Result r;
      try {
        if (healing) {
          const int b = f.readStep(file.c_str());
          if (b) {
            r = q20Measure(*f.find(b), row.faces, writtenSolids, writtenVolume, uncertaintyOf(file));
            f.release(b);
          }
        } else {
          r = q20Measure(readStepUnhealed(file), row.faces, writtenSolids, writtenVolume, uncertaintyOf(file));
        }
      } catch (...) {
      }
      Interface_Static::SetIVal("read.surfacecurve.mode", readMode);
      q20Print(name, r, row.faces, "q21");
    };
    const std::pair<int, const char*> modes[] = {{0, "0 default"}, {3, "3 3DUse_Preferred"}, {2, "2 2DUse_Preferred"},
                                                 {-3, "-3 3DUse_Forced"}, {-2, "-2 2DUse_Forced"}};
    for (const auto& [mode, name] : modes) {
      row21(std::string("read mode ") + name + ", healing", text, mode, true);
      row21(std::string("read mode ") + name + ", healing off", text, mode, false);
    }
    std::string greatest;
    try {
      Interface_Static::SetIVal("write.precision.mode", 1);
      greatest = stepDirect(written);
    } catch (...) {
    }
    Interface_Static::SetIVal("write.precision.mode", writeMode);
    std::cout << "   q21 greatest file uncertainty " << uncertaintyOf(greatest) << std::endl;
    row21("write greatest, read default", greatest, readMode, true);
    row21("write greatest, read mode -2", greatest, -2, true);
  }

  // Q22 (ADR-0097 slice D8 follow-up): hairpins, drift.
  if (detail && getenv("Q22A") && *getenv("Q22A")) {
    const std::string base = std::filesystem::path(row.file).stem().string();
    const std::string pairsFile = "diag/q22a-pairs-" + base + ".txt";
    if (getenv("Q22OLD") && *getenv("Q22OLD")) q22OldPairs(f, written, pairsFile);
    else q22Hairpins(f, written, readBack, text, pairsFile);
  }
  if (detail && getenv("Q22B") && *getenv("Q22B")) q22Faces(f, written, readBack, text);
  if (detail && getenv("Q23") && *getenv("Q23")) q23Cones(written, readBack);

  // Q9: the BREP round trip (keeps tolerances and pcurves).
  {
    std::ostringstream out;
    BRepTools::Write(written, out);
    std::istringstream in(out.str());
    BRep_Builder builder;
    TopoDS_Shape brepShape;
    BRepTools::Read(brepShape, in, builder);
    const int brepH = f.store(brepShape);
    if (brepH) {
      const TopoDS_Shape& bs = *f.find(brepH);
      row.brepValid = BRepCheck_Analyzer(bs).IsValid();
      row.brepFaces = f.count(brepH, 0);
      row.brepSolids = f.count(brepH, 3);
      row.brepRatio = writtenVolume != 0 ? ExtrudoFacade::volumeOf(bs) / writtenVolume : 0;
      f.release(brepH);
    }
    if (detail)
      std::cout << "   q9 brep (" << out.str().size() << " bytes): " << (row.brepValid ? "valid" : "invalid")
                << ", faces " << row.brepFaces << ", solids " << row.brepSolids << ", ratio " << row.brepRatio << std::endl;
  }

  // Q10: heal a copy, then the STEP round trip of the healed body.
  {
    ShapeFix_Shape healer(BRepBuilderAPI_Copy(written).Shape());
    healer.SetPrecision(maxEdge);
    healer.SetMaxTolerance(std::max(1.0, 2.0 * maxEdge));
    healer.Perform();
    const TopoDS_Shape healed = healer.Shape();
    row.healedValid = !healed.IsNull() && BRepCheck_Analyzer(healed).IsValid();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> healedFaces;
    TopExp::MapShapes(healed, TopAbs_FACE, healedFaces);
    row.healedFaces = healedFaces.Extent();
    const int healedH = f.store(healed);
    if (healedH) {
      f.clearArgs();
      f.pushArg(healedH);
      const int hsize = f.writeStep();
      std::string htext;
      if (hsize > 0) htext.assign(reinterpret_cast<const char*>(f.exportTextPtr()), static_cast<size_t>(hsize));
      f.clearExport();
      const int hback = htext.empty() ? 0 : f.readStep(htext.c_str());
      if (hback) {
        const TopoDS_Shape& hr = *f.find(hback);
        row.healedRtValid = BRepCheck_Analyzer(hr).IsValid();
        row.healedRtFaces = f.count(hback, 0);
        row.healedRtSolids = f.count(hback, 3);
        row.healedRtRatio = writtenVolume != 0 ? ExtrudoFacade::volumeOf(hr) / writtenVolume : 0;
        f.release(hback);
      }
      f.release(healedH);
    }
    if (detail)
      std::cout << "   q10 healed: " << (row.healedValid ? "valid" : "invalid") << ", faces " << row.healedFaces
                << "; healed round trip " << (row.healedRtValid ? "valid" : "invalid") << ", faces " << row.healedRtFaces
                << ", solids " << row.healedRtSolids << ", ratio " << row.healedRtRatio << std::endl;
  }

  // Q11a: no pcurves written (write.surfacecurve.mode 0 = Off), read with the
  // defaults. Written with stepDirect: the facade's writeStep() overwrites the
  // transfer parameters, so the static has no effect there.
  {
    const int previous = Interface_Static::IVal("write.surfacecurve.mode");
    Interface_Static::SetIVal("write.surfacecurve.mode", 0);
    const std::string ntext = stepDirect(written);
    Interface_Static::SetIVal("write.surfacecurve.mode", previous);
    const int nback = ntext.empty() ? 0 : f.readStep(ntext.c_str());
    if (nback) {
      const TopoDS_Shape& nr = *f.find(nback);
      row.nopcValid = BRepCheck_Analyzer(nr).IsValid();
      row.nopcFaces = f.count(nback, 0);
      row.nopcSolids = f.count(nback, 3);
      row.nopcRatio = writtenVolume != 0 ? ExtrudoFacade::volumeOf(nr) / writtenVolume : 0;
      f.release(nback);
    }
    if (detail)
      std::cout << "   q11 no pcurves (" << ntext.size() << " bytes): " << (row.nopcValid ? "valid" : "invalid")
                << ", faces " << row.nopcFaces << ", solids " << row.nopcSolids << ", ratio " << row.nopcRatio << std::endl;
  }

  // Q11b: read with the file's pcurves preferred. read.surfacecurve.mode 2 =
  // 2DUse_Preferred; the brief's -3 is 3DUse_Forced (ignores them). The reader
  // honours statics (STEPControl_Reader::ReadStream calls InitFromStatic), so
  // the facade's readStep is fine here.
  {
    f.clearArgs();
    f.pushArg(h);
    const int psize = f.writeStep();
    std::string ptext;
    if (psize > 0) ptext.assign(reinterpret_cast<const char*>(f.exportTextPtr()), static_cast<size_t>(psize));
    f.clearExport();
    const int previous = Interface_Static::IVal("read.surfacecurve.mode");
    Interface_Static::SetIVal("read.surfacecurve.mode", 2);
    const int pback = ptext.empty() ? 0 : f.readStep(ptext.c_str());
    Interface_Static::SetIVal("read.surfacecurve.mode", previous);
    if (pback) {
      const TopoDS_Shape& pr = *f.find(pback);
      row.pref2dValid = BRepCheck_Analyzer(pr).IsValid();
      row.pref2dFaces = f.count(pback, 0);
      row.pref2dSolids = f.count(pback, 3);
      row.pref2dRatio = writtenVolume != 0 ? ExtrudoFacade::volumeOf(pr) / writtenVolume : 0;
      f.release(pback);
    }
    if (detail)
      std::cout << "   q11 prefer 2D: " << (row.pref2dValid ? "valid" : "invalid") << ", faces " << row.pref2dFaces
                << ", solids " << row.pref2dSolids << ", ratio " << row.pref2dRatio << std::endl;
  }

  f.release(back);
  f.release(h);
  return row;
}

/** The Q6 summary table over every file (ADR-0097 D7 diagnosis). */
static void printSummaryTable(const std::vector<RoundTripRow>& rows) {
  std::cout << "| file | rebuild | tol | faces | facets | max edge tol written | max vertex tol written | back valid | "
               "back faces | back solids | ratio | back invalid edges | back invalid faces | top status | fix valid | "
               "fix faces | fix ratio | u2 valid | u2 faces | u2 solids | u2 ratio | uncertainty |\n";
  std::cout << "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const RoundTripRow& r : rows)
    std::cout << "| " << r.file << " | " << r.rebuild << " | " << r.tol << " | " << r.faces << " | " << r.facets
              << " | " << r.maxEdge << " | " << r.maxVertex << " | " << (r.backValid ? "valid" : "invalid") << " | "
              << r.backFaces << " | " << r.backSolids << " | " << r.ratio << " | " << r.backInvalidEdges << " | "
              << r.backInvalidFaces << " | " << r.topStatus << " | " << (r.fixValid ? "valid" : "invalid") << " | "
              << r.fixFaces << " | " << r.fixRatio << " | " << (r.u2Valid ? "valid" : "invalid") << " | " << r.u2Faces
              << " | " << r.u2Solids << " | " << r.u2Ratio << " | " << r.uncertainty << " |\n";
  std::cout.flush();
}

/** The Q15-Q17 fourth summary table (ADR-0097 2026-10-30b): the flagged wires'
 * self-intersecting pairs, classified, and whether the written body carries
 * them. */
static void printSummaryTable3(const std::vector<RoundTripRow>& rows) {
  std::cout << "\n| file | flagged wires | pairs same-edge / adjacent / non-adjacent | hairpin / 3D-close / 2D-only | "
               "written pairs @1e-7 / @tol | unmatched faces |\n";
  std::cout << "|---|---|---|---|---|---|\n";
  int wires = 0, same = 0, adj = 0, non = 0, hair = 0, close = 0, two = 0, e7 = 0, tol = 0, unmatched = 0;
  for (const RoundTripRow& r : rows) {
    std::cout << "| " << r.file << " | " << r.flaggedWires << " | " << r.q15SameEdge << " / " << r.q15Adjacent << " / "
              << r.q15NonAdjacent << " | " << r.q17Hairpin << " / " << r.q17ThreeDClose << " / " << r.q17TwoDOnly << " | "
              << r.q16PairsOneE7 << " / " << r.q16PairsTol << " | " << r.q16Unmatched << " |\n";
    wires += r.flaggedWires;
    same += r.q15SameEdge;
    adj += r.q15Adjacent;
    non += r.q15NonAdjacent;
    hair += r.q17Hairpin;
    close += r.q17ThreeDClose;
    two += r.q17TwoDOnly;
    e7 += r.q16PairsOneE7;
    tol += r.q16PairsTol;
    unmatched += r.q16Unmatched;
  }
  std::cout << "| **totals** | " << wires << " | " << same << " / " << adj << " / " << non << " | " << hair << " / " << close
            << " / " << two << " | " << e7 << " / " << tol << " | " << unmatched << " |\n";
  std::cout.flush();
}

/** The Q15b/Q17b fifth summary table (ADR-0097 2026-10-30b): BRepCheck_Wire's
 * own first pair per flagged wire, classified. */
static void printSummaryTable4(const std::vector<RoundTripRow>& rows) {
  std::cout << "\n| file | BRepCheck pairs | same-edge | hairpin | 3D-close | 2D-only |\n";
  std::cout << "|---|---|---|---|---|---|\n";
  int pairs = 0, same = 0, hair = 0, close = 0, two = 0;
  for (const RoundTripRow& r : rows) {
    std::cout << "| " << r.file << " | " << r.q15bPairs << " | " << r.q17bSameEdge << " | " << r.q17bHairpin << " | "
              << r.q17bThreeDClose << " | " << r.q17bTwoDOnly << " |\n";
    pairs += r.q15bPairs;
    same += r.q17bSameEdge;
    hair += r.q17bHairpin;
    close += r.q17bThreeDClose;
    two += r.q17bTwoDOnly;
  }
  std::cout << "| **totals** | " << pairs << " | " << same << " | " << hair << " | " << close << " | " << two << " |\n";
  std::cout.flush();
}

/** The Q9-Q12 second summary table (ADR-0097 2026-10-30b). */
static void printSummaryTable2(const std::vector<RoundTripRow>& rows) {
  std::cout << "\n| file | rebuild | brep valid | brep faces | brep solids | brep ratio | healed valid | healed faces | "
               "healed rt valid | healed rt faces | healed rt solids | healed rt ratio | nopc valid | nopc faces | nopc "
               "solids | nopc ratio | pref2d valid | pref2d faces | pref2d solids | pref2d ratio | flagged wires | min "
               "edge in flagged | edges < uncertainty | written vertices->back vertices | written edges->back edges |\n";
  std::cout << "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  for (const RoundTripRow& r : rows)
    std::cout << "| " << r.file << " | " << r.rebuild << " | " << (r.brepValid ? "valid" : "invalid") << " | " << r.brepFaces
              << " | " << r.brepSolids << " | " << r.brepRatio << " | " << (r.healedValid ? "valid" : "invalid") << " | "
              << r.healedFaces << " | " << (r.healedRtValid ? "valid" : "invalid") << " | " << r.healedRtFaces << " | "
              << r.healedRtSolids << " | " << r.healedRtRatio << " | " << (r.nopcValid ? "valid" : "invalid") << " | "
              << r.nopcFaces << " | " << r.nopcSolids << " | " << r.nopcRatio << " | " << (r.pref2dValid ? "valid" : "invalid")
              << " | " << r.pref2dFaces << " | " << r.pref2dSolids << " | " << r.pref2dRatio << " | " << r.flaggedWires
              << " | " << r.minFlaggedEdge << " | " << r.flaggedEdgesBelowUncertainty << " | " << r.writtenVertices << "->"
              << r.backVertices << " | " << r.writtenEdges << "->" << r.backEdges << " |\n";
  std::cout.flush();
}

/** Runs meshRegions on `m` (the region preview, no solid); prints its surfaces by kind, the report and the time. */
static void regions(ExtrudoFacade& f, const char* name, const Mesh& m, double tolerance) {
  const double t0 = now();
  f.meshNodes(int(m.nodes.size() / 3));
  double* nodes = reinterpret_cast<double*>(f.meshNodesPtr());
  for (size_t i = 0; i < m.nodes.size(); ++i) nodes[i] = static_cast<float>(m.nodes[i]);
  f.meshTriangles(int(m.triangles.size() / 3));
  std::memcpy(reinterpret_cast<void*>(f.meshTrianglesPtr()), m.triangles.data(), m.triangles.size() * sizeof(uint32_t));
  if (getenv("PIECES") && *getenv("PIECES")) {
    // Every surface of the segmentation: kind, regions, area and its numbers.
    ExtrudoFacade::MeshSegmentation seg;
    if (f.segmentMesh(tolerance, seg)) {
      for (const auto& s : seg.surfaces) {
        std::cout << "     surface kind " << s.kind << " regions " << s.regions.size() << " area " << s.area << " r " << s.radius
                  << " R " << s.majorRadius << " at " << s.origin.X() << "," << s.origin.Y() << "," << s.origin.Z() << " dir "
                  << s.direction.X() << "," << s.direction.Y() << "," << s.direction.Z() << " dev " << s.deviation << "\n";
      }
    }
  }
  const int ok = f.meshRegions(tolerance);
  const double ms = now() - t0;
  std::cout << "== regions " << name << " (" << m.triangles.size() / 3 << " triangles, tol " << tolerance << "): " << ms << " ms\n";
  if (!ok) {
    std::cout << "   failed: " << f.lastError() << "\n";
    ++failures;
    return;
  }
  std::map<int, int> byKind;
  const int32_t* kinds = reinterpret_cast<const int32_t*>(f.meshRegionKindsPtr());
  for (int s = 0; s < f.meshRegionCount(); ++s) byKind[kinds[s]]++;
  const int32_t* of = reinterpret_cast<const int32_t*>(f.meshRegionsPtr());
  int unassigned = 0;
  for (int t = 0; t < f.meshRegionTriangles(); ++t) unassigned += of[t] < 0 || of[t] >= f.meshRegionCount();
  std::cout << "   " << f.meshRegionCount() << " surfaces:";
  for (auto& [k, n] : byKind)
    std::cout << " " << n
              << (k == 0 ? " plane" : k == 1 ? " cylinder" : k == 2 ? " cone" : k == 3 ? " sphere" : k == 4 ? " torus" : k < 0 ? " unfit" : " other");
  std::cout << "; " << f.meshRegionTriangles() << " triangles mapped, " << unassigned << " unassigned\n";
  const auto& r = f.meshReport_;
  std::cout << "   report: planes " << r[1] << ", cylinders " << r[2] << ", cones " << r[3] << ", spheres " << r[4] << ", tori " << r[5]
            << ", unfit " << r[6] << " regions / " << r[7]
            << " triangles / " << r[8] << ", suggested " << r[9] << "\n";
  if (unassigned) ++failures;
  f.clearMeshRegions();
}

/** Case f/F: one file from /stl (STL_DIR) through meshRegions, then meshToSolid prismatic, at `tolerance`. */
static void file(ExtrudoFacade& f, const std::string& path, double tolerance) {
  const Mesh m = stlFile(path.c_str());
  std::cout << "== file " << path.substr(5) << " (" << m.triangles.size() / 3 << " triangles, tol " << tolerance << ")" << std::endl;
  auto stage = [&] {
    f.meshNodes(int(m.nodes.size() / 3));
    double* nodes = reinterpret_cast<double*>(f.meshNodesPtr());
    for (size_t i = 0; i < m.nodes.size(); ++i) nodes[i] = static_cast<float>(m.nodes[i]);
    f.meshTriangles(int(m.triangles.size() / 3));
    std::memcpy(reinterpret_cast<void*>(f.meshTrianglesPtr()), m.triangles.data(), m.triangles.size() * sizeof(uint32_t));
  };
  stage();
  if (getenv("UNFIT") && *getenv("UNFIT")) {
    // Every unfit surface: triangles, area, box, the kinds of its neighbours, each kind's fit deviation, the thinnest triangle.
    ExtrudoFacade::MeshSegmentation seg;
    if (f.segmentMesh(tolerance, seg)) {
      std::vector<int> surfaceOf(seg.regions.size(), -1);
      for (size_t i = 0; i < seg.surfaces.size(); ++i)
        for (int r : seg.surfaces[i].regions) surfaceOf[r] = int(i);
      for (size_t i = 0; i < seg.surfaces.size(); ++i) {
        const auto& s = seg.surfaces[i];
        if (s.kind >= 0) continue;
        std::vector<int> nodes, triangles;
        double lo[3] = {1e300, 1e300, 1e300}, hi[3] = {-1e300, -1e300, -1e300}, thinnest = 1e300, longest = 0;
        std::map<int, int> neighbours;
        for (int r : s.regions) {
          nodes.insert(nodes.end(), seg.regions[r].nodes.begin(), seg.regions[r].nodes.end());
          triangles.insert(triangles.end(), seg.regions[r].triangles.begin(), seg.regions[r].triangles.end());
          for (int o : seg.regionNeighbours[r])
            if (surfaceOf[o] != int(i)) neighbours[surfaceOf[o]]++;
        }
        std::sort(nodes.begin(), nodes.end());
        nodes.erase(std::unique(nodes.begin(), nodes.end()), nodes.end());
        for (int n : nodes) {
          const gp_XYZ p = f.meshNode(n);
          for (int k = 0; k < 3; ++k) lo[k] = std::min(lo[k], p.Coord(k + 1)), hi[k] = std::max(hi[k], p.Coord(k + 1));
        }
        for (int t : triangles) {
          const gp_XYZ a = f.meshNode(int(f.meshTriangles_[3 * t])), b = f.meshNode(int(f.meshTriangles_[3 * t + 1])),
                       c = f.meshNode(int(f.meshTriangles_[3 * t + 2]));
          const double e = std::max({(b - a).Modulus(), (c - b).Modulus(), (a - c).Modulus()});
          longest = std::max(longest, e);
          if (e > 0) thinnest = std::min(thinnest, 2 * seg.areas[t] / e);
        }
        gp_XYZ outward(0, 0, 0);
        for (int t : triangles) outward += seg.areas[t] * seg.normals[t];
        if (outward.Modulus() < 1e-300) outward = gp_XYZ(0, 0, 1);
        const ExtrudoFacade::MeshFit fits[5] = {f.fitMeshPlane(nodes, outward), f.fitMeshCylinder(nodes, triangles, seg.normals, seg.areas),
                                                f.fitMeshCone(nodes, triangles, seg.normals, seg.areas), f.fitMeshSphere(nodes),
                                                f.fitMeshTorus(nodes, triangles, seg.normals, seg.areas, tolerance)};
        std::cout << std::setprecision(5) << "   unfit surface " << i << ": " << s.regions.size() << " regions, " << triangles.size()
                  << " triangles, " << nodes.size() << " nodes, area " << s.area << " (" << 100 * s.area / seg.meshArea << " %), box ["
                  << lo[0] << "," << lo[1] << "," << lo[2] << " .. " << hi[0] << "," << hi[1] << "," << hi[2] << "], thinnest triangle "
                  << thinnest << ", longest edge " << longest << ", dev " << s.deviation << "\n     fits pl/cy/co/sp/to:";
        for (const auto& fit : fits) {
          if (fit.ok) std::cout << " " << fit.deviation;
          else std::cout << " -";
        }
        std::cout << " (sp r " << fits[3].radius << ", cy r " << fits[1].radius << ", to R " << fits[4].majorRadius << " r " << fits[4].radius
                  << ")\n     neighbours:";
        for (const auto& [o, borders] : neighbours) {
          const auto& n = seg.surfaces[o];
          std::cout << " " << o << "(kind " << n.kind << ", r " << n.radius << ", area " << n.area << ")";
        }
        std::cout << std::setprecision(6) << std::endl;
        if (std::string(getenv("UNFIT")) == "2") {
          // UNFIT=2: its 20 largest planar regions.
          std::vector<int> order(s.regions);
          std::sort(order.begin(), order.end(), [&](int a, int b) { return seg.regions[a].area > seg.regions[b].area; });
          {
            std::vector<double> sizes;
            for (int r : s.regions) sizes.push_back(seg.regions[r].area);
            std::sort(sizes.begin(), sizes.end());
            const double median = sizes[(sizes.size() - 1) / 2];
            int large = 0;
            for (double a : sizes) large += a >= 4 * median;
            std::cout << "       median region area " << median << ", " << large << " of " << sizes.size() << " at 4 x or more\n";
          }
          for (size_t k = 0; k < order.size() && k < 20; ++k) {
            const auto& r = seg.regions[order[k]];
            std::cout << "       region " << order[k] << " area " << r.area << " triangles " << r.triangles.size() << " nodes " << r.nodes.size()
                      << " normal " << r.normal.X() << "," << r.normal.Y() << "," << r.normal.Z() << " at " << r.origin.X() << "," << r.origin.Y()
                      << "," << r.origin.Z() << "\n";
          }
        }
      }
    }
    stage();
  }
  if (getenv("PIECES") && *getenv("PIECES")) {
    // How many surfaces each region is in: exactly one, or the segmentation lost or doubled it.
    ExtrudoFacade::MeshSegmentation seg;
    if (f.segmentMesh(tolerance, seg)) {
      std::vector<int> in(seg.regions.size(), 0);
      for (const auto& surface : seg.surfaces)
        for (int r : surface.regions) in[r]++;
      int none = 0, many = 0;
      for (int c : in) none += c == 0, many += c > 1;
      std::cout << "   coverage: " << seg.regions.size() << " regions, " << none << " in no surface, " << many << " in several" << std::endl;
      if (!(getenv("SEGMENT") && *getenv("SEGMENT"))) {
        // Each surface before and after rebuildPrismatic's snaps, with the farthest of its own nodes.
        std::vector<ExtrudoFacade::MeshSurface> before = seg.surfaces;
        const std::string why = "refused";
        f.keepRebuildFaces_ = getenv("GAPS") && *getenv("GAPS");
        Handle(ExtrudoFacade::MeshDeadline) deadline = new ExtrudoFacade::MeshDeadline(ExtrudoFacade::nowMs() + 30000);
        int h = 0;
        try {
          h = f.rebuildPrismatic(tolerance, seg.surfaces, seg.regions, seg.regionOf, seg.regionNeighbours, seg.normals, seg.areas,
                                 seg.meshArea, seg.meshVolume, why, deadline);
        } catch (...) {
        }
        if (h) f.release(h);
        if (getenv("GAPS") && *getenv("GAPS") && f.rebuildFaces_.size() == seg.surfaces.size()) {
          // Neighbouring surfaces whose oversized faces don't meet: a gap MakerVolume can't close.
          std::vector<int> surfaceOf(seg.regions.size(), -1);
          for (size_t i = 0; i < seg.surfaces.size(); ++i)
            for (int r : seg.surfaces[i].regions) surfaceOf[r] = int(i);
          std::set<std::pair<int, int>> pairs;
          for (size_t r = 0; r < seg.regions.size(); ++r)
            for (int o : seg.regionNeighbours[r])
              if (surfaceOf[r] < surfaceOf[o]) pairs.insert({surfaceOf[r], surfaceOf[o]});
          std::cout << "     MakerVolume warnings: " << f.rebuildWarnings_ << std::endl;
          for (size_t i = 0; i < f.rebuildFaces_.size(); ++i) {
            if (f.rebuildFaces_[i].IsNull() || seg.surfaces[i].kind <= 0) continue;
            double u0, u1, v0, v1;
            BRepTools::UVBounds(TopoDS::Face(f.rebuildFaces_[i]), u0, u1, v0, v1);
            std::cout << "     face " << i << " kind " << seg.surfaces[i].kind << " u " << u0 << " .. " << u1 << " v " << v0 << " .. " << v1 << std::endl;
          }
          for (const auto& [a, b] : pairs) {
            if (f.rebuildFaces_[a].IsNull() || f.rebuildFaces_[b].IsNull()) continue;
            BRepExtrema_DistShapeShape d(f.rebuildFaces_[a], f.rebuildFaces_[b]);
            if (!d.IsDone() || d.Value() > 1e-7)
              std::cout << "     gap between surface " << a << " (kind " << seg.surfaces[a].kind << ") and " << b << " (kind "
                        << seg.surfaces[b].kind << "): " << (d.IsDone() ? d.Value() : -1.0) << std::endl;
          }
        }
        auto farthest = [&](const ExtrudoFacade::MeshSurface& surface) {
          double d = 0;
          for (int r : surface.regions)
            for (int n : seg.regions[r].nodes) d = std::max(d, ExtrudoFacade::distanceToSurface(surface, f.meshNode(n)));
          return d;
        };
        // The surfaces as fitted, then as rebuilt (same surfaces merged, snapped).
        for (int pass = 0; pass < 2; ++pass)
        for (size_t i = 0; i < (pass ? seg.surfaces : before).size(); ++i) {
          const auto &a = (pass ? seg.surfaces : before)[i], &b = a;
          if (i == 0) std::cout << (pass ? "   rebuilt:" : "   fitted:") << std::endl;
          std::cout << std::setprecision(9) << "     surface " << i << " kind " << a.kind << " regions " << a.regions.size() << " area " << a.area
                    << " r " << a.radius << " R " << a.majorRadius << " at " << a.origin.X() << "," << a.origin.Y() << "," << a.origin.Z() << " dir "
                    << a.direction.X() << "," << a.direction.Y() << "," << a.direction.Z() << " sag " << a.sag << " off " << farthest(a) << std::setprecision(6)
                    << std::endl;
        }
        stage();
      }
    }
  }
  if (getenv("SEGMENT") && *getenv("SEGMENT")) return;
  double t0 = now();
  const int ok = f.meshRegions(tolerance);
  std::cout << "   regions " << (ok ? std::to_string(f.meshRegionCount()) : std::string("failed: ") + f.lastError()) << " ("
            << now() - t0 << " ms)";
  if (ok && f.meshReport_.size() >= 10) {
    const auto& r = f.meshReport_;
    std::cout << " pl/cy/co/sp/to " << r[1] << "/" << r[2] << "/" << r[3] << "/" << r[4] << "/" << r[5] << ", unfit " << r[6];
  }
  std::cout << std::endl;
  f.clearMeshRegions();
  stage();
  t0 = now();
  f.keepHybridFaces_ = getenv("FACES") && *getenv("FACES");
  const int h = f.meshToSolid(1, tolerance);
  const double ms = now() - t0;
  if (f.keepHybridFaces_)
    for (const auto& line : f.hybridFaces_) std::cout << "   hybrid " << line << std::endl;
  if (f.keepHybridFaces_ && !f.hybridInvalid_.IsNull()) {
    // What BRepCheck says about the unified result that failed.
    BRepCheck_Analyzer analyzer(f.hybridInvalid_);
    std::map<std::string, int> counts;
    const std::pair<TopAbs_ShapeEnum, const char*> types[] = {{TopAbs_VERTEX, "vertex"}, {TopAbs_EDGE, "edge"}, {TopAbs_WIRE, "wire"},
                                                             {TopAbs_FACE, "face"}, {TopAbs_SHELL, "shell"}, {TopAbs_SOLID, "solid"}};
    for (const auto& [type, name] : types) {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> shapes;
      TopExp::MapShapes(f.hybridInvalid_, type, shapes);
      for (int i = 1; i <= shapes.Extent(); ++i) {
        Handle(BRepCheck_Result) r = analyzer.Result(shapes(i));
        if (r.IsNull()) continue;
        for (BRepCheck_Status st : r->Status())
          if (st != BRepCheck_NoError) counts[std::string(name) + " " + std::to_string(int(st))]++;
        for (r->InitContextIterator(); r->MoreShapeInContext(); r->NextShapeInContext())
          for (BRepCheck_Status st : r->StatusOnShape())
            if (st != BRepCheck_NoError) counts[std::string(name) + " in context " + std::to_string(int(st))]++;
      }
    }
    std::cout << "   invalid after unify: valid " << analyzer.IsValid() << ", " << counts.size() << " kinds of status" << std::endl;
    for (const auto& [k, n] : counts) std::cout << "   invalid after unify: " << k << " x" << n << std::endl;
    f.hybridInvalid_.Nullify();
  }
  if (getenv("TIMES") && *getenv("TIMES")) {
    double rebuild = 0;
    for (const auto& [name, stageMs] : f.rebuildTimes_) rebuild += stageMs;
    std::cout << "   times: segmentation and fits " << ms - rebuild;
    for (const auto& [name, stageMs] : f.rebuildTimes_) std::cout << ", " << name << " " << stageMs;
    std::cout << " ms" << std::endl;
    if (!h && !f.rebuildRefusal_.empty()) std::cout << "   rebuild refused at: " << f.rebuildRefusal_ << std::endl;
    if (!h && !f.hybridRefusal_.empty()) std::cout << "   hybrid refused at: " << f.hybridRefusal_ << std::endl;
    std::cout << "   hybrid exploded regions: " << f.hybridExploded_ << std::endl;
    std::cout << "   calls: chainCurve " << f.chainCurveCalls_ << ", interpolate " << f.interpolateCalls_ << ", mesh check nodes " << f.meshCheckNodes_ << ", of them by BRepExtrema " << f.meshCheckExtrema_ << ", face classifiers " << f.meshCheckClassifiers_ << " built in " << f.meshCheckClassifierMs_ << " ms, classifying " << f.meshCheckClassifyMs_ << " ms" << std::endl;
  }
  if (!h) {
    std::cout << "   prismatic refused (" << ms << " ms): " << f.lastError() << std::endl;
    return;
  }
  double meshVolume = 0;
  for (size_t t = 0; t < m.triangles.size(); t += 3) {
    const double* a = &m.nodes[3 * m.triangles[t]];
    const double* b = &m.nodes[3 * m.triangles[t + 1]];
    const double* c = &m.nodes[3 * m.triangles[t + 2]];
    meshVolume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  const TopoDS_Shape& s = *f.find(h);
  const double v = ExtrudoFacade::volumeOf(s);
  const auto& rep = f.meshReport_;
  if (rep.size() >= 13) std::cout << "   rebuild " << (rep[10] == 1 ? "hybrid" : "exact") << ", facets " << rep[11]
                                  << ", tolerance " << rep[12] << ", exploded " << f.hybridExploded_
                                  << ", pl/cy/co/sp/to " << rep[1] << "/" << rep[2] << "/" << rep[3] << "/" << rep[4] << "/" << rep[5] << std::endl;
  else if (rep.size() >= 12) std::cout << "   rebuild " << (rep[10] == 1 ? "hybrid" : "exact") << ", facets " << rep[11] << ", exploded " << f.hybridExploded_
                                       << ", pl/cy/co/sp/to " << rep[1] << "/" << rep[2] << "/" << rep[3] << "/" << rep[4] << "/" << rep[5] << std::endl;
  if (rep.size() >= 11 && rep[10] == 1 && !f.hybridChains_.empty())
    std::cout << "   " << f.hybridChains_ << "; kept as polylines: " << (f.hybridChainsKept_.empty() ? "none" : f.hybridChainsKept_) << std::endl;
  {
    // The result's edges by curve type (slice D3 collapses chains into lines, circles and ellipses).
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(s, TopAbs_EDGE, edges);
    int circles = 0, ellipses = 0, lines = 0;
    for (int i = 1; i <= edges.Extent(); ++i) {
      const GeomAbs_CurveType type = BRepAdaptor_Curve(TopoDS::Edge(edges(i))).GetType();
      circles += type == GeomAbs_Circle;
      ellipses += type == GeomAbs_Ellipse;
      lines += type == GeomAbs_Line;
    }
    std::cout << "   edges " << edges.Extent() << " (" << lines << " lines, " << circles << " circles, " << ellipses << " ellipses)" << std::endl;
  }
  std::cout << "   prismatic " << f.count(h, 0) << " faces:" << kinds(s) << ", valid " << BRepCheck_Analyzer(s).IsValid() << ", volume "
            << v << " / mesh " << meshVolume << " = " << v / meshVolume << " (" << ms << " ms)" << std::endl;
  f.release(h);
}

static double noise32(int ring, int i) { return 0.005 * (ring == 0 ? std::sin(1.7 * i + 0.3) : std::cos(2.3 * i + 0.1)); }

int main(int argc, char** argv) {
  ExtrudoFacade f;
  // BUDGET=ms lowers the rebuild's budget (PRISMATIC_REBUILD_BUDGET_MS), to see it hit; HYBRID_BUDGET=ms the hybrid's.
  if (getenv("BUDGET") && *getenv("BUDGET")) f.prismaticBudgetMs_ = std::atof(getenv("BUDGET"));
  if (getenv("HYBRID_BUDGET") && *getenv("HYBRID_BUDGET")) f.hybridBudgetMs_ = std::atof(getenv("HYBRID_BUDGET"));
  const std::string only = argc > 1 ? argv[1] : "";
  const double envTol = getenv("TOL") && *getenv("TOL") ? std::atof(getenv("TOL")) : 0.01;
  if (only == "f") {
    file(f, std::string("/stl/") + (getenv("FILE") ? getenv("FILE") : ""), envTol);
    std::cout << "live shapes " << f.liveShapes() << "\n";
    return 0;
  }
  if (only == "F") {
    // Every .stl under /stl in one process: state left by one file shows in the next.
    std::vector<std::string> paths;
    for (const auto& e : std::filesystem::recursive_directory_iterator("/stl"))
      if (e.is_regular_file() && (e.path().extension() == ".stl" || e.path().extension() == ".mesh")) paths.push_back(e.path().string());
    std::sort(paths.begin(), paths.end());
    for (const auto& p : paths) file(f, p, envTol);
    std::cout << "live shapes " << f.liveShapes() << "\n";
    return 0;
  }
  if (only == "s") {
    // One corpus file, then the STEP round-trip diagnosis (ADR-0097 D7): STL_DIR mounted at /stl, FILE, TOL.
    printStepSettings();
    const char* file = getenv("FILE");
    if (!file || !*file) {
      std::cout << "== step: set FILE (with STL_DIR mounted at /stl), e.g. FILE=own/drill-block.stl\n";
    } else {
      stepOne(f, std::string("/stl/") + file, envTol, true);
    }
    std::cout << "live shapes " << f.liveShapes() << std::endl;
    return 0;
  }
  if (only == "S") {
    // Every .stl under /stl, one process: the diagnosis per file and a summary table at the end.
    printStepSettings();
    std::vector<std::string> paths;
    for (const auto& e : std::filesystem::recursive_directory_iterator("/stl"))
      if (e.is_regular_file() && (e.path().extension() == ".stl" || e.path().extension() == ".mesh")) paths.push_back(e.path().string());
    std::sort(paths.begin(), paths.end());
    std::vector<RoundTripRow> rows;
    for (const auto& p : paths) {
      try {
        rows.push_back(stepOne(f, p, envTol, true));
      } catch (...) {
        RoundTripRow r;
        r.file = p.size() > 5 ? p.substr(5) : p;
        r.rebuild = "crash";
        rows.push_back(r);
        std::cout << "   CRASH on " << r.file << std::endl;
      }
      std::cout.flush();
    }
    printSummaryTable(rows);
    printSummaryTable2(rows);
    printSummaryTable3(rows);
    printSummaryTable4(rows);
    std::cout << "live shapes " << f.liveShapes() << std::endl;
    return 0;
  }
  auto want = [&](const char* id) { return only.empty() || only == id; };
  if (want("g")) {
    // Faceted on one corpus file: STL_DIR=... FILE=x.stl bash run.sh prismatic g
    const char* file = getenv("FILE");
    if (!file || !*file) {
      std::cout << "== faceted: set FILE (with STL_DIR mounted at /stl), e.g. FILE=third-party/wyze-garage-bracket.stl\n";
    } else {
      int h = runFaceted(f, file, stlFile((std::string("/stl/") + file).c_str()), 0.01);
      if (h) f.release(h);
    }
  }
  if (want("1")) {
    int h = run(f, "1 cube.stl", stlFile("/repo/fixtures/imports/cube.stl"), 0.01, 8000);
    if (h) f.release(h);
  }
  const double cylVolume = M_PI * 25 * 20;
  if (want("2")) { int h = run(f, "2 cylinder 32", cylinder(5, 20, 32), 0.01, cylVolume); if (h) f.release(h); }
  if (want("3")) { int h = run(f, "3 cylinder 360", cylinder(5, 20, 360), 0.01, cylVolume); if (h) f.release(h); }
  if (want("4")) { int h = run(f, "4 cylinder 16", cylinder(5, 20, 16), 0.01, cylVolume); if (h) f.release(h); }
  if (want("5") || want("11")) {
    TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 5).Shape();
    TopoDS_Shape drill = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 15, -1), gp_Dir(0, 0, 1)), 3, 7).Shape();
    TopoDS_Shape plate = BRepAlgoAPI_Cut(box, drill).Shape();
    const double exact = 6000 - 45 * M_PI;
    if (want("5")) {
      int h = run(f, "5 plate with hole, fine", meshOf(plate, 0.001, 0.05), 0.01, exact);
      if (h) {
        // A 1 mm fillet on the hole's top edge (a circle at z = 5).
        const TopoDS_Shape& s = *f.find(h);
        BRepFilletAPI_MakeFillet fillet(s);
        int circles = 0;
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
        TopExp::MapShapes(s, TopAbs_EDGE, edges);
        for (int i = 1; i <= edges.Extent(); ++i) {
          BRepAdaptor_Curve c(TopoDS::Edge(edges(i)));
          if (c.GetType() == GeomAbs_Circle) {
            ++circles;
            if (c.Value(c.FirstParameter()).Z() > 4.9) fillet.Add(1.0, TopoDS::Edge(edges(i)));
          }
        }
        fillet.Build();
        std::cout << "   circle edges " << circles << ", fillet r1 on the top one: done " << fillet.IsDone();
        if (fillet.IsDone()) std::cout << ", valid " << BRepCheck_Analyzer(fillet.Shape()).IsValid() << ", faces " << kinds(fillet.Shape());
        std::cout << "\n";
        f.release(h);
      }
    }
    if (want("11")) {
      int h = run(f, "11a plate with hole, ~20k triangles", meshOf(plate, 0.0002, 0.01), 0.01, exact);
      if (h) f.release(h);
    }
  }
  if (want("6")) {
    TopoDS_Shape box = BRepPrimAPI_MakeBox(20, 20, 20).Shape();
    BRepFilletAPI_MakeFillet fillet(box);
    TopExp_Explorer e(box, TopAbs_EDGE);
    fillet.Add(2.0, TopoDS::Edge(e.Current()));
    TopoDS_Shape rounded = fillet.Shape();
    const double exact = ExtrudoFacade::volumeOf(rounded);
    int h = run(f, "6a filleted box, fine", meshOf(rounded, 0.001, 0.05), 0.01, exact);
    if (h) f.release(h);
    TopoDS_Shape again = BRepBuilderAPI_Copy(rounded).Shape();
    h = run(f, "6b filleted box, coarse (8 segments)", meshOf(again, 1, M_PI / 16 + 1e-3), 0.01, exact);
    if (h) f.release(h);
  }
  if (want("7")) { int h = run(f, "7 sphere r10", sphere(10, 24, 48), 0.01); if (h) f.release(h); }
  if (want("8")) {
    BRepBuilderAPI_MakePolygon polygon;
    const int steps = 299;
    polygon.Add(gp_Pnt(0, 0, 0));
    polygon.Add(gp_Pnt(steps, 0, 0));
    for (int i = 0; i < steps; ++i) {
      polygon.Add(gp_Pnt(steps - i, i + 1, 0));
      polygon.Add(gp_Pnt(steps - i - 1, i + 1, 0));
    }
    polygon.Close();
    TopoDS_Face face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face();
    TopoDS_Shape stairs = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, 5)).Shape();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> stairFaces;
    TopExp::MapShapes(stairs, TopAbs_FACE, stairFaces);
    std::cout << "   staircase: " << stairFaces.Extent() << " faces\n";
    int h = run(f, "8 staircase", meshOf(stairs, 0.1, 0.5), 0.01);
    if (h) f.release(h);
  }
  if (want("9")) {
    int h = run(f, "9a noisy 32-gon, tol 0.001", cylinder(5, 20, 32, noise32), 0.001, cylVolume);
    if (h) f.release(h);
    h = run(f, "9b noisy 32-gon, tol 0.02", cylinder(5, 20, 32, noise32), 0.02, cylVolume);
    if (h) f.release(h);
  }
  if (want("11")) {
    int h = run(f, "11b sphere, 500k triangles", sphere(10, 500, 500), 0.01);
    if (h) f.release(h);
  }
  if (want("r")) {
    // The region preview (meshRegions, slice 4): the plate, the spheres, the noisy 32-gon.
    TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 5).Shape();
    TopoDS_Shape drill = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 15, -1), gp_Dir(0, 0, 1)), 3, 7).Shape();
    TopoDS_Shape plate = BRepAlgoAPI_Cut(box, drill).Shape();
    regions(f, "cube.stl", stlFile("/repo/fixtures/imports/cube.stl"), 0.01);
    regions(f, "plate with hole, ~20k triangles", meshOf(plate, 0.0002, 0.01), 0.01);
    regions(f, "noisy 32-gon, tol 0.001", cylinder(5, 20, 32, noise32), 0.001);
    regions(f, "sphere r10", sphere(10, 24, 48), 0.01);
    regions(f, "sphere, 500k triangles", sphere(10, 500, 500), 0.01);
    int h = run(f, "r sphere, 500k triangles (the conversion, for comparison)", sphere(10, 500, 500), 0.01);
    if (h) f.release(h);
    h = run(f, "r plate, ~20k triangles (the conversion, for comparison)", meshOf(plate, 0.0002, 0.01), 0.01);
    if (h) f.release(h);
    // A 302-surface staircase (149 steps): the regions, then the full rebuild.
    BRepBuilderAPI_MakePolygon polygon;
    const int steps = 149;
    polygon.Add(gp_Pnt(0, 0, 0));
    polygon.Add(gp_Pnt(steps, 0, 0));
    for (int i = 0; i < steps; ++i) {
      polygon.Add(gp_Pnt(steps - i, i + 1, 0));
      polygon.Add(gp_Pnt(steps - i - 1, i + 1, 0));
    }
    polygon.Close();
    TopoDS_Face face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face();
    TopoDS_Shape stairs = BRepPrimAPI_MakePrism(face, gp_Vec(0, 0, 5)).Shape();
    const Mesh stairMesh = meshOf(stairs, 0.1, 0.5);
    regions(f, "staircase, 302 surfaces", stairMesh, 0.01);
    h = run(f, "r staircase, 302 surfaces (the conversion)", stairMesh, 0.01);
    if (h) f.release(h);
  }
  if (want("u")) {
    // Slice C: a box 20 x 20 x 10 with one vertical edge cut by a twisted
    // chamfer (w0 wide on one face along the whole edge, w0 to w1 on the
    // other: a ruled saddle no primitive fits).
    for (double scale : {1.0, 3.0}) {
      const double w0 = 2 * scale, w1 = 1 * scale, L = 20, W = 20, H = 10;
      auto section = [&](double z, double w) {
        BRepBuilderAPI_MakePolygon p;
        for (gp_Pnt q : {gp_Pnt(0, 0, z), gp_Pnt(L, 0, z), gp_Pnt(L, W - w, z), gp_Pnt(L - w0, W, z), gp_Pnt(0, W, z)}) p.Add(q);
        p.Close();
        return p.Wire();
      };
      BRepOffsetAPI_ThruSections loft(true, true);
      loft.AddWire(section(0, w0));
      loft.AddWire(section(H, w1));
      loft.Build();
      const TopoDS_Shape block = loft.Shape();
      const std::string name = scale == 1 ? "u1 box with a twisted chamfer 2/1" : "u2 box with a twisted chamfer 6/3";
      int h = run(f, name.c_str(), meshOf(block, 0.002, 0.1), 0.01, ExtrudoFacade::volumeOf(block));
      if (h) f.release(h);
    }
  }
  if (want("x")) {
    // Extra shapes beyond the slice's matrix.
    auto exact = [](const TopoDS_Shape& s) { return ExtrudoFacade::volumeOf(s); };
    TopoDS_Shape bracket = BRepAlgoAPI_Cut(BRepPrimAPI_MakeBox(30, 20, 20).Shape(),
                                           BRepPrimAPI_MakeBox(gp_Pnt(5, -1, 5), 30, 22, 20).Shape()).Shape();
    int h = run(f, "x1 L-bracket", meshOf(bracket, 0.01, 0.1), 0.01, exact(bracket));
    if (h) f.release(h);
    for (int coarse = 0; coarse < 2; ++coarse) {
      TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 10).Shape();
      BRepFilletAPI_MakeFillet fillet(box);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(box, TopAbs_EDGE, edges);
      for (int i = 1; i <= edges.Extent(); ++i) {
        BRepAdaptor_Curve c(TopoDS::Edge(edges(i)));
        gp_Vec d(c.Value(c.FirstParameter()), c.Value(c.LastParameter()));
        if (std::fabs(d.Z()) > 1) fillet.Add(3.0, TopoDS::Edge(edges(i)));
      }
      TopoDS_Shape rounded = fillet.Shape();
      h = run(f, coarse ? "x2b box, 4 vertical edges filleted r3, coarse" : "x2a box, 4 vertical edges filleted r3, fine",
              coarse ? meshOf(rounded, 1, M_PI / 16 + 1e-3) : meshOf(rounded, 0.001, 0.05), 0.01, exact(rounded));
      if (h) f.release(h);
    }
    {
      TopoDS_Shape top = BRepPrimAPI_MakeBox(40, 30, 10).Shape();
      BRepFilletAPI_MakeFillet fillet(top);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(top, TopAbs_EDGE, edges);
      for (int i = 1; i <= edges.Extent(); ++i) {
        BRepAdaptor_Curve c(TopoDS::Edge(edges(i)));
        if (c.Value(c.FirstParameter()).Z() > 9.9 && c.Value(c.LastParameter()).Z() > 9.9) fillet.Add(2.0, TopoDS::Edge(edges(i)));
      }
      TopoDS_Shape rounded = fillet.Shape();
      h = run(f, "x3 box, 4 top edges filleted r2 (corners are mitred: no sphere)", meshOf(rounded, 0.01, 0.2), 0.01, exact(rounded));
      if (h) f.release(h);
    }
    {
      TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 5).Shape();
      TopoDS_Shape drill = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 15, -1), gp_Dir(0, 0, 1)), 3, 7).Shape();
      TopoDS_Shape plate = BRepAlgoAPI_Cut(box, drill).Shape();
      h = run(f, "x4 plate with a coarse hole (12-gon)", meshOf(plate, 1, M_PI / 6 - 1e-3), 0.01, exact(plate));
      if (h) f.release(h);
    }
    {
      // A slot: two half cylinders tangent to two parallel walls.
      TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 5).Shape();
      TopoDS_Shape a = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(12, 15, -1), gp_Dir(0, 0, 1)), 4, 7).Shape();
      TopoDS_Shape b = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(28, 15, -1), gp_Dir(0, 0, 1)), 4, 7).Shape();
      TopoDS_Shape mid = BRepPrimAPI_MakeBox(gp_Pnt(12, 11, -1), 16, 8, 7).Shape();
      TopoDS_Shape slot = BRepAlgoAPI_Fuse(BRepAlgoAPI_Fuse(a, b).Shape(), mid).Shape();
      ShapeUpgrade_UnifySameDomain u(slot, true, true, false); u.Build();
      TopoDS_Shape plate = BRepAlgoAPI_Cut(box, u.Shape()).Shape();
      h = run(f, "x5 plate with a slot", meshOf(plate, 0.01, 0.1), 0.01, exact(plate));
      if (h) f.release(h);
    }
    {
      TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 5).Shape();
      TopoDS_Shape boss = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 15, 4), gp_Dir(0, 0, 1)), 6, 10).Shape();
      TopoDS_Shape part = BRepAlgoAPI_Fuse(box, boss).Shape();
      ShapeUpgrade_UnifySameDomain u(part, true, true, false); u.Build();
      h = run(f, "x6 plate with a boss", meshOf(u.Shape(), 0.01, 0.1), 0.01, exact(u.Shape()));
      if (h) f.release(h);
    }
    {
      // A tube: two coaxial cylinders.
      TopoDS_Shape outer = BRepPrimAPI_MakeCylinder(10, 20).Shape();
      TopoDS_Shape inner = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(0, 0, -1), gp_Dir(0, 0, 1)), 6, 22).Shape();
      TopoDS_Shape tube = BRepAlgoAPI_Cut(outer, inner).Shape();
      h = run(f, "x7 tube", meshOf(tube, 0.01, 0.1), 0.01, exact(tube));
      if (h) f.release(h);
    }
  }
  if (want("c")) {
    // Slice 4a1: spheres and cones (dome, truncated cone, countersink, apex).
    {
      const Mesh m = sphere(10, 24, 48);
      regions(f, "c1 sphere r10", m, 0.01);
      int h = run(f, "c1 sphere r10", m, 0.01, 4.0 / 3.0 * M_PI * 1000);
      if (h) f.release(h);
    }
    {
      TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(10, 10).Shape();
      TopoDS_Shape cap = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 10), 10).Shape();
      TopoDS_Shape dome = BRepAlgoAPI_Fuse(cyl, cap).Shape();
      const double exact = M_PI * 100 * 10 + 2.0 / 3.0 * M_PI * 1000;
      const Mesh fine = meshOf(dome, 0.01, 0.2);
      const Mesh coarse = meshOf(BRepBuilderAPI_Copy(dome).Shape(), 0.5, 0.5);
      regions(f, "c2 dome, fine", fine, 0.01);
      int h = run(f, "c2a dome, fine", fine, 0.01, exact);
      if (h) f.release(h);
      regions(f, "c2 dome, coarse", coarse, 0.01);
      h = run(f, "c2b dome, coarse", coarse, 0.01, exact);
      if (h) f.release(h);
    }
    {
      TopoDS_Shape cone = BRepPrimAPI_MakeCone(10, 4, 20).Shape();
      const Mesh m = meshOf(cone, 0.01, 0.2);
      const double exact = M_PI * 20 * (100 + 40 + 16) / 3;
      regions(f, "c3 truncated cone", m, 0.01);
      int h = run(f, "c3 truncated cone", m, 0.01, exact);
      if (h) f.release(h);
    }
    {
      TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 5).Shape();
      TopoDS_Shape hole = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 15, -1), gp_Dir(0, 0, 1)), 3, 7).Shape();
      TopoDS_Shape sink = BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(20, 15, 5), gp_Dir(0, 0, -1)), 6, 3, 3).Shape();
      TopoDS_Shape plate = BRepAlgoAPI_Cut(BRepAlgoAPI_Cut(box, hole).Shape(), sink).Shape();
      const double exact = ExtrudoFacade::volumeOf(plate);
      const Mesh m = meshOf(plate, 0.01, 0.2);
      regions(f, "c4 countersunk plate", m, 0.01);
      int h = run(f, "c4 countersunk plate", m, 0.01, exact);
      if (h) f.release(h);
    }
    {
      TopoDS_Shape cone = BRepPrimAPI_MakeCone(10, 0, 20).Shape();
      const Mesh m = meshOf(cone, 0.01, 0.2);
      const double exact = M_PI * 100 * 20 / 3;
      regions(f, "c5 pointed cone", m, 0.01);
      int h = run(f, "c5 pointed cone", m, 0.01, exact);
      if (h) f.release(h);
    }
    {
      Mesh e = sphere(10, 24, 48);
      for (size_t i = 2; i < e.nodes.size(); i += 3) e.nodes[i] *= 0.6;
      regions(f, "c6 ellipsoid", e, 0.01);
      int h = run(f, "c6 ellipsoid", e, 0.01);
      if (h) f.release(h);
    }
  }
  if (want("t")) {
    // Slice 4a2: tori, and smooth clusters split into several primitives.
    auto exact = [](const TopoDS_Shape& s) { return ExtrudoFacade::volumeOf(s); };
    // The edges of `shape` whose both ends satisfy `pick`, filleted by `radius`.
    auto filleted = [](const TopoDS_Shape& shape, double radius, bool (*pick)(const gp_Pnt&, const gp_Pnt&)) {
      BRepFilletAPI_MakeFillet fillet(shape);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(shape, TopAbs_EDGE, edges);
      for (int i = 1; i <= edges.Extent(); ++i) {
        BRepAdaptor_Curve c(TopoDS::Edge(edges(i)));
        if (pick(c.Value(c.FirstParameter()), c.Value(c.LastParameter()))) fillet.Add(radius, TopoDS::Edge(edges(i)));
      }
      return fillet.Shape();
    };
    {
      TopoDS_Shape donut = BRepPrimAPI_MakeTorus(10, 3).Shape();
      const double volume = 2 * M_PI * M_PI * 10 * 9;
      const Mesh fine = meshOf(donut, 0.01, 0.2);
      const Mesh coarse = meshOf(BRepBuilderAPI_Copy(donut).Shape(), 0.5, 0.5);
      regions(f, "t1 donut R10 r3, fine", fine, 0.01);
      int h = run(f, "t1a donut R10 r3, fine", fine, 0.01, volume);
      if (h) f.release(h);
      h = run(f, "t1b donut R10 r3, coarse", coarse, 0.01, volume);
      if (h) f.release(h);
    }
    {
      TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 10).Shape();
      TopoDS_Shape rounded = filleted(box, 2, [](const gp_Pnt& a, const gp_Pnt& b) { return a.Z() > 9.9 && b.Z() > 9.9; });
      std::cout << "   t2 shape:" << kinds(rounded) << "\n";
      const Mesh m = meshOf(rounded, 0.01, 0.2);
      regions(f, "t2 box, 4 top edges filleted r2", m, 0.01);
      int h = run(f, "t2 box, 4 top edges filleted r2", m, 0.01, exact(rounded));
      if (h) f.release(h);
    }
    {
      TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5, 20).Shape();
      TopoDS_Shape rounded = filleted(cyl, 2, [](const gp_Pnt& a, const gp_Pnt& b) { return a.Z() > 19.9 && b.Z() > 19.9; });
      std::cout << "   t3 shape:" << kinds(rounded) << "\n";
      const Mesh m = meshOf(rounded, 0.01, 0.2);
      regions(f, "t3 cylinder r5 h20, top edge filleted r2", m, 0.01);
      int h = run(f, "t3 cylinder r5 h20, top edge filleted r2", m, 0.01, exact(rounded));
      if (h) f.release(h);
    }
    {
      TopoDS_Shape box = BRepPrimAPI_MakeBox(40, 30, 5).Shape();
      TopoDS_Shape drill = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(20, 15, -1), gp_Dir(0, 0, 1)), 3, 7).Shape();
      TopoDS_Shape plate = BRepAlgoAPI_Cut(box, drill).Shape();
      TopoDS_Shape rounded = filleted(plate, 1, [](const gp_Pnt& a, const gp_Pnt& b) {
        return a.Z() > 4.9 && b.Z() > 4.9 && std::hypot(a.X() - 20, a.Y() - 15) < 3.1;
      });
      std::cout << "   t4 shape:" << kinds(rounded) << "\n";
      const Mesh m = meshOf(rounded, 0.01, 0.2);
      regions(f, "t4 plate, hole's top edge filleted r1", m, 0.01);
      int h = run(f, "t4 plate, hole's top edge filleted r1", m, 0.01, exact(rounded));
      if (h) f.release(h);
    }
    {
      TopoDS_Shape box = BRepPrimAPI_MakeBox(20, 20, 20).Shape();
      TopoDS_Shape rounded = filleted(box, 2, [](const gp_Pnt&, const gp_Pnt&) { return true; });
      std::cout << "   t5 shape:" << kinds(rounded) << "\n";
      const Mesh m = meshOf(rounded, 0.01, 0.2);
      regions(f, "t5 box 20, all 12 edges filleted r2", m, 0.01);
      int h = run(f, "t5 box 20, all 12 edges filleted r2", m, 0.01, exact(rounded));
      if (h) f.release(h);
    }
    {
      Mesh e = sphere(10, 24, 48);
      for (size_t i = 2; i < e.nodes.size(); i += 3) e.nodes[i] *= 0.6;
      regions(f, "t6 ellipsoid", e, 0.01);
      int h = run(f, "t6 ellipsoid", e, 0.01);
      if (h) f.release(h);
    }
  }
  std::cout << "live shapes " << f.liveShapes() << "\n";
  return failures;
}
