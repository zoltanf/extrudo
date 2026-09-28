// SPDX-License-Identifier: LGPL-2.1-or-later
//
// Extrudo's C++ facade over OpenCascade, compiled into our OCCT WASM build
// (see ../libcascade.config.ts and docs/adr/0001-geometry-kernel.md).
//
// Why it exists: libcascade's `delete()` from JS does not reliably release the
// memory an OCCT object owns (taucad/opencascade.js#40). So every operation
// that allocates heavily runs here, with its builder on the C++ stack, and JS
// only ever holds integer handles into an arena of shapes. Results, history and
// meshes come back as flat arrays that JS copies out of the WASM heap.
//
// The libcascade toolchain parses this file and generates the embind bindings
// for every class declared in it, so it contains exactly one class. Helpers
// are private static members. Keep method names unique: the generator suffixes
// overloads.
//
// Conventions
// - Handles are positive ints; 0 means the call failed and lastError() says why.
// - Sub-shape kinds: 0 = face, 1 = edge, 2 = vertex. Sub-shape indices are
//   0-based positions in TopExp::MapShapes order for that kind.
// - Integer arguments that are lists (fillet edges) are staged with
//   clearArgs() / pushArg() before the call; lists of numbers (spline poles
//   and knots) with clearNumbers() / pushNumber().

#include <BOPAlgo_Builder.hxx>
#include <BOPAlgo_BuilderFace.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeShape.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepGProp.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRepTopAdaptor_FClass2d.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepSweep_Revol.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <Geom2dAPI_InterCurveCurve.hxx>
#include <Geom2dInt_GInter.hxx>
#include <Geom2d_BSplineCurve.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <IntRes2d_IntersectionPoint.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Curve.hxx>
#include <GProp_GProps.hxx>
#include <NCollection_Array1.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <NCollection_IndexedMap.hxx>
#include <NCollection_List.hxx>
#include <NCollection_Map.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Triangulation.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Precision.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Elips.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <unistd.h>

#include <algorithm>
#include <type_traits>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <string>
#include <unordered_map>
#include <vector>

class ExtrudoFacade {
public:
  ExtrudoFacade() : nextHandle_(1) {}

  // ---------------------------------------------------------------- arena --

  /** Number of shapes currently held. The memory test expects 0 after cleanup. */
  int liveShapes() const { return static_cast<int>(shapes_.size()); }

  /** Frees one shape. Unknown handles are ignored, so double release is safe. */
  void release(int handle) { shapes_.erase(handle); }

  /** Frees every shape (used when the worker resets). */
  void releaseAll() { shapes_.clear(); }

  // ------------------------------------------------------------ arguments --

  void clearArgs() { args_.clear(); }
  void pushArg(int value) { args_.push_back(value); }
  void clearNumbers() { numbers_.clear(); }
  void pushNumber(double value) { numbers_.push_back(value); }

  // ------------------------------------------------------------ primitives --

  int makeBox(double x, double y, double z, double dx, double dy, double dz) {
    beginOp();
    try {
      BRepPrimAPI_MakeBox builder(gp_Pnt(x, y, z), dx, dy, dz);
      builder.Build();
      if (!builder.IsDone()) return fail("Box failed: check that all sizes are positive.");
      return store(builder.Shape());
    } catch (...) {
      return failFromException("Box failed");
    }
  }

  int makeCylinder(double px, double py, double pz, double dx, double dy, double dz, double radius,
                   double height) {
    beginOp();
    try {
      BRepPrimAPI_MakeCylinder builder(gp_Ax2(gp_Pnt(px, py, pz), gp_Dir(dx, dy, dz)), radius,
                                       height);
      builder.Build();
      if (!builder.IsDone()) return fail("Cylinder failed: check the radius and height.");
      return store(builder.Shape());
    } catch (...) {
      return failFromException("Cylinder failed");
    }
  }

  // -------------------------------------------------------------- features --

