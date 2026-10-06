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
// - Integer arguments that are lists (fillet and chamfer edges) are staged with
//   clearArgs() / pushArg() before the call; lists of numbers (spline poles
//   and knots, fillet radii) with clearNumbers() / pushNumber().

#include <BOPAlgo_Builder.hxx>
#include <BOPAlgo_ArgumentAnalyzer.hxx>
#include <BOPAlgo_BuilderFace.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <GeomLib.hxx>
#include <Geom_BoundedSurface.hxx>
#include <Geom_BezierSurface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeShape.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepBuilderAPI_GTransform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepOffset_MakeSimpleOffset.hxx>
#include <ShapeFix_Solid.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <BRepFill_CompatibleWires.hxx>
#include <BRepFill_TypeOfContact.hxx>
#include <BRepAdaptor_CompCurve.hxx>
#include <GCPnts_QuasiUniformAbscissa.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <Law_Linear.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom2d_Line.hxx>
#include <Geom2d_Circle.hxx>
#include <Geom2d_Ellipse.hxx>
#include <Geom_Line.hxx>
#include <Geom_Ellipse.hxx>
#include <GeomConvert.hxx>
#include <BRepGProp.hxx>
#include <BRepLProp_SLProps.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepTools.hxx>
#include <BRepTools_ReShape.hxx>
#include <BRepLib.hxx>
#include <BRepLib_MakeEdge.hxx>
#include <BRepTopAdaptor_FClass2d.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepSweep_Revol.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <DESTEP_Parameters.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <Geom2dAPI_InterCurveCurve.hxx>
#include <Geom2dInt_GInter.hxx>
#include <Geom2d_BSplineCurve.hxx>
#include <GeomAPI_ProjectPointOnCurve.hxx>
#include <IntRes2d_IntersectionPoint.hxx>
#include <Message.hxx>
#include <Message_Messenger.hxx>
#include <Message_PrinterOStream.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Plane.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Geom_Surface.hxx>
#include <Geom2d_Curve.hxx>
#include <GeomLib_IsPlanarSurface.hxx>
#include <IFSelect_ReturnStatus.hxx>
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
#include <BRepTools_WireExplorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Iterator.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Precision.hxx>
#include <STEPControl_Reader.hxx>
#include <StepBasic_Product.hxx>
#include <StepData_StepModel.hxx>
#include <TCollection_HAsciiString.hxx>
#include <STEPControl_Writer.hxx>
#include <UnitsMethods_LengthUnit.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Ax3.hxx>
#include <gp_Circ.hxx>
#include <gp_Cone.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Elips.hxx>
#include <gp_Elips2d.hxx>
#include <gp_Ax22d.hxx>
#include <gp_Lin2d.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Sphere.hxx>
#include <gp_Torus.hxx>
#include <gp_Trsf.hxx>
#include <gp_GTrsf.hxx>
#include <gp_Lin.hxx>
#include <gp_Mat.hxx>
#include <gp_XYZ.hxx>
#include <gp_Vec.hxx>

#include <unistd.h>

#include <algorithm>
#include <type_traits>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <exception>
#include <map>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

class ExtrudoFacade {
public:
  ExtrudoFacade() : nextHandle_(1) {}

  // -------------------------------------------------------- mass properties --

  /**
   * The relative error bound of the BRepGProp integrators (P4-12 H3,
   * ADR-0067 §H3). Without it OCCT integrates with a fixed Gauss order, which
   * is 1-3 % out on a body with B-spline faces (a wrap's walls, ADR-0060 §3).
   * 1e-7 gives the same answer as 1e-12 on every case in `spikes/p4-12-mass`
   * at about half the time.
   */
  static constexpr double MASS_EPS = 1e-7;

  /**
   * Whether `shape` needs the adaptive integral at all, which is whether one
   * of its faces is a surface OCCT cannot integrate exactly with a fixed
   * order: a B-spline, Bezier or offset surface, which is the geometry our own
   * maps make (a wrap's wall, a sweep's, a scale's, a loft's side).
   *
   * The alternative, a surface of linear extrusion or of revolution, is where
   * the adaptive integral is the worse of the two: the terms of the volume
   * integral cancel there (a prism wall's exact contribution is zero, whatever
   * the prism's other faces say), and subdividing to a bound on each term
   * leaves more of the cancellation behind. Measured on the prism of an
   * extruded letter (ADR-0058's shaper output, eleven B-spline walls), against
   * the same profile's area times the distance: 0.3 % out with the fixed order
   * and 3.9 % with the bound, while the same letter's wall as a wrap (where
   * the terms add) goes from 1.08 % to exact. So the choice is per shape, not
   * per call site.
   */
  static bool needsTolerance(const TopoDS_Shape& shape) {
    for (TopExp_Explorer face(shape, TopAbs_FACE); face.More(); face.Next()) {
      BRepAdaptor_Surface surface(TopoDS::Face(face.Current()), false);
      const GeomAbs_SurfaceType type = surface.GetType();
      if (type == GeomAbs_BSplineSurface || type == GeomAbs_BezierSurface ||
          type == GeomAbs_OffsetSurface) {
        return true;
      }
    }
    return false;
  }

  /** A solid's volume, integrated to MASS_EPS where that is the better form. */
  static void integrateVolume(const TopoDS_Shape& shape, GProp_GProps& props) {
    if (needsTolerance(shape)) {
      BRepGProp::VolumeProperties(shape, props, MASS_EPS, false);
    } else {
      BRepGProp::VolumeProperties(shape, props);
    }
  }

  /** The area of a face or shape, on the same rule as `integrateVolume`. */
  static void integrateArea(const TopoDS_Shape& shape, GProp_GProps& props) {
    if (needsTolerance(shape)) {
      BRepGProp::SurfaceProperties(shape, props, MASS_EPS, false);
    } else {
      BRepGProp::SurfaceProperties(shape, props);
    }
  }

  /** The length of edges, on the same rule as `integrateVolume`. */
  static void integrateLength(const TopoDS_Shape& shape, GProp_GProps& props) {
    if (needsTolerance(shape)) {
      BRepGProp::LinearProperties(shape, props, MASS_EPS, false);
    } else {
      BRepGProp::LinearProperties(shape, props);
    }
  }

