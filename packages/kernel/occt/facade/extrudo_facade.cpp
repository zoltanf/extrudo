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
//   clearArgs() / pushArg() before the call.

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeShape.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <GProp_GProps.hxx>
#include <NCollection_Array1.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <NCollection_IndexedMap.hxx>
#include <NCollection_List.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Triangulation.hxx>
#include <Standard_Failure.hxx>
#include <TopExp.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>

#include <unistd.h>

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

  /** Boolean of two shapes: op 0 = fuse, 1 = cut (a − b), 2 = common. Records history for 0 and 1. */
  int boolean(int op, int a, int b) {
    beginOp();
    const TopoDS_Shape* shapeA = find(a);
    const TopoDS_Shape* shapeB = find(b);
    if (shapeA == nullptr || shapeB == nullptr) return fail("Boolean failed: unknown input shape.");
    try {
      switch (op) {
        case 0: {
          BRepAlgoAPI_Fuse builder(*shapeA, *shapeB);
          return finishBoolean(builder, *shapeA, *shapeB);
        }
        case 1: {
          BRepAlgoAPI_Cut builder(*shapeA, *shapeB);
          return finishBoolean(builder, *shapeA, *shapeB);
        }
        case 2: {
          BRepAlgoAPI_Common builder(*shapeA, *shapeB);
          return finishBoolean(builder, *shapeA, *shapeB);
        }
        default:
          return fail("Boolean failed: unknown operation.");
      }
    } catch (...) {
      return failFromException("Boolean failed");
    }
  }

  // -------------------------------------------------------------- history --

  /**
   * History of the last operation as int32 records:
   * [input, kind, index, relation, n, (resultKind, resultIndex) × n].
   * relation: 0 = modified, 1 = generated, 2 = deleted (n = 0), 3 = kept unchanged.
   */
  uintptr_t historyPtr() const { return reinterpret_cast<uintptr_t>(history_.data()); }
  int historySize() const { return static_cast<int>(history_.size()); }

  // ------------------------------------------------------------- topology --

  /** Number of sub-shapes of a kind (0 = face, 1 = edge, 2 = vertex), or -1 for an unknown handle. */
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
  int finishBoolean(Builder& builder, const TopoDS_Shape& a, const TopoDS_Shape& b) {
    builder.Build();
    if (!builder.IsDone() || builder.HasErrors()) {
      return fail("Boolean failed: OCCT could not combine these shapes.");
    }
    const TopoDS_Shape result = builder.Shape();
    recordHistory(builder, a, 0, result);
    recordHistory(builder, b, 1, result);
    return store(result);
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