  /**
   * Fillets the staged edges (0-based edge indices of `shape`) with one radius.
   * Records history for input 0.
   */
  int fillet(int shape, double radius) {
    beginOp();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Fillet failed: unknown input shape.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(*input, TopAbs_EDGE, edges);
      BRepFilletAPI_MakeFillet builder(*input);
      for (int index : args_) {
        if (index < 0 || index >= edges.Extent()) return fail("Fillet failed: edge index out of range.");
        builder.Add(radius, TopoDS::Edge(edges(index + 1)));
      }
      builder.Build();
      if (!builder.IsDone()) {
        return fail("Fillet failed: the radius is probably too large for the selected edges.");
      }
      const TopoDS_Shape result = builder.Shape();
      recordHistory(builder, *input, 0, result);
      return store(result);
    } catch (...) {
      return failFromException("Fillet failed");
    }
  }

  /**
   * Boolean of two shapes: op 0 = fuse, 1 = cut (a − b), 2 = common. With
   * `simplify`, faces and edges that lie on one surface or curve are merged
   * afterwards (ShapeUpgrade_UnifySameDomain through SimplifyResult), and
   * the history accounts for it. Records history for inputs 0 and 1.
   */
  int boolean(int op, int a, int b, bool simplify) {
    beginOp();
    const TopoDS_Shape* shapeA = find(a);
    const TopoDS_Shape* shapeB = find(b);
    if (shapeA == nullptr || shapeB == nullptr) return fail("Boolean failed: unknown input shape.");
    try {
      switch (op) {
        case 0: {
          BRepAlgoAPI_Fuse builder(*shapeA, *shapeB);
          return finishBoolean(builder, *shapeA, *shapeB, simplify);
        }
        case 1: {
          BRepAlgoAPI_Cut builder(*shapeA, *shapeB);
          return finishBoolean(builder, *shapeA, *shapeB, simplify);
        }
        case 2: {
          BRepAlgoAPI_Common builder(*shapeA, *shapeB);
          return finishBoolean(builder, *shapeA, *shapeB, simplify);
        }
        default:
          return fail("Boolean failed: unknown operation.");
      }
    } catch (...) {
      return failFromException("Boolean failed");
    }
  }

  // --------------------------------------------------------------- sweeps --
  //
  // Sweeps record history for input 0, the swept shape, with the relations
  // generated (1: an edge's side face, a vertex's side edge), first (4: the
  // copy of a sub-shape at the start) and last (5: at the end). Sub-shape
  // indices are those of the swept shape as passed in.

  /**
   * Sweeps a face (or a compound of faces, or any shape) along (dx, dy, dz),
   * after moving it by (ox, oy, oz): a shift lets an extrude start below its
   * sketch plane (symmetric, two sides) without changing sub-shape order.
   *
   * A non-zero `taper` (radians, |taper| < π/2) tilts every side face about
   * its edge in the start plane (BRepOffsetAPI_DraftAngle, neutral plane =
   * the start plane): positive widens the outline along the sweep, negative
   * narrows it; holes do the opposite. Planes become tilted planes and
   * cylinders cones; sides of other surfaces (ellipses, splines) can't be
   * tapered. The history is that of the straight sweep carried through the
   * taper, so side faces keep their sources.
   */
  int prism(int shape, double ox, double oy, double oz, double dx, double dy, double dz,
            double taper) {
    beginOp();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Extrude failed: unknown input shape.");
    try {
      const gp_Vec along(dx, dy, dz);
      if (along.Magnitude() <= Precision::Confusion()) return fail("Extrude failed: the distance is zero.");
      if (std::abs(taper) >= M_PI / 2 - Precision::Angular()) {
        return fail("The taper angle must be between -90° and 90°.");
      }
      const TopoDS_Shape base = shifted(*input, ox, oy, oz);
      BRepPrimAPI_MakePrism builder(base, along, false, true);
      builder.Build();
      if (!builder.IsDone()) return fail("Extrude failed: OCCT could not sweep this shape.");
      const TopoDS_Shape swept = builder.Shape();
      if (std::abs(taper) <= Precision::Angular()) {
        recordSweep(builder, base, swept);
        return store(swept);
      }
      return taperSweep(builder, base, swept, along, taper);
    } catch (...) {
      return failFromException("Extrude failed");
    }
  }

  /**
   * Revolves a shape about the axis through (px, py, pz) along (dx, dy, dz)
   * by `angle` radians (counter-clockwise about the axis); 2π or more is a
   * full revolution, which has no start and end faces.
   */
  int revolve(int shape, double px, double py, double pz, double dx, double dy, double dz,
              double angle) {
    beginOp();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Revolve failed: unknown input shape.");
    try {
      if (gp_Vec(dx, dy, dz).Magnitude() <= Precision::Confusion()) {
        return fail("Revolve failed: the axis has no direction.");
      }
      if (std::abs(angle) <= Precision::Angular()) return fail("Revolve failed: the angle is zero.");
      const gp_Ax1 axis(gp_Pnt(px, py, pz), gp_Dir(dx, dy, dz));
      const bool full = std::abs(angle) >= 2 * M_PI - Precision::Angular();
      BRepPrimAPI_MakeRevol builder(*input, axis, full ? 2 * M_PI : angle, false);
      builder.Build();
      if (!builder.IsDone()) {
        return fail("Revolve failed: the profile probably crosses the axis.");
      }
      const TopoDS_Shape result = builder.Shape();
      recordSweep(builder, *input, result);
      return store(result);
    } catch (...) {
      return failFromException("Revolve failed");
    }
  }

  // ------------------------------------------------------------ sub-shapes --

  /** A compound of the staged shapes (clearArgs() / pushArg() handles), or 0. */
  int compound() {
    beginOp();
    try {
      TopoDS_Compound result;
      BRep_Builder builder;
      builder.MakeCompound(result);
      for (int handle : args_) {
        const TopoDS_Shape* s = find(handle);
        if (s == nullptr) return fail("Compound failed: unknown input shape.");
        builder.Add(result, *s);
      }
      return store(result);
    } catch (...) {
      return failFromException("Compound failed");
    }
  }

  /** A new handle to one sub-shape (kind as for count(), 0-based index) of a shape, or 0. */
  int subShape(int shape, int kind, int index) {
    beginOp();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return fail("Unknown shape.");
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> map;
    TopExp::MapShapes(*s, kindToEnum(kind), map);
    if (index < 0 || index >= map.Extent()) return fail("Sub-shape index out of range.");
    return store(map(index + 1));
  }

  /**
   * Where the sub-shapes of one kind of `part` sit in `whole`: for each, in
   * part's order, its index in whole's map, or -1. Read with lookupPtr/Size.
   * Returns the count, or -1 for an unknown handle.
   */
  int locate(int part, int whole, int kind) {
    beginOp();
    lookup_.clear();
    const TopoDS_Shape* p = find(part);
    const TopoDS_Shape* w = find(whole);
    if (p == nullptr || w == nullptr) {
      fail("Unknown shape.");
      return -1;
    }
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> partMap;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> wholeMap;
    TopExp::MapShapes(*p, kindToEnum(kind), partMap);
    TopExp::MapShapes(*w, kindToEnum(kind), wholeMap);
    for (int i = 1; i <= partMap.Extent(); ++i) lookup_.push_back(wholeMap.FindIndex(partMap(i)) - 1);
    return partMap.Extent();
  }

  /**
   * The smallest distance between two shapes (0 where they touch or one
   * is inside a solid of the other), or -1. Compared solid by solid, so a
   * compound of solids (what booleans return) counts its insides too.
   */
  double distance(int a, int b) {
    beginOp();
    const TopoDS_Shape* sa = find(a);
    const TopoDS_Shape* sb = find(b);
    if (sa == nullptr || sb == nullptr) {
      fail("Unknown shape.");
      return -1;
    }
    try {
      const std::vector<TopoDS_Shape> partsA = solidsOrSelf(*sa);
      const std::vector<TopoDS_Shape> partsB = solidsOrSelf(*sb);
      double best = -1;
      for (const TopoDS_Shape& pa : partsA) {
        for (const TopoDS_Shape& pb : partsB) {
          BRepExtrema_DistShapeShape measure(pa, pb, Extrema_ExtFlag_MIN);
          if (!measure.IsDone()) continue;
          const double d = measure.InnerSolution() ? 0.0 : measure.Value();
          if (best < 0 || d < best) best = d;
          if (best <= 0) return 0;
        }
      }
      if (best < 0) fail("Couldn't measure the distance between these shapes.");
      return best;
    } catch (...) {
      failFromException("Distance failed");
      return -1;
    }
  }

  uintptr_t lookupPtr() const { return reinterpret_cast<uintptr_t>(lookup_.data()); }
  int lookupSize() const { return static_cast<int>(lookup_.size()); }

  /**
   * Geometry and adjacency of every face, edge and vertex of a shape, in
   * sub-shape order: what topological naming orders split pieces by and
   * fingerprints are made of. Returns the face count, or -1.
   *
   * describeInts: [faces, edges, vertices], then per face [surface type],
   * per edge [curve type, n, adjacent face × n], per vertex [n, adjacent
   * face × n]. Surface types: 0 plane, 1 cylinder, 2 cone, 3 sphere, 4
   * torus, 5 Bézier, 6 B-spline, 7 revolution, 8 extrusion, 9 offset, 10
   * other. Curve types: 0 line, 1 circle, 2 ellipse, 3 hyperbola, 4
   * parabola, 5 Bézier, 6 B-spline, 7 offset, 8 other, -1 degenerate.
   *
   * describeNumbers: per face [area, centroid xyz, direction xyz], per edge
   * [length, midpoint xyz, direction xyz], per vertex [xyz]. A face's
   * direction is its outward normal if it is planar (else at the middle of
   * its parameter range), the axis of a cylinder, cone, torus or surface of
   * revolution, 0 for a sphere; an edge's is a line's direction, a circle's
   * or ellipse's axis, else the tangent at its middle. Axes and line
   * directions have a canonical sign (first non-zero component positive).
   */
  int describe(int shape) {
    beginOp();
    describeInts_.clear();
    describeNumbers_.clear();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) {
      fail("Unknown shape.");
      return -1;
    }
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices;
      TopExp::MapShapes(*s, TopAbs_FACE, faces);
      TopExp::MapShapes(*s, TopAbs_EDGE, edges);
      TopExp::MapShapes(*s, TopAbs_VERTEX, vertices);
      describeInts_.push_back(faces.Extent());
      describeInts_.push_back(edges.Extent());
      describeInts_.push_back(vertices.Extent());
      for (int i = 1; i <= faces.Extent(); ++i) describeFace(TopoDS::Face(faces(i)));
      NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
      TopExp::MapShapesAndUniqueAncestors(*s, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
      for (int i = 1; i <= edges.Extent(); ++i) {
        describeEdge(TopoDS::Edge(edges(i)));
        pushAdjacent(edgeFaces, edges(i), faces);
      }
      NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> vertexFaces;
      TopExp::MapShapesAndUniqueAncestors(*s, TopAbs_VERTEX, TopAbs_FACE, vertexFaces);
      for (int i = 1; i <= vertices.Extent(); ++i) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vertices(i)));
        describeNumbers_.push_back(p.X());
        describeNumbers_.push_back(p.Y());
        describeNumbers_.push_back(p.Z());
        pushAdjacent(vertexFaces, vertices(i), faces);
      }
      return faces.Extent();
    } catch (...) {
      describeInts_.clear();
      describeNumbers_.clear();
      failFromException("Describe failed");
      return -1;
    }
  }

  uintptr_t describeIntsPtr() const { return reinterpret_cast<uintptr_t>(describeInts_.data()); }
  int describeIntsSize() const { return static_cast<int>(describeInts_.size()); }
  uintptr_t describeNumbersPtr() const { return reinterpret_cast<uintptr_t>(describeNumbers_.data()); }
  int describeNumbersSize() const { return static_cast<int>(describeNumbers_.size()); }

  // ----------------------------------------------------------- projection --
  //
  // What the sketch evaluator projects into a sketch plane (P2-09, ADR-0031):
  // the exact geometry of a body edge, and the silhouette lines of a curved
  // face. Both write geometryNumbers (read with geometryPtr/Size).

  /**
   * The geometry of edge `edge` (0-based, MapShapes order) of a shape, with
   * `samples` points along it (at least 2, evenly spaced in its parameter,
   * both ends included). Returns 1, or 0 on failure.
   *
   * geometryNumbers: [type, closed, n, point xyz × n], then for a circle
   * [center xyz, axis xyz, x direction xyz, radius, first, last] and for an
   * ellipse [center xyz, axis xyz, major direction xyz, major radius, minor
   * radius, first, last]. Types as in describe(); -1 is a degenerate edge
   * (n = 0). `first` and `last` are angles about the axis from the x or
   * major direction; the edge's own orientation is ignored.
   */
  int edgeGeometry(int shape, int edge, int samples) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return fail("Unknown shape.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(*s, TopAbs_EDGE, edges);
      if (edge < 0 || edge >= edges.Extent()) return fail("Edge index out of range.");
      const TopoDS_Edge e = TopoDS::Edge(edges(edge + 1));
      if (BRep_Tool::Degenerated(e)) {
        geometry_.insert(geometry_.end(), {-1.0, 0.0, 0.0});
        return 1;
      }
      BRepAdaptor_Curve curve(e);
      const GeomAbs_CurveType type = curve.GetType();
      const double first = curve.FirstParameter();
      const double last = curve.LastParameter();
      const int n = type == GeomAbs_Line ? 2 : std::max(2, samples);
      geometry_.push_back(static_cast<double>(type));
      geometry_.push_back(BRep_Tool::IsClosed(e) ? 1.0 : 0.0);
      geometry_.push_back(static_cast<double>(n));
      for (int i = 0; i < n; ++i) {
        const double t = i == n - 1 ? last : first + (last - first) * i / (n - 1);
        pushPoint(curve.Value(t));
      }
      if (type == GeomAbs_Circle) {
        const gp_Circ c = curve.Circle();
        pushPoint(c.Location());
        pushDir(c.Axis().Direction());
        pushDir(c.XAxis().Direction());
        geometry_.insert(geometry_.end(), {c.Radius(), first, last});
      } else if (type == GeomAbs_Ellipse) {
        const gp_Elips c = curve.Ellipse();
        pushPoint(c.Location());
        pushDir(c.Axis().Direction());
        pushDir(c.XAxis().Direction());
        geometry_.insert(geometry_.end(), {c.MajorRadius(), c.MinorRadius(), first, last});
      }
      return 1;
    } catch (...) {
      geometry_.clear();
      return failFromException("Edge geometry failed");
    }
  }

  /**
   * The silhouette lines of face `face` of a shape seen along (dx, dy, dz):
   * the straight lines on a cylinder or cone where its normal is square to
   * the view, clipped to the face. Other surfaces have none here. Returns
   * the number of segments, or -1 on failure.
   *
   * geometryNumbers: [start xyz, end xyz] per segment.
   */
  int faceSilhouettes(int shape, int face, double dx, double dy, double dz) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) {
      fail("Unknown shape.");
      return -1;
    }
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*s, TopAbs_FACE, faces);
      if (face < 0 || face >= faces.Extent()) {
        fail("Face index out of range.");
        return -1;
      }
      const gp_Vec view(dx, dy, dz);
      if (view.Magnitude() <= Precision::Confusion()) {
        fail("The view direction has no length.");
        return -1;
      }
      const TopoDS_Face f = TopoDS::Face(faces(face + 1));
      BRepAdaptor_Surface surface(f);
      gp_Ax3 position;
      double semiAngle = 0;
      if (surface.GetType() == GeomAbs_Cylinder) {
        position = surface.Cylinder().Position();
      } else if (surface.GetType() == GeomAbs_Cone) {
        position = surface.Cone().Position();
        semiAngle = surface.Cone().SemiAngle();
      } else {
        return 0;
      }
      // The normal at angle u is proportional to cos(A)(cos u X + sin u Y) - sin(A) Z
      // (either sign), so the silhouette is where cos u a + sin u b = tan(A) c.
      const gp_Dir d(view);
      const double a = position.XDirection().Dot(d);
      const double b = position.YDirection().Dot(d);
      const double c = position.Direction().Dot(d);
      const double rho = std::hypot(a, b);
      if (rho <= 1e-9) return 0;
      const double k = std::tan(semiAngle) * c / rho;
      if (std::abs(k) > 1) return 0;
      const double phi = std::atan2(b, a);
      const double spread = std::acos(std::max(-1.0, std::min(1.0, k)));
      double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
      BRepTools::UVBounds(f, u0, u1, v0, v1);
      BRepTopAdaptor_FClass2d classifier(f, Precision::PConfusion());
      const double candidates[2] = {phi + spread, phi - spread};
      int segments = 0;
      for (int i = 0; i < 2; ++i) {
        if (i == 1 && spread <= 1e-12) break;
        double u = u0 + std::fmod(candidates[i] - u0, 2 * M_PI);
        if (u < u0) u += 2 * M_PI;
        if (u > u1 + 1e-9) continue;
        segments += silhouetteRuns(surface, classifier, std::min(u, u1), v0, v1);
      }
      return segments;
    } catch (...) {
      geometry_.clear();
      failFromException("Silhouette failed");
      return -1;
    }
  }

  uintptr_t geometryPtr() const { return reinterpret_cast<uintptr_t>(geometry_.data()); }
  int geometrySize() const { return static_cast<int>(geometry_.size()); }

  // ------------------------------------------------------------- sketches --
  //
  // A sketch's profiles (P2-02, ADR-0025): stage its curves in the sketch
  // plane's own 2D frame (z = 0) with sketchClear() and sketch*(), which
  // return the curve's index (or -1), then call sketchProfiles(). Directions
  // follow the sketch model: lines start → end, circles, arcs and ellipses
  // counter-clockwise, splines along their parameter.

  void sketchClear() {
    sketchEdges_.clear();
    sketchCurveOf_.clear();
    sketchCurveCount_ = 0;
  }

  int sketchLine(double x0, double y0, double x1, double y1) {
    beginOp();
    try {
      const gp_Pnt a(x0, y0, 0);
      const gp_Pnt b(x1, y1, 0);
      if (a.Distance(b) <= Precision::Confusion()) return failCurve("The line has no length.");
      BRepBuilderAPI_MakeEdge builder(a, b);
      if (!builder.IsDone()) return failCurve("Couldn't make an edge from the line.");
      return addSketchEdge(builder.Edge());
    } catch (...) {
      failFromException("Line failed");
      return -1;
    }
  }

  /** An arc counter-clockwise from angle `from` through `sweep` radians (a full circle if sweep ≥ 2π). */
  int sketchArc(double cx, double cy, double radius, double from, double sweep) {
    beginOp();
    try {
      if (radius <= Precision::Confusion()) return failCurve("The arc has no radius.");
      if (sweep <= 0) return failCurve("The arc has no length.");
      const gp_Ax2 axes(gp_Pnt(cx, cy, 0), gp::DZ(), gp::DX());
      if (sweep >= 2 * M_PI - 1e-12) {
        BRepBuilderAPI_MakeEdge builder(gp_Circ(axes, radius));
        if (!builder.IsDone()) return failCurve("Couldn't make an edge from the circle.");
        return addSketchEdge(builder.Edge());
      }
      Handle(Geom_Circle) circle = new Geom_Circle(axes, radius);
      BRepBuilderAPI_MakeEdge builder(circle, from, from + sweep);
      if (!builder.IsDone()) return failCurve("Couldn't make an edge from the arc.");
      return addSketchEdge(builder.Edge());
    } catch (...) {
      failFromException("Arc failed");
      return -1;
    }
  }

  /** A full ellipse; `rotation` is the direction of the `a` axis in radians. */
  int sketchEllipse(double cx, double cy, double a, double b, double rotation) {
    beginOp();
    try {
      if (a <= Precision::Confusion() || b <= Precision::Confusion()) {
        return failCurve("The ellipse is flat.");
      }
      // OCCT wants the major radius first; a quarter turn keeps the direction.
      if (b > a) {
        std::swap(a, b);
        rotation += M_PI / 2;
      }
      const gp_Ax2 axes(gp_Pnt(cx, cy, 0), gp::DZ(), gp_Dir(std::cos(rotation), std::sin(rotation), 0));
      BRepBuilderAPI_MakeEdge builder(gp_Elips(axes, a, b));
      if (!builder.IsDone()) return failCurve("Couldn't make an edge from the ellipse.");
      return addSketchEdge(builder.Edge());
    } catch (...) {
      failFromException("Ellipse failed");
      return -1;
    }
  }

  /**
   * A clamped, non-rational B-spline: the staged numbers are the poles
   * (x, y × poleCount), then the full knot vector (poleCount + degree + 1).
   * A spline that crosses itself is staged in pieces cut at its crossings:
   * General Fuse only splits edges where they meet other edges.
   */
  int sketchSpline(int degree, int poleCount) {
    beginOp();
    try {
      const int knotCount = poleCount + degree + 1;
      if (degree < 1 || poleCount < degree + 1 ||
          static_cast<int>(numbers_.size()) != 2 * poleCount + knotCount) {
        return failCurve("The spline's poles and knots don't match.");
      }
      NCollection_Array1<gp_Pnt> poles(1, poleCount);
      NCollection_Array1<gp_Pnt2d> flatPoles(1, poleCount);
      for (int i = 0; i < poleCount; ++i) {
        poles(i + 1) = gp_Pnt(numbers_[2 * i], numbers_[2 * i + 1], 0);
        flatPoles(i + 1) = gp_Pnt2d(numbers_[2 * i], numbers_[2 * i + 1]);
      }
      std::vector<double> distinct;
      std::vector<int> multiplicities;
      for (int i = 0; i < knotCount; ++i) {
        const double knot = numbers_[2 * poleCount + i];
        if (!distinct.empty() && knot - distinct.back() <= 1e-15) {
          multiplicities.back()++;
        } else {
          distinct.push_back(knot);
          multiplicities.push_back(1);
        }
      }
      NCollection_Array1<double> knots(1, static_cast<int>(distinct.size()));
      NCollection_Array1<int> mults(1, static_cast<int>(distinct.size()));
      for (size_t i = 0; i < distinct.size(); ++i) {
        knots(static_cast<int>(i) + 1) = distinct[i];
        mults(static_cast<int>(i) + 1) = multiplicities[i];
      }
      Handle(Geom_BSplineCurve) curve = new Geom_BSplineCurve(poles, knots, mults, degree);
      Handle(Geom2d_BSplineCurve) flat = new Geom2d_BSplineCurve(flatPoles, knots, mults, degree);
      std::vector<double> cuts = {curve->FirstParameter(), curve->LastParameter()};
      Geom2dAPI_InterCurveCurve crossings(flat, Precision::Confusion());
      const Geom2dInt_GInter& found = crossings.Intersector();
      for (int i = 1; i <= found.NbPoints(); ++i) {
        cuts.push_back(found.Point(i).ParamOnFirst());
        cuts.push_back(found.Point(i).ParamOnSecond());
      }
      std::sort(cuts.begin(), cuts.end());
      std::vector<TopoDS_Edge> pieces;
      double from = cuts.front();
      for (size_t i = 1; i < cuts.size(); ++i) {
        const double to = cuts[i];
        if (to - from <= 1e-9) continue;
        BRepBuilderAPI_MakeEdge builder(curve, from, to);
        if (!builder.IsDone()) return failCurve("Couldn't make an edge from the spline.");
        pieces.push_back(builder.Edge());
        from = to;
      }
      if (pieces.empty()) return failCurve("The spline has no length.");
      const int index = sketchCurveCount_++;
      for (const TopoDS_Edge& piece : pieces) {
        sketchEdges_.push_back(piece);
        sketchCurveOf_.push_back(index);
      }
      return index;
    } catch (...) {
      failFromException("Spline failed");
      return -1;
    }
  }

  /**
   * Splits the staged curves where they cross, touch or end on each other
   * (General Fuse, positions within `fuzzy` mm are one), builds the faces
   * between them and places each in the sketch plane (origin, X direction,
   * normal). Returns the number of faces, or -1. Read them with
   * profileRecordsPtr/Size, as int32 records per face:
   * [handle, holes, n, (curve, reversed) × n, m, curve × m]: the n curves
   * bounding its outer loop (for a piece shared by overlapping curves, the
   * lowest index), then the curve of each of its m edges in sub-shape order;
   * and profileNumbersPtr/Size, [area, centroid x, centroid y] per face in
   * plane coordinates. The faces are in the arena.
   */
  int sketchProfiles(double ox, double oy, double oz, double xx, double xy, double xz, double nx,
                     double ny, double nz, double fuzzy) {
    beginOp();
    profileRecords_.clear();
    profileNumbers_.clear();
    try {
      std::vector<TopoDS_Face> faces;
      if (!buildProfiles(fuzzy, faces)) return -1;
      gp_Trsf placement;
      placement.SetDisplacement(gp_Ax3(), gp_Ax3(gp_Pnt(ox, oy, oz), gp_Dir(nx, ny, nz), gp_Dir(xx, xy, xz)));
      const TopLoc_Location location(placement);
      std::vector<int> stored;
      for (const TopoDS_Face& face : faces) {
        const int handle = store(face.Moved(location));
        if (handle == 0) {
          for (int h : stored) release(h);
          return -1;
        }
        stored.push_back(handle);
        profileRecords_[recordStart(face)] = handle;
      }
      return static_cast<int>(faces.size());
    } catch (...) {
      failFromException("Profiles failed");
      return -1;
    }
  }

  uintptr_t profileRecordsPtr() const { return reinterpret_cast<uintptr_t>(profileRecords_.data()); }
  int profileRecordsSize() const { return static_cast<int>(profileRecords_.size()); }
  uintptr_t profileNumbersPtr() const { return reinterpret_cast<uintptr_t>(profileNumbers_.data()); }
  int profileNumbersSize() const { return static_cast<int>(profileNumbers_.size()); }

  // -------------------------------------------------------------- history --

  /**
   * History of the last operation as int32 records:
   * [input, kind, index, relation, n, (resultKind, resultIndex) × n].
   * relation: 0 = modified, 1 = generated, 2 = deleted (n = 0), 3 = kept unchanged,
   * 4 = first and 5 = last (a sweep's copy of the sub-shape at its start or end).
   */
  uintptr_t historyPtr() const { return reinterpret_cast<uintptr_t>(history_.data()); }
  int historySize() const { return static_cast<int>(history_.size()); }

  // ------------------------------------------------------------- topology --

  /** Number of sub-shapes of a kind (0 = face, 1 = edge, 2 = vertex, 3 = solid), or -1 for an unknown handle. */
  int count(int shape, int kind) {
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return -1;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> map;
    TopExp::MapShapes(*s, kindToEnum(kind), map);
    return map.Extent();
  }

  // ----------------------------------------------------------- properties --

  /** Validity check with BRepCheck_Analyzer. */
  bool isValid(int shape) {
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return false;
    try {
      BRepCheck_Analyzer analyzer(*s);
      return analyzer.IsValid();
    } catch (...) {
      failFromException("Validity check failed");
      return false;
    }
  }

  /**
   * Computes volume, area and bounding box. Read them with measured(i):
   * 0 = volume, 1 = area, 2..4 = bbox min xyz, 5..7 = bbox max xyz.
   */
  bool measure(int shape) {
    beginOp();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return fail("Measure failed: unknown shape.") != 0;
    try {
      GProp_GProps volume;
      BRepGProp::VolumeProperties(*s, volume);
      GProp_GProps area;
      BRepGProp::SurfaceProperties(*s, area);
      Bnd_Box box;
      BRepBndLib::Add(*s, box);
      measured_[0] = volume.Mass();
      measured_[1] = area.Mass();
      if (box.IsVoid()) {
        for (int i = 2; i < 8; ++i) measured_[i] = 0.0;
      } else {
        box.Get(measured_[2], measured_[3], measured_[4], measured_[5], measured_[6], measured_[7]);
      }
      return true;
    } catch (...) {
      failFromException("Measure failed");
      return false;
    }
  }

  double measured(int index) const { return index >= 0 && index < 8 ? measured_[index] : 0.0; }

  // ----------------------------------------------------------------- mesh --

  /**
   * Tessellates a shape into the mesh buffers below (replacing the previous
   * mesh). Faces, edges and vertices come in MapShapes order, so their
   * positions in faceRanges / edgeRanges / vertexPoints are sub-shape indices.
   */
  bool mesh(int shape, double linearDeflection, double angularDeflection) {
    beginOp();
    clearMesh();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return fail("Mesh failed: unknown shape.") != 0;
    try {
      BRepMesh_IncrementalMesh mesher(*s, linearDeflection, false, angularDeflection,
                                      false);
      if (!mesher.IsDone()) return fail("Mesh failed.") != 0;
      meshFaces(*s);
      meshEdges(*s, linearDeflection, angularDeflection);
      meshVertices(*s);
      return true;
    } catch (...) {
      clearMesh();
      failFromException("Mesh failed");
      return false;
    }
  }

  /** Frees the mesh buffers once JS has copied them. */
  void clearMesh() {
    std::vector<float>().swap(positions_);
    std::vector<float>().swap(normals_);
    std::vector<uint32_t>().swap(indices_);
    std::vector<uint32_t>().swap(faceRanges_);
    std::vector<float>().swap(edgePoints_);
    std::vector<uint32_t>().swap(edgeRanges_);
    std::vector<uint8_t>().swap(edgeFlags_);
    std::vector<float>().swap(vertexPoints_);
  }

  uintptr_t positionsPtr() const { return reinterpret_cast<uintptr_t>(positions_.data()); }
  int positionsSize() const { return static_cast<int>(positions_.size()); }
  uintptr_t normalsPtr() const { return reinterpret_cast<uintptr_t>(normals_.data()); }
  int normalsSize() const { return static_cast<int>(normals_.size()); }
  uintptr_t indicesPtr() const { return reinterpret_cast<uintptr_t>(indices_.data()); }
  int indicesSize() const { return static_cast<int>(indices_.size()); }
  /** Per face: first triangle, triangle count. */
  uintptr_t faceRangesPtr() const { return reinterpret_cast<uintptr_t>(faceRanges_.data()); }
  int faceRangesSize() const { return static_cast<int>(faceRanges_.size()); }
  /** Edge polylines, xyz per point. */
  uintptr_t edgePointsPtr() const { return reinterpret_cast<uintptr_t>(edgePoints_.data()); }
  int edgePointsSize() const { return static_cast<int>(edgePoints_.size()); }
  /** Per edge: first point, point count (0 for degenerate edges). */
  uintptr_t edgeRangesPtr() const { return reinterpret_cast<uintptr_t>(edgeRanges_.data()); }
  int edgeRangesSize() const { return static_cast<int>(edgeRanges_.size()); }
  /** Per edge: flag bits. 1 = seam (the edge where a closed face, like a cylinder, meets itself). */
  uintptr_t edgeFlagsPtr() const { return reinterpret_cast<uintptr_t>(edgeFlags_.data()); }
  int edgeFlagsSize() const { return static_cast<int>(edgeFlags_.size()); }
  uintptr_t vertexPointsPtr() const { return reinterpret_cast<uintptr_t>(vertexPoints_.data()); }
  int vertexPointsSize() const { return static_cast<int>(vertexPoints_.size()); }

  // ------------------------------------------------------ errors, memory --

  const char* lastError() const { return lastError_.c_str(); }

  /**
   * Top of the malloc heap (sbrk(0)), in bytes. dlmalloc cannot give memory
   * back in WASM, so this only grows, and only when freed chunks can't satisfy
   * a request. A leak-free loop plateaus after warm-up; a leak grows it
   * steadily. Unlike the WASM memory size, it ignores the unused initial slack.
   * (mallinfo() isn't linked in this build.)
   */
  double heapTop() const { return static_cast<double>(reinterpret_cast<uintptr_t>(sbrk(0))); }

  /** Aborts the WASM instance on purpose, for the crash-recovery test (NFR-03). */
  void debugAbort() { std::abort(); }