  /**
   * A volume for a decision, as `integrateVolume` gives it: the checks that a
   * percent could flip (shellIsGood, offsetIsGood, draftIsGood) want it, a
   * check that only asks whether a volume is positive (volumeOf) does not care.
   */
  static double exactVolume(const TopoDS_Shape& shape) {
    GProp_GProps props;
    integrateVolume(shape, props);
    return props.Mass();
  }

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
   * Fillets edges of `shape` (P3-01): the staged edges (clearArgs/pushArg,
   * 0-based edge indices) with the staged radii (clearNumbers/pushNumber,
   * one per edge). OCCT rounds a whole chain of tangent-continuous edges
   * once any one of them is added, so the edges of a chain share one
   * radius (staging different ones for a chain fails, see below). Records
   * history for input 0: a filleted edge is deleted and generates its
   * fillet face, the faces it touches are modified.
   *
   * On failure it returns 0 with a message in lastError() and, in
   * geometryNumbers, what a person can act on: [status, n, then n records
   * of [m, edge × m, value]] with the edge indices of `shape`:
   * - 1 the radius is too large for a chain: its m edges and the largest
   *   radius that still works (0: none does), found by bisection;
   * - 2 an edge can't be filleted (it isn't between two faces): [1, edge, 0];
   * - 3 one chain got two radii: its staged edges, value 0;
   * - 4 every chain works alone but not all together: all staged edges and
   *   the largest factor (0..1) the radii can be scaled by, 0 if none;
   * - 5 anything else (an OCCT exception or an invalid result): n = 0.
   *
   * A radius that changes along a chain is filletVariable()'s, and a constant
   * one is this method's.
   */
  int fillet(int shape) { return filletBuild(shape, 1); }

  /**
   * Fillets edges of `shape` with a radius that changes along each chain of
   * tangent-continuous edges (P4-10, ADR-0064 §2): the staged edges
   * (clearArgs/pushArg, 0-based edge indices) with **two** staged numbers per
   * edge (clearNumbers/pushNumber), the radius at the chain's start and the
   * radius at its end; the radius in between moves from one to the other.
   * Two equal radii are a constant fillet, which fillet() asks for.
   *
   * As in fillet(), OCCT rounds a whole chain of tangent-continuous edges at
   * once, so one pair per chain decides it: the first staged edge of the chain
   * gives its start and end radius. Records fillet()'s history for input 0.
   *
   * On failure it returns 0 with a message in lastError() and, in
   * geometryNumbers, the diagnosis in fillet()'s layout
   * [status, n, n × [m, edge × m, value]]:
   * - 2 an edge can't be filleted (it isn't between two faces): [1, edge, 0];
   * - 3 one chain got two radius pairs: its staged edges, value 0;
   * - 4 the fillets can't be built: all staged edges and the largest factor
   *   (0..1) every radius can be scaled by, 0 if none;
   * - 5 anything else: n = 0.
   * There is no status 1: with a taper, which chain is too large depends on
   * the direction the radius runs in, so the one number a person can act on
   * is the factor all of them scale by.
   */
  int filletVariable(int shape) { return filletBuild(shape, 2); }

  /**
   * The edge indices of the chain of tangent-continuous edges around one
   * edge (what fillet() rounds together), the edge itself included, in
   * lookupPtr/lookupSize. An edge that can't be filleted is its own
   * chain. Returns the count, or -1.
   */
  int tangentChain(int shape, int edge) {
    beginOp();
    lookup_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) {
      fail("Unknown shape.");
      return -1;
    }
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(*input, TopAbs_EDGE, edges);
      if (edge < 0 || edge >= edges.Extent()) {
        fail("Edge index out of range.");
        return -1;
      }
      BRepFilletAPI_MakeFillet builder(*input);
      const TopoDS_Edge start = TopoDS::Edge(edges(edge + 1));
      builder.Add(start);
      const int contour = builder.Contour(start);
      if (contour > 0) {
        for (int j = 1; j <= builder.NbEdges(contour); ++j) {
          const int at = edges.FindIndex(builder.Edge(contour, j)) - 1;
          if (at >= 0) lookup_.push_back(at);
        }
      }
      if (lookup_.empty()) lookup_.push_back(edge);
      return static_cast<int>(lookup_.size());
    } catch (...) {
      lookup_.clear();
      lookup_.push_back(edge);
      return 1;
    }
  }

  /**
   * Chamfers edges of `shape` (P3-02): the staged edges (clearArgs/pushArg,
   * 0-based edge indices) with four staged numbers per edge
   * (clearNumbers/pushNumber): [mode, a, b, flip].
   * - mode 0, equal distance: `a` on both faces; `b` and `flip` are ignored.
   * - mode 1, two distances: `a` measured on the reference face, `b` on the
   *   other.
   * - mode 2, distance and angle: `a` measured on the reference face, `b`
   *   the angle (radians, 0..π/2) the chamfer makes with it.
   * The reference face of an edge is the lower-numbered of the two faces
   * next to it, the other one when `flip` is 1. As in fillet(), OCCT
   * chamfers a whole chain of tangent-continuous edges once one of them is
   * added, so the edges of a chain need the same four numbers, and the
   * first staged edge of a chain decides its reference face. Records
   * history for input 0 (a chamfered edge is deleted and generates its
   * chamfer face).
   *
   * On failure it returns 0 with a message in lastError() and, in
   * geometryNumbers, the diagnosis in fillet()'s layout
   * [status, n, n × [m, edge × m, value]]:
   * - 1 the distances are too large for a chain: its m edges and the
   *   largest factor (0..1; 0: none works) its distances (not the angle)
   *   can be scaled by, found by bisection;
   * - 2 an edge can't be chamfered (not between two faces): [1, edge, 0];
   * - 3 one chain got different settings: its staged edges, value 0;
   * - 4 every chain works alone but not all together: all staged edges and
   *   the largest factor all distances can be scaled by, 0 if none;
   * - 5 anything else: n = 0.
   */
  int chamfer(int shape) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Chamfer failed: unknown input shape.");
    if (args_.empty() || numbers_.size() != args_.size() * 4) {
      return fail("Chamfer failed: pick edges and give each its distances.");
    }
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*input, TopAbs_EDGE, edges);
      TopExp::MapShapes(*input, TopAbs_FACE, faces);
      NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
      TopExp::MapShapesAndUniqueAncestors(*input, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
      const std::vector<int> staged = args_;
      const std::vector<double> spec = numbers_;
      for (size_t i = 0; i < staged.size(); ++i) {
        if (staged[i] < 0 || staged[i] >= edges.Extent()) return fail("Chamfer failed: edge index out of range.");
        const int mode = static_cast<int>(spec[4 * i]);
        const double a = spec[4 * i + 1];
        const double b = spec[4 * i + 2];
        if (mode < 0 || mode > 2) return fail("Chamfer failed: unknown mode.");
        if (!(a > 0)) return fail("Chamfer failed: the distance must be greater than 0.");
        if (mode == 1 && !(b > 0)) return fail("Chamfer failed: the second distance must be greater than 0.");
        if (mode == 2 && !(b > 0 && b < 1.5707963267948966)) {
          return fail("Chamfer failed: the angle must be between 0 and 90 degrees.");
        }
      }
      BRepFilletAPI_MakeChamfer builder(*input);
      std::vector<int> contourOf;
      std::vector<int> bad;
      const int added = addChamfers(builder, edges, faces, edgeFaces, staged, spec, contourOf, bad);
      if (added == 1) {
        geometry_.push_back(2);
        geometry_.push_back(static_cast<double>(bad.size()));
        for (int position : bad) {
          geometry_.push_back(1);
          geometry_.push_back(staged[position]);
          geometry_.push_back(0);
        }
        return fail("Chamfer failed: an edge can't be chamfered.");
      }
      if (added == 2) {
        geometry_.push_back(3);
        geometry_.push_back(1);
        geometry_.push_back(static_cast<double>(bad.size()));
        for (int position : bad) geometry_.push_back(staged[position]);
        geometry_.push_back(0);
        return fail("Chamfer failed: one chain of tangent edges got different settings.");
      }
      // The chains, before Build: a failed Build can leave the builder unfit to ask.
      std::vector<std::vector<int>> chains(static_cast<size_t>(builder.NbContours()) + 1);
      for (int contour = 1; contour <= builder.NbContours(); ++contour) {
        for (int j = 1; j <= builder.NbEdges(contour); ++j) {
          const int at = edges.FindIndex(builder.Edge(contour, j)) - 1;
          if (at >= 0) chains[contour].push_back(at);
        }
      }
      TopoDS_Shape result;
      try {
        builder.Build();
        if (builder.IsDone()) result = builder.Shape();
      } catch (...) {
        result.Nullify();
      }
      if (!result.IsNull() && BRepCheck_Analyzer(result).IsValid()) {
        recordHistory(builder, *input, 0, result);
        return store(result);
      }
      return explainChamfer(*input, edges, faces, edgeFaces, staged, spec, contourOf, chains);
    } catch (...) {
      geometry_.clear();
      geometry_.push_back(5);
      geometry_.push_back(0);
      return failFromException("Chamfer failed");
    }
  }

  /**
   * Shells the solid `shape` (P3-03): hollows it with walls of `thickness`
   * (> 0) mm, `outside` growing the walls outwards from the original
   * surface (the original becomes the cavity) and otherwise inwards (the
   * outside stays where it is). The staged args (clearArgs/pushArg,
   * 0-based face indices, duplicates ignored) are the faces to remove, the
   * openings; none stages a closed, hollow solid with a void inside.
   * Records history for input 0: a removed face is deleted, the faces that
   * stay are kept, each generates its offset face and each edge of a removed
   * face its rim.
   *
   * On failure it returns 0 with a message in lastError() and, in
   * geometryNumbers, [status, value]:
   * - 1 the thickness is too large: the largest thickness that works, by
   *   bisection (value);
   * - 2 OCCT can't offset the body at any thickness worth trying (value 0):
   *   typically fillets or tangent faces;
   * - 3 every face would be removed (value 0);
   * - 4 the body isn't a solid (value 0);
   * - 5 anything else (an OCCT exception): value 0;
   * - 6 a removed face flows smoothly (tangent) into a neighbouring face,
   *   as next to a fillet: OCCT's offset corrupts its heap there, so it is
   *   not tried. Value: the face's index.
   */
  int shell(int shape, double thickness, bool outside) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Shell failed: unknown input shape.");
    if (!(thickness > 0)) return fail("Shell failed: the thickness must be greater than 0.");
    try {
      if (!TopExp_Explorer(*input, TopAbs_SOLID).More()) {
        pushShellStatus(4, 0);
        return fail("Shell failed: the body isn't a solid.");
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*input, TopAbs_FACE, faces);
      std::vector<int> removed;
      for (int index : args_) {
        if (index < 0 || index >= faces.Extent()) return fail("Shell failed: face index out of range.");
        if (std::find(removed.begin(), removed.end(), index) == removed.end()) removed.push_back(index);
      }
      if (static_cast<int>(removed.size()) >= faces.Extent()) {
        pushShellStatus(3, 0);
        return fail("Shell failed: every face would be removed.");
      }
      int refused = -1;
      const int route = openingRoute(*input, faces, removed, refused);
      if (route < 0) {
        pushShellStatus(6, refused);
        return fail("Shell failed: a removed face is tangent to its neighbours.");
      }
      if (route == 1) {
        const std::vector<double> perFace(static_cast<size_t>(faces.Extent()), thickness);
        return plugShell(*input, removed, perFace, thickness, outside, false, false);
      }
      {
        // OCCT's offset repairs the shape it is given in place (edge
        // tolerances, curves through SameParameter), which would change the
        // cached body every preview builds on, so every build (and every
        // probe of the diagnosis) gets its own copy. A copy keeps the
        // original's sub-shape order, so indices and history carry over.
        const TopoDS_Shape copy = BRepBuilderAPI_Copy(*input, true, false).Shape();
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> copyFaces;
        TopExp::MapShapes(copy, TopAbs_FACE, copyFaces);
        if (copyFaces.Extent() == faces.Extent()) {
          BRepOffsetAPI_MakeThickSolid builder;
          TopoDS_Shape result;
          if (buildShell(builder, copy, copyFaces, removed, thickness, outside, result) &&
              shellIsGood(builder, copy, copyFaces, removed, result, thickness, outside)) {
            recordHistory(builder, copy, 0, result);
            return store(result);
          }
        }
      }
      // The failed builder is gone before the probes start (see explainShell).
      return explainShell(*input, removed, thickness, outside);
    } catch (...) {
      pushShellStatus(5, 0);
      return failFromException("Shell failed");
    }
  }

  /** Clears the walls staged for shellFaces(). */
  void clearWalls() {
    wallFaces_.clear();
    wallThickness_.clear();
  }

  /**
   * Stages one wall for shellFaces() (P4-12, ADR-0046's amendment): face
   * `face` (a 0-based index) gets walls of `thickness` mm instead of the
   * shell's own thickness.
   */
  void pushWall(int face, double thickness) {
    wallFaces_.push_back(face);
    wallThickness_.push_back(thickness);
  }

  /**
   * Shells the solid `shape` like shell() (the staged args are the faces to
   * remove), with a thickness per face (P4-12, ADR-0046's amendment): the
   * walls staged with clearWalls()/pushWall() get their own thickness, every
   * other face `thickness`. OCCT gives the faces that run smoothly into a
   * staged face (its smooth chain, see tangentFaces) the same thickness, and
   * so does the check. Built on BRepOffset_MakeOffset with SetOffsetOnFace,
   * which is what traps the heap on bodies where a smooth chain has a sharp
   * edge inside it (ADR-0051), so those are refused before OCCT runs. Records
   * history for input 0 as shell() does.
   *
   * On failure it returns 0 with a message in lastError() and, in
   * geometryNumbers, [status, value]: 2 to 6 as shell(), and
   * - 1 the walls are too thick: the largest factor every thickness (the
   *   shell's and the walls') can be scaled by together, by bisection;
   * - 7 a smooth chain has a sharp edge inside it (value 0);
   * - 8 a staged wall is a removed face: its index;
   * - 9 a face is staged twice with different thicknesses: its index;
   * - 10 two faces of one smooth chain are staged with different
   *   thicknesses: the second face's index.
   */
  int shellFaces(int shape, double thickness, bool outside) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Shell failed: unknown input shape.");
    if (!(thickness > 0)) return fail("Shell failed: the thickness must be greater than 0.");
    for (double t : wallThickness_) {
      if (!(t > 0)) return fail("Shell failed: every wall thickness must be greater than 0.");
    }
    try {
      if (!TopExp_Explorer(*input, TopAbs_SOLID).More()) {
        pushShellStatus(4, 0);
        return fail("Shell failed: the body isn't a solid.");
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*input, TopAbs_FACE, faces);
      std::vector<int> removed;
      for (int index : args_) {
        if (index < 0 || index >= faces.Extent()) return fail("Shell failed: face index out of range.");
        if (std::find(removed.begin(), removed.end(), index) == removed.end()) removed.push_back(index);
      }
      if (static_cast<int>(removed.size()) >= faces.Extent()) {
        pushShellStatus(3, 0);
        return fail("Shell failed: every face would be removed.");
      }
      for (int index : wallFaces_) {
        if (index < 0 || index >= faces.Extent()) return fail("Shell failed: wall face index out of range.");
      }
      int refused = -1;
      const int route = openingRoute(*input, faces, removed, refused);
      if (route < 0) {
        pushShellStatus(6, refused);
        return fail("Shell failed: a removed face is tangent to its neighbours.");
      }
      std::vector<int> chain;
      if (smoothChains(*input, faces, chain)) {
        pushShellStatus(7, 0);
        return fail("Shell failed: rounded edges meet at a sharp corner.");
      }
      std::vector<double> perFace;
      if (!wallThicknesses(chain, removed, thickness, perFace)) return 0;
      if (route == 1) return plugShell(*input, removed, perFace, thickness, outside, true, true);
      for (int index : removed) perFace[static_cast<size_t>(index)] = 0;
      {
        // A copy for every build, as in shell(): OCCT repairs its input in place.
        const TopoDS_Shape copy = BRepBuilderAPI_Copy(*input, true, false).Shape();
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> copyFaces;
        TopExp::MapShapes(copy, TopAbs_FACE, copyFaces);
        if (copyFaces.Extent() == faces.Extent()) {
          BRepOffset_MakeOffset builder;
          TopoDS_Shape result;
          if (buildShellFaces(builder, copy, copyFaces, removed, perFace, thickness, 1.0, outside, result) &&
              shellFacesGood(builder, copy, copyFaces, removed, perFace, 1.0, result, outside)) {
            recordHistory(builder, copy, 0, result);
            return store(result);
          }
        }
      }
      return explainShellFaces(*input, removed, perFace, thickness, outside);
    } catch (...) {
      pushShellStatus(5, 0);
      return failFromException("Shell failed");
    }
  }

  /**
   * Moves faces of the solid `shape` along their normals (P3-08, offset
   * face): the staged faces (clearArgs/pushArg, 0-based face indices,
   * duplicates ignored) each move by `distance` mm, positive along the
   * face's outward normal (the body grows there: out of a wall, into a
   * hole), negative against it. The faces next to them are extended or
   * trimmed to follow (sharp joins, `GeomAbs_Intersection`), so a slanted
   * neighbour keeps its slope and a cylinder's wall changes its radius.
   * OCCT moves the faces that run smoothly into a picked face (a fillet
   * around a pad) by the same distance, so `tangentFaces` says which these
   * are. Records history for input 0: every face generates its (offset)
   * image; a face the offset swallows is deleted.
   *
   * On failure it returns 0 with a message in lastError() and, in
   * geometryNumbers, [status, value]:
   * - 1 the distance is too large: the largest distance of the same sign
   *   (as a magnitude) that works, by bisection (value);
   * - 2 OCCT can't offset these faces at any distance worth trying (value 0);
   * - 3 the body isn't a solid (value 0);
   * - 4 the solid has an inner void (more than one shell), which the offset
   *   can't handle (value 0);
   * - 5 anything else (an OCCT exception): value 0;
   * - 6 a smooth chain of faces has a sharp edge inside it (fillets that meet
   *   at a corner without a blend): OCCT's offset traps the wasm heap on such
   *   bodies, so it is not tried (value 0).
   */
  int offsetFaces(int shape, double distance) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Offset failed: unknown input shape.");
    if (!(std::fabs(distance) > 1e-9)) return fail("Offset failed: the distance must not be 0.");
    try {
      if (!TopExp_Explorer(*input, TopAbs_SOLID).More()) {
        pushShellStatus(3, 0);
        return fail("Offset failed: the body isn't a solid.");
      }
      int shells = 0;
      for (TopExp_Explorer it(*input, TopAbs_SHELL); it.More(); it.Next()) ++shells;
      if (shells != 1) {
        pushShellStatus(4, 0);
        return fail("Offset failed: the solid has an inner void.");
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*input, TopAbs_FACE, faces);
      std::vector<int> picked;
      for (int index : args_) {
        if (index < 0 || index >= faces.Extent()) return fail("Offset failed: face index out of range.");
        if (std::find(picked.begin(), picked.end(), index) == picked.end()) picked.push_back(index);
      }
      if (picked.empty()) return fail("Offset failed: no face to offset.");
      // OCCT offsets a face's smooth neighbours with it: those are checked too. A chain with
      // a sharp edge inside it (fillets meeting at a corner) traps OCCT's offset: refused.
      std::vector<int> chain;
      if (smoothChains(*input, faces, chain)) {
        pushShellStatus(6, 0);
        return fail("Offset failed: rounded edges meet at a sharp corner.");
      }
      const std::vector<int> moving = smoothClosure(chain, picked);
      {
        // A copy for every build, as in shell(): OCCT repairs its input in place.
        const TopoDS_Shape copy = BRepBuilderAPI_Copy(*input, true, false).Shape();
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> copyFaces;
        TopExp::MapShapes(copy, TopAbs_FACE, copyFaces);
        if (copyFaces.Extent() == faces.Extent()) {
          BRepOffset_MakeOffset builder;
          TopoDS_Shape result;
          if (buildOffset(builder, copy, copyFaces, picked, distance, result) &&
              offsetIsGood(builder, copy, copyFaces, moving, result, distance)) {
            recordHistory(builder, copy, 0, result);
            return store(result);
          }
        }
      }
      return explainOffset(*input, picked, moving, distance);
    } catch (...) {
      pushShellStatus(5, 0);
      return failFromException("Offset failed");
    }
  }

  /**
   * The faces (indices, in lookupPtr/lookupSize) that run smoothly into
   * face `face` and each other, the face itself included: the faces OCCT's
   * offset moves together (a fillet around a pad moves with the pad's top).
   * Returns the count, or -1.
   */
  int tangentFaces(int shape, int face) {
    beginOp();
    lookup_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) {
      fail("Unknown shape.");
      return -1;
    }
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*input, TopAbs_FACE, faces);
      if (face < 0 || face >= faces.Extent()) {
        fail("Face index out of range.");
        return -1;
      }
      std::vector<int> chain;
      smoothChains(*input, faces, chain);
      for (int index : smoothClosure(chain, std::vector<int>{face})) lookup_.push_back(index);
      return static_cast<int>(lookup_.size());
    } catch (...) {
      lookup_.clear();
      lookup_.push_back(face);
      return 1;
    }
  }

  /**
   * Boolean of two shapes: op 0 = fuse, 1 = cut (a − b), 2 = common, 3 =
   * split (a cut into pieces by b, which may be a face; the result is a's
   * pieces, b's own parts left out: P4-12, ADR-0028's amendment). With
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
          BRepAlgoAPI_Fuse builder;
          return finishBoolean(builder, *shapeA, *shapeB, simplify);
        }
        case 1: {
          BRepAlgoAPI_Cut builder;
          return finishBoolean(builder, *shapeA, *shapeB, simplify);
        }
        case 2: {
          BRepAlgoAPI_Common builder;
          return finishBoolean(builder, *shapeA, *shapeB, simplify);
        }
        case 3: {
          BRepAlgoAPI_Splitter builder;
          return finishBoolean(builder, *shapeA, *shapeB, simplify);
        }
        default:
          return fail("Boolean failed: unknown operation.");
      }
    } catch (...) {
      return failFromException("Boolean failed");
    }
  }

  /**
   * The surface under face `face` of `shape` as a face of its own, bounded
   * far past the face (P4-12, ADR-0028's amendment): a split by it cuts a
   * sweep wherever the surface, not only the face, crosses it. A closed
   * direction (a cylinder's or sphere's turn, a torus) is taken whole; an
   * open one (a plane, a cylinder's length) is grown by `size` mm on both
   * sides, stopping at the surface's own bounds and short of a cone's tip;
   * a B-spline or Bézier surface is extended by `size` along its tangents
   * (GeomLib::ExtendSurfByLength, C1), or kept as it is where that fails.
   * The face keeps the original's orientation. No history.
   */
  int extendFace(int shape, int face, double size) {
    beginOp();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return fail("Unknown shape.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*s, TopAbs_FACE, faces);
      if (face < 0 || face >= faces.Extent()) return fail("Face index out of range.");
      const TopoDS_Face original = TopoDS::Face(faces(face + 1));
      Handle(Geom_Surface) surface = BRep_Tool::Surface(original);
      if (surface.IsNull()) return fail("This face has no surface to extend.");
      while (surface->IsKind(STANDARD_TYPE(Geom_RectangularTrimmedSurface))) {
        surface = Handle(Geom_RectangularTrimmedSurface)::DownCast(surface)->BasisSurface();
      }
      double u0, u1, v0, v1;
      BRepTools::UVBounds(original, u0, u1, v0, v1);
      const bool spline = surface->IsKind(STANDARD_TYPE(Geom_BSplineSurface)) ||
                          surface->IsKind(STANDARD_TYPE(Geom_BezierSurface));
      if (spline) {
        Handle(Geom_BoundedSurface) grown = Handle(Geom_BoundedSurface)::DownCast(surface->Copy());
        for (const bool inU : {true, false}) {
          for (const bool after : {false, true}) {
            try {
              GeomLib::ExtendSurfByLength(grown, size, 1, inU, after);
            } catch (...) {
              // Keep what was extended so far.
            }
          }
        }
        surface = grown;
        surface->Bounds(u0, u1, v0, v1);
      } else {
        double su0, su1, sv0, sv1;
        surface->Bounds(su0, su1, sv0, sv1);
        const double faceV0 = v0, faceV1 = v1;
        if (surface->IsUPeriodic()) {
          u0 = su0;
          u1 = su0 + surface->UPeriod();
        } else {
          u0 = std::max(su0, u0 - size);
          u1 = std::min(su1, u1 + size);
        }
        if (surface->IsVPeriodic()) {
          v0 = sv0;
          v1 = sv0 + surface->VPeriod();
        } else {
          v0 = std::max(sv0, v0 - size);
          v1 = std::min(sv1, v1 + size);
        }
        Handle(Geom_ConicalSurface) cone = Handle(Geom_ConicalSurface)::DownCast(surface);
        if (!cone.IsNull()) {
          // V runs along the cone's side; its tip is where the radius reaches 0.
          const double tip = -cone->RefRadius() / std::sin(cone->SemiAngle());
          const double margin = 1e-3 * std::max(1.0, std::abs(tip));
          if (tip <= faceV0) v0 = std::max(v0, tip + margin);
          else if (tip >= faceV1) v1 = std::min(v1, tip - margin);
        }
      }
      BRepBuilderAPI_MakeFace maker(surface, u0, u1, v0, v1, Precision::Confusion());
      if (!maker.IsDone()) return fail("Couldn't extend this face.");
      TopoDS_Face extended = maker.Face();
      if (original.Orientation() == TopAbs_REVERSED) extended.Reverse();
      return store(extended);
    } catch (...) {
      return failFromException("Couldn't extend this face");
    }
  }

  // ----------------------------------------------------------- transforms --

  /**
   * Moves, turns or mirrors `shape` by the staged matrix (P3-06): 12 numbers
   * (clearNumbers/pushNumber), the rows of a 3 × 4 matrix, [r11 r12 r13 tx,
   * r21 r22 r23 ty, r31 r32 r33 tz]. The 3 × 3 part must be a rotation or a
   * reflection (determinant -1: a mirror); a scale fails. The geometry is
   * rebuilt (BRepBuilderAPI_Transform, copy = true), not given a location,
   * so the result is an ordinary shape that later operations can combine,
   * and a mirror comes out with its faces turned outward. Sub-shape order
   * is that of the input. Records history for input 0: every sub-shape is
   * modified into its image.
   */
  int transform(int shape) {
    beginOp();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Transform failed: unknown input shape.");
    if (numbers_.size() != 12) return fail("Transform failed: the matrix needs 12 numbers.");
    try {
      const std::vector<double>& m = numbers_;
      gp_Trsf trsf;
      trsf.SetValues(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]);
      if (std::abs(std::abs(trsf.ScaleFactor()) - 1.0) > 1e-9) {
        return fail("Transform failed: the matrix scales; only moves, turns and mirrors are allowed.");
      }
      BRepBuilderAPI_Transform builder(*input, trsf, true);
      if (!builder.IsDone()) return fail("Transform failed: OCCT could not transform this shape.");
      const TopoDS_Shape result = builder.Shape();
      recordHistory(builder, *input, 0, result);
      return store(result);
    } catch (...) {
      return failFromException("Transform failed");
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
   *
   * geometryNumbers: the closest points [on a xyz, on b xyz] (P2-13's
   * measure draws the line between them). Where one shape is inside the
   * other, both are a point of the inner one.
   */
  double distance(int a, int b) {
    beginOp();
    geometry_.clear();
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
          if (best < 0 || d < best) {
            best = d;
            geometry_.clear();
            if (measure.NbSolution() > 0) {
              const gp_Pnt onA = measure.PointOnShape1(1);
              pushPoint(onA);
              pushPoint(measure.InnerSolution() ? onA : measure.PointOnShape2(1));
            }
          }
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
   * 0 = volume, 1 = area, 2..4 = bbox min xyz, 5..7 = bbox max xyz. The
   * volume and the area are integrated to MASS_EPS where a B-spline face makes
   * that necessary, so they are right on the bodies OCCT's fixed order cannot
   * integrate (P4-12 H3; see needsTolerance).
   */
  bool measure(int shape) {
    beginOp();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return fail("Measure failed: unknown shape.") != 0;
    try {
      GProp_GProps volume;
      integrateVolume(*s, volume);
      GProp_GProps area;
      integrateArea(*s, area);
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

  /**
   * What the Measure tool shows of a shape (P2-13), read with measured(i):
   * 0 = volume (solids only), 1 = area (faces only), 2..4 = bbox min xyz,
   * 5..7 = bbox max xyz, 8 = length (edges, when there are no faces),
   * 9..11 = centre of mass of the volume, else the area, else the length,
   * else the vertex. Unlike measure(), the box is tight: it comes from the
   * exact geometry, not the triangulation or tolerances. The three integrals
   * follow needsTolerance (P4-12 H3).
   */
  bool properties(int shape) {
    beginOp();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return fail("Unknown shape.") != 0;
    try {
      for (double& m : measured_) m = 0.0;
      const bool solids = TopExp_Explorer(*s, TopAbs_SOLID).More();
      const bool faces = TopExp_Explorer(*s, TopAbs_FACE).More();
      const bool edges = TopExp_Explorer(*s, TopAbs_EDGE).More();
      GProp_GProps props;
      if (solids) {
        integrateVolume(*s, props);
        measured_[0] = props.Mass();
      }
      if (faces) {
        GProp_GProps area;
        integrateArea(*s, area);
        measured_[1] = area.Mass();
        if (!solids) props = area;
      }
      if (edges && !faces) {
        integrateLength(*s, props);
        measured_[8] = props.Mass();
      }
      gp_Pnt centre;
      if (solids || faces || edges) {
        centre = props.CentreOfMass();
      } else {
        TopExp_Explorer vertex(*s, TopAbs_VERTEX);
        if (vertex.More()) centre = BRep_Tool::Pnt(TopoDS::Vertex(vertex.Current()));
      }
      measured_[9] = centre.X();
      measured_[10] = centre.Y();
      measured_[11] = centre.Z();
      Bnd_Box box;
      BRepBndLib::AddOptimal(*s, box, false, false);
      if (!box.IsVoid()) {
        box.Get(measured_[2], measured_[3], measured_[4], measured_[5], measured_[6], measured_[7]);
      }
      return true;
    } catch (...) {
      failFromException("Measure failed");
      return false;
    }
  }

  double measured(int index) const { return index >= 0 && index < 12 ? measured_[index] : 0.0; }

  /**
   * The surface under face `face` of a shape (P2-13). geometryNumbers:
   * [type, origin xyz, direction xyz, radius, second], types as describe()
   * gives them. A plane: a point on it and its normal out of the face. A
   * cylinder: a point on its axis, the axis (canonical sign), the radius. A
   * cone: the apex, the axis, the radius at the reference plane, the half
   * angle (radians). A sphere: the centre, its polar axis, the radius. A
   * torus: the centre, the axis, the major and the minor radius. A surface
   * of revolution: a point on its axis and the axis; an extrusion: its
   * direction. Otherwise only the type. Returns 1, or 0 on failure.
   */
  int surfaceGeometry(int shape, int face) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return fail("Unknown shape.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*s, TopAbs_FACE, faces);
      if (face < 0 || face >= faces.Extent()) return fail("Face index out of range.");
      const TopoDS_Face f = TopoDS::Face(faces(face + 1));
      BRepAdaptor_Surface surface(f);
      const GeomAbs_SurfaceType type = surface.GetType();
      geometry_.push_back(static_cast<double>(type));
      const auto axis = [this](const gp_Pnt& origin, const gp_Dir& direction, double r1, double r2) {
        pushPoint(origin);
        pushDir(direction);
        geometry_.insert(geometry_.end(), {r1, r2});
      };
      switch (type) {
        case GeomAbs_Plane: {
          const gp_Pln plane = surface.Plane();
          const gp_Dir normal = plane.Axis().Direction();
          axis(plane.Location(), f.Orientation() == TopAbs_REVERSED ? normal.Reversed() : normal, 0, 0);
          break;
        }
        case GeomAbs_Cylinder: {
          const gp_Cylinder c = surface.Cylinder();
          axis(c.Location(), canonical(c.Axis().Direction()), c.Radius(), 0);
          break;
        }
        case GeomAbs_Cone: {
          const gp_Cone c = surface.Cone();
          axis(c.Apex(), canonical(c.Axis().Direction()), c.RefRadius(), c.SemiAngle());
          break;
        }
        case GeomAbs_Sphere: {
          const gp_Sphere c = surface.Sphere();
          axis(c.Location(), canonical(c.Position().Direction()), c.Radius(), 0);
          break;
        }
        case GeomAbs_Torus: {
          const gp_Torus c = surface.Torus();
          axis(c.Location(), canonical(c.Axis().Direction()), c.MajorRadius(), c.MinorRadius());
          break;
        }
        case GeomAbs_SurfaceOfRevolution: {
          const gp_Ax1 a = surface.AxeOfRevolution();
          axis(a.Location(), canonical(a.Direction()), 0, 0);
          break;
        }
        case GeomAbs_SurfaceOfExtrusion:
          axis(gp_Pnt(0, 0, 0), canonical(surface.Direction()), 0, 0);
          break;
        default:
          break;
      }
      return 1;
    } catch (...) {
      geometry_.clear();
      return failFromException("Surface geometry failed");
    }
  }

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

  // --------------------------------------------------------------- export --
  //
  // Export (P2-12, ADR-0034): a welded triangle mesh for STL and 3MF, and a
  // STEP file. Read the results with the export*Ptr/Size accessors, then
  // call clearExport().

  /**
   * Tessellates a shape for export at an absolute deflection (mm, radians)
   * into exportPositions (xyz as doubles) and exportIndices (three node
   * indices per triangle, counter-clockwise seen from outside). Unlike
   * mesh(), nodes are shared: a node on an edge is one node for both faces
   * along it, a node at a vertex one for every face around it, so a closed
   * solid gives a closed mesh. It meshes a copy of the shape, so the
   * display triangulation stays as it is. Degenerate triangles (at a cone's
   * apex, a sphere's poles) are left out. Returns the triangle count, or -1.
   */
  int exportMesh(int shape, double linearDeflection, double angularDeflection) {
    beginOp();
    clearExport();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return failExport("Export failed: unknown shape.");
    try {
      BRepBuilderAPI_Copy copier(*s, false, false);
      const TopoDS_Shape copy = copier.Shape();
      BRepMesh_IncrementalMesh mesher(copy, linearDeflection, false, angularDeflection, false);
      if (!mesher.IsDone()) return failExport("Export failed: the body couldn't be meshed.");
      if (!weldedMesh(copy)) {
        clearExport();
        return -1;
      }
      return static_cast<int>(exportIndices_.size() / 3);
    } catch (...) {
      clearExport();
      failFromException("Export failed");
      return -1;
    }
  }

  /** Names the shapes of the next writeStep() in order: one pushStepName() per shape. */
  void clearStepNames() { stepNames_.clear(); }
  void pushStepName(const char* name) { stepNames_.emplace_back(name == nullptr ? "" : name); }

  /**
   * Writes the shapes staged with clearArgs()/pushArg() as one STEP AP242
   * file in millimetres, each shape a product named by pushStepName() (a
   * missing or empty name leaves OCCT's "Product <n>"). Names are STEP strings: encode
   * non-ASCII characters as \X2\…\X0\ first. Read the text with
   * exportTextPtr/Size. Returns its length in bytes, or -1.
   */
  int writeStep() {
    beginOp();
    clearExport();
    quietMessages();
    try {
      STEPControl_Writer writer;
      int scanned = 0;
      for (size_t i = 0; i < args_.size(); ++i) {
        const TopoDS_Shape* s = find(args_[i]);
        if (s == nullptr) return failExport("STEP export failed: unknown shape.");
        DESTEP_Parameters parameters;
        parameters.WriteSchema = DESTEP_Parameters::WriteMode_StepSchema_AP242DIS;
        parameters.WriteUnit = UnitsMethods_LengthUnit_Millimeter;
        if (writer.Transfer(*s, STEPControl_AsIs, parameters) != IFSelect_RetDone) {
          return failExport("STEP export failed: a body couldn't be translated.");
        }
        // OCCT names products "<name> <level>" ("Product 1"): the first
        // product this transfer made (its root) gets the body's name as is.
        const Handle(StepData_StepModel) model = writer.Model();
        const int entities = model->NbEntities();
        for (; scanned < entities; ++scanned) {
          const Handle(StepBasic_Product) product =
              Handle(StepBasic_Product)::DownCast(model->Value(scanned + 1));
          if (product.IsNull()) continue;
          if (i < stepNames_.size() && !stepNames_[i].empty()) {
            const Handle(TCollection_HAsciiString) name =
                new TCollection_HAsciiString(stepNames_[i].c_str());
            product->SetId(name);
            product->SetName(name);
          }
          scanned = entities;
          break;
        }
      }
      std::ostringstream out;
      if (writer.WriteStream(out) != IFSelect_RetDone) {
        return failExport("STEP export failed: the file couldn't be written.");
      }
      exportText_ = out.str();
      return static_cast<int>(exportText_.size());
    } catch (...) {
      clearExport();
      failFromException("STEP export failed");
      return -1;
    }
  }

  /**
   * Reads STEP text into one shape (a compound of what the file's roots
   * translate to). Used by the export tests; STEP import (FR-IO-05) will
   * build on it. Returns a handle, or 0.
   */
  int readStep(const char* text) {
    beginOp();
    quietMessages();
    try {
      std::istringstream in(text == nullptr ? "" : text);
      STEPControl_Reader reader;
      if (reader.ReadStream("extrudo.step", in) != IFSelect_RetDone) {
        return fail("STEP import failed: the file couldn't be read.");
      }
      if (reader.TransferRoots() <= 0) return fail("STEP import failed: the file has no shapes.");
      return store(reader.OneShape());
    } catch (...) {
      return failFromException("STEP import failed");
    }
  }

  /** Frees the export buffers once JS has copied them. */
  void clearExport() {
    std::vector<double>().swap(exportPositions_);
    std::vector<uint32_t>().swap(exportIndices_);
    std::string().swap(exportText_);
  }

  uintptr_t exportPositionsPtr() const { return reinterpret_cast<uintptr_t>(exportPositions_.data()); }
  int exportPositionsSize() const { return static_cast<int>(exportPositions_.size()); }
  uintptr_t exportIndicesPtr() const { return reinterpret_cast<uintptr_t>(exportIndices_.data()); }
  int exportIndicesSize() const { return static_cast<int>(exportIndices_.size()); }
  uintptr_t exportTextPtr() const { return reinterpret_cast<uintptr_t>(exportText_.data()); }
  int exportTextSize() const { return static_cast<int>(exportText_.size()); }

  // ------------------------------------------------ scale and draft (P3-08) --

  /**
   * Scales `shape` about a point (P3-08, scale): 6 staged numbers
   * (clearNumbers/pushNumber), [cx, cy, cz, sx, sy, sz], the centre and the
   * factors along the world X, Y and Z axes, each greater than 0. Equal
   * factors scale uniformly (gp_Trsf through BRepBuilderAPI_Transform, copy
   * = true): every surface keeps its type, a cylinder stays a cylinder.
   * Different factors go through gp_GTrsf (BRepBuilderAPI_GTransform), which
   * turns every surface and curve into a B-spline first; faces that come out
   * flat are put back on planes and straight edges between such faces on
   * lines (`restoreCanonical`), so a box stays a box that can be sketched on.
   * Curved faces stay B-splines (a cylinder scaled across its axis has an
   * elliptic section). Records history for input 0: every sub-shape is
   * modified into its image.
   */
  int scale(int shape) {
    beginOp();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Scale failed: unknown input shape.");
    if (numbers_.size() != 6) return fail("Scale failed: it needs a centre and three factors.");
    const gp_Pnt centre(numbers_[0], numbers_[1], numbers_[2]);
    const double f[3] = {numbers_[3], numbers_[4], numbers_[5]};
    for (double factor : f) {
      if (!std::isfinite(factor) || !(factor > 1e-9)) {
        return fail("Scale failed: every factor must be greater than 0.");
      }
    }
    try {
      const double largest = std::max(f[0], std::max(f[1], f[2]));
      const bool uniform =
          std::abs(f[0] - f[1]) <= 1e-12 * largest && std::abs(f[0] - f[2]) <= 1e-12 * largest;
      if (uniform) {
        gp_Trsf trsf;
        trsf.SetScale(centre, f[0]);
        BRepBuilderAPI_Transform builder(*input, trsf, true);
        if (!builder.IsDone()) return fail("Scale failed: OCCT could not scale this shape.");
        const TopoDS_Shape result = builder.Shape();
        recordHistory(builder, *input, 0, result);
        return store(result);
      }
      gp_GTrsf gtrsf;
      gtrsf.SetVectorialPart(gp_Mat(f[0], 0, 0, 0, f[1], 0, 0, 0, f[2]));
      gtrsf.SetTranslationPart(
          gp_XYZ(centre.X() * (1 - f[0]), centre.Y() * (1 - f[1]), centre.Z() * (1 - f[2])));
      BRepBuilderAPI_GTransform builder(*input, gtrsf, true);
      if (!builder.IsDone()) return fail("Scale failed: OCCT could not scale this shape.");
      const TopoDS_Shape scaled = builder.Shape();
      // The B-spline result, with flat faces and straight edges put back on planes and
      // lines where that gives a valid shape; else the B-spline result as it is.
      Handle(BRepTools_ReShape) reshape = new BRepTools_ReShape();
      TopoDS_Shape result = restoreCanonical(scaled, reshape);
      if (result.IsNull() || !BRepCheck_Analyzer(result).IsValid()) {
        result = scaled;
        reshape.Nullify();
      }
      if (!BRepCheck_Analyzer(result).IsValid()) return fail("Scale failed: OCCT could not scale this shape.");
      recordImages(*input, result, [&](const TopoDS_Shape& sub) {
        TopoDS_Shape image = builder.ModifiedShape(sub);
        if (!reshape.IsNull() && !image.IsNull()) image = reshape->Value(image);
        return image;
      });
      return store(result);
    } catch (...) {
      return failFromException("Scale failed");
    }
  }

  /**
   * Tilts faces of the solid `shape` (P3-08, draft): the staged faces
   * (clearArgs/pushArg, 0-based face indices, duplicates ignored) turn by
   * `angle` radians about the line where each meets the neutral plane, the
   * plane through (px, py, pz) whose normal (nx, ny, nz) is the pull
   * direction. A positive angle removes matter on the pull side of the
   * neutral plane and adds it on the other (the body narrows along the pull,
   * as a part drawn out of a mould does); a negative angle the opposite.
   * Only flat, cylindrical and conical faces can be tilted: planes become
   * tilted planes, cylinders cones. OCCT drafts the faces that run smoothly
   * into a picked one with it. Built on a copy (BRepOffsetAPI_DraftAngle) and
   * checked: OCCT returns "valid" solids whose faces have crossed. Records
   * history for input 0: every sub-shape is modified into its image
   * (DraftAngle calls tilted faces "generated": ModifiedShape is read).
   *
   * On failure it returns 0 with a message in lastError() and, in
   * geometryNumbers, [status, value]:
   * - 1 the angle is too steep: the largest angle of the same sign that
   *   works (radians, a magnitude), by bisection;
   * - 2 OCCT can't tilt a face about this plane (value: the face's index);
   * - 3 a face isn't flat, cylindrical or conical (value: its index);
   * - 4 the shape isn't a solid (value 0);
   * - 5 anything else (an OCCT exception): value 0;
   * - 6 no angle works (value 0);
   * - 7 a face is parallel to the neutral plane, so it has no line to turn
   *   about (value: its index).
   */
  int draft(int shape, double px, double py, double pz, double nx, double ny, double nz, double angle) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Draft failed: unknown input shape.");
    if (!(std::abs(angle) > 1e-9)) return fail("Draft failed: the angle must not be 0.");
    if (std::abs(angle) >= M_PI / 2 - 1e-6) return fail("Draft failed: the angle must be under 90 degrees.");
    if (gp_Vec(nx, ny, nz).Magnitude() <= 1e-12) return fail("Draft failed: the pull direction has no length.");
    try {
      if (!TopExp_Explorer(*input, TopAbs_SOLID).More()) {
        pushShellStatus(4, 0);
        return fail("Draft failed: the body isn't a solid.");
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*input, TopAbs_FACE, faces);
      std::vector<int> picked;
      for (int index : args_) {
        if (index < 0 || index >= faces.Extent()) return fail("Draft failed: face index out of range.");
        if (std::find(picked.begin(), picked.end(), index) == picked.end()) picked.push_back(index);
      }
      if (picked.empty()) return fail("Draft failed: no face to draft.");
      const gp_Dir pull(nx, ny, nz);
      const gp_Pln neutral(gp_Pnt(px, py, pz), pull);
      for (int index : picked) {
        const int problem = undraftable(TopoDS::Face(faces(index + 1)), pull);
        if (problem != 0) {
          pushShellStatus(problem, index);
          return fail(problem == 3 ? "Draft failed: a face isn't flat, cylindrical or conical."
                                   : "Draft failed: a face is parallel to the neutral plane.");
        }
      }
      {
        // A copy for every build, as in shell(); the copy keeps the sub-shape order.
        const TopoDS_Shape copy = BRepBuilderAPI_Copy(*input, true, false).Shape();
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> copyFaces;
        TopExp::MapShapes(copy, TopAbs_FACE, copyFaces);
        if (copyFaces.Extent() == faces.Extent()) {
          BRepOffsetAPI_DraftAngle builder(copy);
          int refused = -1;
          TopoDS_Shape result;
          if (buildDraft(builder, copyFaces, picked, pull, neutral, angle, refused, result) &&
              draftIsGood(builder, copy, result)) {
            recordImages(copy, result, [&](const TopoDS_Shape& sub) { return builder.ModifiedShape(sub); });
            return store(result);
          }
          if (refused >= 0) {
            pushShellStatus(2, refused);
            return fail("Draft failed: OCCT can't tilt a face about this plane.");
          }
        }
      }
      return explainDraft(*input, picked, pull, neutral, angle);
    } catch (...) {
      pushShellStatus(5, 0);
      return failFromException("Draft failed");
    }
  }

  // ------------------------------------------- paths, sweeps and lofts (P4-01) --
  //
  // A path (ADR-0055) is staged piece by piece: pathClear(), then
  // pathSketch() for the curves staged with sketchClear()/sketch*() (placed in
  // a sketch's frame) and pathEdge() for an edge of a shape, then pathWire()
  // chains them into one wire. helix() makes a coil's path. sweep() moves a
  // profile along a wire, loft() goes through profiles in order. Both record
  // history like prism (first, last, generated).

  void pathClear() { pathEdges_.clear(); }

  /**
   * The curves staged with sketchClear()/sketch*() (exact lines, arcs,
   * ellipses and splines), placed in the frame (origin, X direction,
   * normal) like sketchProfiles() places faces, as pieces of the path.
   * Returns the number of pieces staged so far (0 on failure).
   */
  int pathSketch(double ox, double oy, double oz, double xx, double xy, double xz, double nx, double ny,
                 double nz) {
    beginOp();
    if (sketchEdges_.empty()) return fail("The path has no curves.");
    try {
      gp_Trsf placement;
      placement.SetDisplacement(gp_Ax3(), gp_Ax3(gp_Pnt(ox, oy, oz), gp_Dir(nx, ny, nz), gp_Dir(xx, xy, xz)));
      for (const TopoDS_Edge& edge : sketchEdges_) {
        BRepBuilderAPI_Transform moved(edge, placement, true);
        if (!moved.IsDone()) return fail("Couldn't place a curve of the path.");
        pathEdges_.push_back(TopoDS::Edge(moved.Shape()));
      }
      return static_cast<int>(pathEdges_.size());
    } catch (...) {
      return failFromException("Path failed");
    }
  }

  /** An edge (0-based index) of `shape` as a piece of the path. Returns the number of pieces (0 on failure). */
  int pathEdge(int shape, int edge) {
    beginOp();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Path failed: unknown input shape.");
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(*input, TopAbs_EDGE, edges);
    if (edge < 0 || edge >= edges.Extent()) return fail("Path failed: edge index out of range.");
    const TopoDS_Edge piece = TopoDS::Edge(edges(edge + 1));
    if (BRep_Tool::Degenerated(piece)) return fail("An edge of the path has no length.");
    pathEdges_.push_back(TopoDS::Edge(piece.Oriented(TopAbs_FORWARD)));
    return static_cast<int>(pathEdges_.size());
  }

  /**
   * The staged pieces chained end to end into one wire; ends within
   * `tolerance` (mm) are one point. The wire starts with the first piece in
   * its own direction (pieces before it are added at the front, reversed
   * where they must be). Fails when the pieces don't make one chain (a
   * gap, or a branch): geometryNumbers is then [n], n the number of pieces
   * that couldn't be joined.
   */
  int pathWire(double tolerance) {
    beginOp();
    geometry_.clear();
    if (pathEdges_.empty()) return fail("The path has no pieces.");
    try {
      const size_t n = pathEdges_.size();
      std::vector<gp_Pnt> starts(n);
      std::vector<gp_Pnt> ends(n);
      for (size_t i = 0; i < n; ++i) {
        TopoDS_Vertex a;
        TopoDS_Vertex b;
        TopExp::Vertices(pathEdges_[i], a, b, true);
        starts[i] = BRep_Tool::Pnt(a);
        ends[i] = BRep_Tool::Pnt(b);
      }
      std::vector<bool> used(n, false);
      std::vector<std::pair<size_t, bool>> chain;  // piece, reversed
      chain.emplace_back(0, false);
      used[0] = true;
      gp_Pnt head = starts[0];
      gp_Pnt tail = ends[0];
      const bool loop = head.Distance(tail) <= tolerance;
      bool grew = !loop;
      while (grew) {
        grew = false;
        for (size_t i = 0; i < n && !grew; ++i) {
          if (used[i]) continue;
          if (starts[i].Distance(tail) <= tolerance) {
            chain.emplace_back(i, false);
            tail = ends[i];
          } else if (ends[i].Distance(tail) <= tolerance) {
            chain.emplace_back(i, true);
            tail = starts[i];
          } else if (ends[i].Distance(head) <= tolerance) {
            chain.insert(chain.begin(), {i, false});
            head = starts[i];
          } else if (starts[i].Distance(head) <= tolerance) {
            chain.insert(chain.begin(), {i, true});
            head = ends[i];
          } else {
            continue;
          }
          used[i] = true;
          // A chain that closed on itself takes nothing more.
          grew = head.Distance(tail) > tolerance;
        }
      }
      if (chain.size() != n) {
        geometry_.push_back(static_cast<double>(n - chain.size()));
        return fail("The pieces of the path don't make one chain: some don't meet the others.");
      }
      BRepBuilderAPI_MakeWire maker;
      for (const auto& [piece, reversed] : chain) {
        maker.Add(reversed ? TopoDS::Edge(pathEdges_[piece].Reversed()) : pathEdges_[piece]);
        if (!maker.IsDone()) break;
      }
      TopoDS_Wire wire;
      if (maker.IsDone()) wire = maker.Wire();
      if (wire.IsNull() || !pathWireIsGood(wire, n)) {
        // Ends that meet only within the tolerance: copies whose vertices are loose enough to join.
        BRepBuilderAPI_MakeWire loose;
        BRep_Builder vertices;
        for (const auto& [piece, reversed] : chain) {
          const TopoDS_Shape copy = BRepBuilderAPI_Copy(pathEdges_[piece], true, false).Shape();
          for (TopExp_Explorer e(copy, TopAbs_VERTEX); e.More(); e.Next()) {
            vertices.UpdateVertex(TopoDS::Vertex(e.Current()), tolerance);
          }
          loose.Add(reversed ? TopoDS::Edge(copy.Reversed()) : TopoDS::Edge(copy));
          if (!loose.IsDone()) break;
        }
        if (!loose.IsDone()) return fail("Couldn't join the pieces of the path into a wire.");
        wire = loose.Wire();
        if (!pathWireIsGood(wire, n)) return fail("Couldn't join the pieces of the path into a wire.");
      }
      return store(wire);
    } catch (...) {
      return failFromException("Path failed");
    }
  }

  /**
   * A helix on a cylinder (or a cone) as a one-edge wire: a coil's path
   * (P4-01), which P4-02's modeled threads reuse. It starts at
   * `origin + radius·x`, turns about the axis through `origin` along `z` for
   * `turns` turns (fractions allowed), rising `pitch` mm along the axis per
   * turn, counter-clockwise seen from the axis's tip, or clockwise with
   * `left`. A non-zero `taper` (radians, |taper| < π/2) is the cone's half
   * angle: the radius grows by tan(taper) per mm of height (negative
   * shrinks; it must stay above 0). `x` need not be perpendicular to `z`:
   * it is made so. The edge is the exact helix on the surface, with a 3D
   * B-spline within 0.1 µm of it.
   */
  int helix(double ox, double oy, double oz, double zx, double zy, double zz, double xx, double xy, double xz,
            double radius, double pitch, double turns, double taper, bool left) {
    beginOp();
    try {
      if (!(radius > Precision::Confusion())) return fail("The coil's radius must be greater than 0.");
      if (!(pitch > Precision::Confusion())) return fail("The coil's pitch must be greater than 0.");
      if (!(turns > 1e-6)) return fail("The coil needs more than 0 turns.");
      if (turns > 1000) return fail("The coil can have at most 1000 turns.");
      if (std::abs(taper) >= M_PI / 2 - 1e-3) return fail("The coil's taper angle must be between -90° and 90°.");
      if (radius + std::tan(taper) * pitch * turns <= Precision::Confusion()) {
        return fail("The coil's taper makes it narrow to nothing before its end.");
      }
      const gp_Dir axis(zx, zy, zz);
      const gp_Dir toward(xx, xy, xz);
      if (axis.IsParallel(toward, 1e-9)) return fail("The coil's start direction runs along its axis.");
      const gp_Ax3 frame(gp_Pnt(ox, oy, oz), axis, toward);
      Handle(Geom_Surface) surface;
      double rise = pitch;
      if (std::abs(taper) > 1e-12) {
        // v runs along the cone's generator: a pitch along the axis is `pitch / cos(taper)` of it.
        surface = new Geom_ConicalSurface(frame, taper, radius);
        rise = pitch / std::cos(taper);
      } else {
        surface = new Geom_CylindricalSurface(frame, radius);
      }
      const double turnSign = left ? -1.0 : 1.0;
      const gp_Dir2d direction(turnSign * 2 * M_PI, rise);
      Handle(Geom2d_Line) line = new Geom2d_Line(gp_Pnt2d(0, 0), direction);
      // One edge per turn (the last one the fraction left): a sweep then has a face per turn,
      // which booleans prune by their boxes; one face for all the turns made a 200-turn cut
      // take minutes.
      const double perTurn = std::sqrt(4 * M_PI * M_PI + rise * rise);
      const double length = turns * perTurn;
      const int pieces = std::max(1, static_cast<int>(std::ceil(turns - 1e-6)));
      BRepBuilderAPI_MakeWire wire;
      TopoDS_Vertex joint;
      for (int k = 0; k < pieces; ++k) {
        const double from = k * perTurn;
        const double to = k + 1 == pieces ? length : (k + 1) * perTurn;
        const gp_Pnt2d uv = line->Value(to);
        const TopoDS_Vertex end = BRepBuilderAPI_MakeVertex(surface->Value(uv.X(), uv.Y())).Vertex();
        if (k == 0) {
          const gp_Pnt2d start = line->Value(from);
          joint = BRepBuilderAPI_MakeVertex(surface->Value(start.X(), start.Y())).Vertex();
        }
        BRepBuilderAPI_MakeEdge edge(line, surface, joint, end, from, to);
        if (!edge.IsDone()) return fail("Couldn't make the coil's helix.");
        TopoDS_Edge piece = edge.Edge();
        if (!BRepLib::BuildCurves3d(piece, 1e-7, GeomAbs_C2, 14, 200)) {
          return fail("Couldn't build the coil's helix as a 3D curve.");
        }
        wire.Add(piece);
        if (!wire.IsDone()) return fail("Couldn't make a wire of the coil's helix.");
        joint = end;
      }
      return store(wire.Wire());
    } catch (...) {
      return failFromException("Coil failed");
    }
  }

  /**
   * Sweeps a profile (a face, or a compound of faces, holes and all) along
   * `spine` (a wire) into a solid (a compound of solids for several faces).
   * The profile stays where it is and goes along with the path's frame from
   * the path's end nearer to it (the wire is turned round when the far end
   * is nearer).
   *
   * `mode` is how the profile turns with the path: 0 it keeps its angle to
   * the path (a corrected Frenet frame), 1 not at all (it stays parallel to
   * itself), 2 it keeps its angle to the fixed direction (dx, dy, dz) (a
   * coil's axis). `twist` (radians, mode 0 only) turns it about the path by
   * that much from start to end, evenly by length (the path must be smooth).
   * `scale` (> 0) scales it about the path from 1 at the start to `scale` at
   * the end, evenly (not on a closed path). Sharp corners of the path are
   * mitred. With `verify`, a sweep that might cross itself (a tight bend
   * for the profile's reach, a path coming back near itself, a corner) is
   * checked for it: slow on long curved paths (a coil), so a caller that
   * knows better leaves it off.
   *
   * History for input 0 (the profile as passed in): first (4) and last (5)
   * for faces (the caps), generated (1) for edges (the side faces). On
   * failure geometryNumbers holds [status]: 1 OCCT couldn't sweep it (a
   * section too large for a tight turn, a corner it can't mitre), 2 the
   * result crosses itself or isn't a sound solid, 3 a twist on a path with a
   * sharp corner, 4 a scale on a closed path.
   */
  int sweep(int profile, int spine, int mode, double twist, double scale, bool verify, double dx, double dy,
            double dz) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* base = find(profile);
    const TopoDS_Shape* path = find(spine);
    if (base == nullptr || path == nullptr) return fail("Sweep failed: unknown input shape.");
    if (path->ShapeType() != TopAbs_WIRE) return fail("Sweep failed: the path isn't a wire.");
    if (!(scale > 1e-6)) return fail("Sweep failed: the end scale must be greater than 0.");
    if (mode < 0 || mode > 2) return fail("Sweep failed: unknown orientation mode.");
    if (mode == 2 && gp_Vec(dx, dy, dz).Magnitude() <= 1e-12) {
      return fail("Sweep failed: the fixed direction has no length.");
    }
    const bool twists = std::abs(twist) > 1e-12;
    if (twists && mode != 0) return fail("Sweep failed: only a sweep that follows the path can twist.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> baseFaces;
      TopExp::MapShapes(*base, TopAbs_FACE, baseFaces);
      std::vector<TopoDS_Face> faces;
      for (int i = 1; i <= baseFaces.Extent(); ++i) faces.push_back(TopoDS::Face(baseFaces(i)));
      if (faces.empty()) return fail("Sweep failed: nothing to sweep.");
      const bool scales = std::abs(scale - 1) > 1e-9;

      // The path runs from the end nearer the profile.
      TopoDS_Wire wire = TopoDS::Wire(*path);
      gp_Pnt first;
      gp_Pnt last;
      wireEnds(wire, first, last);
      const bool closed = first.Distance(last) <= 1e-6;
      if (closed && scales) return sweepStatus(4, "Sweep failed: a closed path can't scale.");
      GProp_GProps props;
      BRepGProp::SurfaceProperties(*base, props);
      const gp_Pnt centre = props.CentreOfMass();
      if (!closed && centre.Distance(last) < centre.Distance(first)) {
        wire = reversedWire(wire);
        if (wire.IsNull()) return sweepStatus(1, "Sweep failed: couldn't turn the path round.");
        std::swap(first, last);
      }
      // How far the profile reaches from the path's start.
      double reach = 0;
      for (const TopoDS_Face& face : faces) {
        Bnd_Box box;
        BRepBndLib::Add(face, box);
        double x0, y0, z0, x1, y1, z1;
        box.Get(x0, y0, z0, x1, y1, z1);
        for (double x : {x0, x1})
          for (double y : {y0, y1})
            for (double z : {z0, z1}) reach = std::max(reach, first.Distance(gp_Pnt(x, y, z)));
      }
      const gp_Dir fixed = mode == 2 ? gp_Dir(dx, dy, dz) : gp_Dir(0, 0, 1);
      gp_Ax2 parallel(first, gp_Dir(0, 0, 1));
      if (mode == 1) {
        // Parallel to itself: any fixed frame does; the first face's normal is a natural one.
        const BRepAdaptor_Surface surface(faces[0]);
        if (surface.GetType() == GeomAbs_Plane) parallel = gp_Ax2(first, surface.Plane().Axis().Direction());
      }
      TopoDS_Wire auxiliary;
      if (twists) {
        if (!smoothWire(wire)) {
          return sweepStatus(3, "Sweep failed: a twisted sweep needs a smooth path, without sharp corners.");
        }
        auxiliary = twistSpine(wire, twist, std::max(1.0, reach));
        if (auxiliary.IsNull()) return sweepStatus(1, "Sweep failed: couldn't twist along this path.");
      }
      const double endScale = scales ? scale : 1.0;

      BRep_Builder builder;
      TopoDS_Compound solids;
      builder.MakeCompound(solids);
      SideList sides;  // profile edge -> its side faces
      std::vector<std::vector<TopoDS_Shape>> firsts(faces.size());
      std::vector<std::vector<TopoDS_Shape>> lasts(faces.size());
      for (size_t f = 0; f < faces.size(); ++f) {
        const TopoDS_Face& face = faces[f];
        const TopoDS_Wire outer = BRepTools::OuterWire(face);
        std::vector<TopoDS_Wire> inner;
        for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) {
          if (!w.Current().IsSame(outer)) inner.push_back(TopoDS::Wire(w.Current()));
        }
        TopoDS_Shape whole;
        TopoDS_Shape firstCap;
        TopoDS_Shape lastCap;
        SideList made;
        int status = pipeOne(wire, outer, mode, fixed, parallel, auxiliary, endScale, whole, firstCap, lastCap, made);
        std::vector<TopoDS_Shape> holes;
        for (size_t i = 0; status == 0 && i < inner.size(); ++i) {
          TopoDS_Shape hole;
          TopoDS_Shape holeFirst;
          TopoDS_Shape holeLast;
          status = pipeOne(wire, inner[i], mode, fixed, parallel, auxiliary, endScale, hole, holeFirst, holeLast, made);
          holes.push_back(hole);
        }
        if (status != 0) {
          return sweepStatus(status, status == 2 ? "Sweep failed: the sweep crosses itself or isn't a sound solid."
                                                 : "Sweep failed: OCCT couldn't sweep this profile along the path.");
        }
        TopoDS_Shape solid = whole;
        // Each face's images through the cut of the holes (itself without holes).
        std::map<const TopoDS_TShape*, std::vector<TopoDS_Shape>> kept;
        if (!holes.empty()) {
          BRepAlgoAPI_Cut cut;
          NCollection_List<TopoDS_Shape> targets;
          NCollection_List<TopoDS_Shape> tools;
          targets.Append(whole);
          for (const TopoDS_Shape& h : holes) tools.Append(h);
          cut.SetArguments(targets);
          cut.SetTools(tools);
          cut.SetRunParallel(false);
          cut.Build();
          if (!cut.IsDone() || cut.HasErrors()) {
            return sweepStatus(1, "Sweep failed: OCCT couldn't cut the profile's holes out of the sweep.");
          }
          solid = cut.Shape();
          auto remember = [&](const TopoDS_Shape& from) {
            for (TopExp_Explorer e(from, TopAbs_FACE); e.More(); e.Next()) {
              std::vector<TopoDS_Shape> list;
              if (!cut.IsDeleted(e.Current())) {
                for (const TopoDS_Shape& m : cut.Modified(e.Current())) list.push_back(m);
                if (list.empty()) list.push_back(e.Current());
              }
              kept[e.Current().TShape().get()] = list;
            }
          };
          remember(whole);
          for (const TopoDS_Shape& h : holes) remember(h);
        }
        auto images = [&kept](const TopoDS_Shape& s) {
          const auto it = kept.find(s.TShape().get());
          return it == kept.end() ? std::vector<TopoDS_Shape>{s} : it->second;
        };
        builder.Add(solids, solid);
        // The holes' caps go with the cut: the outer caps, cut, are the profile face's caps.
        for (TopExp_Explorer e(firstCap, TopAbs_FACE); e.More(); e.Next()) {
          for (const TopoDS_Shape& s : images(e.Current())) firsts[f].push_back(s);
        }
        for (TopExp_Explorer e(lastCap, TopAbs_FACE); e.More(); e.Next()) {
          for (const TopoDS_Shape& s : images(e.Current())) lasts[f].push_back(s);
        }
        for (const auto& [edge, list] : made) {
          std::vector<TopoDS_Shape> mapped;
          for (const TopoDS_Shape& m : list) {
            for (const TopoDS_Shape& s : images(m)) mapped.push_back(s);
          }
          sides.emplace_back(edge, std::move(mapped));
        }
      }

      // One solid is the result itself, several a compound.
      TopoDS_Shape result = solids;
      int count = 0;
      TopoDS_Shape only;
      for (TopoDS_Iterator it(solids); it.More(); it.Next()) {
        ++count;
        only = it.Value();
      }
      if (count == 1) result = only;
      if (!BRepCheck_Analyzer(result).IsValid() || (verify && sweepMayCross(wire, reach) && crossesItself(result))) {
        return sweepStatus(2, "Sweep failed: the sweep crosses itself or isn't a sound solid.");
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
      TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> baseEdges;
      TopExp::MapShapes(*base, TopAbs_EDGE, baseEdges);
      // Caps: each face of the profile maps to its own caps.
      for (size_t f = 0; f < faces.size(); ++f) {
        recordFaces(0, 0, static_cast<int>(f), 4, firsts[f], resultFaces);
        recordFaces(0, 0, static_cast<int>(f), 5, lasts[f], resultFaces);
      }
      for (const auto& [edge, made] : sides) {
        const int index = baseEdges.FindIndex(edge);
        if (index > 0) recordFaces(0, 1, index - 1, 1, made, resultFaces);
      }
      return store(result);
    } catch (...) {
      geometry_.assign(1, 1.0);
      return failFromException("Sweep failed");
    }
  }

  /**
   * Lofts through the staged sections in order (clearArgs/pushArg): a handle
   * of a shape holding one face without holes, or 0 for a point, read as
   * three numbers (clearNumbers/pushNumber, x y z, in the order the points
   * come); a point may only be the first or the last section. A smooth solid
   * through them all, or with `ruled` flat or ruled between neighbours. With
   * `closed` the last section joins the first again: a ring, no caps (at
   * least three sections, no points).
   *
   * History, input i for section i (indices of its shape as passed in):
   * first (4) for the first section's face and last (5) for the last's (the
   * caps), generated (1) from every section's edges (the side faces each
   * edge bounds). On failure geometryNumbers are [status, section]: 1 OCCT
   * couldn't loft them, 2 the loft crosses itself or isn't a sound solid, 3 a
   * section has holes, 5 a section isn't one face, 6 a point in the middle.
   */
  int loft(bool ruled, bool closed) {
    beginOp();
    geometry_.clear();
    try {
      const size_t n = args_.size();
      if (n < 2) return fail("Loft failed: it needs at least two sections.");
      if (closed && n < 3) return fail("Loft failed: a closed loft needs at least three sections.");
      std::vector<TopoDS_Face> faces(n);
      std::vector<TopoDS_Vertex> points(n);
      size_t numbered = 0;
      for (size_t i = 0; i < n; ++i) {
        if (args_[i] == 0) {
          if (closed || (i != 0 && i != n - 1)) return loftStatus(6, i, "Loft failed: a point can only start or end a loft.");
          if (numbers_.size() < 3 * (numbered + 1)) return fail("Loft failed: a point section has no coordinates.");
          const gp_Pnt p(numbers_[3 * numbered], numbers_[3 * numbered + 1], numbers_[3 * numbered + 2]);
          ++numbered;
          points[i] = BRepBuilderAPI_MakeVertex(p).Vertex();
          continue;
        }
        const TopoDS_Shape* shape = find(args_[i]);
        if (shape == nullptr) return fail("Loft failed: unknown input shape.");
        int count = 0;
        TopoDS_Face face;
        for (TopExp_Explorer e(*shape, TopAbs_FACE); e.More(); e.Next()) {
          face = TopoDS::Face(e.Current());
          ++count;
        }
        if (count != 1) return loftStatus(5, i, "Loft failed: a section isn't a single face.");
        int wires = 0;
        for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) ++wires;
        if (wires != 1) return loftStatus(3, i, "Loft failed: a section has holes.");
        faces[i] = face;
      }
      if (faces.front().IsNull() && faces.back().IsNull() && n == 2) {
        return fail("Loft failed: it needs at least one profile.");
      }
      TopoDS_Shape result;
      std::vector<TopoDS_Shape> firstCap;
      std::vector<TopoDS_Shape> lastCap;
      // Per section, each edge's generated faces.
      std::vector<SideList> made(n);
      {
        BRepOffsetAPI_ThruSections builder(true, ruled, 1e-6);
        builder.SetMutableInput(false);
        // An edge's pieces in the sections OCCT lofts (a closed loft's, made compatible here).
        NCollection_DataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> pieces;
        if (closed) {
          // OCCT lofts a ring only when the last section is the first itself, and its own
          // compatibility pass copies them apart: line the sections up first, then repeat the first.
          NCollection_Sequence<TopoDS_Shape> sections;
          for (size_t i = 0; i < n; ++i) sections.Append(BRepTools::OuterWire(faces[i]));
          BRepFill_CompatibleWires compatible(sections);
          compatible.Perform();
          if (!compatible.IsDone()) return loftStatus(1, 0, "Loft failed: OCCT couldn't line these sections up.");
          const NCollection_Sequence<TopoDS_Shape>& lined = compatible.Shape();
          for (int i = 1; i <= lined.Length(); ++i) builder.AddWire(TopoDS::Wire(lined(i)));
          builder.AddWire(TopoDS::Wire(lined(1)));
          builder.CheckCompatibility(false);
          pieces = compatible.Generated();
        } else {
          builder.CheckCompatibility(true);
          for (size_t i = 0; i < n; ++i) {
            if (!points[i].IsNull()) builder.AddVertex(points[i]);
            else builder.AddWire(BRepTools::OuterWire(faces[i]));
          }
        }
        builder.Build();
        if (!builder.IsDone()) return loftStatus(1, 0, "Loft failed: OCCT couldn't loft through these sections.");
        result = builder.Shape();
        if (!closed) {
          for (TopExp_Explorer e(builder.FirstShape(), TopAbs_FACE); e.More(); e.Next()) firstCap.push_back(e.Current());
          for (TopExp_Explorer e(builder.LastShape(), TopAbs_FACE); e.More(); e.Next()) lastCap.push_back(e.Current());
        }
        for (size_t i = 0; i < n; ++i) {
          if (faces[i].IsNull()) continue;
          for (TopExp_Explorer e(faces[i], TopAbs_EDGE); e.More(); e.Next()) {
            NCollection_List<TopoDS_Shape> own;
            if (pieces.IsBound(e.Current())) own = pieces.Find(e.Current());
            if (own.IsEmpty()) own.Append(e.Current());
            std::vector<TopoDS_Shape> list;
            for (const TopoDS_Shape& piece : own) {
              for (const TopoDS_Shape& s : builder.Generated(piece)) {
                if (s.ShapeType() == TopAbs_FACE) list.push_back(s);
              }
            }
            made[i].emplace_back(e.Current(), std::move(list));
          }
        }
      }
      if (result.ShapeType() != TopAbs_SOLID) {
        TopoDS_Shape solid;
        for (TopExp_Explorer e(result, TopAbs_SOLID); e.More(); e.Next()) {
          if (!solid.IsNull()) return loftStatus(2, 0, "Loft failed: the loft isn't one solid.");
          solid = e.Current();
        }
        if (solid.IsNull()) return loftStatus(1, 0, "Loft failed: OCCT couldn't make a solid of the loft.");
        result = solid;
      }
      if (volumeOf(result) < 0) result.Reverse();
      // (A ring's faces close on themselves along a seam that isn't periodic, which the
      // self-intersection check takes for a crossing: a ring is checked for soundness only.)
      if (!BRepCheck_Analyzer(result).IsValid() || !(volumeOf(result) > 0) || (!closed && crossesItself(result))) {
        return loftStatus(2, 0, "Loft failed: the loft crosses itself or isn't a sound solid.");
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
      TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
      if (!faces.front().IsNull()) recordFaces(0, 0, 0, 4, firstCap, resultFaces);
      if (!faces.back().IsNull()) recordFaces(static_cast<int>(n - 1), 0, 0, 5, lastCap, resultFaces);
      for (size_t i = 0; i < n; ++i) {
        if (faces[i].IsNull()) continue;
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
        TopExp::MapShapes(faces[i], TopAbs_EDGE, edges);
        for (const auto& [edge, list] : made[i]) {
          const int index = edges.FindIndex(edge);
          if (index > 0) recordFaces(static_cast<int>(i), 1, index - 1, 1, list, resultFaces);
        }
      }
      return store(result);
    } catch (...) {
      geometry_.assign({1.0, 0.0});
      return failFromException("Loft failed");
    }
  }

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

  // --------------------------------------------------------------- threads --

  /**
   * The helical sweep of a modeled thread (P4-02, ADR-0056): the planar face
   * `profile`, which lies in a plane through the axis (through (ox, oy, oz)
   * along (dx, dy, dz)) on one side of it, carried round the axis as a screw
   * moves: rising `pitch` mm per turn, for `turns` turns (fractions allowed),
   * counter-clockwise seen from the axis's tip (right-handed) or clockwise
   * with `left`. The path is a helix through the profile's centre on a
   * cylinder about the axis, one edge per turn (one long edge needs a
   * B-spline of thousands of poles), and the profile keeps a fixed angle to
   * the axis (MakePipeShell's fixed binormal), so every point of it runs on
   * its own helix of the same pitch.
   *
   * Refused before OCCT runs: a profile that isn't a planar face through the
   * axis, touches the axis or is as long along the axis as the pitch (the
   * turns would touch), and more than 2000 turns. The result must pass
   * BRepCheck_Analyzer. History for input 0 as for prism: generated (1) side
   * faces per profile edge (one per turn), first (4) and last (5) for the
   * profile face.
   */
  int threadSweep(int profile, double ox, double oy, double oz, double dx, double dy, double dz,
                  double pitch, double turns, bool left) {
    beginOp();
    const TopoDS_Shape* input = find(profile);
    if (input == nullptr) return fail("Thread failed: unknown profile shape.");
    if (!(pitch > Precision::Confusion())) return fail("Thread failed: the pitch must be greater than 0.");
    if (!(turns > 1e-6) || turns > 2000) return fail("Thread failed: the number of turns is out of range.");
    if (gp_Vec(dx, dy, dz).Magnitude() <= Precision::Confusion()) return fail("Thread failed: the axis has no direction.");
    try {
      TopExp_Explorer faceAt(*input, TopAbs_FACE);
      if (!faceAt.More()) return fail("Thread failed: the profile has no face.");
      const TopoDS_Face face = TopoDS::Face(faceAt.Current());
      const gp_Pnt origin(ox, oy, oz);
      const gp_Dir axis(dx, dy, dz);
      // The profile's extent along the axis and from it, from its vertices.
      double hMin = 1e300, hMax = -1e300, rMin = 1e300;
      for (TopExp_Explorer v(face, TopAbs_VERTEX); v.More(); v.Next()) {
        const gp_Vec to(origin, BRep_Tool::Pnt(TopoDS::Vertex(v.Current())));
        const double h = to.Dot(gp_Vec(axis));
        const double r = (to - gp_Vec(axis) * h).Magnitude();
        hMin = std::min(hMin, h);
        hMax = std::max(hMax, h);
        rMin = std::min(rMin, r);
      }
      if (!(rMin > 1e-4)) return fail("Thread failed: the profile touches the axis.");
      if (!(hMax - hMin < pitch - 1e-6)) return fail("Thread failed: the profile is as long as the pitch.");
      BRepAdaptor_Surface surface(face);
      if (surface.GetType() != GeomAbs_Plane) return fail("Thread failed: the profile isn't flat.");
      const gp_Pln plane = surface.Plane();
      if (std::abs(plane.Axis().Direction().Dot(axis)) > 1e-7 || plane.Distance(origin) > 1e-6) {
        return fail("Thread failed: the profile's plane doesn't contain the axis.");
      }

      GProp_GProps props;
      BRepGProp::SurfaceProperties(face, props);
      const gp_Vec toCentre(origin, props.CentreOfMass());
      const double hc = toCentre.Dot(gp_Vec(axis));
      const gp_Vec radial = toCentre - gp_Vec(axis) * hc;
      const double rc = radial.Magnitude();
      const gp_Ax3 frame(origin.Translated(gp_Vec(axis) * hc), axis, gp_Dir(radial));
      Handle(Geom_Surface) cylinder = new Geom_CylindricalSurface(frame, rc);
      const double sign = left ? -1.0 : 1.0;
      const gp_Dir2d along(sign * 2 * M_PI, pitch);
      const double perTurn = std::sqrt(4 * M_PI * M_PI + pitch * pitch);
      BRepBuilderAPI_MakeWire spine;
      const int whole = static_cast<int>(std::floor(turns + 1e-9));
      const int pieces = whole + (turns - whole > 1e-6 ? 1 : 0);
      for (int k = 0; k < pieces; ++k) {
        const double span = std::min(1.0, turns - k);
        Handle(Geom2d_Line) line = new Geom2d_Line(gp_Pnt2d(sign * 2 * M_PI * k, pitch * k), along);
        BRepBuilderAPI_MakeEdge edge(line, cylinder, 0, span * perTurn);
        if (!edge.IsDone()) return fail("Thread failed: couldn't make the helix.");
        TopoDS_Edge helix = edge.Edge();
        if (!BRepLib::BuildCurves3d(helix, 1e-5, GeomAbs_C2, 14, 200)) {
          return fail("Thread failed: couldn't build the helix.");
        }
        spine.Add(helix);
        if (!spine.IsDone()) return fail("Thread failed: couldn't join the helix's turns.");
      }

      BRepOffsetAPI_MakePipeShell pipe(spine.Wire());
      pipe.SetMode(axis);
      const TopoDS_Wire outline = BRepTools::OuterWire(face);
      pipe.Add(outline, false, false);
      pipe.Build();
      if (!pipe.IsDone()) return fail("Thread failed: OCCT couldn't sweep the profile.");
      if (!pipe.MakeSolid()) return fail("Thread failed: the sweep isn't closed.");
      const TopoDS_Shape result = pipe.Shape();
      BRepCheck_Analyzer check(result);
      if (!check.IsValid()) return fail("Thread failed: the swept thread isn't a sound solid.");
      GProp_GProps volume;
      BRepGProp::VolumeProperties(result, volume);
      if (!(volume.Mass() > 0)) return fail("Thread failed: the swept thread is inside out.");

      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultMaps[3];
      for (int kind = 0; kind < 3; ++kind) TopExp::MapShapes(result, kindToEnum(kind), resultMaps[kind]);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(*input, TopAbs_EDGE, edges);
      NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> sides;
      for (int i = 1; i <= edges.Extent(); ++i) {
        const NCollection_List<TopoDS_Shape>& made = pipe.Generated(edges(i));
        appendRelation(made, resultMaps, 0, 1, i - 1, 1);
        for (NCollection_List<TopoDS_Shape>::Iterator it(made); it.More(); it.Next()) sides.Add(it.Value());
      }
      // The caps: the two faces no edge generated, told apart by how far they lie from the profile.
      std::vector<TopoDS_Shape> caps;
      for (int i = 1; i <= resultMaps[0].Extent(); ++i) {
        if (!sides.Contains(resultMaps[0](i))) caps.push_back(resultMaps[0](i));
      }
      if (caps.size() == 2) {
        GProp_GProps a, b;
        BRepGProp::SurfaceProperties(caps[0], a);
        BRepGProp::SurfaceProperties(caps[1], b);
        const gp_Pnt centre = props.CentreOfMass();
        const bool firstIsA = a.CentreOfMass().Distance(centre) <= b.CentreOfMass().Distance(centre);
        NCollection_List<TopoDS_Shape> one;
        one.Append(firstIsA ? caps[0] : caps[1]);
        appendRelation(one, resultMaps, 0, 0, 0, 4);
        one.Clear();
        one.Append(firstIsA ? caps[1] : caps[0]);
        appendRelation(one, resultMaps, 0, 0, 0, 5);
      }
      return store(result);
    } catch (...) {
      return failFromException("Thread failed");
    }
  }

  /**
   * What a thread needs to know of a cylindrical face `face` of `shape`
   * (P4-02, ADR-0056), in geometryNumbers: [ox, oy, oz, dx, dy, dz, radius,
   * inside, h0, h1, whole, open0, open1]. The axis runs through (ox, oy, oz)
   * along (dx, dy, dz) (canonical sign); the face spans h0 to h1 along it
   * from that point. `inside` is 1 when the face's material lies outside the
   * cylinder (a hole's wall: an internal thread), 0 for a shaft. `whole` is 1
   * when the face goes all the way round. `open0` / `open1` say whether the
   * face's edge at h0 / h1 is an outward corner (1: the shaft's end, a hole's
   * mouth, where a thread gets its lead-in chamfer) or not (0: a shoulder,
   * a hole's floor, a smooth join, or no edge right round). Returns 13, or -1
   * (not a cylinder, unknown shape).
   */
  int threadFace(int shape, int face) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) return failCurve("Unknown shape.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*s, TopAbs_FACE, faces);
      if (face < 0 || face >= faces.Extent()) return failCurve("Face index out of range.");
      const TopoDS_Face f = TopoDS::Face(faces(face + 1));
      BRepAdaptor_Surface surface(f);
      if (surface.GetType() != GeomAbs_Cylinder) return failCurve("The face isn't cylindrical.");
      const gp_Cylinder cylinder = surface.Cylinder();
      const gp_Pnt origin = cylinder.Location();
      const gp_Dir axis = cylinder.Axis().Direction();
      const gp_Dir out = canonical(axis);
      const double flip = out.Dot(axis) < 0 ? -1.0 : 1.0;
      double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
      BRepTools::UVBounds(f, u0, u1, v0, v1);
      // The material side, from the face's normal in the middle.
      const double um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      BRepLProp_SLProps props(surface, um, vm, 1, Precision::Confusion());
      if (!props.IsNormalDefined()) return failCurve("The face has no normal.");
      gp_Dir normal = props.Normal();
      if (f.Orientation() == TopAbs_REVERSED) normal.Reverse();
      const gp_Pnt mid = props.Value();
      const gp_Vec toMid(origin, mid);
      const gp_Vec radial = toMid - gp_Vec(axis) * toMid.Dot(gp_Vec(axis));
      const bool inside = gp_Vec(normal).Dot(radial) < 0;
      const bool whole = u1 - u0 >= 2 * M_PI - 1e-6;

      // Each end: the faces across the edges that lie on it, and whether they turn away.
      NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
      TopExp::MapShapesAndUniqueAncestors(*s, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
      const double tol = 1e-6 * std::max(1.0, v1 - v0);
      double open[2] = {1, 1};
      double around[2] = {0, 0};
      for (TopExp_Explorer e(f, TopAbs_EDGE); e.More(); e.Next()) {
        const TopoDS_Edge edge = TopoDS::Edge(e.Current());
        double first = 0, last = 0;
        Handle(Geom2d_Curve) onFace = BRep_Tool::CurveOnSurface(edge, f, first, last);
        if (onFace.IsNull()) continue;
        const gp_Pnt2d a = onFace->Value(first), b = onFace->Value(last), m = onFace->Value((first + last) / 2);
        int end = -1;
        if (std::abs(a.Y() - v0) < tol && std::abs(b.Y() - v0) < tol && std::abs(m.Y() - v0) < tol) end = 0;
        if (std::abs(a.Y() - v1) < tol && std::abs(b.Y() - v1) < tol && std::abs(m.Y() - v1) < tol) end = 1;
        if (end < 0) continue;
        around[end] += std::abs(b.X() - a.X());
        const int at = edgeFaces.FindIndex(edge);
        if (at == 0) continue;
        // Into the face from this end, along the axis.
        const gp_Vec into = gp_Vec(axis) * (end == 0 ? 1.0 : -1.0);
        for (NCollection_List<TopoDS_Shape>::Iterator it(edgeFaces(at)); it.More(); it.Next()) {
          if (it.Value().IsSame(f)) continue;
          const TopoDS_Face other = TopoDS::Face(it.Value());
          double f2 = 0, l2 = 0;
          Handle(Geom2d_Curve) onOther = BRep_Tool::CurveOnSurface(edge, other, f2, l2);
          if (onOther.IsNull()) {
            open[end] = 0;
            continue;
          }
          const gp_Pnt2d uv = onOther->Value((f2 + l2) / 2);
          BRepAdaptor_Surface otherSurface(other);
          BRepLProp_SLProps otherProps(otherSurface, uv.X(), uv.Y(), 1, Precision::Confusion());
          if (!otherProps.IsNormalDefined()) {
            open[end] = 0;
            continue;
          }
          gp_Dir n2 = otherProps.Normal();
          if (other.Orientation() == TopAbs_REVERSED) n2.Reverse();
          // An outward corner: the face across turns its back on this one.
          if (!(gp_Vec(n2).Dot(into) < -0.5)) open[end] = 0;
        }
      }
      for (int end = 0; end < 2; ++end) {
        if (around[end] < (u1 - u0) - 1e-6) open[end] = 0;
      }
      pushPoint(origin);
      pushDir(out);
      const double h0 = flip > 0 ? v0 : -v1;
      const double h1 = flip > 0 ? v1 : -v0;
      geometry_.insert(geometry_.end(), {cylinder.Radius(), inside ? 1.0 : 0.0, h0, h1, whole ? 1.0 : 0.0,
                                         flip > 0 ? open[0] : open[1], flip > 0 ? open[1] : open[0]});
      return static_cast<int>(geometry_.size());
    } catch (...) {
      failFromException("Thread face failed");
      return -1;
    }
  }

  /**
   * Wraps the planar face `face` around a cylinder (P4-04, ADR-0060 §3) and
   * returns a handle to the solid between radius R and R + depth (outward)
   * or R − depth (inward), or 0 with lastError().
   *
   * The unrolling frame: o = a point on the cylinder axis, a = the axis
   * direction (unit), r = the reference direction (unit, square to a): the
   * direction from the axis towards the sketch, so a sketch point (s, z) --
   * measured in the sketch plane from p along sx (unit) and along a --
   * lands at angle s / R from r, height z. The surface's height parameter is
   * z + (p − o)·a, which is z when p is the projection of o onto the plane.
   *
   * Every curve is mapped exactly: a line to a line, a B-spline by its poles
   * (an affine map keeps B-splines, rational ones too), a circle or an
   * unrotated ellipse to an ellipse with its s semi-axis divided by R. A
   * rotated ellipse is turned into a B-spline first, so that the map has
   * perpendicular axes to work with.
   *
   * The solid is the two mapped faces -- on cylinders of radius R and of
   * R ± depth, the same gp_Ax3 -- plus one ruled face per edge of `face`
   * (BRepFill between the two), sewn into a shell.
   *
   * History for input 0 (the face as passed in): generated (1) from every
   * edge (its side face) and first (4) and last (5) for the face (the cap on
   * R, the cap on R ± depth).
   */
  int wrapOnCylinder(int face, double ox, double oy, double oz, double ax, double ay, double az, double rx,
                     double ry, double rz, double radius, double px, double py, double pz, double sx, double sy,
                     double sz, double depth, bool outward) {
    beginOp();
    const TopoDS_Shape* input = find(face);
    if (input == nullptr) return fail("Emboss failed: unknown face.");
    TopoDS_Face profile;
    int faces = 0;
    for (TopExp_Explorer e(*input, TopAbs_FACE); e.More(); e.Next()) {
      profile = TopoDS::Face(e.Current());
      ++faces;
    }
    if (faces != 1) return fail("Emboss failed: the profile isn't a single face.");
    // A loop that doesn't close up is not a region: the thickening below would spin on
    // it, so it is refused here.
    if (!BRep_Tool::IsClosed(BRepTools::OuterWire(profile))) {
      return fail("Emboss failed: the profile's outline doesn't close up.");
    }
    for (TopExp_Explorer w(profile, TopAbs_WIRE); w.More(); w.Next()) {
      if (!BRep_Tool::IsClosed(TopoDS::Wire(w.Current()))) {
        return fail("Emboss failed: a hole of the profile doesn't close up.");
      }
    }
    if (!(radius > Precision::Confusion())) return fail("Emboss failed: the cylinder's radius must be greater than 0.");
    if (!(depth > Precision::Confusion())) return fail("Emboss failed: the depth must be greater than 0.");
    const double far = outward ? radius + depth : radius - depth;
    if (!(far > Precision::Confusion())) return fail("Emboss failed: the depth is bigger than the radius.");
    if (gp_Vec(ax, ay, az).Magnitude() <= Precision::Confusion() ||
        gp_Vec(rx, ry, rz).Magnitude() <= Precision::Confusion() ||
        gp_Vec(sx, sy, sz).Magnitude() <= Precision::Confusion()) {
      return fail("Emboss failed: the cylinder's frame has no direction.");
    }
    try {
      BRepAdaptor_Surface carried(profile);
      if (carried.GetType() != GeomAbs_Plane) return fail("Emboss failed: the profile isn't flat.");
      const gp_Dir axis(ax, ay, az);
      const gp_Dir rdir(rx, ry, rz);
      // The sketch plane runs along the axis: its normal is square to it.
      if (std::abs(carried.Plane().Axis().Direction().Dot(axis)) > 1e-6) {
        return fail("Emboss failed: the sketch isn't on a plane parallel to the cylinder's axis.");
      }
      const gp_Pnt origin(ox, oy, oz);
      const gp_Pnt corner(px, py, pz);
      const gp_Dir across(sx, sy, sz);
      if (std::abs(axis.Dot(across)) > 1e-6) {
        return fail("Emboss failed: the sketch's frame doesn't run along the cylinder's axis.");
      }
      const double lift = gp_Vec(origin, corner).Dot(gp_Vec(axis));
      WrapFrame frame(axis, across, corner, lift, radius);

      // The profile's loops: the outer one first, then its holes, each in wire order.
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> profileEdges;
      TopExp::MapShapes(profile, TopAbs_EDGE, profileEdges);
      const TopoDS_Wire outline = BRepTools::OuterWire(profile);
      std::vector<TopoDS_Wire> loops{outline};
      for (TopExp_Explorer w(profile, TopAbs_WIRE); w.More(); w.Next()) {
        if (!w.Current().IsSame(outline)) loops.push_back(TopoDS::Wire(w.Current()));
      }
      std::vector<std::vector<int>> loopEdges;  // into sourceEdges, per loop
      std::vector<TopoDS_Edge> sourceEdges;
      std::vector<int> edgeAt;  // an edge's index in profileEdges, for the history
      std::vector<Wrapped> wrapped;
      for (const TopoDS_Wire& wire : loops) {
        std::vector<int> mine;
        for (BRepTools_WireExplorer edge(wire); edge.More(); edge.Next()) {
          const int index = profileEdges.FindIndex(edge.Current()) - 1;
          if (index < 0) return fail("Emboss failed: an edge of the profile isn't one of its own.");
          const Wrapped on = frame.wrap(edge.Current(), profile);
          if (on.curve.IsNull()) return fail("Emboss failed: couldn't map a curve of the profile onto the cylinder.");
          if (on.round > M_PI + 1e-9) {
            return fail("Emboss failed: the profiles are longer than half way round the cylinder.");
          }
          mine.push_back(static_cast<int>(sourceEdges.size()));
          sourceEdges.push_back(edge.Current());
          edgeAt.push_back(index);
          wrapped.push_back(on);
        }
        if (mine.empty()) return fail("Emboss failed: a loop of the profile has no edges.");
        loopEdges.push_back(std::move(mine));
      }

      // How far apart two points may lie and still be one corner: a millionth of the
      // profile's size, never under OCCT's own confusion.
      Bnd_Box box;
      BRepBndLib::Add(profile, box);
      double x0, y0, z0, x1, y1, z1;
      box.Get(x0, y0, z0, x1, y1, z1);
      const double tolerance = 1e-6 * std::max(1.0, std::sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) +
                                                                (z1 - z0) * (z1 - z0)));

      // Every edge of every loop, wrapped onto the near cylinder.
      Handle(Geom_Surface) inner = new Geom_CylindricalSurface(gp_Ax3(origin, axis, rdir), radius);
      std::vector<TopoDS_Edge> innerEdges(sourceEdges.size());
      for (size_t i = 0; i < sourceEdges.size(); ++i) {
        BRepBuilderAPI_MakeEdge made(wrapped[i].curve, inner, wrapped[i].from, wrapped[i].to);
        if (!made.IsDone()) return fail("Emboss failed: couldn't make an edge on the cylinder.");
        innerEdges[i] = made.Edge();
        if (!BRepLib::BuildCurves3d(innerEdges[i], 1e-7, GeomAbs_C2, 14, 200)) {
          return fail("Emboss failed: couldn't build a wrapped edge as a 3D curve.");
        }
      }

      // The loops as the wires of one face on that cylinder. A wire builder gives the
      // loop one vertex at every corner, so the face holds copies of the edges; a copy
      // keeps the edge's curve on the cylinder, which is what pairs the two here.
      std::vector<TopoDS_Wire> onCylinder;
      for (const std::vector<int>& mine : loopEdges) {
        BRepBuilderAPI_MakeWire wire;
        for (int i : mine) wire.Add(innerEdges[static_cast<size_t>(i)]);
        if (!wire.IsDone()) return fail("Emboss failed: couldn't join the wrapped edges into a loop.");
        onCylinder.push_back(wire.Wire());
      }
      BRepBuilderAPI_MakeFace cap(inner, onCylinder.front(), true);
      if (!cap.IsDone()) return fail("Emboss failed: couldn't make the face on the cylinder.");
      // A hole's loop the other way round, which is what an inner wire is.
      for (size_t w = 1; w < onCylinder.size() && cap.IsDone(); ++w) {
        cap.Add(TopoDS::Wire(onCylinder[w].Reversed()));
      }
      if (!cap.IsDone()) return fail("Emboss failed: couldn't add a hole to the face on the cylinder.");
      const TopoDS_Face near = cap.Face();

      std::vector<TopoDS_Edge> capEdges(sourceEdges.size());
      double from = 0;
      double to = 0;
      for (size_t i = 0; i < sourceEdges.size(); ++i) {
        const Handle(Geom2d_Curve) uv = BRep_Tool::CurveOnSurface(innerEdges[i], near, from, to);
        for (TopExp_Explorer e(near, TopAbs_EDGE); e.More(); e.Next()) {
          const TopoDS_Edge& candidate = TopoDS::Edge(e.Current());
          if (BRep_Tool::CurveOnSurface(candidate, near, from, to) == uv) {
            capEdges[i] = candidate;
            break;
          }
        }
        if (capEdges[i].IsNull()) return fail("Emboss failed: couldn't pair the wrapped edges with the cap's.");
      }

      // Which way the face looks: its surface's own normal, turned when the face came
      // out reversed. An offset runs that way, so this says which of the two signs grows
      // the radius (a cylinder's normal is radial, whichever way it is drawn).
      double uMin = 0;
      double uMax = 0;
      double vMin = 0;
      double vMax = 0;
      BRepTools::UVBounds(near, uMin, uMax, vMin, vMax);
      gp_Pnt at;
      gp_Vec du, dv;
      BRep_Tool::Surface(near)->D1(0.5 * (uMin + uMax), 0.5 * (vMin + vMax), at, du, dv);
      gp_Vec looks = du.Crossed(dv);
      if (near.Orientation() == TopAbs_REVERSED) looks.Reverse();
      gp_Vec radial(at.XYZ());
      radial.Subtract(origin.XYZ());
      const gp_Vec along(axis);
      radial.Subtract(along * radial.Dot(along));
      if (radial.Magnitude() <= Precision::Confusion() || looks.Magnitude() <= Precision::Confusion()) {
        return fail("Emboss failed: the profile has no area on the cylinder.");
      }
      const double grow = looks.Dot(radial) > 0 ? depth : -depth;

      // The solid: OCCT's simple offset of that one face. It maps the face onto the
      // coaxial cylinder of radius R ± depth -- the same curves, so both caps come out
      // exact -- and then makes the wall of each of its boundary edges between the two,
      // sharing the radial edge at a corner between the two walls that meet there. One
      // call, and every loop comes out right: a hole in it, a corner, a whole closed
      // curve such as a letter's O.
      BRepOffset_MakeSimpleOffset builder(near, outward ? grow : -grow);
      builder.SetBuildSolidFlag(true);
      builder.Perform();
      if (!builder.IsDone()) {
        const std::string why = builder.GetErrorMessage().ToCString();
        return fail(("Emboss failed: couldn't thicken the wrapped profile" + (why.empty() ? "" : ": " + why) + ".").c_str());
      }
      TopoDS_Solid body;
      for (TopExp_Explorer solid(builder.GetResultShape(), TopAbs_SOLID); solid.More(); solid.Next()) {
        body = TopoDS::Solid(solid.Current());
      }
      if (body.IsNull()) return fail("Emboss failed: the wrapped profile didn't make a solid.");
      // The sign of the offset decides which way round the shell comes out; a solid
      // built inside out has a negative volume, so turn it over.
      BRepLib::OrientClosedSolid(body);
      if (!(exactVolume(body) > 0)) {
        ShapeFix_Solid fixer(body);
        fixer.Perform();
        body = TopoDS::Solid(fixer.Solid());
      }
      if (!(exactVolume(body) > 0)) return fail("Emboss failed: the wrapped solid is inside out.");
      const TopoDS_Shape result = body;
      if (!BRepCheck_Analyzer(result).IsValid()) {
        return fail("Emboss failed: the wrapped solid isn't sound.");
      }

      // History for input 0 (the face as passed in): first (4) and last (5) for the face
      // itself (the cap on R and the one on R ± depth), generated (1) from every edge of
      // it: the wall between that edge and its image is the only face of the result that
      // carries the image and is neither cap.
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
      TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
      const TopoDS_Shape grown = builder.Generated(near);
      if (grown.IsNull()) return fail("Emboss failed: the thickening lost the profile's face.");
      recordFaces(0, 0, 0, 4, {near}, resultFaces);
      recordFaces(0, 0, 0, 5, {grown}, resultFaces);
      for (size_t i = 0; i < sourceEdges.size(); ++i) {
        const TopoDS_Shape image = builder.Generated(capEdges[i]);
        std::vector<TopoDS_Shape> walls;
        if (!image.IsNull()) {
          for (int f = 1; f <= resultFaces.Extent(); ++f) {
            const TopoDS_Shape& face = resultFaces.FindKey(f);
            if (face.IsSame(near) || face.IsSame(grown)) continue;
            for (TopExp_Explorer e(face, TopAbs_EDGE); e.More(); e.Next()) {
              if (e.Current().IsSame(image)) {
                walls.push_back(face);
                break;
              }
            }
          }
        }
        recordFaces(0, 1, edgeAt[i], 1, walls, resultFaces);
      }
      return store(result);
    } catch (...) {
      return failFromException("Emboss failed");
    }
  }

