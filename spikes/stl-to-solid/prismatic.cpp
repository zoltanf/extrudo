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
  double minFlaggedEdge = 0;
  int flaggedEdgesBelowUncertainty = 0;
  int writtenVertices = 0, writtenEdges = 0, backVertices = 0, backEdges = 0;
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