private:
  std::unordered_map<int, TopoDS_Shape> shapes_;
  int nextHandle_;
  std::vector<int> args_;
  std::vector<int32_t> history_;
  std::string lastError_;
  double measured_[8] = {0, 0, 0, 0, 0, 0, 0, 0};
  std::vector<float> positions_;
  std::vector<float> normals_;
  std::vector<uint32_t> indices_;
  std::vector<uint32_t> faceRanges_;
  std::vector<float> edgePoints_;
  std::vector<uint32_t> edgeRanges_;
  std::vector<uint8_t> edgeFlags_;
  std::vector<float> vertexPoints_;
  std::vector<double> numbers_;
  /** Staged edges: one per curve, or a spline's pieces (sketchCurveOf_ says whose). */
  std::vector<TopoDS_Edge> sketchEdges_;
  std::vector<int> sketchCurveOf_;
  int sketchCurveCount_ = 0;
  std::vector<int32_t> profileRecords_;
  std::vector<double> profileNumbers_;
  std::vector<int32_t> lookup_;
  std::vector<int32_t> describeInts_;
  std::vector<double> describeNumbers_;
  std::vector<double> geometry_;
  /** Where each face's record starts in profileRecords_, while sketchProfiles runs. */
  std::unordered_map<const TopoDS_TShape*, size_t> recordStarts_;

  void beginOp() {
    lastError_.clear();
    history_.clear();
  }

  int fail(const char* message) {
    lastError_ = message;
    return 0;
  }

  /** Call only from a catch block: turns the in-flight exception into lastError. */
  int failFromException(const char* prefix) {
    lastError_ = prefix;
    try {
      throw;
    } catch (const Standard_Failure& e) {
      const char* detail = e.what();
      lastError_ += ": ";
      lastError_ += (detail != nullptr && detail[0] != '\0') ? detail : "OCCT error";
    } catch (const std::exception& e) {
      lastError_ += ": ";
      lastError_ += e.what();
    } catch (...) {
      lastError_ += ": unknown error";
    }
    return 0;
  }

  int failCurve(const char* message) {
    fail(message);
    return -1;
  }

  int addSketchEdge(const TopoDS_Edge& edge) {
    sketchEdges_.push_back(edge);
    sketchCurveOf_.push_back(sketchCurveCount_);
    return sketchCurveCount_++;
  }

  size_t recordStart(const TopoDS_Face& face) const { return recordStarts_.at(face.TShape().get()); }

  /**
   * The profile faces of the staged curves, in the plane z = 0, and their
   * records (see sketchProfiles; the handle slot is left 0). Pieces that
   * bound nothing are dropped and the faces made again, until every piece
   * left bounds a face once: a dangling line, or a bridge joining a hole to
   * its outline, would otherwise stay inside a face as an extra edge.
   */
  bool buildProfiles(double fuzzy, std::vector<TopoDS_Face>& out) {
    recordStarts_.clear();
    if (sketchEdges_.empty()) return true;
    // Which staged edge each piece comes from: the lowest index, and so the
    // lowest curve.
    NCollection_IndexedDataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher> origin;
    // General Fuse wants two arguments at least; one curve has nothing to meet.
    BOPAlgo_Builder fuse;
    if (sketchEdges_.size() == 1) {
      origin.Add(sketchEdges_[0], 0);
    } else {
      NCollection_List<TopoDS_Shape> arguments;
      for (const TopoDS_Edge& edge : sketchEdges_) arguments.Append(edge);
      fuse.SetArguments(arguments);
      fuse.SetFuzzyValue(fuzzy);
      fuse.SetRunParallel(false);
      fuse.Perform();
      if (fuse.HasErrors()) return fail("Couldn't find where the sketch's curves meet.") != 0;
    }
    for (int i = 0; sketchEdges_.size() > 1 && i < static_cast<int>(sketchEdges_.size()); ++i) {
      const TopoDS_Edge& edge = sketchEdges_[i];
      const NCollection_List<TopoDS_Shape>& pieces = fuse.Modified(edge);
      auto note = [&](const TopoDS_Shape& piece) {
        const int found = origin.FindIndex(piece);
        if (found == 0) origin.Add(piece, i);
        else if (origin(found) > i) origin(found) = i;
      };
      if (pieces.IsEmpty()) {
        if (!fuse.IsDeleted(edge)) note(edge);
      } else {
        for (NCollection_List<TopoDS_Shape>::Iterator it(pieces); it.More(); it.Next()) note(it.Value());
      }
    }

    std::vector<TopoDS_Shape> pieces;
    for (int i = 1; i <= origin.Extent(); ++i) {
      if (!BRep_Tool::Degenerated(TopoDS::Edge(origin.FindKey(i)))) pieces.push_back(origin.FindKey(i));
    }

    const TopoDS_Face base = BRepBuilderAPI_MakeFace(gp_Pln(gp::XOY())).Face();
    std::vector<TopoDS_Face> faces;
    for (int round = 0; round < 1000; ++round) {
      faces.clear();
      if (pieces.empty()) break;
      BOPAlgo_BuilderFace builder;
      builder.SetFace(base);
      NCollection_List<TopoDS_Shape> shapes;
      for (const TopoDS_Shape& piece : pieces) {
        shapes.Append(piece.Oriented(TopAbs_FORWARD));
        shapes.Append(piece.Oriented(TopAbs_REVERSED));
      }
      builder.SetShapes(shapes);
      builder.SetFuzzyValue(fuzzy);
      builder.Perform();
      if (builder.HasErrors()) return fail("Couldn't make faces from the sketch's curves.") != 0;

      // How often each piece bounds a face; internal edges count as bad.
      NCollection_IndexedDataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher> uses;
      for (const TopoDS_Shape& piece : pieces) uses.Add(piece, 0);
      std::vector<TopoDS_Shape> bad;
      for (NCollection_List<TopoDS_Shape>::Iterator it(builder.Areas()); it.More(); it.Next()) {
        const TopoDS_Face& face = TopoDS::Face(it.Value());
        faces.push_back(face);
        for (TopExp_Explorer e(face, TopAbs_EDGE); e.More(); e.Next()) {
          const int found = uses.FindIndex(e.Current());
          const TopAbs_Orientation o = e.Current().Orientation();
          if (found == 0) continue;
          if (o == TopAbs_INTERNAL || o == TopAbs_EXTERNAL) uses(found) += 2;
          else uses(found) += 1;
        }
      }
      // A piece bounding two faces is normal (one on each side), but twice
      // within one face it is a bridge or a dangling line.
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> drop;
      for (const TopoDS_Face& face : faces) {
        NCollection_IndexedDataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher> within;
        for (TopExp_Explorer e(face, TopAbs_EDGE); e.More(); e.Next()) {
          const TopAbs_Orientation o = e.Current().Orientation();
          if (o == TopAbs_INTERNAL || o == TopAbs_EXTERNAL) {
            drop.Add(e.Current());
            continue;
          }
          const int found = within.FindIndex(e.Current());
          if (found == 0) within.Add(e.Current(), 1);
          else drop.Add(e.Current());
        }
      }
      for (int i = 1; i <= uses.Extent(); ++i) {
        if (uses(i) == 0) drop.Add(uses.FindKey(i));
      }
      if (drop.IsEmpty()) break;
      std::vector<TopoDS_Shape> kept;
      for (const TopoDS_Shape& piece : pieces) {
        if (!drop.Contains(piece)) kept.push_back(piece);
      }
      pieces.swap(kept);
    }

    const double minArea = fuzzy * fuzzy;
    for (const TopoDS_Face& face : faces) {
      GProp_GProps props;
      BRepGProp::SurfaceProperties(face, props);
      if (props.Mass() <= minArea) continue;
      // Wires that touch (share a vertex) are one loop, as in the arrangement:
      // a circle touching the outline from inside is part of the outline,
      // two holes touching each other are one hole.
      std::vector<TopoDS_Shape> wires = {BRepTools::OuterWire(face)};
      for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) {
        if (!w.Current().IsSame(wires[0])) wires.push_back(w.Current());
      }
      std::vector<int> group(wires.size());
      for (size_t i = 0; i < wires.size(); ++i) group[i] = static_cast<int>(i);
      const auto root = [&group](int i) {
        while (group[i] != i) i = group[i] = group[group[i]];
        return i;
      };
      std::vector<NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>> vertices(wires.size());
      for (size_t i = 0; i < wires.size(); ++i) TopExp::MapShapes(wires[i], TopAbs_VERTEX, vertices[i]);
      for (size_t i = 0; i < wires.size(); ++i) {
        for (size_t j = i + 1; j < wires.size(); ++j) {
          for (int v = 1; v <= vertices[j].Extent(); ++v) {
            if (vertices[i].Contains(vertices[j](v))) {
              group[root(static_cast<int>(j))] = root(static_cast<int>(i));
              break;
            }
          }
        }
      }
      std::vector<int> holeGroups;
      for (size_t i = 1; i < wires.size(); ++i) {
        const int g = root(static_cast<int>(i));
        if (g != root(0) && std::find(holeGroups.begin(), holeGroups.end(), g) == holeGroups.end()) {
          holeGroups.push_back(g);
        }
      }
      recordStarts_[face.TShape().get()] = profileRecords_.size();
      profileRecords_.push_back(0);
      profileRecords_.push_back(static_cast<int32_t>(holeGroups.size()));
      const size_t countAt = profileRecords_.size();
      profileRecords_.push_back(0);
      for (size_t i = 0; i < wires.size(); ++i) {
        if (root(static_cast<int>(i)) != root(0)) continue;
        // Explore from the face so each edge carries its orientation in the face.
        for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) {
          if (!w.Current().IsSame(wires[i])) continue;
          for (TopExp_Explorer e(w.Current(), TopAbs_EDGE); e.More(); e.Next()) {
            const TopoDS_Edge& edge = TopoDS::Edge(e.Current());
            const int found = origin.FindIndex(edge);
            if (found == 0) continue;
            const int staged = origin(found);
            profileRecords_.push_back(sketchCurveOf_[staged]);
            profileRecords_.push_back(runsAgainst(edge, sketchEdges_[staged]) ? 1 : 0);
            profileRecords_[countAt]++;
          }
        }
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(face, TopAbs_EDGE, edges);
      profileRecords_.push_back(edges.Extent());
      for (int i = 1; i <= edges.Extent(); ++i) {
        const int found = origin.FindIndex(edges(i));
        profileRecords_.push_back(found == 0 ? -1 : sketchCurveOf_[origin(found)]);
      }
      const gp_Pnt c = props.CentreOfMass();
      profileNumbers_.push_back(props.Mass());
      profileNumbers_.push_back(c.X());
      profileNumbers_.push_back(c.Y());
      out.push_back(face);
    }
    return true;
  }

  /** Whether `piece`, as it runs in its wire, goes against the direction of the curve it came from. */
  static bool runsAgainst(const TopoDS_Edge& piece, const TopoDS_Edge& curve) {
    BRepAdaptor_Curve adaptor(piece);
    gp_Pnt p;
    gp_Vec along;
    adaptor.D1((adaptor.FirstParameter() + adaptor.LastParameter()) / 2, p, along);
    if (piece.Orientation() == TopAbs_REVERSED) along.Reverse();
    double first = 0;
    double last = 0;
    const Handle(Geom_Curve) geometry = BRep_Tool::Curve(curve, first, last);
    GeomAPI_ProjectPointOnCurve projection(p, geometry, first, last);
    const double u = projection.NbPoints() > 0 ? projection.LowerDistanceParameter() : first;
    gp_Pnt q;
    gp_Vec own;
    geometry->D1(u, q, own);
    return along.Dot(own) < 0;
  }

  int store(const TopoDS_Shape& shape) {
    if (shape.IsNull()) return fail("The operation produced no shape.");
    const int handle = nextHandle_++;
    shapes_.emplace(handle, shape);
    return handle;
  }

  const TopoDS_Shape* find(int handle) const {
    const auto it = shapes_.find(handle);
    return it == shapes_.end() ? nullptr : &it->second;
  }

  static TopAbs_ShapeEnum kindToEnum(int kind) {
    switch (kind) {
      case 0:
        return TopAbs_FACE;
      case 1:
        return TopAbs_EDGE;
      case 3:
        return TopAbs_SOLID;
      default:
        return TopAbs_VERTEX;
    }
  }

  static int enumToKind(TopAbs_ShapeEnum type) {
    switch (type) {
      case TopAbs_FACE:
        return 0;
      case TopAbs_EDGE:
        return 1;
      case TopAbs_VERTEX:
        return 2;
      default:
        return -1;
    }
  }

  template <typename Builder>
  int finishBoolean(Builder& builder, const TopoDS_Shape& a, const TopoDS_Shape& b, bool simplify) {
    builder.SetRunParallel(false);
    builder.Build();
    if (!builder.IsDone() || builder.HasErrors()) {
      return fail("Boolean failed: OCCT could not combine these shapes.");
    }
    if (simplify) builder.SimplifyResult();
    const TopoDS_Shape result = builder.Shape();
    recordHistory(builder, a, 0, result);
    recordHistory(builder, b, 1, result);
    // The builder is on the stack: its destructor frees what it owns (the
    // Clear() rule of ADR-0001 is for builders deleted from JS).
    return store(result);
  }

  /** `shape` moved by (x, y, z), or `shape` itself for a zero move. Sub-shape order is kept. */
  static TopoDS_Shape shifted(const TopoDS_Shape& shape, double x, double y, double z) {
    if (std::abs(x) + std::abs(y) + std::abs(z) == 0) return shape;
    gp_Trsf move;
    move.SetTranslation(gp_Vec(x, y, z));
    return shape.Moved(TopLoc_Location(move));
  }

  /**
   * Tapers a straight sweep's side faces (see prism) and records the sweep's
   * history carried through the taper. Fails with a message for the user
   * when OCCT can't tilt a side or the sides meet before the end.
   */
  int taperSweep(BRepPrimAPI_MakePrism& builder, const TopoDS_Shape& base, const TopoDS_Shape& swept,
                 const gp_Vec& along, double taper) {
    const gp_Dir pull(along);
    const double height = along.Magnitude();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices;
    TopExp::MapShapes(base, TopAbs_VERTEX, vertices);
    if (vertices.IsEmpty()) return fail("Extrude failed: the profile has no vertices.");
    const gp_Pln neutral(BRep_Tool::Pnt(TopoDS::Vertex(vertices(1))), pull);
    // DraftAngle removes matter on the pull side for a positive angle: a
    // positive taper here widens, so the sign flips.
    BRepOffsetAPI_DraftAngle draft(swept);
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(base, TopAbs_EDGE, edges);
    NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> done;
    for (int i = 1; i <= edges.Extent(); ++i) {
      for (NCollection_List<TopoDS_Shape>::Iterator it(builder.Generated(edges(i))); it.More(); it.Next()) {
        if (it.Value().ShapeType() != TopAbs_FACE || done.Contains(it.Value())) continue;
        const TopoDS_Face& side = TopoDS::Face(it.Value());
        BRepAdaptor_Surface surface(side, false);
        const GeomAbs_SurfaceType type = surface.GetType();
        if (type != GeomAbs_Plane && type != GeomAbs_Cylinder && type != GeomAbs_Cone) {
          return fail("Can't taper sides made from ellipses or splines yet. Set the taper to 0.");
        }
        draft.Add(side, pull, -taper, neutral, true);
        if (!draft.AddDone()) {
          return fail("Can't taper this profile's sides. Try a smaller angle or a simpler profile.");
        }
        // Adding a face also tapers the faces tangent to it; adding one of
        // those again is a no-op.
        done.Add(side);
      }
    }
    draft.Build();
    if (!draft.IsDone()) {
      return fail("The taper is too steep for this distance: the sides meet before the end. Use a smaller angle or distance.");
    }
    const TopoDS_Shape result = draft.Shape();
    if (!taperHolds(builder, draft, base, result, neutral, pull, height)) {
      return fail("The taper is too steep for this distance: the sides meet before the end. Use a smaller angle or distance.");
    }
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultMaps[3];
    for (int kind = 0; kind < 3; ++kind) TopExp::MapShapes(result, kindToEnum(kind), resultMaps[kind]);
    for (int kind = 0; kind < 3; ++kind) {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> baseMap;
      TopExp::MapShapes(base, kindToEnum(kind), baseMap);
      for (int i = 1; i <= baseMap.Extent(); ++i) {
        const TopoDS_Shape& sub = baseMap(i);
        appendRelation(throughModifier(draft, builder.Generated(sub)), resultMaps, 0, kind, i - 1, 1);
        NCollection_List<TopoDS_Shape> ends;
        ends.Append(builder.FirstShape(sub));
        appendRelation(throughModifier(draft, ends), resultMaps, 0, kind, i - 1, 4);
        ends.Clear();
        ends.Append(builder.LastShape(sub));
        appendRelation(throughModifier(draft, ends), resultMaps, 0, kind, i - 1, 5);
      }
    }
    return store(result);
  }

  /**
   * Whether a narrowing taper still has room: DraftAngle happily tilts
   * sides past each other, and the result can even pass BRepCheck. So,
   * besides validity and volume: every straight edge of the end cap runs
   * the same way as the profile edge it comes from (sides that met turn it
   * round), and no cone a tapered circle or arc became has its tip before
   * the end.
   */
  static bool taperHolds(BRepPrimAPI_MakePrism& builder, const BRepOffsetAPI_DraftAngle& draft,
                         const TopoDS_Shape& base, const TopoDS_Shape& result, const gp_Pln& neutral,
                         const gp_Dir& pull, double height) {
    BRepCheck_Analyzer analyzer(result);
    GProp_GProps props;
    BRepGProp::VolumeProperties(result, props);
    if (!analyzer.IsValid() || std::abs(props.Mass()) <= Precision::Confusion()) return false;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(result, TopAbs_FACE, faces);
    for (int i = 1; i <= faces.Extent(); ++i) {
      BRepAdaptor_Surface surface(TopoDS::Face(faces(i)), false);
      if (surface.GetType() != GeomAbs_Cone) continue;
      const double tip = gp_Vec(neutral.Location(), surface.Cone().Apex()).Dot(gp_Vec(pull));
      if (tip > Precision::Confusion() && tip < height - 1e-9 * std::max(1.0, height)) return false;
    }
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(base, TopAbs_EDGE, edges);
    for (int i = 1; i <= edges.Extent(); ++i) {
      const TopoDS_Edge& from = TopoDS::Edge(edges(i));
      const TopoDS_Shape last = builder.LastShape(from);
      if (last.IsNull() || last.ShapeType() != TopAbs_EDGE) continue;
      const TopoDS_Shape now = draft.ModifiedShape(last);
      if (now.IsNull() || now.ShapeType() != TopAbs_EDGE) continue;
      TopoDS_Vertex a0, a1, b0, b1;
      TopExp::Vertices(from, a0, a1);
      TopExp::Vertices(TopoDS::Edge(now), b0, b1);
      if (a0.IsNull() || a1.IsNull() || b0.IsNull() || b1.IsNull() || a0.IsSame(a1)) continue;
      const gp_Vec was(BRep_Tool::Pnt(a0), BRep_Tool::Pnt(a1));
      const gp_Vec is(BRep_Tool::Pnt(b0), BRep_Tool::Pnt(b1));
      if (was.Dot(is) <= Precision::Confusion() * was.Magnitude()) return false;
    }
    return true;
  }

  /**
   * What the taper made of each shape. DraftAngle reports a tilted face as
   * generated, not modified, so ask ModifiedShape, which maps any sub-shape.
   */
  static NCollection_List<TopoDS_Shape> throughModifier(const BRepOffsetAPI_DraftAngle& draft,
                                                        const NCollection_List<TopoDS_Shape>& shapes) {
    NCollection_List<TopoDS_Shape> out;
    for (NCollection_List<TopoDS_Shape>::Iterator it(shapes); it.More(); it.Next()) {
      if (it.Value().IsNull()) continue;
      const TopoDS_Shape now = draft.ModifiedShape(it.Value());
      if (!now.IsNull()) out.Append(now);
    }
    return out;
  }

  /** The solids of a shape, or the shape itself if it has none. */
  static std::vector<TopoDS_Shape> solidsOrSelf(const TopoDS_Shape& shape) {
    std::vector<TopoDS_Shape> out;
    for (TopExp_Explorer e(shape, TopAbs_SOLID); e.More(); e.Next()) out.push_back(e.Current());
    if (out.empty()) out.push_back(shape);
    return out;
  }

  /** History of a sweep (see the sweeps section): generated, first and last per sub-shape of `base`. */
  template <typename Builder>
  void recordSweep(Builder& builder, const TopoDS_Shape& base, const TopoDS_Shape& result) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultMaps[3];
    for (int kind = 0; kind < 3; ++kind) TopExp::MapShapes(result, kindToEnum(kind), resultMaps[kind]);
    for (int kind = 0; kind < 3; ++kind) {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> baseMap;
      TopExp::MapShapes(base, kindToEnum(kind), baseMap);
      for (int i = 1; i <= baseMap.Extent(); ++i) {
        const TopoDS_Shape& sub = baseMap(i);
        const bool generated = appendRelation(builder.Generated(sub), resultMaps, 0, kind, i - 1, 1);
        if constexpr (std::is_same_v<Builder, BRepPrimAPI_MakeRevol>) {
          // In a full revolution, MakeRevol::Generated returns nothing for an
          // edge square to the axis (its annulus or disc face is not marked
          // "used" by BRepSweep), though the face is in the result. Ask the
          // sweep itself.
          if (!generated && kind != 0) {
            NCollection_List<TopoDS_Shape> own;
            own.Append(const_cast<BRepSweep_Revol&>(builder.Revol()).Shape(sub));
            appendRelation(own, resultMaps, 0, kind, i - 1, 1);
          }
        }
        NCollection_List<TopoDS_Shape> ends;
        ends.Append(builder.FirstShape(sub));
        appendRelation(ends, resultMaps, 0, kind, i - 1, 4);
        ends.Clear();
        ends.Append(builder.LastShape(sub));
        appendRelation(ends, resultMaps, 0, kind, i - 1, 5);
      }
    }
  }

  /** A canonical sign for an axis or line direction: first non-zero component positive. */
  static gp_Dir canonical(const gp_Dir& d) {
    const double c[3] = {d.X(), d.Y(), d.Z()};
    for (double v : c) {
      if (std::abs(v) > 1e-9) return v < 0 ? d.Reversed() : d;
    }
    return d;
  }

  void pushPoint(const gp_Pnt& p) { geometry_.insert(geometry_.end(), {p.X(), p.Y(), p.Z()}); }
  void pushDir(const gp_Dir& d) { geometry_.insert(geometry_.end(), {d.X(), d.Y(), d.Z()}); }

  /**
   * Appends the pieces of the iso line u = const between v0 and v1 that lie
   * on the face (faceSilhouettes). The line is sampled, and each change
   * between inside and outside is found by bisection. Returns the count.
   */
  int silhouetteRuns(const BRepAdaptor_Surface& surface, BRepTopAdaptor_FClass2d& classifier,
                     double u, double v0, double v1) {
    if (!(v1 > v0)) return 0;
    const auto inside = [&](double v) {
      const TopAbs_State state = classifier.Perform(gp_Pnt2d(u, v));
      return state == TopAbs_IN || state == TopAbs_ON;
    };
    const auto edgeOf = [&](double in, double out) {
      for (int k = 0; k < 48; ++k) {
        const double mid = (in + out) / 2;
        if (inside(mid)) in = mid;
        else out = mid;
      }
      return in;
    };
    const int steps = 64;
    int count = 0;
    double start = 0;
    bool open = false;
    double previous = v0;
    for (int i = 0; i <= steps; ++i) {
      const double v = i == steps ? v1 : v0 + (v1 - v0) * i / steps;
      const bool in = inside(v);
      if (in && !open) {
        start = i == 0 ? v : edgeOf(v, previous);
        open = true;
      } else if (!in && open) {
        count += pushRun(surface, u, start, edgeOf(previous, v));
        open = false;
      }
      previous = v;
    }
    if (open) count += pushRun(surface, u, start, v1);
    return count;
  }

  int pushRun(const BRepAdaptor_Surface& surface, double u, double from, double to) {
    const gp_Pnt a = surface.Value(u, from);
    const gp_Pnt b = surface.Value(u, to);
    if (a.Distance(b) <= Precision::Confusion()) return 0;
    pushPoint(a);
    pushPoint(b);
    return 1;
  }

  void pushNumbers(double size, const gp_Pnt& p, const gp_Dir* d) {
    describeNumbers_.push_back(size);
    describeNumbers_.push_back(p.X());
    describeNumbers_.push_back(p.Y());
    describeNumbers_.push_back(p.Z());
    describeNumbers_.push_back(d ? d->X() : 0.0);
    describeNumbers_.push_back(d ? d->Y() : 0.0);
    describeNumbers_.push_back(d ? d->Z() : 0.0);
  }

  void describeFace(const TopoDS_Face& face) {
    GProp_GProps props;
    BRepGProp::SurfaceProperties(face, props);
    BRepAdaptor_Surface surface(face);
    const GeomAbs_SurfaceType type = surface.GetType();
    describeInts_.push_back(static_cast<int32_t>(type));
    gp_Dir direction(0, 0, 1);
    bool hasDirection = true;
    switch (type) {
      case GeomAbs_Cylinder:
        direction = canonical(surface.Cylinder().Axis().Direction());
        break;
      case GeomAbs_Cone:
        direction = canonical(surface.Cone().Axis().Direction());
        break;
      case GeomAbs_Torus:
        direction = canonical(surface.Torus().Axis().Direction());
        break;
      case GeomAbs_SurfaceOfRevolution:
        direction = canonical(surface.AxeOfRevolution().Direction());
        break;
      case GeomAbs_SurfaceOfExtrusion:
        direction = canonical(surface.Direction());
        break;
      case GeomAbs_Sphere:
        hasDirection = false;
        break;
      default: {
        // The outward normal in the middle of the parameter range; exact for planes.
        double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
        BRepTools::UVBounds(face, u0, u1, v0, v1);
        gp_Pnt p;
        gp_Vec du;
        gp_Vec dv;
        surface.D1((u0 + u1) / 2, (v0 + v1) / 2, p, du, dv);
        const gp_Vec n = du.Crossed(dv);
        if (n.Magnitude() <= 1e-12) {
          hasDirection = false;
        } else {
          direction = gp_Dir(n);
          if (face.Orientation() == TopAbs_REVERSED) direction.Reverse();
        }
      }
    }
    pushNumbers(props.Mass(), props.CentreOfMass(), hasDirection ? &direction : nullptr);
  }

  void describeEdge(const TopoDS_Edge& edge) {
    if (BRep_Tool::Degenerated(edge)) {
      describeInts_.push_back(-1);
      TopoDS_Vertex first;
      TopoDS_Vertex last;
      TopExp::Vertices(edge, first, last);
      pushNumbers(0, first.IsNull() ? gp_Pnt() : BRep_Tool::Pnt(first), nullptr);
      return;
    }
    GProp_GProps props;
    BRepGProp::LinearProperties(edge, props);
    BRepAdaptor_Curve curve(edge);
    const GeomAbs_CurveType type = curve.GetType();
    describeInts_.push_back(static_cast<int32_t>(type));
    gp_Pnt middle;
    gp_Vec tangent;
    curve.D1((curve.FirstParameter() + curve.LastParameter()) / 2, middle, tangent);
    gp_Dir direction(0, 0, 1);
    bool hasDirection = true;
    switch (type) {
      case GeomAbs_Line:
        direction = canonical(curve.Line().Direction());
        break;
      case GeomAbs_Circle:
        direction = canonical(curve.Circle().Axis().Direction());
        break;
      case GeomAbs_Ellipse:
        direction = canonical(curve.Ellipse().Axis().Direction());
        break;
      default:
        if (tangent.Magnitude() <= 1e-12) hasDirection = false;
        else direction = canonical(gp_Dir(tangent));
    }
    pushNumbers(props.Mass(), middle, hasDirection ? &direction : nullptr);
  }

  /** [n, face index × n]: the distinct faces around a sub-shape, as indices into `faces`. */
  void pushAdjacent(
      const NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>& around,
      const TopoDS_Shape& sub, const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces) {
    const size_t countAt = describeInts_.size();
    describeInts_.push_back(0);
    const int found = around.FindIndex(sub);
    if (found == 0) return;
    std::vector<int32_t> seen;
    for (NCollection_List<TopoDS_Shape>::Iterator it(around(found)); it.More(); it.Next()) {
      const int32_t index = faces.FindIndex(it.Value()) - 1;
      if (index < 0 || std::find(seen.begin(), seen.end(), index) != seen.end()) continue;
      seen.push_back(index);
      describeInts_.push_back(index);
    }
    describeInts_[countAt] = static_cast<int32_t>(seen.size());
  }

  /** Appends history records for the faces, edges and vertices of one input. */
  void recordHistory(BRepBuilderAPI_MakeShape& builder, const TopoDS_Shape& input, int inputIndex,
                     const TopoDS_Shape& result) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultMaps[3];
    for (int kind = 0; kind < 3; ++kind) TopExp::MapShapes(result, kindToEnum(kind), resultMaps[kind]);

    for (int kind = 0; kind < 3; ++kind) {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> inputMap;
      TopExp::MapShapes(input, kindToEnum(kind), inputMap);
      for (int i = 1; i <= inputMap.Extent(); ++i) {
        const TopoDS_Shape& sub = inputMap(i);
        // A deleted sub-shape can still generate new ones: a filleted edge is
        // deleted and generates its fillet face.
        const bool deleted = builder.IsDeleted(sub);
        if (deleted) {
          pushRecord(inputIndex, kind, i - 1, 2);
          history_.push_back(0);
        }
        const bool modified =
            !deleted && appendRelation(builder.Modified(sub), resultMaps, inputIndex, kind, i - 1, 0);
        appendRelation(builder.Generated(sub), resultMaps, inputIndex, kind, i - 1, 1);
        if (!deleted && !modified) {
          const int kept = resultMaps[kind].FindIndex(sub);
          if (kept > 0) {
            pushRecord(inputIndex, kind, i - 1, 3);
            history_.push_back(1);
            history_.push_back(kind);
            history_.push_back(kept - 1);
          }
        }
      }
    }
  }

  /** Writes one record if `shapes` has members in the result. Returns whether it wrote one. */
  bool appendRelation(const NCollection_List<TopoDS_Shape>& shapes, const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>* resultMaps,
                      int inputIndex, int kind, int index, int relation) {
    std::vector<int32_t> pairs;
    for (NCollection_List<TopoDS_Shape>::Iterator it(shapes); it.More(); it.Next()) {
      const int resultKind = enumToKind(it.Value().ShapeType());
      if (resultKind < 0) continue;
      const int found = resultMaps[resultKind].FindIndex(it.Value());
      if (found <= 0) continue;
      pairs.push_back(resultKind);
      pairs.push_back(found - 1);
    }
    if (pairs.empty()) return false;
    pushRecord(inputIndex, kind, index, relation);
    history_.push_back(static_cast<int32_t>(pairs.size() / 2));
    history_.insert(history_.end(), pairs.begin(), pairs.end());
    return true;
  }

  void pushRecord(int inputIndex, int kind, int index, int relation) {
    history_.push_back(inputIndex);
    history_.push_back(kind);
    history_.push_back(index);
    history_.push_back(relation);
  }

  void meshFaces(const TopoDS_Shape& shape) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(shape, TopAbs_FACE, faces);
    for (int i = 1; i <= faces.Extent(); ++i) {
      const TopoDS_Face& face = TopoDS::Face(faces(i));
      const uint32_t firstTriangle = static_cast<uint32_t>(indices_.size() / 3);
      TopLoc_Location location;
      const Handle(Poly_Triangulation)& triangulation = BRep_Tool::Triangulation(face, location);
      if (!triangulation.IsNull()) {
        if (!triangulation->HasNormals()) {
          BRepLib_ToolTriangulatedShape::ComputeNormals(face, triangulation);
        }
        const gp_Trsf transform = location.Transformation();
        const bool reversed = face.Orientation() == TopAbs_REVERSED;
        const uint32_t base = static_cast<uint32_t>(positions_.size() / 3);
        for (int n = 1; n <= triangulation->NbNodes(); ++n) {
          const gp_Pnt p = triangulation->Node(n).Transformed(transform);
          positions_.push_back(static_cast<float>(p.X()));
          positions_.push_back(static_cast<float>(p.Y()));
          positions_.push_back(static_cast<float>(p.Z()));
          gp_Dir normal = triangulation->Normal(n);
          normal.Transform(transform);
          const double sign = reversed ? -1.0 : 1.0;
          normals_.push_back(static_cast<float>(sign * normal.X()));
          normals_.push_back(static_cast<float>(sign * normal.Y()));
          normals_.push_back(static_cast<float>(sign * normal.Z()));
        }
        for (int t = 1; t <= triangulation->NbTriangles(); ++t) {
          int n1 = 0;
          int n2 = 0;
          int n3 = 0;
          triangulation->Triangle(t).Get(n1, n2, n3);
          if (reversed) std::swap(n2, n3);
          indices_.push_back(base + static_cast<uint32_t>(n1 - 1));
          indices_.push_back(base + static_cast<uint32_t>(n2 - 1));
          indices_.push_back(base + static_cast<uint32_t>(n3 - 1));
        }
      }
      faceRanges_.push_back(firstTriangle);
      faceRanges_.push_back(static_cast<uint32_t>(indices_.size() / 3) - firstTriangle);
    }
  }

  void meshEdges(const TopoDS_Shape& shape, double linearDeflection, double angularDeflection) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(shape, TopAbs_EDGE, edges);
    NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    for (int i = 1; i <= edges.Extent(); ++i) {
      const TopoDS_Edge& edge = TopoDS::Edge(edges(i));
      const uint32_t firstPoint = static_cast<uint32_t>(edgePoints_.size() / 3);
      const int faceListIndex = edgeFaces.FindIndex(edge);
      uint8_t flags = 0;
      if (faceListIndex > 0) {
        for (NCollection_List<TopoDS_Shape>::Iterator it(edgeFaces(faceListIndex)); it.More(); it.Next()) {
          if (BRep_Tool::IsClosed(edge, TopoDS::Face(it.Value()))) flags |= 1;
        }
      }
      edgeFlags_.push_back(flags);
      if (!BRep_Tool::Degenerated(edge)) {
        bool done = false;
        // Prefer the polygon on an adjacent face's triangulation, so edge
        // lines sit exactly on the rendered mesh.
        if (faceListIndex > 0) {
          for (NCollection_List<TopoDS_Shape>::Iterator it(edgeFaces(faceListIndex)); it.More() && !done;
               it.Next()) {
            TopLoc_Location location;
            const Handle(Poly_Triangulation)& triangulation =
                BRep_Tool::Triangulation(TopoDS::Face(it.Value()), location);
            if (triangulation.IsNull()) continue;
            const Handle(Poly_PolygonOnTriangulation)& polygon =
                BRep_Tool::PolygonOnTriangulation(edge, triangulation, location);
            if (polygon.IsNull()) continue;
            const gp_Trsf transform = location.Transformation();
            const NCollection_Array1<int>& nodes = polygon->Nodes();
            for (int k = nodes.Lower(); k <= nodes.Upper(); ++k) {
              pushPoint(edgePoints_, triangulation->Node(nodes(k)).Transformed(transform));
            }
            done = true;
          }
        }
        if (!done) {
          BRepAdaptor_Curve curve(edge);
          GCPnts_TangentialDeflection sampler(curve, angularDeflection, linearDeflection);
          for (int k = 1; k <= sampler.NbPoints(); ++k) pushPoint(edgePoints_, sampler.Value(k));
        }
      }
      edgeRanges_.push_back(firstPoint);
      edgeRanges_.push_back(static_cast<uint32_t>(edgePoints_.size() / 3) - firstPoint);
    }
  }

  void meshVertices(const TopoDS_Shape& shape) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices;
    TopExp::MapShapes(shape, TopAbs_VERTEX, vertices);
    for (int i = 1; i <= vertices.Extent(); ++i) {
      pushPoint(vertexPoints_, BRep_Tool::Pnt(TopoDS::Vertex(vertices(i))));
    }
  }

  static void pushPoint(std::vector<float>& out, const gp_Pnt& p) {
    out.push_back(static_cast<float>(p.X()));
    out.push_back(static_cast<float>(p.Y()));
    out.push_back(static_cast<float>(p.Z()));
  }
};