private:
  /** One edge of a sketch plane in a cylinder's parameters (P4-04). */
  struct Wrapped {
    Handle(Geom2d_Curve) curve;
    double from = 0;
    double to = 0;
    /** How far round the cylinder the edge runs, in radians: its largest |u|. */
    double round = 0;
  };

  /**
   * The unrolled sketch frame of wrapOnCylinder(): s along `across` from
   * `corner`, z along `axis` from it, so the cylinder's parameters are
   * (u, v) = (s / radius, z + lift). Every curve of a face in a plane maps
   * into them exactly -- a line to a line, a B-spline by its poles (an
   * affine map keeps B-splines, rational ones too), a circle or an
   * unrotated ellipse to an ellipse with its s semi-axis divided by the
   * radius -- and the conic made is checked against the source's own ends,
   * so a case the shortcut doesn't cover falls back to the B-spline.
   */
  struct WrapFrame {
    gp_Vec across;
    gp_Vec axis;
    gp_Pnt corner;
    double lift;
    double radius;

    WrapFrame(const gp_Dir& anAxis, const gp_Dir& anAcross, const gp_Pnt& aCorner, double aLift, double aRadius)
        : across(anAcross), axis(anAxis), corner(aCorner), lift(aLift), radius(aRadius) {}

        /** A point of the sketch plane as its (s, z) coordinates. */
    gp_Pnt2d flat(const gp_Pnt& p) const {
      gp_Vec v(p.XYZ());
      v.Subtract(corner.XYZ());
      return gp_Pnt2d(v.Dot(across), v.Dot(axis));
    }

    /** The same point in the cylinder's parameters. */
    gp_Pnt2d wrapped(const gp_Pnt& p) const {
      const gp_Pnt2d sz = flat(p);
      return gp_Pnt2d(sz.X() / radius, sz.Y() + lift);
    }

    /** How far a millimetre along a direction of the plane moves in (u, v). */
    gp_Pnt2d step(const gp_Dir& d) const {
      const gp_Vec v(d.XYZ());
      return gp_Pnt2d(v.Dot(across) / radius, v.Dot(axis));
    }

    /** Whether a direction runs along s (across) or along z (axis). */
    bool isAcross(const gp_Dir& d) const {
      return std::abs(v(d).Dot(across)) > 1 - 1e-9 && std::abs(v(d).Dot(axis)) < 1e-9;
    }
    bool isAlong(const gp_Dir& d) const {
      return std::abs(v(d).Dot(axis)) > 1 - 1e-9 && std::abs(v(d).Dot(across)) < 1e-9;
    }
    static gp_Vec v(const gp_Dir& d) { return gp_Vec(d.XYZ()); }

    /** A point of the plane's own parameter space as a point in space. */
    static gp_Pnt inPlane(const gp_Ax3& place, const gp_Pnt2d& uv) {
      return place.Location().Translated(
          gp_Vec(place.XDirection()) * uv.X() + gp_Vec(place.YDirection()) * uv.Y());
    }
    /** A direction of the plane's own parameter space as one in space. */
    static gp_Dir inPlane(const gp_Ax3& place, const gp_Dir2d& uv) {
      return gp_Dir(gp_Vec(place.XDirection()) * uv.X() + gp_Vec(place.YDirection()) * uv.Y());
    }

    /** An ellipse of semi-axes `ua` along u and `va` along v, at `centre`. */
    static Handle(Geom2d_Ellipse) ellipse(const gp_Pnt2d& centre, double ua, double va) {
      const double a = std::max(std::abs(ua), std::abs(va));
      const double b = std::min(std::abs(ua), std::abs(va));
      const gp_Dir2d major = a >= b ? gp_Dir2d(1, 0) : gp_Dir2d(0, 1);
      return new Geom2d_Ellipse(gp_Elips2d(gp_Ax2d(centre, major), a, b));
    }

    /** A B-spline whose poles are `pole(1..count)`, mapped into (u, v). */
    template <typename PoleAt>
    static Handle(Geom2d_BSplineCurve) mapSpline(int degree, int count, PoleAt pole,
                                                 const NCollection_Array1<double>& knots,
                                                 const NCollection_Array1<int>& mults, bool periodic, bool rational,
                                                 const NCollection_Array1<double>& weights) {
      NCollection_Array1<gp_Pnt2d> poles(1, count);
      for (int i = 1; i <= count; ++i) poles(i) = pole(i);
      if (!rational) return new Geom2d_BSplineCurve(poles, knots, mults, degree, periodic);
      return new Geom2d_BSplineCurve(poles, weights, knots, mults, degree, periodic);
    }

    /** The largest |u| a curve runs to (the poles bound a B-spline). */
    static double reach(const Handle(Geom2d_Curve)& curve, double from, double to) {
      if (Handle(Geom2d_Ellipse) conic = Handle(Geom2d_Ellipse)::DownCast(curve)) {
        return std::abs(conic->Location().X()) + std::max(conic->MajorRadius(), conic->MinorRadius());
      }
      if (Handle(Geom2d_Line) straight = Handle(Geom2d_Line)::DownCast(curve)) {
        return std::max(std::abs(straight->Value(from).X()), std::abs(straight->Value(to).X()));
      }
      double most = 0;
      if (Handle(Geom2d_BSplineCurve) spline = Handle(Geom2d_BSplineCurve)::DownCast(curve)) {
        for (int i = 1; i <= spline->NbPoles(); ++i) most = std::max(most, std::abs(spline->Pole(i).X()));
      }
      return most;
    }

    /** Whether a mapped curve starts where the source does. */
    bool agrees(const Handle(Geom2d_Curve)& made, double from, const Handle(Geom2d_Curve)& source, double at,
                const gp_Ax3& place) const {
      const gp_Pnt2d want = wrapped(inPlane(place, source->Value(at)));
      const gp_Pnt2d got = made->Value(from);
      return std::abs(want.X() - got.X()) < 1e-9 && std::abs(want.Y() - got.Y()) < 1e-9;
    }

    /** The edge `edge` of the plane face `onPlane`, in the cylinder's parameters. */
    Wrapped wrap(const TopoDS_Edge& edge, const TopoDS_Face& onPlane) {
      Wrapped out;
      // The curve in its own direction, and the range the edge really uses on the
      // plane: CurveOnSurface gives the range of the whole curve it finds, which
      // for an arc projected onto the plane is a whole circle.
      double whole = 0;
      double wholeLast = 0;
      const TopoDS_Edge forward = TopoDS::Edge(edge.Oriented(TopAbs_FORWARD));
      const Handle(Geom2d_Curve) curve = BRep_Tool::CurveOnSurface(forward, onPlane, whole, wholeLast);
      double first = 0;
      double last = 0;
      BRep_Tool::Range(forward, onPlane, first, last);
      if (curve.IsNull() || !(last > first)) return out;
      const gp_Ax3 place = BRepAdaptor_Surface(onPlane).Plane().Position();

      // A line: both ends and its direction, with the parameter scaled by how far
      // a millimetre along it moves in (u, v).
      if (Handle(Geom2d_Line) asLine = Handle(Geom2d_Line)::DownCast(curve)) {
        const gp_Pnt2d mapped = wrapped(inPlane(place, asLine->Value(first)));
        const gp_Pnt2d along = step(inPlane(place, asLine->Direction()));
        const double length = std::hypot(along.X(), along.Y());
        if (!(length > 1e-12)) return out;
        out.curve = new Geom2d_Line(mapped, gp_Dir2d(along.X(), along.Y()));
        out.from = first * length;
        out.to = last * length;
        out.round = reach(out.curve, out.from, out.to);
        return out;
      }

      // A circle, or an ellipse with its axes along the frame: an ellipse whose
      // s semi-axis is divided by the radius.
      gp_Pnt2d centre;
      double ua = 0;
      double va = 0;
      const Handle(Geom2d_Circle) asCircle = Handle(Geom2d_Circle)::DownCast(curve);
      const Handle(Geom2d_Ellipse) asEllipse = Handle(Geom2d_Ellipse)::DownCast(curve);
      if (!asCircle.IsNull()) {
        centre = wrapped(inPlane(place, asCircle->Location()));
        const gp_Dir x = inPlane(place, asCircle->Position().XDirection());
        if (isAcross(x)) {
          ua = asCircle->Radius() / radius;
          va = asCircle->Radius();
        } else if (isAlong(x)) {
          ua = asCircle->Radius();
          va = asCircle->Radius() / radius;
        }
      } else if (!asEllipse.IsNull()) {
        centre = wrapped(inPlane(place, asEllipse->Location()));
        const gp_Dir x = inPlane(place, asEllipse->Position().XDirection());
        const gp_Dir y = inPlane(place, asEllipse->Position().YDirection());
        if (isAcross(x) && isAlong(y)) {
          ua = asEllipse->MajorRadius() / radius;
          va = asEllipse->MinorRadius();
        } else if (isAlong(x) && isAcross(y)) {
          ua = asEllipse->MajorRadius();
          va = asEllipse->MinorRadius() / radius;
        }
      }
      if (ua > 0 && va > 0) {
        const Handle(Geom2d_Ellipse) conic = ellipse(centre, ua, va);
        // The sense of the source's ellipse carries over or turns with the
        // frame; where it doesn't, the B-spline below is the exact answer.
        if (agrees(conic, first, curve, first, place) && agrees(conic, last, curve, last, place)) {
          out.curve = conic;
          out.from = first;
          out.to = last;
          out.round = reach(conic, first, last);
          return out;
        }
      }

      // Everything else as a B-spline, poles and all.
      if (Handle(Geom2d_BSplineCurve) spline = Handle(Geom2d_BSplineCurve)::DownCast(curve)) {
        out.curve = mapSpline(spline->Degree(), spline->NbPoles(),
                              [&](int i) { return wrapped(inPlane(place, spline->Pole(i))); }, spline->Knots(),
                              spline->Multiplicities(), spline->IsPeriodic(), spline->IsRational(),
                              spline->WeightsArray());
        out.from = first;
        out.to = last;
        out.round = reach(out.curve, first, last);
        return out;
      }
      // A circle or an ellipse the frame didn't line up with, or whose parameter the
      // ellipse above measures from another axis: a B-spline is the exact answer, and it
      // has to be the piece the edge really runs along. An arc's curve in space is the
      // whole circle it sits on, so converting that untrimmed would run the cap's edge
      // the whole way round and no shell could close.
      const TopoDS_Edge ahead = TopoDS::Edge(edge.Oriented(TopAbs_FORWARD));
      double f3 = 0;
      double l3 = 0;
      const Handle(Geom_Curve) solid = BRep_Tool::Curve(ahead, f3, l3);
      if (solid.IsNull()) return out;
      TopoDS_Vertex head, tail;
      TopExp::Vertices(ahead, head, tail);
      // A closed edge (a whole circle or ellipse) takes the curve as it is.
      const bool closed = !head.IsNull() && head.IsSame(tail);
      const Handle(Geom_Curve) piece =
          closed ? solid : Handle(Geom_Curve)(new Geom_TrimmedCurve(solid, f3, l3));
      const Handle(Geom_BSplineCurve) three = GeomConvert::CurveToBSplineCurve(piece);
      if (three.IsNull()) return out;
      out.curve = mapSpline(three->Degree(), three->NbPoles(), [&](int i) { return wrapped(three->Pole(i)); },
                            three->Knots(), three->Multiplicities(), three->IsPeriodic(), three->IsRational(),
                            three->WeightsArray());
      out.from = three->FirstParameter();
      out.to = three->LastParameter();
      out.round = reach(out.curve, out.from, out.to);
      return out;
    }

  };

  std::unordered_map<int, TopoDS_Shape> shapes_;
  int nextHandle_;
  std::vector<int> args_;
  std::vector<int32_t> history_;
  std::string lastError_;
  double measured_[12] = {0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
  std::vector<float> positions_;
  std::vector<float> normals_;
  std::vector<uint32_t> indices_;
  std::vector<uint32_t> faceRanges_;
  std::vector<float> edgePoints_;
  std::vector<uint32_t> edgeRanges_;
  std::vector<uint8_t> edgeFlags_;
  std::vector<float> vertexPoints_;
  std::vector<double> exportPositions_;
  std::vector<uint32_t> exportIndices_;
  std::string exportText_;
  std::vector<std::string> stepNames_;
  std::vector<double> numbers_;
  /** Walls staged for shellFaces(): face indices and their thicknesses. */
  std::vector<int> wallFaces_;
  std::vector<double> wallThickness_;
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
  /** Staged path pieces (pathLine and friends). */
  std::vector<TopoDS_Edge> pathEdges_;
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

  int failExport(const char* message) {
    clearExport();
    fail(message);
    return -1;
  }

  /**
   * Stops OCCT's messages (the STEP translator's banner and statistics)
   * from reaching stdout, where Emscripten prints them to the console.
   */
  static void quietMessages() {
    const Handle(Message_Messenger)& messenger = Message::DefaultMessenger();
    if (!messenger.IsNull()) messenger->RemovePrinters(STANDARD_TYPE(Message_PrinterOStream));
  }

  /** The export node at a position: adds one. */
  int32_t addExportNode(const gp_Pnt& p) {
    exportPositions_.push_back(p.X());
    exportPositions_.push_back(p.Y());
    exportPositions_.push_back(p.Z());
    return static_cast<int32_t>(exportPositions_.size() / 3 - 1);
  }

  double exportNodeDistance(int32_t node, const gp_Pnt& p) const {
    const size_t i = static_cast<size_t>(node) * 3;
    return p.SquareDistance(
        gp_Pnt(exportPositions_[i], exportPositions_[i + 1], exportPositions_[i + 2]));
  }

  /**
   * Fills exportPositions_/exportIndices_ from the triangulation of every
   * face of a meshed shape, sharing nodes through the topology: each face
   * edge's polygon on the face's triangulation names the face nodes along
   * it, which become the edge's nodes (made once, by the first face that
   * meets the edge, their ends the edge's vertex nodes); nodes inside a
   * face are its own. BRepMesh discretises each edge once for all its
   * faces, so the polygons of one edge match node for node; their order
   * along the edge is checked by position, not assumed.
   */
  bool weldedMesh(const TopoDS_Shape& shape) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(shape, TopAbs_VERTEX, vertices);
    TopExp::MapShapes(shape, TopAbs_EDGE, edges);
    TopExp::MapShapes(shape, TopAbs_FACE, faces);
    std::vector<int32_t> vertexNodes(static_cast<size_t>(vertices.Extent()) + 1, -1);
    std::vector<std::vector<int32_t>> edgeNodes(static_cast<size_t>(edges.Extent()) + 1);
    std::vector<int32_t> local;

    for (int f = 1; f <= faces.Extent(); ++f) {
      const TopoDS_Face& face = TopoDS::Face(faces(f));
      TopLoc_Location location;
      const Handle(Poly_Triangulation)& triangulation = BRep_Tool::Triangulation(face, location);
      if (triangulation.IsNull()) {
        return fail("Export failed: a face of the body couldn't be meshed.") != 0;
      }
      const gp_Trsf transform = location.Transformation();
      const auto nodeAt = [&](int n) { return triangulation->Node(n).Transformed(transform); };
      const auto vertexNode = [&](const TopoDS_Vertex& vertex, const gp_Pnt& p) {
        int32_t& node = vertexNodes[static_cast<size_t>(vertices.FindIndex(vertex))];
        if (node < 0) node = addExportNode(p);
        return node;
      };
      local.assign(static_cast<size_t>(triangulation->NbNodes()) + 1, -1);

      for (TopExp_Explorer it(face, TopAbs_EDGE); it.More(); it.Next()) {
        const TopoDS_Edge& edge = TopoDS::Edge(it.Current());
        const Handle(Poly_PolygonOnTriangulation)& polygon =
            BRep_Tool::PolygonOnTriangulation(edge, triangulation, location);
        if (polygon.IsNull()) {
          return fail("Export failed: an edge of the body couldn't be meshed.") != 0;
        }
        const NCollection_Array1<int>& nodes = polygon->Nodes();
        const int count = nodes.Length();
        const int lower = nodes.Lower();
        if (count == 0) continue;
        TopoDS_Vertex first;
        TopoDS_Vertex last;
        TopExp::Vertices(TopoDS::Edge(edge.Oriented(TopAbs_FORWARD)), first, last);
        if (BRep_Tool::Degenerated(edge)) {
          // A pole or an apex: every node along it is the one vertex.
          const int32_t node = vertexNode(first, nodeAt(nodes(lower)));
          for (int k = 0; k < count; ++k) local[static_cast<size_t>(nodes(lower + k))] = node;
          continue;
        }
        std::vector<int32_t>& ids = edgeNodes[static_cast<size_t>(edges.FindIndex(edge))];
        bool forward = true;
        if (ids.empty()) {
          const gp_Pnt start = nodeAt(nodes(lower));
          forward = start.SquareDistance(BRep_Tool::Pnt(first)) <=
                    start.SquareDistance(BRep_Tool::Pnt(last));
          ids.assign(static_cast<size_t>(count), -1);
          for (int k = 0; k < count; ++k) {
            const int j = forward ? k : count - 1 - k;
            const gp_Pnt p = nodeAt(nodes(lower + k));
            if (j == 0) ids[0] = vertexNode(first, p);
            else if (j == count - 1) ids[static_cast<size_t>(j)] = vertexNode(last, p);
            else ids[static_cast<size_t>(j)] = addExportNode(p);
          }
        } else {
          if (static_cast<int>(ids.size()) != count) {
            return fail("Export failed: the mesh of two faces doesn't match along an edge.") != 0;
          }
          if (count >= 3) {
            const gp_Pnt second = nodeAt(nodes(lower + 1));
            forward = exportNodeDistance(ids[1], second) <=
                      exportNodeDistance(ids[static_cast<size_t>(count) - 2], second);
          } else {
            const gp_Pnt start = nodeAt(nodes(lower));
            forward = exportNodeDistance(ids[0], start) <= exportNodeDistance(ids[1], start);
          }
        }
        for (int k = 0; k < count; ++k) {
          const int j = forward ? k : count - 1 - k;
          int32_t& slot = local[static_cast<size_t>(nodes(lower + k))];
          if (slot < 0) slot = ids[static_cast<size_t>(j)];
        }
      }

      for (int n = 1; n <= triangulation->NbNodes(); ++n) {
        if (local[static_cast<size_t>(n)] < 0) local[static_cast<size_t>(n)] = addExportNode(nodeAt(n));
      }
      const bool reversed = face.Orientation() == TopAbs_REVERSED;
      for (int t = 1; t <= triangulation->NbTriangles(); ++t) {
        int n1 = 0;
        int n2 = 0;
        int n3 = 0;
        triangulation->Triangle(t).Get(n1, n2, n3);
        if (reversed) std::swap(n2, n3);
        const int32_t a = local[static_cast<size_t>(n1)];
        const int32_t b = local[static_cast<size_t>(n2)];
        const int32_t c = local[static_cast<size_t>(n3)];
        if (a == b || b == c || a == c) continue;
        exportIndices_.push_back(static_cast<uint32_t>(a));
        exportIndices_.push_back(static_cast<uint32_t>(b));
        exportIndices_.push_back(static_cast<uint32_t>(c));
      }
    }
    return true;
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

  using EdgeFaceMap =
      NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>;

  /**
   * The distance from the straight edge `edge` to the nearest straight
   * boundary edge of the flat face `face` that runs parallel to it on the
   * face's side and overlaps its length (a step or pocket wall, or the
   * face's far side): how far a round can reach into the face before that
   * wall is in its way. -1 when there is none or it can't be told (the edge
   * isn't a line, the face isn't flat).
   */
  static double wallBeside(const TopoDS_Edge& edge, const TopoDS_Face& face) {
    try {
      BRepAdaptor_Surface surface(face);
      if (surface.GetType() != GeomAbs_Plane) return -1;
      BRepAdaptor_Curve line(edge);
      if (line.GetType() != GeomAbs_Line) return -1;
      gp_Dir normal;
      if (!edgeNormal(edge, face, normal)) return -1;
      // The edge as the face's wire runs along it: the face lies to its left
      // seen from the outward normal.
      gp_Vec along(line.Line().Direction());
      bool found = false;
      for (TopExp_Explorer it(face, TopAbs_EDGE); it.More(); it.Next()) {
        if (!it.Current().IsSame(edge)) continue;
        if (it.Current().Orientation() == TopAbs_REVERSED) along.Reverse();
        found = true;
        break;
      }
      if (!found) return -1;
      const gp_Vec inward = gp_Vec(normal).Crossed(along);
      if (inward.Magnitude() < 1e-9) return -1;
      const gp_Vec inside = inward.Normalized();
      const gp_Vec direction = along.Normalized();
      const gp_Pnt origin = line.Value(line.FirstParameter());
      const double length = gp_Vec(origin, line.Value(line.LastParameter())).Dot(direction);
      const double span = std::abs(length);
      const double start = std::min(0.0, length);
      double nearest = -1;
      for (TopExp_Explorer it(face, TopAbs_EDGE); it.More(); it.Next()) {
        if (it.Current().IsSame(edge)) continue;
        BRepAdaptor_Curve wall(TopoDS::Edge(it.Current()));
        if (wall.GetType() != GeomAbs_Line) continue;
        const gp_Vec p1(origin, wall.Value(wall.FirstParameter()));
        const gp_Vec p2(origin, wall.Value(wall.LastParameter()));
        const gp_Vec run = p2 - p1;
        if (run.Magnitude() < 1e-9) continue;
        if (run.Normalized().Crossed(direction).Magnitude() > 0.01) continue;
        const double d1 = p1.Dot(inside);
        const double d2 = p2.Dot(inside);
        const double distance = std::min(d1, d2);
        if (distance < 1e-6) continue;
        const double t1 = p1.Dot(direction);
        const double t2 = p2.Dot(direction);
        const double lo = std::max(std::min(t1, t2), start);
        const double hi = std::min(std::max(t1, t2), start + span);
        if (hi - lo < 1e-3) continue;
        if (nearest < 0 || distance < nearest) nearest = distance;
      }
      return nearest;
    } catch (...) {
      return -1;
    }
  }

  /**
   * Whether a fillet of `radius` on `edge` would run into a wall parallel to
   * it: the round touches each face at `radius * tan(turn / 2)` from the
   * edge (turn = the angle between the faces' normals), so a face with a
   * wall of its own (the far side of a thin strip, a step) at or inside that
   * distance leaves the round no face to sit on, along the wall's length.
   * OCCT trips over this in some shapes (a face notched by a step: its
   * restriction-edge walk reads a curve that was never set and traps in
   * `Geom2dAdaptor_Curve::EvalD1`, "null function or function signature
   * mismatch"), and a trap can corrupt the heap, so the radius is refused
   * before OCCT runs. Only straight edges between flat faces are checked.
   */
  static bool filletRollsOff(const EdgeFaceMap& edgeFaces, const TopoDS_Edge& edge, double radius) {
    const int at = edgeFaces.FindIndex(edge);
    if (at == 0) return false;
    std::vector<TopoDS_Face> around;
    for (const TopoDS_Shape& face : edgeFaces(at)) around.push_back(TopoDS::Face(face));
    if (around.size() != 2) return false;
    gp_Dir a;
    gp_Dir b;
    if (!edgeNormal(edge, around[0], a) || !edgeNormal(edge, around[1], b)) return false;
    const double cosine = std::max(-1.0, std::min(1.0, a.Dot(b)));
    const double turn = std::acos(cosine);
    if (turn < 1e-6) return false;
    const double touch = turn > 3.14159 ? 1e9 : radius * std::tan(0.5 * turn);
    for (const TopoDS_Face& face : around) {
      const double wall = wallBeside(edge, face);
      if (wall >= 0 && touch >= wall - 1e-6) return true;
    }
    return false;
  }

  /**
   * The body of fillet() and filletVariable(): `perEdge` is how many radii each
   * staged edge carries (1, or 2 for a start and an end radius), so both round
   * the same edges, record the same history and report the same diagnosis.
   */
  int filletBuild(int shape, int perEdge) {
    beginOp();
    geometry_.clear();
    const bool variable = perEdge == 2;
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Fillet failed: unknown input shape.");
    if (args_.empty() || numbers_.size() != args_.size() * perEdge) {
      return fail(variable ? "Fillet failed: pick edges and give each its radius at its start and at its end."
                           : "Fillet failed: pick edges and give each a radius.");
    }
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(*input, TopAbs_EDGE, edges);
      for (size_t i = 0; i < args_.size(); ++i) {
        if (args_[i] < 0 || args_[i] >= edges.Extent()) return fail("Fillet failed: edge index out of range.");
        for (int k = 0; k < perEdge; ++k) {
          if (!(numbers_[perEdge * i + k] > 0)) return fail("Fillet failed: the radius must be greater than 0.");
        }
      }
      const std::vector<int> staged = args_;
      const std::vector<double> radii = numbers_;
      EdgeFaceMap edgeFaces;
      TopExp::MapShapesAndUniqueAncestors(*input, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
      BRepFilletAPI_MakeFillet builder(*input);
      std::vector<int> contourOf;
      std::vector<int> bad;
      const int added = addFillets(builder, edges, edgeFaces, staged, radii, perEdge, contourOf, bad);
      if (added == 1) {
        geometry_.push_back(2);
        geometry_.push_back(static_cast<double>(bad.size()));
        for (int position : bad) {
          geometry_.push_back(1);
          geometry_.push_back(staged[position]);
          geometry_.push_back(0);
        }
        return fail("Fillet failed: an edge can't be filleted.");
      }
      if (added == 2) {
        geometry_.push_back(3);
        geometry_.push_back(1);
        geometry_.push_back(static_cast<double>(bad.size()));
        for (int position : bad) geometry_.push_back(staged[position]);
        geometry_.push_back(0);
        return fail(variable ? "Fillet failed: one chain of tangent edges got two pairs of radii."
                             : "Fillet failed: one chain of tangent edges got two radii.");
      }
      // The chains, before Build: a failed Build can leave the builder unfit to ask.
      std::vector<std::vector<int>> chains(static_cast<size_t>(builder.NbContours()) + 1);
      for (int contour = 1; contour <= builder.NbContours(); ++contour) {
        for (int j = 1; j <= builder.NbEdges(contour); ++j) {
          const int at = edges.FindIndex(builder.Edge(contour, j)) - 1;
          if (at >= 0) chains[contour].push_back(at);
        }
      }
      // A radius that rolls off a flat face goes straight to the diagnosis: OCCT can trap there.
      if (added == 3) {
        return explainFillet(*input, edges, edgeFaces, staged, radii, perEdge, contourOf, chains);
      }
      TopoDS_Shape result;
      try {
        builder.Build();
        if (builder.IsDone()) result = builder.Shape();
      } catch (...) {
        result.Nullify();
      }
      if (!result.IsNull() && BRepCheck_Analyzer(result).IsValid()) {
        recordHistory(builder, *input, 0, result);
        return store(result);
      }
      return explainFillet(*input, edges, edgeFaces, staged, radii, perEdge, contourOf, chains);
    } catch (...) {
      geometry_.clear();
      geometry_.push_back(5);
      geometry_.push_back(0);
      return failFromException("Fillet failed");
    }
  }

  /**
   * Adds the edges of a fillet to `builder`: one radius per staged edge
   * (`perEdge` 1, the radius of the chain) or a pair (2: the radius at the
   * chain's start and at its end, see filletVariable); `radii` holds `perEdge`
   * numbers per staged edge, in `staged`'s order. Fills `contourOf` with each
   * staged edge's contour (a chain's number in the builder, 0 if OCCT can't
   * fillet the edge). Returns 0, 1 (some edge can't be filleted: `bad` lists
   * their positions in `staged`), 2 (a chain got two radii or two pairs:
   * `bad` lists its) or 3 (a radius rolls off a flat face: see filletRollsOff;
   * don't build).
   */
  static int addFillets(BRepFilletAPI_MakeFillet& builder,
                        const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& edges,
                        const EdgeFaceMap& edgeFaces,
                        const std::vector<int>& staged, const std::vector<double>& radii,
                        int perEdge, std::vector<int>& contourOf, std::vector<int>& bad) {
    contourOf.assign(staged.size(), 0);
    for (size_t i = 0; i < staged.size(); ++i) builder.Add(TopoDS::Edge(edges(staged[i] + 1)));
    for (size_t i = 0; i < staged.size(); ++i) {
      contourOf[i] = builder.Contour(TopoDS::Edge(edges(staged[i] + 1)));
      if (contourOf[i] == 0) bad.push_back(static_cast<int>(i));
    }
    if (!bad.empty()) return 1;
    for (int contour = 1; contour <= builder.NbContours(); ++contour) {
      std::vector<int> members;
      for (size_t i = 0; i < staged.size(); ++i) {
        if (contourOf[i] == contour) members.push_back(static_cast<int>(i));
      }
      if (members.empty()) continue;
      const size_t first = static_cast<size_t>(perEdge * members[0]);
      for (int position : members) {
        for (int k = 0; k < perEdge; ++k) {
          if (std::abs(radii[static_cast<size_t>(perEdge * position) + static_cast<size_t>(k)] -
                       radii[first + static_cast<size_t>(k)]) > 1e-9) {
            bad = members;
            return 2;
          }
        }
      }
      if (perEdge == 1) {
        for (int j = 1; j <= builder.NbEdges(contour); ++j) builder.SetRadius(radii[first], contour, j);
        continue;
      }
      // A start and an end radius: OCCT adds the chain's spine and puts the
      // law along it, so one Add per chain is enough.
      builder.Add(radii[first], radii[first + 1], TopoDS::Edge(edges(staged[members[0]] + 1)));
    }
    // Last, so that a chain with two radii or an edge that can't be filleted is reported first.
    for (int contour = 1; contour <= builder.NbContours(); ++contour) {
      for (size_t i = 0; i < staged.size(); ++i) {
        if (contourOf[i] != contour) continue;
        double widest = 0;
        for (int k = 0; k < perEdge; ++k) {
          widest = std::max(widest, radii[perEdge * i + static_cast<size_t>(k)]);
        }
        for (int j = 1; j <= builder.NbEdges(contour); ++j) {
          if (filletRollsOff(edgeFaces, builder.Edge(contour, j), widest)) return 3;
        }
        break;
      }
    }
    return 0;
  }

  /** Whether these fillets build a valid solid (a probe: nothing is kept). */
  bool filletWorks(const TopoDS_Shape& input,
                   const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& edges,
                   const EdgeFaceMap& edgeFaces, const std::vector<int>& staged,
                   const std::vector<double>& radii, int perEdge) {
    try {
      BRepFilletAPI_MakeFillet builder(input);
      std::vector<int> contourOf;
      std::vector<int> bad;
      if (addFillets(builder, edges, edgeFaces, staged, radii, perEdge, contourOf, bad) != 0) return false;
      builder.Build();
      if (!builder.IsDone()) return false;
      const TopoDS_Shape result = builder.Shape();
      return !result.IsNull() && BRepCheck_Analyzer(result).IsValid();
    } catch (...) {
      return false;
    }
  }

  /**
   * The largest value below `failing` for which `works` holds, by
   * bisection from 0 (7 steps, so within 0.8 % of `failing`: more would
   * only refine digits the message drops, and a failing build can take a
   * second), or 0 if nothing down to failing / 128 works.
   */
  template <typename Probe>
  static double largestThatWorks(Probe works, double failing) {
    double good = 0;
    double bad = failing;
    for (int step = 0; step < 7; ++step) {
      const double middle = 0.5 * (good + bad);
      if (works(middle)) good = middle;
      else bad = middle;
    }
    return good;
  }

  /**
   * Fills geometry_ after a fillet failed (see fillet() and filletVariable()):
   * finds the chains that fail alone and the largest radius each takes; if none
   * does (or a radius tapers, where which chain is too large depends on the
   * direction it runs in), the largest factor all radii can be scaled by.
   * Returns 0 with lastError set.
   */
  int explainFillet(const TopoDS_Shape& input,
                    const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& edges,
                    const EdgeFaceMap& edgeFaces, const std::vector<int>& staged, const std::vector<double>& radii,
                    int perEdge, const std::vector<int>& contourOf, const std::vector<std::vector<int>>& chains) {
    geometry_.clear();
    geometry_.push_back(1);
    geometry_.push_back(0);
    int records = 0;
    for (size_t contour = 1; contour < chains.size() && perEdge == 1; ++contour) {
      std::vector<int> subset;
      std::vector<double> subsetRadii;
      for (size_t i = 0; i < staged.size(); ++i) {
        if (contourOf[i] != static_cast<int>(contour)) continue;
        subset.push_back(staged[i]);
        subsetRadii.push_back(radii[i]);
      }
      if (subset.empty() || filletWorks(input, edges, edgeFaces, subset, subsetRadii, perEdge)) continue;
      const double failing = subsetRadii[0];
      const double largest = largestThatWorks(
          [&](double radius) {
            return filletWorks(input, edges, edgeFaces, subset, std::vector<double>(subset.size(), radius), perEdge);
          },
          failing);
      geometry_.push_back(static_cast<double>(chains[contour].size()));
      for (int at : chains[contour]) geometry_.push_back(at);
      geometry_.push_back(largest);
      ++records;
    }
    if (records == 0) {
      // Each chain builds alone, so they get in each other's way (the only
      // diagnosis a tapered fillet gets: its radii are one set of numbers).
      geometry_[0] = 4;
      const double factor = largestThatWorks(
          [&](double f) {
            std::vector<double> scaled(radii);
            for (double& r : scaled) r *= f;
            return filletWorks(input, edges, edgeFaces, staged, scaled, perEdge);
          },
          1.0);
      geometry_.push_back(static_cast<double>(staged.size()));
      for (int at : staged) geometry_.push_back(at);
      geometry_.push_back(factor);
      records = 1;
    }
    geometry_[1] = records;
    return fail("Fillet failed: the radius is probably too large for the selected edges.");
  }

  /**
   * The reference face of a chamfer on `edge`: the lower-numbered of its two
   * faces, the other with `flip`. Null when the edge isn't between two
   * different faces.
   */
  static TopoDS_Face referenceFace(const EdgeFaceMap& edgeFaces, const TopoDS_Shape& edge,
                                   const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                                   bool flip) {
    const int at = edgeFaces.FindIndex(edge);
    if (at == 0) return TopoDS_Face();
    std::vector<int> around;
    for (const TopoDS_Shape& face : edgeFaces(at)) around.push_back(faces.FindIndex(face));
    if (around.size() != 2 || around[0] == around[1]) return TopoDS_Face();
    std::sort(around.begin(), around.end());
    return TopoDS::Face(faces(around[flip ? 1 : 0]));
  }

  /**
   * Adds the edges of a chamfer to `builder` (see chamfer() for `spec`, four
   * numbers per staged edge). Fills `contourOf` with each staged edge's
   * contour (0 if OCCT can't chamfer it). Returns 0, 1 (some edge can't be
   * chamfered: `bad` lists their positions in `staged`) or 2 (a chain got
   * different settings: `bad` lists its positions).
   */
  static int addChamfers(BRepFilletAPI_MakeChamfer& builder,
                         const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& edges,
                         const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                         const EdgeFaceMap& edgeFaces, const std::vector<int>& staged,
                         const std::vector<double>& spec, std::vector<int>& contourOf,
                         std::vector<int>& bad) {
    contourOf.assign(staged.size(), 0);
    for (size_t i = 0; i < staged.size(); ++i) {
      const TopoDS_Edge edge = TopoDS::Edge(edges(staged[i] + 1));
      const int mode = static_cast<int>(spec[4 * i]);
      const double a = spec[4 * i + 1];
      const double b = spec[4 * i + 2];
      if (mode == 0) {
        builder.Add(a, edge);
        continue;
      }
      const TopoDS_Face face = referenceFace(edgeFaces, edge, faces, spec[4 * i + 3] > 0.5);
      if (face.IsNull()) continue;
      if (mode == 1) builder.Add(a, b, edge, face);
      else builder.AddDA(a, b, edge, face);
    }
    for (size_t i = 0; i < staged.size(); ++i) {
      contourOf[i] = builder.Contour(TopoDS::Edge(edges(staged[i] + 1)));
      if (contourOf[i] == 0) bad.push_back(static_cast<int>(i));
    }
    if (!bad.empty()) return 1;
    for (int contour = 1; contour <= builder.NbContours(); ++contour) {
      std::vector<int> members;
      for (size_t i = 0; i < staged.size(); ++i) {
        if (contourOf[i] == contour) members.push_back(static_cast<int>(i));
      }
      for (int position : members) {
        for (int k = 0; k < 4; ++k) {
          if (std::abs(spec[4 * position + k] - spec[4 * members[0] + k]) > 1e-9) {
            bad = members;
            return 2;
          }
        }
      }
    }
    return 0;
  }

  /** The staged settings of `positions`, with the distances scaled by `factor` (angles stay). */
  static std::vector<double> scaledSpec(const std::vector<double>& spec, const std::vector<int>& positions,
                                        double factor) {
    std::vector<double> out;
    for (int position : positions) {
      const int mode = static_cast<int>(spec[4 * position]);
      out.push_back(mode);
      out.push_back(spec[4 * position + 1] * factor);
      out.push_back(mode == 1 ? spec[4 * position + 2] * factor : spec[4 * position + 2]);
      out.push_back(spec[4 * position + 3]);
    }
    return out;
  }

  /** Whether these chamfers build a valid solid (a probe: nothing is kept). */
  bool chamferWorks(const TopoDS_Shape& input,
                    const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& edges,
                    const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                    const EdgeFaceMap& edgeFaces, const std::vector<int>& staged,
                    const std::vector<double>& spec) {
    try {
      BRepFilletAPI_MakeChamfer builder(input);
      std::vector<int> contourOf;
      std::vector<int> bad;
      if (addChamfers(builder, edges, faces, edgeFaces, staged, spec, contourOf, bad) != 0) return false;
      builder.Build();
      if (!builder.IsDone()) return false;
      const TopoDS_Shape result = builder.Shape();
      return !result.IsNull() && BRepCheck_Analyzer(result).IsValid();
    } catch (...) {
      return false;
    }
  }

  /**
   * Fills geometry_ after a chamfer failed (see chamfer()): finds the chains
   * that fail alone and the largest factor their distances take; if none
   * does, the largest factor all distances can be scaled by. Returns 0 with
   * lastError set. Same shape as explainFillet().
   */
  int explainChamfer(const TopoDS_Shape& input,
                     const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& edges,
                     const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                     const EdgeFaceMap& edgeFaces, const std::vector<int>& staged,
                     const std::vector<double>& spec, const std::vector<int>& contourOf,
                     const std::vector<std::vector<int>>& chains) {
    geometry_.clear();
    geometry_.push_back(1);
    geometry_.push_back(0);
    int records = 0;
    for (size_t contour = 1; contour < chains.size(); ++contour) {
      std::vector<int> positions;
      std::vector<int> subset;
      for (size_t i = 0; i < staged.size(); ++i) {
        if (contourOf[i] != static_cast<int>(contour)) continue;
        positions.push_back(static_cast<int>(i));
        subset.push_back(staged[i]);
      }
      if (subset.empty() || chamferWorks(input, edges, faces, edgeFaces, subset, scaledSpec(spec, positions, 1.0))) {
        continue;
      }
      const double largest = largestThatWorks(
          [&](double factor) {
            return chamferWorks(input, edges, faces, edgeFaces, subset, scaledSpec(spec, positions, factor));
          },
          1.0);
      geometry_.push_back(static_cast<double>(chains[contour].size()));
      for (int at : chains[contour]) geometry_.push_back(at);
      geometry_.push_back(largest);
      ++records;
    }
    if (records == 0) {
      // Each chain builds alone, so they get in each other's way.
      geometry_[0] = 4;
      std::vector<int> all;
      for (size_t i = 0; i < staged.size(); ++i) all.push_back(static_cast<int>(i));
      const double factor = largestThatWorks(
          [&](double f) {
            return chamferWorks(input, edges, faces, edgeFaces, staged, scaledSpec(spec, all, f));
          },
          1.0);
      geometry_.push_back(static_cast<double>(staged.size()));
      for (int at : staged) geometry_.push_back(at);
      geometry_.push_back(factor);
      records = 1;
    }
    geometry_[1] = records;
    return fail("Chamfer failed: the distances are probably too large for the selected edges.");
  }

  // ------------------------------------------------------------------ shell --

  /**
   * Whether `face` meets a neighbouring face without a crease along one of
   * its edges: their normals agree (within about 2 degrees) at the edge's
   * middle. Seams (a face meeting itself) don't count.
   */
  static bool touchesTangentFace(const TopoDS_Shape& body, const TopoDS_Face& face) {
    EdgeFaceMap edgeFaces;
    TopExp::MapShapesAndUniqueAncestors(body, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    for (TopExp_Explorer it(face, TopAbs_EDGE); it.More(); it.Next()) {
      const TopoDS_Edge edge = TopoDS::Edge(it.Current());
      const int at = edgeFaces.FindIndex(edge);
      if (at == 0) continue;
      for (const TopoDS_Shape& other : edgeFaces(at)) {
        if (other.IsSame(face)) continue;
        gp_Dir a;
        gp_Dir b;
        if (edgeNormal(edge, face, a) && edgeNormal(edge, TopoDS::Face(other), b) &&
            a.Dot(b) > 0.9994) {
          return true;
        }
      }
    }
    return false;
  }

  /** The outward normal of `face` at the middle of `edge`; false if it can't be found. */
  static bool edgeNormal(const TopoDS_Edge& edge, const TopoDS_Face& face, gp_Dir& normal) {
    double first = 0;
    double last = 0;
    const opencascade::handle<Geom2d_Curve> pcurve = BRep_Tool::CurveOnSurface(edge, face, first, last);
    if (pcurve.IsNull()) return false;
    const gp_Pnt2d uv = pcurve->Value(0.5 * (first + last));
    BRepAdaptor_Surface surface(face);
    BRepLProp_SLProps props(surface, uv.X(), uv.Y(), 1, 1e-7);
    if (!props.IsNormalDefined()) return false;
    normal = props.Normal();
    if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
    return true;
  }

  void pushShellStatus(int status, double value) {
    geometry_.clear();
    geometry_.push_back(status);
    geometry_.push_back(value);
  }

  /**
   * Builds the shell of `input` into `result` with `builder` (kept by the
   * caller for its history). `removed` are 0-based face indices. Without
   * removed faces OCCT returns only the offset skin, so the solid with a
   * void is put together here. False when OCCT can't build it.
   */
  static bool buildShell(BRepOffsetAPI_MakeThickSolid& builder, const TopoDS_Shape& input,
                         const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                         const std::vector<int>& removed, double thickness, bool outside,
                         TopoDS_Shape& result) {
    try {
      NCollection_List<TopoDS_Shape> closing;
      for (int index : removed) closing.Append(faces(index + 1));
      builder.MakeThickSolidByJoin(input, closing, outside ? thickness : -thickness, 1e-3);
      if (!builder.IsDone()) return false;
      result = builder.Shape();
      if (removed.empty()) result = hollowSolid(input, result, outside);
      return !result.IsNull();
    } catch (...) {
      result.Nullify();
      return false;
    }
  }

  /**
   * A solid with a void from the original `input` and its offset skin (what
   * OCCT gives for a shell without openings): the outer surface is the
   * original when hollowing inwards and the skin when growing outwards.
   */
  static TopoDS_Shape hollowSolid(const TopoDS_Shape& input, const TopoDS_Shape& skin, bool outside) {
    BRep_Builder builder;
    TopoDS_Solid solid;
    builder.MakeSolid(solid);
    for (TopExp_Explorer it(input, TopAbs_SHELL); it.More(); it.Next()) {
      builder.Add(solid, outside ? it.Current().Reversed() : it.Current());
    }
    for (TopExp_Explorer it(skin, TopAbs_SHELL); it.More(); it.Next()) {
      builder.Add(solid, it.Current().Reversed());
    }
    solid.Closed(true);
    return solid;
  }

  /**
   * A volume for a sign or an order, which the cheap fixed-order integral
   * answers: 1-3 % off on a B-spline body, but never the wrong side of zero.
   * Where a fraction of a percent decides the outcome (shellIsGood,
   * offsetIsGood, draftIsGood) it is exactVolume instead.
   */
  static double volumeOf(const TopoDS_Shape& shape) {
    GProp_GProps props;
    BRepGProp::VolumeProperties(shape, props);
    return props.Mass();
  }

  /**
   * Whether `result` is a sound shell of `input`: a valid solid with a
   * positive volume (smaller than the original's when hollowing inwards),
   * whose offset faces stay at least the thickness from the faces they were
   * offset from. OCCT "succeeds" with valid solids that are junk when the
   * thickness is beyond a curved face's radius (the offset cylinder turns
   * inside out), and only this distance shows it.
   */
  static bool shellIsGood(BRepOffsetAPI_MakeThickSolid& builder, const TopoDS_Shape& input,
                          const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                          const std::vector<int>& removed, const TopoDS_Shape& result, double thickness,
                          bool outside) {
    if (result.IsNull() || !TopExp_Explorer(result, TopAbs_SOLID).More()) return false;
    if (!BRepCheck_Analyzer(result).IsValid()) return false;
    const double volume = exactVolume(result);
    if (!(volume > 0)) return false;
    if (!outside && !(volume < exactVolume(input) * (1 - 1e-6))) return false;
    BRep_Builder compounds;
    TopoDS_Compound originals;
    TopoDS_Compound offsets;
    compounds.MakeCompound(originals);
    compounds.MakeCompound(offsets);
    bool any = false;
    for (int i = 1; i <= faces.Extent(); ++i) {
      if (std::find(removed.begin(), removed.end(), i - 1) != removed.end()) continue;
      const TopoDS_Shape& face = faces(i);
      for (const TopoDS_Shape& made : builder.Generated(face)) {
        if (made.ShapeType() != TopAbs_FACE) continue;
        compounds.Add(offsets, made);
        any = true;
      }
      compounds.Add(originals, face);
    }
    if (!any) return true;
    BRepExtrema_DistShapeShape measure(originals, offsets, Extrema_ExtFlag_MIN);
    if (!measure.IsDone()) return true;
    return measure.Value() >= 0.999 * thickness - 1e-3;
  }

  /**
   * Whether the shell builds and is sound (a probe: nothing is kept). Works
   * on a fresh copy of `input`, like shell() (see there).
   */
  static bool shellWorks(const TopoDS_Shape& input, const std::vector<int>& removed, double thickness,
                         bool outside) {
    const TopoDS_Shape copy = BRepBuilderAPI_Copy(input, true, false).Shape();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(copy, TopAbs_FACE, faces);
    BRepOffsetAPI_MakeThickSolid builder;
    TopoDS_Shape result;
    return buildShell(builder, copy, faces, removed, thickness, outside, result) &&
           shellIsGood(builder, copy, faces, removed, result, thickness, outside);
  }

  /**
   * Fills geometry_ after a shell failed (see shell()): the largest
   * thickness that works, or "nothing does". Returns 0 with lastError set.
   */
  int explainShell(const TopoDS_Shape& input, const std::vector<int>& removed, double thickness,
                   bool outside) {
    const double largest = largestThatWorks(
        [&](double t) { return shellWorks(input, removed, t, outside); }, thickness);
    pushShellStatus(largest > 0 ? 1 : 2, largest);
    return fail(largest > 0 ? "Shell failed: the thickness is too large for this body."
                            : "Shell failed: OCCT can't offset this body.");
  }

  /**
   * The thickness of every face of a shellFaces() call into `perFace`: the
   * staged walls and their smooth chains (OCCT offsets a chain by one
   * value), the shell's thickness elsewhere; a removed face gets its
   * chain's, the depth of a plug through it (plugShell). False
   * with the status (8, 9 or 10, see shellFaces()) and lastError set when
   * the walls contradict each other or the removed faces.
   */
  bool wallThicknesses(const std::vector<int>& chain, const std::vector<int>& removed, double thickness,
                      std::vector<double>& perFace) {
    const size_t count = chain.size();
    perFace.assign(count, thickness);
    std::vector<int> setBy(count, -1);
    for (size_t w = 0; w < wallFaces_.size(); ++w) {
      const int face = wallFaces_[w];
      const double t = wallThickness_[w];
      if (std::find(removed.begin(), removed.end(), face) != removed.end()) {
        pushShellStatus(8, face);
        fail("Shell failed: a wall is also a removed face.");
        return false;
      }
      for (size_t i = 0; i < count; ++i) {
        if (chain[i] != chain[static_cast<size_t>(face)]) continue;
        if (setBy[i] >= 0 && std::fabs(perFace[i] - t) > 1e-9) {
          const bool same = setBy[i] == face;
          pushShellStatus(same ? 9 : 10, face);
          fail(same ? "Shell failed: a face has two wall thicknesses."
                    : "Shell failed: faces that run smoothly into each other have different walls.");
          return false;
        }
        perFace[i] = t;
        setBy[i] = face;
      }
    }
    return true;
  }

  /**
   * Whether some flat face's wall, scaled by `factor`, reaches through the
   * body when hollowing inwards: at least as deep as the body is behind the
   * face (`skip`: removed faces, which have no wall). No such wall can work,
   * and OCCT's per-face offset (sharp joins) builds junk for it and leaks
   * about 9 kB doing so (P4-12: a 40 mm wall on a 40 mm plate leaks, 39 mm
   * doesn't), so it is not built. The depth is the box's bound first, then,
   * for a wall past half of that, exact: the body's distance from a plane
   * beyond it.
   */
  static bool wallsPassThrough(const TopoDS_Shape& input,
                               const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                               const std::vector<int>& skip, const std::vector<double>& perFace, double factor,
                               bool outside) {
    if (outside) return false;
    Bnd_Box box;
    BRepBndLib::AddOptimal(input, box, false, false);
    if (box.IsVoid()) return false;
    double x0, y0, z0, x1, y1, z1;
    box.Get(x0, y0, z0, x1, y1, z1);
    const double size = gp_Pnt(x0, y0, z0).Distance(gp_Pnt(x1, y1, z1)) + 1;
    for (int i = 1; i <= faces.Extent(); ++i) {
      const double t = perFace[static_cast<size_t>(i - 1)] * factor;
      if (!(t > 0) || std::find(skip.begin(), skip.end(), i - 1) != skip.end()) continue;
      const TopoDS_Face face = TopoDS::Face(faces(i));
      BRepAdaptor_Surface surface(face);
      if (surface.GetType() != GeomAbs_Plane) continue;
      const gp_Pln plane = surface.Plane();
      gp_Vec n(plane.Axis().Direction());
      if (face.Orientation() == TopAbs_REVERSED) n.Reverse();
      const gp_Pnt at = plane.Location();
      double far = 0;
      for (double x : {x0, x1}) {
        for (double y : {y0, y1}) {
          for (double z : {z0, z1}) far = std::max(far, gp_Vec(gp_Pnt(x, y, z), at).Dot(n));
        }
      }
      if (t < 0.5 * far) continue;
      const gp_Pnt beyond = at.Translated(-n * (far + 1));
      const TopoDS_Face wall =
          BRepBuilderAPI_MakeFace(gp_Pln(beyond, gp_Dir(n)), -size, size, -size, size).Face();
      BRepExtrema_DistShapeShape distance(input, wall, Extrema_ExtFlag_MIN);
      if (!distance.IsDone()) continue;
      if (t >= far + 1 - distance.Value() - 1e-6) return true;
    }
    return false;
  }

  /**
   * Builds a shell with a thickness per face (see shellFaces()) of `input`
   * into `result` with `builder`, kept by the caller for its history:
   * `perFace` scaled by `factor` (the diagnosis' probes scale everything
   * together). Without removed faces the solid with a void is put together
   * as in buildShell. False when OCCT can't build it.
   */
  static bool buildShellFaces(BRepOffset_MakeOffset& builder, const TopoDS_Shape& input,
                              const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                              const std::vector<int>& removed, const std::vector<double>& perFace, double thickness,
                              double factor, bool outside, TopoDS_Shape& result) {
    if (wallsPassThrough(input, faces, removed, perFace, factor, outside)) return false;
    try {
      const double sign = outside ? factor : -factor;
      // Sharp joins, as offsetFaces(): with round joins OCCT spreads a face's
      // own offset over every edge where the offsets diverge (convex edges
      // outwards, concave ones inwards), so one thicker floor thickened a
      // whole box grown outwards. With sharp joins it spreads over smooth
      // edges only, which is what wallThicknesses() and the check assume.
      builder.Initialize(input, sign * thickness, 1e-3, BRepOffset_Skin, true, false, GeomAbs_Intersection, false,
                         false);
      for (int index : removed) builder.AddFace(TopoDS::Face(faces(index + 1)));
      for (int i = 1; i <= faces.Extent(); ++i) {
        const double t = perFace[static_cast<size_t>(i - 1)];
        if (t > 0 && std::fabs(t - thickness) > 1e-9) builder.SetOffsetOnFace(TopoDS::Face(faces(i)), sign * t);
      }
      builder.MakeThickSolid();
      if (!builder.IsDone()) return false;
      result = builder.Shape();
      if (removed.empty()) result = hollowSolid(input, result, outside);
      return !result.IsNull();
    } catch (...) {
      result.Nullify();
      return false;
    }
  }

  /**
   * Whether `result` is a sound shell with a thickness per face: shellIsGood's
   * tests, with the distance test per thickness (each group of faces stays
   * at least its own thickness from its offsets) and over all faces (at
   * least the thinnest wall).
   */
  static bool shellFacesGood(BRepOffset_MakeOffset& builder, const TopoDS_Shape& input,
                             const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                             const std::vector<int>& removed, const std::vector<double>& perFace, double factor,
                             const TopoDS_Shape& result, bool outside) {
    if (result.IsNull() || !TopExp_Explorer(result, TopAbs_SOLID).More()) return false;
    if (!BRepCheck_Analyzer(result).IsValid()) return false;
    const double volume = exactVolume(result);
    if (!(volume > 0)) return false;
    if (!outside && !(volume < exactVolume(input) * (1 - 1e-6))) return false;
    std::vector<double> groups;
    for (int i = 0; i < faces.Extent(); ++i) {
      const double t = perFace[static_cast<size_t>(i)];
      if (t > 0 && std::find(groups.begin(), groups.end(), t) == groups.end()) groups.push_back(t);
    }
    if (groups.empty()) return true;
    // One entry per thickness, and a last one over every face for the thinnest.
    groups.push_back(-*std::min_element(groups.begin(), groups.end()));
    for (double group : groups) {
      BRep_Builder compounds;
      TopoDS_Compound originals;
      TopoDS_Compound offsets;
      compounds.MakeCompound(originals);
      compounds.MakeCompound(offsets);
      bool any = false;
      for (int i = 1; i <= faces.Extent(); ++i) {
        const double t = perFace[static_cast<size_t>(i - 1)];
        if (!(t > 0) || std::find(removed.begin(), removed.end(), i - 1) != removed.end()) continue;
        if (group > 0 && t != group) continue;
        const TopoDS_Shape& face = faces(i);
        for (const TopoDS_Shape& made : builder.Generated(face)) {
          if (made.ShapeType() != TopAbs_FACE) continue;
          compounds.Add(offsets, made);
          any = true;
        }
        compounds.Add(originals, face);
      }
      if (!any) continue;
      BRepExtrema_DistShapeShape measure(originals, offsets, Extrema_ExtFlag_MIN);
      if (!measure.IsDone()) continue;
      if (measure.Value() < 0.999 * std::fabs(group) * factor - 1e-3) return false;
    }
    return true;
  }

  /** Whether the shell with a thickness per face builds and is sound at `factor` (a probe), on a fresh copy. */
  static bool shellFacesWork(const TopoDS_Shape& input, const std::vector<int>& removed,
                             const std::vector<double>& perFace, double thickness, double factor, bool outside) {
    const TopoDS_Shape copy = BRepBuilderAPI_Copy(input, true, false).Shape();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(copy, TopAbs_FACE, faces);
    BRepOffset_MakeOffset builder;
    TopoDS_Shape result;
    return buildShellFaces(builder, copy, faces, removed, perFace, thickness, factor, outside, result) &&
           shellFacesGood(builder, copy, faces, removed, perFace, factor, result, outside);
  }

  /**
   * Fills geometry_ after a shell with a thickness per face failed: the
   * largest factor every thickness can be scaled by together, or "nothing
   * does". Returns 0 with lastError set.
   */
  int explainShellFaces(const TopoDS_Shape& input, const std::vector<int>& removed,
                        const std::vector<double>& perFace, double thickness, bool outside) {
    const double largest = largestThatWorks(
        [&](double f) { return shellFacesWork(input, removed, perFace, thickness, f, outside); }, 1.0);
    pushShellStatus(largest > 0 ? 1 : 2, largest);
    return fail(largest > 0 ? "Shell failed: the walls are too thick for this body."
                            : "Shell failed: OCCT can't offset this body.");
  }

  // ------------------------------------------------------------- plugs --

  /**
   * Whether a removed face that runs smoothly into a neighbour can be opened
   * by a plug instead (P4-12, ADR-0046's amendment, see plugShell): it is
   * flat, and at each of its edges the neighbour either runs smoothly into
   * it or stands square to it (a fillet round a lid, a box's side), so the
   * wall under it is the face's own outline swept straight in.
   */
  static bool pluggable(const TopoDS_Shape& body, const TopoDS_Face& face) {
    if (BRepAdaptor_Surface(face).GetType() != GeomAbs_Plane) return false;
    EdgeFaceMap edgeFaces;
    TopExp::MapShapesAndUniqueAncestors(body, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    for (TopExp_Explorer it(face, TopAbs_EDGE); it.More(); it.Next()) {
      const TopoDS_Edge edge = TopoDS::Edge(it.Current());
      const int at = edgeFaces.FindIndex(edge);
      if (at == 0) continue;
      for (const TopoDS_Shape& other : edgeFaces(at)) {
        if (other.IsSame(face)) continue;
        gp_Dir a;
        gp_Dir b;
        if (!edgeNormal(edge, face, a) || !edgeNormal(edge, TopoDS::Face(other), b)) return false;
        const double dot = a.Dot(b);
        if (dot > 0.9994 || std::fabs(dot) < 1e-3) continue;
        return false;
      }
    }
    return true;
  }

  /** Whether two of the `removed` faces share an edge. */
  static bool removedTouch(const TopoDS_Shape& body,
                           const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                           const std::vector<int>& removed) {
    EdgeFaceMap edgeFaces;
    TopExp::MapShapesAndUniqueAncestors(body, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    for (int e = 1; e <= edgeFaces.Extent(); ++e) {
      int count = 0;
      for (const TopoDS_Shape& other : edgeFaces(e)) {
        const int index = faces.FindIndex(other) - 1;
        if (std::find(removed.begin(), removed.end(), index) != removed.end()) ++count;
      }
      if (count > 1) return true;
    }
    return false;
  }

  /**
   * How a shell's removed faces can be opened: 0 the usual way (none runs
   * smoothly into a neighbour), 1 by plugs (see plugShell), or -1 not at
   * all, with `refused` the face that can't be opened.
   */
  static int openingRoute(const TopoDS_Shape& body,
                          const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                          const std::vector<int>& removed, int& refused) {
    int tangent = -1;
    for (int index : removed) {
      if (touchesTangentFace(body, TopoDS::Face(faces(index + 1)))) {
        tangent = index;
        break;
      }
    }
    if (tangent < 0) return 0;
    refused = tangent;
    if (removedTouch(body, faces, removed)) return -1;
    for (int index : removed) {
      if (!pluggable(body, TopoDS::Face(faces(index + 1)))) {
        refused = index;
        return -1;
      }
    }
    return 1;
  }

  /**
   * A shell whose openings are cut as plugs (P4-12, ADR-0046's amendment):
   * OCCT's MakeThickSolid can't open a face that runs smoothly into its
   * neighbours (its result is invalid, or the body unchanged), but it does
   * hollow such a body closed. So the body is hollowed closed with `thick`
   * (round joins as shell() has them, or with `sharp` the per-face offsets
   * of shellFaces()), and each removed face is swept through its wall as a
   * plug, kept to the cavity's own outline (the plug is the common of the
   * face's prism, which reaches half a wall past both sides of the wall,
   * with the cavity moved out along the face's normal by two walls, so its
   * outline near its top is what the prism meets), and cut out of it with
   * `cut`. `perFace` holds every face's wall,
   * the removed ones' too (their smooth chain's); all scaled by `factor`.
   * `plugs` gets the plugs, for the history. False when it can't be built.
   */
  static bool buildPlugged(BRepOffset_MakeOffset& thick, BRepAlgoAPI_Cut& cut, const TopoDS_Shape& input,
                           const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                           const std::vector<int>& removed, const std::vector<double>& perFace, double thickness,
                           double factor, bool outside, bool sharp, TopoDS_Shape& result,
                           std::vector<TopoDS_Shape>& plugs) {
    // Hollowed closed, every face has a wall, the removed ones too.
    if (sharp && wallsPassThrough(input, faces, {}, perFace, factor, outside)) return false;
    try {
      const double sign = outside ? factor : -factor;
      thick.Initialize(input, sign * thickness, 1e-3, BRepOffset_Skin, sharp, false,
                       sharp ? GeomAbs_Intersection : GeomAbs_Arc, false, false);
      if (sharp) {
        for (int i = 1; i <= faces.Extent(); ++i) {
          const double t = perFace[static_cast<size_t>(i - 1)];
          if (t > 0 && std::fabs(t - thickness) > 1e-9) thick.SetOffsetOnFace(TopoDS::Face(faces(i)), sign * t);
        }
      }
      // MakeThickSolid with no closing face returns the skin as shell() gets it
      // (MakeOffsetShape's skin comes out the other way round outwards).
      thick.MakeThickSolid();
      if (!thick.IsDone()) return false;
      const TopoDS_Shape skin = thick.Shape();
      const TopoDS_Shape hollow = hollowSolid(input, skin, outside);
      // The cavity: the skin's inside when hollowing inwards, the body itself when growing outwards.
      const TopoDS_Shape cavity = outside ? input : asSolid(skin);
      if (cavity.IsNull()) return false;
      BRep_Builder builder;
      TopoDS_Compound tools;
      builder.MakeCompound(tools);
      plugs.clear();
      for (int index : removed) {
        const TopoDS_Face face = TopoDS::Face(faces(index + 1));
        gp_Dir n = BRepAdaptor_Surface(face).Plane().Axis().Direction();
        if (face.Orientation() == TopAbs_REVERSED) n.Reverse();
        const double depth = perFace[static_cast<size_t>(index)] * factor;
        const double over = 0.5 * depth;
        // Inwards the wall is under the face, outwards over it; the prism runs `over` past both sides.
        const double from = outside ? -over : over;
        const double along = outside ? depth + 2 * over : -(depth + 2 * over);
        const TopoDS_Shape base = shifted(face, n.X() * from, n.Y() * from, n.Z() * from);
        BRepPrimAPI_MakePrism prism(base, gp_Vec(n) * along, false, true);
        if (!prism.IsDone()) return false;
        // The cavity moved out past the prism's far end, so the two never share a face.
        const double move = depth + 2 * over;
        BRepAlgoAPI_Common plug(prism.Shape(), shifted(cavity, n.X() * move, n.Y() * move, n.Z() * move));
        if (!plug.IsDone() || !TopExp_Explorer(plug.Shape(), TopAbs_SOLID).More()) return false;
        plugs.push_back(plug.Shape());
        builder.Add(tools, plug.Shape());
      }
      NCollection_List<TopoDS_Shape> arguments;
      NCollection_List<TopoDS_Shape> toolList;
      arguments.Append(hollow);
      toolList.Append(tools);
      cut.SetArguments(arguments);
      cut.SetTools(toolList);
      cut.SetRunParallel(false);
      cut.Build();
      if (!cut.IsDone() || cut.HasErrors()) return false;
      // A plug's faces lie on the cavity's own planes where it meets a square
      // neighbour and half a wall into the cavity: merged back, so the cavity's
      // faces stay whole (the history accounts for it).
      cut.SimplifyResult();
      result = asSolid(cut.Shape());
      return !result.IsNull();
    } catch (...) {
      result.Nullify();
      return false;
    }
  }

  /** Whether a plugged shell builds and is sound at `factor` (a probe), on a fresh copy. */
  static bool pluggedWorks(const TopoDS_Shape& input, const std::vector<int>& removed,
                           const std::vector<double>& perFace, double thickness, double factor, bool outside,
                           bool sharp) {
    const TopoDS_Shape copy = BRepBuilderAPI_Copy(input, true, false).Shape();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(copy, TopAbs_FACE, faces);
    BRepOffset_MakeOffset thick;
    BRepAlgoAPI_Cut cut;
    TopoDS_Shape result;
    std::vector<TopoDS_Shape> plugs;
    return buildPlugged(thick, cut, copy, faces, removed, perFace, thickness, factor, outside, sharp, result,
                        plugs) &&
           shellFacesGood(thick, copy, faces, removed, perFace, factor, result, outside);
  }

  /**
   * shell() or shellFaces() through plugs (see buildPlugged): builds it,
   * records its history and stores it, or diagnoses it as they do (with
   * `asFactor` the too-thick value is the factor, else a thickness).
   */
  int plugShell(const TopoDS_Shape& input, const std::vector<int>& removed, const std::vector<double>& perFace,
                double thickness, bool outside, bool sharp, bool asFactor) {
    {
      const TopoDS_Shape copy = BRepBuilderAPI_Copy(input, true, false).Shape();
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(copy, TopAbs_FACE, faces);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> originals;
      TopExp::MapShapes(input, TopAbs_FACE, originals);
      if (faces.Extent() == originals.Extent()) {
        BRepOffset_MakeOffset thick;
        BRepAlgoAPI_Cut cut;
        TopoDS_Shape result;
        std::vector<TopoDS_Shape> plugs;
        if (buildPlugged(thick, cut, copy, faces, removed, perFace, thickness, 1.0, outside, sharp, result, plugs) &&
            shellFacesGood(thick, copy, faces, removed, perFace, 1.0, result, outside)) {
          recordPlugged(thick, cut, copy, removed, plugs, result);
          return store(result);
        }
      }
    }
    const double largest = largestThatWorks(
        [&](double f) { return pluggedWorks(input, removed, perFace, thickness, f, outside, sharp); }, 1.0);
    pushShellStatus(largest > 0 ? 1 : 2, asFactor ? largest : largest * thickness);
    return fail(largest > 0 ? "Shell failed: the thickness is too large for this body."
                            : "Shell failed: OCCT can't offset this body.");
  }

  /**
   * History of a plugged shell for input 0 (as recordHistory writes it):
   * the closed hollow's (every face kept, each generating its offset, edges
   * and vertices the rounds) carried through the cut, and each removed
   * face modified into what is left of it (the wall ends in its plane) and
   * the faces its plug leaves: the rim round the opening.
   */
  void recordPlugged(BRepOffset_MakeOffset& thick, BRepAlgoAPI_Cut& cut, const TopoDS_Shape& input,
                     const std::vector<int>& removed, const std::vector<TopoDS_Shape>& plugs,
                     const TopoDS_Shape& result) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultMaps[3];
    for (int kind = 0; kind < 3; ++kind) TopExp::MapShapes(result, kindToEnum(kind), resultMaps[kind]);
    // The result's images of a shape of the closed hollow; `kept` when it is there unchanged.
    const auto through = [&](const TopoDS_Shape& shape, NCollection_List<TopoDS_Shape>& out, bool& kept) {
      kept = false;
      const NCollection_List<TopoDS_Shape>& modified = cut.Modified(shape);
      if (!modified.IsEmpty()) {
        for (const TopoDS_Shape& s : modified) out.Append(s);
        return;
      }
      if (resultMaps[enumToKind(shape.ShapeType())].Contains(shape)) {
        kept = true;
        out.Append(shape);
      }
    };
    for (int kind = 0; kind < 3; ++kind) {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> inputMap;
      TopExp::MapShapes(input, kindToEnum(kind), inputMap);
      for (int i = 1; i <= inputMap.Extent(); ++i) {
        const TopoDS_Shape& sub = inputMap(i);
        const auto at = std::find(removed.begin(), removed.end(), i - 1);
        if (kind == 0 && at != removed.end()) {
          // What is left of the face itself (the wall ends in its plane, where a
          // neighbour meets it square) and the plug's faces are the rim.
          NCollection_List<TopoDS_Shape> rim;
          bool left = false;
          through(sub, rim, left);
          for (TopExp_Explorer it(plugs[static_cast<size_t>(at - removed.begin())], TopAbs_FACE); it.More();
               it.Next()) {
            bool kept = false;
            through(it.Current(), rim, kept);
          }
          if (!appendRelation(rim, resultMaps, 0, kind, i - 1, 0)) {
            pushRecord(0, kind, i - 1, 2);
            history_.push_back(0);
          }
          continue;
        }
        NCollection_List<TopoDS_Shape> images;
        bool kept = false;
        through(sub, images, kept);
        NCollection_List<TopoDS_Shape> generated;
        for (const TopoDS_Shape& made : thick.Generated(sub)) {
          bool also = false;
          through(made, generated, also);
        }
        if (images.IsEmpty() && generated.IsEmpty()) {
          pushRecord(0, kind, i - 1, 2);
          history_.push_back(0);
          continue;
        }
        if (kept) {
          pushRecord(0, kind, i - 1, 3);
          history_.push_back(1);
          history_.push_back(kind);
          history_.push_back(resultMaps[kind].FindIndex(sub) - 1);
        } else {
          appendRelation(images, resultMaps, 0, kind, i - 1, 0);
        }
        appendRelation(generated, resultMaps, 0, kind, i - 1, 1);
      }
    }
  }

  // ------------------------------------------------------------ offset face --

  /**
   * How the faces of a body run into each other: its smooth chains (sets of
   * faces connected through edges where their normals agree within 4
   * degrees, the angle OCCT's offset calls tangent), and whether any chain
   * has a sharp edge inside it (two of its faces meeting at a crease, as two
   * fillets do at the corner of a box whose top edges are rounded). OCCT's
   * offset corrupts the wasm heap on such bodies (a memory access trap at
   * some distances, an empty result at others), so they are refused.
   * Fills `chain` (per face: the lowest face index of its chain) and returns
   * whether some chain has a sharp edge inside it.
   */
  static bool smoothChains(const TopoDS_Shape& body,
                           const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                           std::vector<int>& chain) {
    EdgeFaceMap edgeFaces;
    TopExp::MapShapesAndUniqueAncestors(body, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    const int count = faces.Extent();
    chain.assign(static_cast<size_t>(count), 0);
    for (int i = 0; i < count; ++i) chain[static_cast<size_t>(i)] = i;
    const auto root = [&chain](int i) {
      while (chain[static_cast<size_t>(i)] != i) {
        chain[static_cast<size_t>(i)] = chain[static_cast<size_t>(chain[static_cast<size_t>(i)])];
        i = chain[static_cast<size_t>(i)];
      }
      return i;
    };
    std::vector<std::pair<int, int>> creases;
    for (int e = 1; e <= edgeFaces.Extent(); ++e) {
      std::vector<int> around;
      for (const TopoDS_Shape& other : edgeFaces(e)) {
        const int index = faces.FindIndex(other) - 1;
        if (index >= 0 && std::find(around.begin(), around.end(), index) == around.end()) around.push_back(index);
      }
      // A seam (one face) or a stray edge has nothing to connect.
      if (around.size() != 2) continue;
      const TopoDS_Edge edge = TopoDS::Edge(edgeFaces.FindKey(e));
      gp_Dir a;
      gp_Dir b;
      if (edgeNormal(edge, TopoDS::Face(faces(around[0] + 1)), a) &&
          edgeNormal(edge, TopoDS::Face(faces(around[1] + 1)), b) && a.Dot(b) > 0.99756) {
        const int ra = root(around[0]);
        const int rb = root(around[1]);
        if (ra != rb) chain[static_cast<size_t>(std::max(ra, rb))] = std::min(ra, rb);
      } else {
        creases.emplace_back(around[0], around[1]);
      }
    }
    for (int i = 0; i < count; ++i) chain[static_cast<size_t>(i)] = root(i);
    bool sharpInside = false;
    for (const auto& crease : creases) {
      if (chain[static_cast<size_t>(crease.first)] == chain[static_cast<size_t>(crease.second)]) sharpInside = true;
    }
    return sharpInside;
  }

  /**
   * The faces of the smooth chains the picked faces belong to, them
   * included, as sorted indices: the faces OCCT's offset moves together.
   */
  static std::vector<int> smoothClosure(const std::vector<int>& chain, const std::vector<int>& picked) {
    std::vector<int> moving;
    for (size_t i = 0; i < chain.size(); ++i) {
      for (int index : picked) {
        if (index >= 0 && index < static_cast<int>(chain.size()) && chain[static_cast<size_t>(index)] == chain[i]) {
          moving.push_back(static_cast<int>(i));
          break;
        }
      }
    }
    return moving;
  }

  /**
   * `shape` as a solid with positive volume: a solid as it is, a shell
   * closed into one (OCCT's offset gives a shell for most bodies). A null
   * shape when it is neither or doesn't close.
   */
  static TopoDS_Shape asSolid(const TopoDS_Shape& shape) {
    TopoDS_Solid solid;
    if (shape.ShapeType() == TopAbs_SOLID) {
      solid = TopoDS::Solid(shape);
    } else if (shape.ShapeType() == TopAbs_SHELL) {
      BRepBuilderAPI_MakeSolid maker;
      maker.Add(TopoDS::Shell(shape));
      if (!maker.IsDone()) return TopoDS_Shape();
      solid = maker.Solid();
    } else if (shape.ShapeType() == TopAbs_COMPOUND) {
      int solids = 0;
      for (TopExp_Explorer it(shape, TopAbs_SOLID); it.More(); it.Next()) {
        solid = TopoDS::Solid(it.Current());
        ++solids;
      }
      if (solids != 1) return TopoDS_Shape();
    } else {
      return TopoDS_Shape();
    }
    if (volumeOf(solid) < 0) return solid.Reversed();
    return solid;
  }

  /**
   * Builds the offset of `input` (a copy, see offsetFaces) into `result`
   * with `builder`, kept by the caller for its history: a skin offset of
   * 0 everywhere but on the picked faces (0-based indices into `faces`),
   * which move by `distance`, with sharp joins.
   */
  static bool buildOffset(BRepOffset_MakeOffset& builder, const TopoDS_Shape& input,
                          const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                          const std::vector<int>& picked, double distance, TopoDS_Shape& result) {
    try {
      builder.Initialize(input, 0.0, 1e-4, BRepOffset_Skin, true, false, GeomAbs_Intersection, false, false);
      for (int index : picked) builder.SetOffsetOnFace(TopoDS::Face(faces(index + 1)), distance);
      builder.MakeOffsetShape();
      if (!builder.IsDone()) return false;
      result = asSolid(builder.Shape());
      return !result.IsNull();
    } catch (...) {
      result.Nullify();
      return false;
    }
  }

  /**
   * Whether `result` is a sound offset of `input`: a valid solid that has
   * grown where faces moved out and shrunk where they moved in, and whose
   * moved faces stay at least `|distance|` from the faces they came from.
   * OCCT "succeeds" with valid junk when a face is pushed past a curved
   * face's axis (the offset cylinder turns inside out): the distance, and
   * the volume for the sphere and torus, show it.
   */
  static bool offsetIsGood(BRepOffset_MakeOffset& builder, const TopoDS_Shape& input,
                           const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                           const std::vector<int>& moving, const TopoDS_Shape& result, double distance) {
    if (result.IsNull() || !TopExp_Explorer(result, TopAbs_SOLID).More()) return false;
    if (!BRepCheck_Analyzer(result).IsValid()) return false;
    const double volume = exactVolume(result);
    const double before = exactVolume(input);
    if (!(volume > 0)) return false;
    const double slack = 1e-6 * before;
    if (distance > 0 && volume < before - slack) return false;
    if (distance < 0 && volume > before + slack) return false;
    BRep_Builder compounds;
    TopoDS_Compound originals;
    TopoDS_Compound offsets;
    compounds.MakeCompound(originals);
    compounds.MakeCompound(offsets);
    bool any = false;
    for (int index : moving) {
      const TopoDS_Shape& face = faces(index + 1);
      for (const TopoDS_Shape& made : builder.Generated(face)) {
        if (made.ShapeType() != TopAbs_FACE) continue;
        compounds.Add(offsets, made);
        any = true;
      }
      compounds.Add(originals, face);
    }
    if (!any) return true;
    BRepExtrema_DistShapeShape measure(originals, offsets, Extrema_ExtFlag_MIN);
    if (!measure.IsDone()) return true;
    return measure.Value() >= 0.999 * std::fabs(distance) - 1e-3;
  }

  /** Whether the offset builds and is sound (a probe: nothing is kept), on a fresh copy. */
  static bool offsetWorks(const TopoDS_Shape& input, const std::vector<int>& picked,
                          const std::vector<int>& moving, double distance) {
    const TopoDS_Shape copy = BRepBuilderAPI_Copy(input, true, false).Shape();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(copy, TopAbs_FACE, faces);
    BRepOffset_MakeOffset builder;
    TopoDS_Shape result;
    return buildOffset(builder, copy, faces, picked, distance, result) &&
           offsetIsGood(builder, copy, faces, moving, result, distance);
  }

  /**
   * Fills geometry_ after an offset failed (see offsetFaces()): the largest
   * distance of the same sign that works, or "none does".
   */
  int explainOffset(const TopoDS_Shape& input, const std::vector<int>& picked,
                    const std::vector<int>& moving, double distance) {
    const double sign = distance < 0 ? -1.0 : 1.0;
    const double largest = largestThatWorks(
        [&](double m) { return offsetWorks(input, picked, moving, sign * m); }, std::fabs(distance));
    pushShellStatus(largest > 0 ? 1 : 2, largest);
    return fail(largest > 0 ? "Offset failed: the distance is too large for this body."
                            : "Offset failed: OCCT can't offset these faces.");
  }

  template <typename Builder>
  int finishBoolean(Builder& builder, const TopoDS_Shape& a, const TopoDS_Shape& b, bool simplify) {
    // Set the arguments here, not in the builder's constructor: the
    // constructor that takes two shapes already builds, and Build() would
    // run the whole boolean again (P4-02 found every boolean ran twice).
    NCollection_List<TopoDS_Shape> arguments, tools;
    arguments.Append(a);
    tools.Append(b);
    builder.SetArguments(arguments);
    builder.SetTools(tools);
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
    if (!analyzer.IsValid() || std::abs(exactVolume(result)) <= Precision::Confusion()) return false;
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
  template <typename Builder>
  void recordHistory(Builder& builder, const TopoDS_Shape& input, int inputIndex,
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

  // ------------------------------------------- scale and draft helpers (P3-08) --

  /**
   * History for input 0 of an operation that maps every sub-shape of
   * `input` to one image (`imageOf`, null if none): modified, or kept when
   * the image is the sub-shape itself. Images not in `result` are skipped.
   */
  template <typename ImageOf>
  void recordImages(const TopoDS_Shape& input, const TopoDS_Shape& result, ImageOf imageOf) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultMaps[3];
    for (int kind = 0; kind < 3; ++kind) TopExp::MapShapes(result, kindToEnum(kind), resultMaps[kind]);
    for (int kind = 0; kind < 3; ++kind) {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> inputMap;
      TopExp::MapShapes(input, kindToEnum(kind), inputMap);
      for (int i = 1; i <= inputMap.Extent(); ++i) {
        const TopoDS_Shape& sub = inputMap(i);
        TopoDS_Shape image;
        try {
          image = imageOf(sub);
        } catch (...) {
          image.Nullify();
        }
        if (image.IsNull() || enumToKind(image.ShapeType()) != kind) continue;
        const int found = resultMaps[kind].FindIndex(image);
        if (found <= 0) continue;
        pushRecord(0, kind, i - 1, image.IsSame(sub) ? 3 : 0);
        history_.push_back(1);
        history_.push_back(kind);
        history_.push_back(found - 1);
      }
    }
  }

  /**
   * `shape` (a non-uniform scale's all-B-spline result) with the faces that
   * are flat put back on planes and the straight edges between them on
   * lines, through `reshape` (its Value() maps an old sub-shape to the new
   * one). A null shape when nothing could be done safely.
   */
  static TopoDS_Shape restoreCanonical(const TopoDS_Shape& shape, const Handle(BRepTools_ReShape)& reshape) {
    try {
      BRep_Builder builder;
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(shape, TopAbs_FACE, faces);
      NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> flat;
      for (int i = 1; i <= faces.Extent(); ++i) {
        const TopoDS_Face& face = TopoDS::Face(faces(i));
        TopLoc_Location location;
        const Handle(Geom_Surface) surface = BRep_Tool::Surface(face, location);
        if (surface.IsNull() || surface->IsKind(STANDARD_TYPE(Geom_Plane))) continue;
        GeomLib_IsPlanarSurface planar(surface, 1e-7);
        if (!planar.IsPlanar()) continue;
        // The plane with the B-spline's own normal (not the face's), so the face keeps its side.
        double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
        BRepTools::UVBounds(face, u0, u1, v0, v1);
        gp_Pnt p;
        gp_Vec du, dv;
        surface->D1((u0 + u1) / 2, (v0 + v1) / 2, p, du, dv);
        const gp_Vec n = du.Crossed(dv);
        if (n.Magnitude() <= 1e-12) continue;
        const Handle(Geom_Plane) plane = new Geom_Plane(gp_Pln(planar.Plan().Location(), gp_Dir(n)));
        const double tolerance = BRep_Tool::Tolerance(face);
        for (TopExp_Explorer e(face, TopAbs_EDGE); e.More(); e.Next()) {
          builder.UpdateEdge(TopoDS::Edge(e.Current()), Handle(Geom2d_Curve)(), surface, location,
                             BRep_Tool::Tolerance(TopoDS::Edge(e.Current())));
        }
        builder.UpdateFace(face, plane, location, tolerance);
        flat.Add(face);
      }
      // Straight edges whose faces are all flat now: lines through their vertices.
      EdgeFaceMap edgeFaces;
      TopExp::MapShapesAndUniqueAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
      for (int e = 1; e <= edgeFaces.Extent(); ++e) {
        const TopoDS_Edge edge = TopoDS::Edge(edgeFaces.FindKey(e));
        if (BRep_Tool::Degenerated(edge)) continue;
        bool allFlat = !edgeFaces(e).IsEmpty();
        for (const TopoDS_Shape& face : edgeFaces(e)) allFlat = allFlat && flat.Contains(face);
        if (!allFlat) continue;
        double first = 0, last = 0;
        Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, first, last);
        const Handle(Geom_TrimmedCurve) trimmed = Handle(Geom_TrimmedCurve)::DownCast(curve);
        if (!trimmed.IsNull()) curve = trimmed->BasisCurve();
        const Handle(Geom_BSplineCurve) spline = Handle(Geom_BSplineCurve)::DownCast(curve);
        if (spline.IsNull() || spline->Degree() != 1 || spline->NbPoles() != 2) continue;
        TopoDS_Vertex a;
        TopoDS_Vertex b;
        TopExp::Vertices(TopoDS::Edge(edge.Oriented(TopAbs_FORWARD)), a, b);
        if (a.IsNull() || b.IsNull() || a.IsSame(b)) continue;
        const gp_Pnt pa = BRep_Tool::Pnt(a);
        const gp_Pnt pb = BRep_Tool::Pnt(b);
        if (pa.Distance(pb) <= Precision::Confusion()) continue;
        BRepBuilderAPI_MakeEdge make(gp_Lin(pa, gp_Dir(gp_Vec(pa, pb))), a, b);
        if (!make.IsDone()) continue;
        TopoDS_Edge line = make.Edge();
        builder.UpdateEdge(line, std::max(BRep_Tool::Tolerance(edge), Precision::Confusion()));
        reshape->Replace(edge.Oriented(TopAbs_FORWARD), line);
      }
      TopoDS_Shape out = reshape->Apply(shape);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> outFaces;
      TopExp::MapShapes(out, TopAbs_FACE, outFaces);
      for (int i = 1; i <= outFaces.Extent(); ++i) {
        const TopoDS_Face& face = TopoDS::Face(outFaces(i));
        if (!BRep_Tool::Surface(face)->IsKind(STANDARD_TYPE(Geom_Plane))) continue;
        for (TopExp_Explorer e(face, TopAbs_EDGE); e.More(); e.Next()) {
          BRepLib::BuildPCurveForEdgeOnPlane(TopoDS::Edge(e.Current()), face);
        }
      }
      return out;
    } catch (...) {
      return TopoDS_Shape();
    }
  }

  /**
   * Why a face can't be drafted along `pull`, before OCCT tries: 3 its
   * surface isn't a plane, cylinder or cone; 7 it is a plane square to the
   * pull (parallel to the neutral plane: no line to turn about). 0 if fine.
   */
  static int undraftable(const TopoDS_Face& face, const gp_Dir& pull) {
    BRepAdaptor_Surface surface(face, false);
    switch (surface.GetType()) {
      case GeomAbs_Plane:
        return std::abs(surface.Plane().Axis().Direction().Dot(pull)) > 1 - 1e-9 ? 7 : 0;
      case GeomAbs_Cylinder:
      case GeomAbs_Cone:
        return 0;
      default:
        return 3;
    }
  }

  /**
   * Adds the picked faces (indices into `faces`) to `builder` and builds it
   * into `result`. `refused` is the index of a face OCCT wouldn't take (-1).
   */
  static bool buildDraft(BRepOffsetAPI_DraftAngle& builder,
                         const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                         const std::vector<int>& picked, const gp_Dir& pull, const gp_Pln& neutral,
                         double angle, int& refused, TopoDS_Shape& result) {
    refused = -1;
    try {
      for (int index : picked) {
        // A face drafted with an earlier one (its smooth chain) is a no-op to add again.
        // (ConnectedFaces would say which, but it throws in this OCCT.)
        builder.Add(TopoDS::Face(faces(index + 1)), pull, angle, neutral, true);
        if (!builder.AddDone()) {
          refused = index;
          return false;
        }
      }
      builder.Build();
      if (!builder.IsDone()) return false;
      result = builder.Shape();
      return !result.IsNull();
    } catch (...) {
      result.Nullify();
      return false;
    }
  }

  /**
   * Whether a draft's `result` is sound: a valid solid with a positive
   * volume whose faces haven't crossed. DraftAngle tilts faces past each
   * other and the result can pass BRepCheck, so: the ends of every edge
   * keep their order along it (faces that met turn the edges between them
   * round), and no cone has its tip inside its own face (a cylinder drafted
   * past its radius).
   */
  static bool draftIsGood(const BRepOffsetAPI_DraftAngle& builder, const TopoDS_Shape& input,
                          const TopoDS_Shape& result) {
    if (result.IsNull() || !TopExp_Explorer(result, TopAbs_SOLID).More()) return false;
    if (!BRepCheck_Analyzer(result).IsValid()) return false;
    if (!(exactVolume(result) > 0)) return false;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(input, TopAbs_EDGE, edges);
    for (int i = 1; i <= edges.Extent(); ++i) {
      const TopoDS_Edge& from = TopoDS::Edge(edges(i));
      if (BRep_Tool::Degenerated(from)) continue;
      TopoDS_Vertex a0, a1;
      TopExp::Vertices(from, a0, a1);
      if (a0.IsNull() || a1.IsNull() || a0.IsSame(a1)) continue;
      // The images of the two ends, whichever way OCCT runs the new edge.
      TopoDS_Shape b0;
      TopoDS_Shape b1;
      try {
        b0 = builder.ModifiedShape(a0);
        b1 = builder.ModifiedShape(a1);
      } catch (...) {
        continue;
      }
      if (b0.IsNull() || b1.IsNull() || b0.ShapeType() != TopAbs_VERTEX || b1.ShapeType() != TopAbs_VERTEX) {
        return false;
      }
      const gp_Vec was(BRep_Tool::Pnt(a0), BRep_Tool::Pnt(a1));
      const gp_Vec is(BRep_Tool::Pnt(TopoDS::Vertex(b0)), BRep_Tool::Pnt(TopoDS::Vertex(b1)));
      if (was.Dot(is) <= Precision::Confusion() * was.Magnitude()) return false;
    }
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(result, TopAbs_FACE, faces);
    for (int i = 1; i <= faces.Extent(); ++i) {
      const TopoDS_Face& face = TopoDS::Face(faces(i));
      BRepAdaptor_Surface surface(face, false);
      if (surface.GetType() != GeomAbs_Cone) continue;
      const gp_Cone cone = surface.Cone();
      const double sine = std::sin(cone.SemiAngle());
      if (std::abs(sine) <= 1e-12) continue;
      // Along the generatrix the radius is R + v sin(α): the tip is at v = -R / sin(α).
      const double tip = -cone.RefRadius() / sine;
      double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
      BRepTools::UVBounds(face, u0, u1, v0, v1);
      const double slack = 1e-7 * std::max(1.0, std::abs(v1 - v0));
      if (tip > v0 + slack && tip < v1 - slack) return false;
    }
    return true;
  }

  /** Whether the draft builds and is sound (a probe: nothing is kept), on a fresh copy. */
  static bool draftWorks(const TopoDS_Shape& input, const std::vector<int>& picked, const gp_Dir& pull,
                         const gp_Pln& neutral, double angle) {
    const TopoDS_Shape copy = BRepBuilderAPI_Copy(input, true, false).Shape();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(copy, TopAbs_FACE, faces);
    BRepOffsetAPI_DraftAngle builder(copy);
    int refused = -1;
    TopoDS_Shape result;
    return buildDraft(builder, faces, picked, pull, neutral, angle, refused, result) &&
           draftIsGood(builder, copy, result);
  }

  /** Fills geometry_ after a draft failed (see draft()): the largest angle that works, or none. */
  int explainDraft(const TopoDS_Shape& input, const std::vector<int>& picked, const gp_Dir& pull,
                   const gp_Pln& neutral, double angle) {
    const double sign = angle < 0 ? -1.0 : 1.0;
    const double largest = largestThatWorks(
        [&](double a) { return draftWorks(input, picked, pull, neutral, sign * a); }, std::abs(angle));
    pushShellStatus(largest > 0 ? 1 : 6, largest);
    return fail(largest > 0 ? "Draft failed: the angle is too steep for this body."
                            : "Draft failed: OCCT can't draft these faces.");
  }

  // ------------------------------------------- paths, sweeps and lofts (P4-01) --

  /** Each profile edge with the side faces it swept into. */
  using SideList = std::vector<std::pair<TopoDS_Shape, std::vector<TopoDS_Shape>>>;

  /** Whether a path wire has all `edges` pieces in one chain. */
  static bool pathWireIsGood(const TopoDS_Wire& wire, size_t edges) {
    size_t count = 0;
    for (BRepTools_WireExplorer e(wire); e.More(); e.Next()) ++count;
    return count == edges;
  }

  /** The edges of a wire in order, each oriented the way the wire runs. */
  static std::vector<TopoDS_Edge> wireEdges(const TopoDS_Wire& wire) {
    std::vector<TopoDS_Edge> out;
    for (BRepTools_WireExplorer e(wire); e.More(); e.Next()) out.push_back(e.Current());
    return out;
  }

  /** Where an oriented edge starts or ends, and which way it runs there. */
  static void edgeEnd(const TopoDS_Edge& edge, bool atEnd, gp_Pnt& point, gp_Vec& tangent) {
    BRepAdaptor_Curve curve(edge);
    const bool reversed = edge.Orientation() == TopAbs_REVERSED;
    const double u = (atEnd != reversed) ? curve.LastParameter() : curve.FirstParameter();
    curve.D1(u, point, tangent);
    if (reversed) tangent.Reverse();
  }

  /** The two ends of a wire, the way it runs. */
  static void wireEnds(const TopoDS_Wire& wire, gp_Pnt& first, gp_Pnt& last) {
    const std::vector<TopoDS_Edge> edges = wireEdges(wire);
    gp_Vec tangent;
    edgeEnd(edges.front(), false, first, tangent);
    edgeEnd(edges.back(), true, last, tangent);
  }

  /** The same path run the other way: its edges reversed, in reverse order. */
  static TopoDS_Wire reversedWire(const TopoDS_Wire& wire) {
    const std::vector<TopoDS_Edge> edges = wireEdges(wire);
    BRepBuilderAPI_MakeWire maker;
    for (auto it = edges.rbegin(); it != edges.rend(); ++it) maker.Add(TopoDS::Edge(it->Reversed()));
    return maker.IsDone() ? maker.Wire() : TopoDS_Wire();
  }

  /** Whether the path turns smoothly where its pieces meet (within about half a degree). */
  static bool smoothWire(const TopoDS_Wire& wire) {
    const std::vector<TopoDS_Edge> edges = wireEdges(wire);
    gp_Pnt first;
    gp_Pnt last;
    wireEnds(wire, first, last);
    const bool closed = first.Distance(last) <= 1e-6;
    for (size_t i = 0; i < edges.size(); ++i) {
      if (i + 1 == edges.size() && !closed) break;
      gp_Pnt p;
      gp_Vec out;
      gp_Vec in;
      edgeEnd(edges[i], true, p, out);
      edgeEnd(edges[(i + 1) % edges.size()], false, p, in);
      if (out.Magnitude() <= 1e-12 || in.Magnitude() <= 1e-12 || out.Angle(in) > 1e-2) return false;
    }
    return true;
  }

  /**
   * The auxiliary spine of a twisted sweep: a curve beside the path whose
   * direction from the path turns by `twist` radians from start to end,
   * evenly by length, on a rotation-minimising frame (the double-reflection
   * method), so a twist of 0 follows the path like the corrected Frenet
   * frame. It stays within `distance` of the path, or nearer where the path
   * bends tightly, so the plane square to the path at a point meets it
   * only there.
   */
  static TopoDS_Wire twistSpine(const TopoDS_Wire& wire, double twist, double distance) {
    BRepAdaptor_CompCurve curve(wire);
    const int n = 400;
    GCPnts_QuasiUniformAbscissa spacing(curve, n + 1);
    if (!spacing.IsDone() || spacing.NbPoints() != n + 1) return TopoDS_Wire();
    std::vector<gp_Pnt> p(n + 1);
    std::vector<gp_Vec> t(n + 1);
    double tightest = 0;
    for (int i = 0; i <= n; ++i) {
      gp_Vec d1;
      gp_Vec d2;
      curve.D2(spacing.Parameter(i + 1), p[i], d1, d2);
      const double speed = d1.Magnitude();
      if (speed <= 1e-12) return TopoDS_Wire();
      tightest = std::max(tightest, d1.Crossed(d2).Magnitude() / (speed * speed * speed));
      t[i] = d1 / speed;
    }
    if (tightest > 0) distance = std::min(distance, 0.2 / tightest);
    // A first normal: square to the tangent, away from the world axis it is least along.
    const gp_Vec t0 = t[0];
    gp_Vec axis(1, 0, 0);
    if (std::abs(t0.Y()) < std::abs(t0.X()) && std::abs(t0.Y()) <= std::abs(t0.Z())) axis = gp_Vec(0, 1, 0);
    else if (std::abs(t0.Z()) < std::abs(t0.X())) axis = gp_Vec(0, 0, 1);
    gp_Vec r = t0.Crossed(axis);
    r.Normalize();
    std::vector<double> along(n + 1, 0.0);
    for (int i = 1; i <= n; ++i) along[i] = along[i - 1] + p[i].Distance(p[i - 1]);
    const double total = along[n];
    if (!(total > 1e-9)) return TopoDS_Wire();
    NCollection_Array1<gp_Pnt> points(1, n + 1);
    NCollection_Array1<double> parameters(1, n + 1);
    for (int i = 0; i <= n; ++i) {
      if (i > 0) {
        // Double reflection (Wang et al. 2008): reflect across the chord, then across the tangents' bisector.
        const gp_Vec v1(p[i - 1], p[i]);
        const double c1 = v1.SquareMagnitude();
        if (c1 > 1e-24) {
          const gp_Vec rl = r - v1 * (2.0 / c1 * v1.Dot(r));
          const gp_Vec tl = t[i - 1] - v1 * (2.0 / c1 * v1.Dot(t[i - 1]));
          const gp_Vec v2 = t[i] - tl;
          const double c2 = v2.SquareMagnitude();
          r = c2 > 1e-24 ? rl - v2 * (2.0 / c2 * v2.Dot(rl)) : rl;
        }
        // Keep it square to the tangent and of unit length against drift.
        r = r - t[i] * r.Dot(t[i]);
        if (r.Magnitude() <= 1e-12) return TopoDS_Wire();
        r.Normalize();
      }
      const double angle = twist * along[i] / total;
      const gp_Vec b = t[i].Crossed(r);
      points(i + 1) = p[i].Translated((r * std::cos(angle) + b * std::sin(angle)) * distance);
      parameters(i + 1) = along[i] / total;
    }
    GeomAPI_PointsToBSpline fit(points, parameters, 3, 8, GeomAbs_C2, 1e-4 * distance);
    if (!fit.IsDone()) return TopoDS_Wire();
    BRepBuilderAPI_MakeEdge edge(fit.Curve());
    if (!edge.IsDone()) return TopoDS_Wire();
    BRepBuilderAPI_MakeWire maker(edge.Edge());
    return maker.IsDone() ? maker.Wire() : TopoDS_Wire();
  }

  /**
   * One closed section swept along `spine` into a solid: 0, or a sweep()
   * status. `sides` gets each section edge's side faces.
   *
   * MakePipeShell's result depends on which edge the section's wire starts
   * with: a triangle starting with its edge parallel to a coil's axis sweeps
   * into an invalid solid counter-clockwise and a sound one clockwise, and
   * starting at the next edge sweeps soundly both ways. So a failed sweep is
   * tried again from each other edge of the section (the same edges, so the
   * history is unchanged).
   */
  static int pipeOne(const TopoDS_Wire& spine, const TopoDS_Wire& section, int mode, const gp_Dir& fixed,
                     const gp_Ax2& parallel, const TopoDS_Wire& auxiliary, double scale, TopoDS_Shape& solid,
                     TopoDS_Shape& firstCap, TopoDS_Shape& lastCap, SideList& sides) {
    const std::vector<TopoDS_Edge> edges = wireEdges(section);
    int status = 1;
    for (size_t start = 0; start < std::min<size_t>(edges.size(), 4); ++start) {
      TopoDS_Wire wire = section;
      if (start > 0) {
        BRepBuilderAPI_MakeWire maker;
        for (size_t k = 0; k < edges.size(); ++k) maker.Add(edges[(start + k) % edges.size()]);
        if (!maker.IsDone()) break;
        wire = maker.Wire();
      }
      SideList made;
      status = pipeTry(spine, wire, mode, fixed, parallel, auxiliary, scale, solid, firstCap, lastCap, made);
      if (status == 0) {
        for (auto& side : made) sides.push_back(std::move(side));
        return 0;
      }
    }
    return status;
  }

  static int pipeTry(const TopoDS_Wire& spine, const TopoDS_Wire& section, int mode, const gp_Dir& fixed,
                     const gp_Ax2& parallel, const TopoDS_Wire& auxiliary, double scale, TopoDS_Shape& solid,
                     TopoDS_Shape& firstCap, TopoDS_Shape& lastCap, SideList& sides) {
    BRepOffsetAPI_MakePipeShell pipe(spine);
    if (!auxiliary.IsNull()) {
      pipe.SetMode(auxiliary, false, BRepFill_NoContact);
    } else if (mode == 1) {
      pipe.SetMode(parallel);
    } else if (mode == 2) {
      pipe.SetMode(fixed);
    } else {
      pipe.SetMode(false);
    }
    pipe.SetTransitionMode(BRepBuilderAPI_RightCorner);
    if (std::abs(scale - 1) > 1e-9) {
      double from = 0;
      double to = 1;
      lawRange(spine, from, to);
      Handle(Law_Linear) law = new Law_Linear();
      law->Set(from, 1.0, to, scale);
      pipe.SetLaw(section, law, false, false);
    } else {
      pipe.Add(section, false, false);
    }
    if (!pipe.IsReady()) return 1;
    pipe.Build();
    if (!pipe.IsDone()) return 1;
    if (!pipe.MakeSolid()) return 1;
    solid = pipe.Shape();
    if (solid.ShapeType() == TopAbs_SOLID) {
      TopoDS_Solid oriented = TopoDS::Solid(solid);
      BRepLib::OrientClosedSolid(oriented);
      solid = oriented;
    }
    if (!(volumeOf(solid) > 0)) return 2;
    firstCap = pipe.FirstShape();
    lastCap = pipe.LastShape();
    for (TopExp_Explorer e(section, TopAbs_EDGE); e.More(); e.Next()) {
      std::vector<TopoDS_Shape> list;
      for (const TopoDS_Shape& s : pipe.Generated(e.Current())) {
        if (s.ShapeType() == TopAbs_FACE) list.push_back(s);
      }
      sides.emplace_back(e.Current(), std::move(list));
    }
    return 0;
  }

  /** The parameter range a scale law runs over along `spine` (see the harness's law test). */
  static void lawRange(const TopoDS_Wire& spine, double& from, double& to) {
    BRepAdaptor_CompCurve curve(spine);
    from = curve.FirstParameter();
    to = curve.LastParameter();
  }

  /**
   * Whether a sweep along `wire` of a profile reaching `reach` from its start
   * could cross itself: a bend tighter than the reach, a corner, or the path
   * coming back within twice the reach of itself. Cheap and conservative:
   * only a "yes" is worth the slow `crossesItself`.
   */
  static bool sweepMayCross(const TopoDS_Wire& wire, double reach) {
    if (!smoothWire(wire)) return true;
    BRepAdaptor_CompCurve curve(wire);
    const int steps = 200;
    GCPnts_QuasiUniformAbscissa spacing(curve, steps + 1);
    if (!spacing.IsDone()) return true;
    std::vector<gp_Pnt> points;
    for (int i = 1; i <= spacing.NbPoints(); ++i) {
      gp_Pnt p;
      gp_Vec d1;
      gp_Vec d2;
      curve.D2(spacing.Parameter(i), p, d1, d2);
      const double speed = d1.Magnitude();
      if (speed > 1e-12 && d1.Crossed(d2).Magnitude() / (speed * speed * speed) * reach > 0.9) return true;
      points.push_back(p);
    }
    double total = 0;
    for (size_t i = 1; i < points.size(); ++i) total += points[i].Distance(points[i - 1]);
    const double step = total / std::max<size_t>(1, points.size() - 1);
    if (!(step > 0)) return false;
    // Parts of the path far apart along it (more than 4 reaches) and close in space.
    const size_t apart = static_cast<size_t>(std::ceil(4 * reach / step)) + 1;
    for (size_t i = 0; i < points.size(); ++i) {
      for (size_t j = i + apart; j < points.size(); ++j) {
        if (points[i].Distance(points[j]) < 2.1 * reach) return true;
      }
    }
    return false;
  }

  /** Whether a shape meets itself where it shouldn't (the argument analyser's self-intersection check). */
  static bool crossesItself(const TopoDS_Shape& shape) {
    size_t faces = 0;
    for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next()) ++faces;
    if (faces > 96) return false;
    BOPAlgo_ArgumentAnalyzer analyzer;
    analyzer.SetShape1(shape);
    analyzer.SelfInterMode() = true;
    analyzer.ArgumentTypeMode() = false;
    analyzer.SmallEdgeMode() = false;
    analyzer.RebuildFaceMode() = false;
    analyzer.TangentMode() = false;
    analyzer.MergeVertexMode() = false;
    analyzer.MergeEdgeMode() = false;
    analyzer.ContinuityMode() = false;
    analyzer.CurveOnSurfaceMode() = false;
    analyzer.SetRunParallel(false);
    analyzer.Perform();
    return analyzer.HasFaulty();
  }

  int sweepStatus(int status, const char* message) {
    geometry_.assign(1, static_cast<double>(status));
    return fail(message);
  }

  int loftStatus(int status, size_t section, const char* message) {
    geometry_.assign({static_cast<double>(status), static_cast<double>(section)});
    return fail(message);
  }

  /** A history record from one sub-shape to the result's faces among `shapes` (none: no record). */
  void recordFaces(int input, int kind, int index, int relation, const std::vector<TopoDS_Shape>& shapes,
                   const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& resultFaces) {
    std::vector<int32_t> pairs;
    for (const TopoDS_Shape& s : shapes) {
      const int found = resultFaces.FindIndex(s);
      if (found <= 0) continue;
      bool seen = false;
      for (size_t k = 1; k < pairs.size(); k += 2) seen = seen || pairs[k] == found - 1;
      if (seen) continue;
      pairs.push_back(0);
      pairs.push_back(found - 1);
    }
    if (pairs.empty()) return;
    pushRecord(input, kind, index, relation);
    history_.push_back(static_cast<int32_t>(pairs.size() / 2));
    history_.insert(history_.end(), pairs.begin(), pairs.end());
  }
};
