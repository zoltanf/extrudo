// SPDX-License-Identifier: LGPL-2.1-or-later
//
// Extrudo's C++ facade over OpenCascade, compiled into our OCCT WASM build
// (see ../libcascade.config.ts and docs/adr/0001-geometry-kernel.md).
//
// Why it exists: every operation that allocates heavily runs here, with its
// builder on the C++ stack, and JS only ever holds integer handles into an
// arena of shapes. Results, history and meshes come back as flat arrays that JS
// copies out of the WASM heap once, and no OCCT type crosses the bindings
// (ADR-0037). It began as the way around libcascade 3.0.x's `delete()`, which
// did not release the memory an OCCT object owns (taucad/opencascade.js#40,
// fixed in toolchain 3.1.0); in 3.1.0 `delete()` frees, which only matters
// here for the facade object itself.
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
#include <BOPAlgo_MakerVolume.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Defeaturing.hxx>
#include <BOPAlgo_Alerts.hxx>
#include <TopoDS_AlertWithShape.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <GeomLib.hxx>
#include <ElSLib.hxx>
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
#include <BRepCheck_Result.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffset_MakeOffset.hxx>
#include <BRepOffset_MakeSimpleOffset.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <IntCurvesFace_Intersector.hxx>
#include <BndLib_Add2dCurve.hxx>
#include <Bnd_Box2d.hxx>
#include <ShapeFix_Solid.hxx>
#include <ShapeFix_Shape.hxx>
#include <BRepBuilderAPI_MakeShapeOnMesh.hxx>
#include <Poly_Triangle.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_TransitionMode.hxx>
#include <BRepFill_CompatibleWires.hxx>
#include <BRepFill_TypeOfContact.hxx>
#include <BRepAdaptor_CompCurve.hxx>
#include <GCPnts_AbscissaPoint.hxx>
#include <GCPnts_QuasiUniformAbscissa.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <Law_Linear.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <Geom_SphericalSurface.hxx>
#include <Geom_ToroidalSurface.hxx>
#include <TopTools_ListOfShape.hxx>
#include <Geom2d_Line.hxx>
#include <Geom2dAPI_Interpolate.hxx>
#include <IntAna_QuadQuadGeo.hxx>
#include <Extrema_ExtPElC.hxx>
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
#include <BRepTools_History.hxx>
#include <BRepTools_ReShape.hxx>
#include <BRepLib.hxx>
#include <BRepLib_MakeEdge.hxx>
#include <BRepTopAdaptor_FClass2d.hxx>
#include <BRepTopAdaptor_TopolTool.hxx>
#include <BRepTopAdaptor_Tool.hxx>
#include <BRepAdaptor_Curve2d.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepGProp_Face.hxx>
#include <Contap_Contour.hxx>
#include <Contap_Line.hxx>
#include <Contap_Point.hxx>
#include <ElCLib.hxx>
#include <HLRAlgo_EdgeIterator.hxx>
#include <HLRAlgo_Projector.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_Data.hxx>
#include <HLRBRep_EdgeData.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
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
#include <Message_ProgressIndicator.hxx>
#include <Message_Report.hxx>
#include <TopoDS_AlertWithShape.hxx>
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
#include <NCollection_DataMap.hxx>
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
#include <ShapeBuild_ReShape.hxx>
#include <ShapeUpgrade_ShapeDivideClosed.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
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
#include <STEPCAFControl_Reader.hxx>
#include <STEPCAFControl_Writer.hxx>
#include <Quantity_Color.hxx>
#include <TDF_Label.hxx>
#include <TDataStd_Name.hxx>
#include <TCollection_AsciiString.hxx>
#include <TCollection_ExtendedString.hxx>
#include <TopLoc_Location.hxx>
#include <TDocStd_Document.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_ColorType.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
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
#include <cstdio>
#include <cstdlib>
#include <exception>
#include <map>
#include <set>
#include <chrono>
#include <memory>
#include <array>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

// Emscripten's stack bounds (emscripten/stack.h, which the bindings step can't
// see): the stack's highest address and its lowest, which it grows down to.
extern "C" uintptr_t emscripten_stack_get_base(void);
extern "C" uintptr_t emscripten_stack_get_end(void);

class ExtrudoFacade {
public:
  ExtrudoFacade() : nextHandle_(1) { armStackGuard(); }

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

  /**
   * Whether one of `shape`'s edges is a rational curve: a sketch conic, staged
   * exactly by sketchConic (P4-12, ADR-0063's amendment), or a rational
   * B-spline from a STEP file. OCCT's fixed Gauss order is exact on lines,
   * circles and polynomial curves but not on a rational one (a hyperbola
   * arc's face area came out 1e-3 out), and the bounded integral of
   * needsTolerance loses a prism's volume to the cancellation described there
   * (5e-3 out at MASS_EPS, 1e-4 at 1e-12). Measured in `spikes/p4-12-conics`:
   * the bounded area and the Gauss–Kronrod volume are exact to 1e-14 on the
   * face and the prism of all three kinds of conic.
   */
  static bool hasRationalCurve(const TopoDS_Shape& shape) {
    for (TopExp_Explorer edge(shape, TopAbs_EDGE); edge.More(); edge.Next()) {
      const TopoDS_Edge& e = TopoDS::Edge(edge.Current());
      if (BRep_Tool::Degenerated(e)) continue;
      BRepAdaptor_Curve curve(e);
      const GeomAbs_CurveType type = curve.GetType();
      if ((type == GeomAbs_BSplineCurve || type == GeomAbs_BezierCurve) && curve.IsRational()) return true;
    }
    return false;
  }

  /** A solid's volume, integrated to MASS_EPS where that is the better form. */
  static void integrateVolume(const TopoDS_Shape& shape, GProp_GProps& props) {
    if (hasRationalCurve(shape)) {
      BRepGProp::VolumePropertiesGK(shape, props, MASS_EPS);
    } else if (needsTolerance(shape)) {
      BRepGProp::VolumeProperties(shape, props, MASS_EPS, false);
    } else {
      BRepGProp::VolumeProperties(shape, props);
    }
  }

  /**
   * The area of a face or shape, on the same rule as `integrateVolume`. With a
   * rational edge it goes face by face: the bounded integral on a face that
   * needs it or is a plane with a rational edge (a conic profile's cap), the
   * fixed order elsewhere, which is exact on the extrusion wall of a conic
   * (where the bounded one is 8e-3 out on a hyperbola arc's).
   */
  static void integrateArea(const TopoDS_Shape& shape, GProp_GProps& props) {
    if (!hasRationalCurve(shape)) {
      if (needsTolerance(shape)) {
        BRepGProp::SurfaceProperties(shape, props, MASS_EPS, false);
      } else {
        BRepGProp::SurfaceProperties(shape, props);
      }
      return;
    }
    for (TopExp_Explorer face(shape, TopAbs_FACE); face.More(); face.Next()) {
      GProp_GProps one;
      BRepAdaptor_Surface surface(TopoDS::Face(face.Current()), false);
      if (needsTolerance(face.Current()) ||
          (surface.GetType() == GeomAbs_Plane && hasRationalCurve(face.Current()))) {
        BRepGProp::SurfaceProperties(face.Current(), one, MASS_EPS, false);
      } else {
        BRepGProp::SurfaceProperties(face.Current(), one);
      }
      props.Add(one);
    }
  }

  /**
   * The length properties of edges. OCCT's LinearProperties has no error
   * bound (it integrates with a fixed order whatever the curve; P4-12 H3's
   * MASS_EPS reached its `SkipShared` flag, which is kept as it was), so the
   * length of a rational edge comes from `edgesLength`.
   */
  static void integrateLength(const TopoDS_Shape& shape, GProp_GProps& props) {
    BRepGProp::LinearProperties(shape, props, needsTolerance(shape));
  }

  /**
   * One edge's length: the adaptive arc length for a rational curve, where
   * LinearProperties' fixed order is 8e-3 out on a hyperbola arc (P4-12,
   * ADR-0063's amendment), else `fixed`, the length LinearProperties gave.
   */
  static double edgeLength(const TopoDS_Edge& edge, double fixed) {
    if (BRep_Tool::Degenerated(edge)) return fixed;
    BRepAdaptor_Curve curve(edge);
    const GeomAbs_CurveType type = curve.GetType();
    if ((type != GeomAbs_BSplineCurve && type != GeomAbs_BezierCurve) || !curve.IsRational()) return fixed;
    const double length = GCPnts_AbscissaPoint::Length(curve, 1e-10);
    return length > 0 ? length : fixed;
  }

  /** The length of a shape's edges, each counted once, as `edgeLength` gives it. */
  static double edgesLength(const TopoDS_Shape& shape, const GProp_GProps& props) {
    if (!hasRationalCurve(shape)) return props.Mass();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(shape, TopAbs_EDGE, edges);
    double total = 0;
    for (int i = 1; i <= edges.Extent(); ++i) {
      GProp_GProps one;
      BRepGProp::LinearProperties(edges(i), one);
      total += edgeLength(TopoDS::Edge(edges(i)), one.Mass());
    }
    return total;
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

  void clearArgs() {
    args_.clear();
    blends_.clear();
  }
  void pushArg(int value) { args_.push_back(value); }
  /** A round offsetFaces re-makes at its radius rather than offsetting it (cleared by clearArgs). */
  void pushBlend(int face) { blends_.push_back(face); }
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
   * Rounds staged with pushBlend (constant-radius cylinder or torus faces a
   * fillet made) are not offset with the faces they run into: they are
   * removed, the picked faces moved, and the rounds made again at their own
   * radius between the moved faces and their other neighbours (ADR-0051's
   * amendment, 2026-10-14), so a 3 mm round stays a 3 mm round and the
   * faces past it stay where they are. Each re-made round's face is
   * recorded as modified from the old one, so it keeps its name. When that
   * can't be built, the plain offset above is tried as before.
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
      std::vector<int> blends;
      for (int index : blends_) {
        if (index < 0 || index >= faces.Extent()) return fail("Offset failed: face index out of range.");
        if (std::find(picked.begin(), picked.end(), index) == picked.end() &&
            std::find(blends.begin(), blends.end(), index) == blends.end()) {
          blends.push_back(index);
        }
      }
      blends_.clear();
      if (!blends.empty()) {
        const TopoDS_Shape copy = BRepBuilderAPI_Copy(*input, true, false).Shape();
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> copyFaces;
        TopExp::MapShapes(copy, TopAbs_FACE, copyFaces);
        if (copyFaces.Extent() == faces.Extent()) {
          ReblendedOffset reblended;
          TopoDS_Shape result;
          if (buildReblendedOffset(reblended, copy, copyFaces, picked, blends, distance, result)) {
            recordHistory(reblended, copy, 0, result);
            return store(result);
          }
        }
      }
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
      if (hasSeam(*input)) {
        const TopoDS_Shape copy = BRepBuilderAPI_Copy(*input, true, false).Shape();
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> copyFaces;
        TopExp::MapShapes(copy, TopAbs_FACE, copyFaces);
        if (copyFaces.Extent() == faces.Extent()) {
          DividedOffset divided;
          TopoDS_Shape result;
          if (buildDividedOffset(divided, copy, copyFaces, picked, moving, distance, result)) {
            recordHistory(divided, copy, 0, result);
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
   * Removes faces from a solid (ADR-0099, Remove Faces): the faces staged
   * with pushArg (0-based indices, duplicates ignored) go, and their
   * neighbours are extended or trimmed until they meet
   * (BRepAlgoAPI_Defeaturing), so a hole closes up and a round becomes a
   * sharp edge. All or nothing: any warning refuses the step, never a part
   * of the pick. The result must be one valid solid without any picked face.
   * No UnifySameDomain afterwards: it would rename the faces. History for
   * input 0 is the builder's: picked faces deleted, neighbours modified.
   *
   * On failure it returns 0 with a message in lastError(), and lookupPtr /
   * lookupSize list the picked faces (indices) of the features OCCT could
   * not remove (BOPAlgo_AlertUnableToRemoveTheFeature), empty when it
   * didn't say.
   */
  int removeFaces(int shape) {
    beginOp();
    lookup_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Remove Faces failed: unknown input shape.");
    try {
      // A copy, as in offsetFaces(): the boolean tools may repair their input in place.
      const TopoDS_Shape copy = BRepBuilderAPI_Copy(*input, true, false).Shape();
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(copy, TopAbs_FACE, faces);
      std::vector<int> picked;
      for (int index : args_) {
        if (index < 0 || index >= faces.Extent()) return fail("Remove Faces failed: face index out of range.");
        if (std::find(picked.begin(), picked.end(), index) == picked.end()) picked.push_back(index);
      }
      if (picked.empty()) return fail("Remove Faces failed: no face to remove.");
      if (static_cast<int>(picked.size()) >= faces.Extent()) return fail("Remove Faces failed: that is every face.");
      BRepAlgoAPI_Defeaturing builder;
      builder.SetShape(copy);
      for (int index : picked) builder.AddFaceToRemove(faces(index + 1));
      builder.SetToFillHistory(true);
      builder.SetRunParallel(false);
      builder.Build();
      if (builder.HasWarnings()) {
        for (const Handle(Message_Alert)& alert : builder.GetReport()->GetAlerts(Message_Warning)) {
          if (!alert->IsKind(STANDARD_TYPE(BOPAlgo_AlertUnableToRemoveTheFeature))) continue;
          const Handle(TopoDS_AlertWithShape) withShape = Handle(TopoDS_AlertWithShape)::DownCast(alert);
          if (withShape.IsNull()) continue;
          for (TopExp_Explorer it(withShape->GetShape(), TopAbs_FACE); it.More(); it.Next()) {
            const int index = faces.FindIndex(it.Current()) - 1;
            if (index >= 0 && std::find(lookup_.begin(), lookup_.end(), index) == lookup_.end()) {
              lookup_.push_back(index);
            }
          }
        }
        return fail("Remove Faces failed: OCCT could not close the gap the faces leave.");
      }
      if (!builder.IsDone() || builder.HasErrors()) {
        return fail("Remove Faces failed: OCCT could not remove the faces.");
      }
      int solids = 0;
      for (TopExp_Explorer it(builder.Shape(), TopAbs_SOLID); it.More(); it.Next()) ++solids;
      const TopoDS_Shape result = solids == 1 ? asSolid(builder.Shape()) : TopoDS_Shape();
      if (result.IsNull() || !BRepCheck_Analyzer(result).IsValid()) {
        return fail("Remove Faces failed: the result isn't one sound solid.");
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> after;
      TopExp::MapShapes(result, TopAbs_FACE, after);
      for (int index : picked) {
        if (after.Contains(faces(index + 1))) return fail("Remove Faces failed: a face stayed.");
      }
      recordHistory(builder, copy, 0, result);
      return store(result);
    } catch (...) {
      lookup_.clear();
      return failFromException("Remove Faces failed");
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
   * cylinders cones. A profile with an ellipse or B-spline side goes through
   * `taperLoft` instead (P4-12). The history is that of the straight sweep
   * carried through the taper, so side faces keep their sources.
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
      // A side made from an ellipse or a B-spline can't be tilted by DraftAngle
      // (P4-12): offset the profile and loft a ruled solid instead.
      if (taperNeedsLoft(builder, base)) return taperLoft(base, along, taper);
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

  // ------------------------------------------------------- pose proximity --
  //
  // A joint's clearance check (P6-05 J3, ADR-0081's J3 amendment) measures the
  // same two bodies at many poses of one of them. A session keeps what doesn't
  // change between poses: every face of both shapes in its own frame with the
  // box round it, and solid classifiers made the first time a containment
  // needs one. A pose moves the queries, not the shape: a moving face is
  // measured through a location (no copy), its box as an oriented box.

  /**
   * Opens a pose-proximity session for `moving` and `other` (two shapes that
   * stay alive for it anyway: the session holds its own references), with
   * `search` the distance in mm beyond which nothing needs an exact answer.
   * Returns the session's id (> 0), or 0 and lastError().
   */
  int proximityOpen(int moving, int other, double search) {
    beginOp();
    const TopoDS_Shape* sm = find(moving);
    const TopoDS_Shape* so = find(other);
    if (sm == nullptr || so == nullptr) return fail("Proximity failed: unknown shape.");
    if (!(search > 0)) return fail("Proximity failed: the search distance must be above 0.");
    try {
      ProximitySession session;
      session.search = search;
      proximityFaces(*sm, session.moving);
      proximityFaces(*so, session.other);
      // Several faces may move together (a moving body of many faces), so the
      // moved triangles are kept per face for the pose that made them.
      for (ProximityFace& f : session.moving) f.pose = -1;
      proximitySolids(*sm, session.movingSolids);
      proximitySolids(*so, session.otherSolids);
      const int id = nextProximity_++;
      proximity_.emplace(id, std::move(session));
      return id;
    } catch (...) {
      return failFromException("Proximity failed");
    }
  }

  /**
   * The smallest distance between `moving` placed by the staged matrix (12
   * numbers as transform() takes them; a move or a turn) and `other`: 0 where
   * they touch, cross or one lies inside a solid of the other, capped at the
   * session's search distance (which then means "nothing within it"). -1 on
   * failure.
   *
   * geometryNumbers, under the search distance only: [from xyz on the placed
   * moving shape, to xyz on other, moving face index, other face index] (a
   * face index is -1 where one solid inside the other decided it).
   *
   * Exact: boxes only pick the face pairs, nearest first. Every pair whose box
   * bound is under the best distance so far is measured face to face with
   * BRepExtrema, so the answer is that of distance() on a moved copy.
   */
  double proximityPose(int id) {
    beginOp();
    geometry_.clear();
    auto found = proximity_.find(id);
    if (found == proximity_.end()) {
      fail("Proximity failed: unknown session.");
      return -1;
    }
    if (numbers_.size() != 12) {
      fail("Proximity failed: the pose needs 12 numbers.");
      return -1;
    }
    ProximitySession& s = found->second;
    try {
      const std::vector<double>& m = numbers_;
      gp_Trsf trsf;
      trsf.SetValues(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]);
      if (std::abs(trsf.ScaleFactor() - 1.0) > 1e-9) {
        fail("Proximity failed: a pose only moves and turns.");
        return -1;
      }
      const TopLoc_Location location(trsf);
      // Rotation columns: the moved box's axes.
      double axes[3][3];
      for (int k = 0; k < 3; ++k) {
        for (int j = 0; j < 3; ++j) axes[k][j] = m[4 * j + k];
      }
      ++s.pose;
      // Candidates: every pair whose box bound is under the search distance,
      // then bounded again by their triangles.
      std::vector<std::pair<double, std::pair<int, int>>> pairs;
      std::vector<std::array<double, 3>> centres(s.moving.size());
      for (size_t i = 0; i < s.moving.size(); ++i) {
        const ProximityFace& f = s.moving[i];
        gp_Pnt c(f.centre[0], f.centre[1], f.centre[2]);
        c.Transform(trsf);
        centres[i] = {c.X(), c.Y(), c.Z()};
      }
      for (size_t i = 0; i < s.moving.size(); ++i) {
        const ProximityFace& a = s.moving[i];
        for (size_t j = 0; j < s.other.size(); ++j) {
          const ProximityFace& b = s.other[j];
          const double bound = proximityBound(centres[i].data(), axes, a.half, b.centre, b.half);
          if (bound < s.search) pairs.push_back({bound, {static_cast<int>(i), static_cast<int>(j)}});
        }
      }
      std::sort(pairs.begin(), pairs.end());
      double best = s.search;
      int bestA = -1;
      int bestB = -1;
      gp_Pnt from;
      gp_Pnt to;
      const auto exact = [&](int i, int j) {
        const ProximityFace& a = s.moving[i];
        const ProximityFace& b = s.other[j];
        BRepExtrema_DistShapeShape measure(a.face.Moved(location), b.face, Extrema_ExtFlag_MIN);
        if (!measure.IsDone() || measure.NbSolution() == 0) return;
        const double d = measure.Value();
        if (d < best) {
          best = d;
          bestA = i;
          bestB = j;
          from = measure.PointOnShape1(1);
          to = measure.PointOnShape2(1);
        }
      };
      const auto placed = [&](ProximityFace& a) -> const std::vector<ProximityTriangle>& {
        if (a.pose != s.pose) {
          a.placed = a.triangles;
          for (ProximityTriangle& t : a.placed) proximityMove(t, trsf);
          a.pose = s.pose;
        }
        return a.placed;
      };
      // The pair nearest at the last pose first: poses come in small steps,
      // so it is usually nearest again, and its distance prunes the rest.
      const std::pair<int, int> seed = s.last;
      bool seeded = false;
      for (const auto& [bound, pair] : pairs) {
        if (pair == seed) {
          exact(pair.first, pair.second);
          seeded = true;
          break;
        }
      }
      // Bound the rest by their triangles, nearest boxes first, each pair only
      // as far as the best distance so far needs.
      std::vector<std::pair<double, std::pair<int, int>>> near;
      // A pair can only matter if it may be nearer than the best by more than
      // this (mm): under the 1e-6 the answer is held to, and over what a flat
      // pair's bound falls short of its distance by (both faces' tolerances).
      const double tie = 5e-7;
      for (const auto& [bound, pair] : pairs) {
        if (bound >= best - tie || best <= Precision::Confusion()) break;
        if (seeded && pair == seed) continue;
        ProximityFace& a = s.moving[pair.first];
        const ProximityFace& b = s.other[pair.second];
        double tight = bound;
        if (!a.triangles.empty() && !b.triangles.empty()) {
          const double slack = a.deflection + b.deflection;
          tight = std::max(bound, proximityMeshDistance(placed(a), b.triangles, best + slack) - slack);
        }
        if (tight < best - tie) near.push_back({tight, pair});
      }
      std::sort(near.begin(), near.end());
      for (const auto& [bound, pair] : near) {
        if (bound >= best - tie || best <= Precision::Confusion()) break;
        exact(pair.first, pair.second);
      }
      if (bestA >= 0) s.last = {bestA, bestB};
      if (bestA >= 0) {
        bestA = s.moving[bestA].index;
        bestB = s.other[bestB].index;
      }
      // No face within reach of another, yet one solid may hold the other.
      if (best > Precision::Confusion()) {
        gp_Pnt inner;
        if (proximityInside(s, trsf, inner)) {
          best = 0;
          bestA = -1;
          bestB = -1;
          from = inner;
          to = inner;
        } else if (best >= s.search) {
          return s.search;
        }
      }
      pushPoint(from);
      pushPoint(to);
      geometry_.push_back(bestA);
      geometry_.push_back(bestB);
      return best;
    } catch (...) {
      failFromException("Proximity failed");
      return -1;
    }
  }

  /** Frees a session (an unknown id is ignored). */
  void proximityClose(int id) { proximity_.erase(id); }

  /** Open sessions: a leak shows here. */
  int proximitySessions() const { return static_cast<int>(proximity_.size()); }

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
   * The silhouettes of face `face` of a shape seen along (dx, dy, dz): the
   * curves on the face where its normal is square to the view, visible and
   * hidden alike, clipped to the face, as exact 3D curves on the surface
   * (P2-09; every surface since P4-12, ADR-0031's amendment). A cylinder or
   * cone gives straight lines in closed form; a sphere, a torus and every
   * other curved surface go through OCCT's contour finder (TKHLR's
   * Contap_Contour, the one HLRBRep_Algo runs per face for its outlines):
   * its lines and circles stay exact, and a walked contour comes back as the
   * walk's own points, which lie on the surface. A contour that runs along a
   * seam or along an edge where the face meets a neighbour smoothly is that
   * edge; one along any other boundary edge is left out (the edge itself is
   * an outline). Planes have none. `deflection` (mm) bounds the chord of a
   * polyline sampled from an edge. Returns the number of pieces, or -1.
   *
   * geometryNumbers, per piece (shared with sectionWithPlane):
   *   [0, start xyz, end xyz]                                 a line segment
   *   [1, center xyz, axis xyz, x xyz, radius, first, last]   a circle arc,
   *       counter-clockwise about the axis from angle `first` to `last`
   *       (from the x direction; last - first = 2π for a whole circle)
   *   [2, n, xyz × n]                                         a polyline
   *   [3, center xyz, axis xyz, x xyz, major, minor, first, last]  an ellipse arc
   */
  int faceSilhouettes(int shape, int face, double dx, double dy, double dz, double deflection) {
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
      TopoDS_Face f = TopoDS::Face(faces(face + 1));
      BRepAdaptor_Surface surface(f);
      const GeomAbs_SurfaceType type = surface.GetType();
      if (type == GeomAbs_Plane) return 0;
      if (type == GeomAbs_Cylinder || type == GeomAbs_Cone) {
        return ruledSilhouettes(f, surface, gp_Dir(view));
      }
      return contourSilhouettes(*s, f, gp_Dir(view), deflection);
    } catch (...) {
      geometry_.clear();
      failFromException("Silhouette failed");
      return -1;
    }
  }

  /**
   * The curves where a shape meets a plane (P4-12, Intersect: ADR-0031's
   * amendment): BRepAlgoAPI_Section of the shape with the plane through
   * (ox, oy, oz) square to (nx, ny, nz). Lines, circles and ellipses come
   * back exact, anything else as a polyline within `deflection` (mm), in
   * faceSilhouettes' encoding. Returns the number of pieces, or -1.
   */
  int sectionWithPlane(int shape, double ox, double oy, double oz, double nx, double ny,
                       double nz, double deflection) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) {
      fail("Unknown shape.");
      return -1;
    }
    try {
      const gp_Vec normal(nx, ny, nz);
      if (normal.Magnitude() <= Precision::Confusion()) {
        fail("The plane's normal has no length.");
        return -1;
      }
      const gp_Pln plane(gp_Pnt(ox, oy, oz), gp_Dir(normal));
      BRepAlgoAPI_Section section(*s, plane, false);
      section.Approximation(false);
      section.ComputePCurveOn1(false);
      section.Build();
      if (!section.IsDone()) {
        fail("The section failed.");
        return -1;
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(section.Shape(), TopAbs_EDGE, edges);
      int pieces = 0;
      for (int i = 1; i <= edges.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(edges(i));
        if (BRep_Tool::Degenerated(e)) continue;
        BRepAdaptor_Curve curve(e);
        pieces += pushCurvePiece(curve, curve.FirstParameter(), curve.LastParameter(), deflection);
      }
      return pieces;
    } catch (...) {
      geometry_.clear();
      failFromException("Section failed");
      return -1;
    }
  }

  /**
   * Where two faces meet a plane (P4-12, a point at the intersection of two
   * curved faces and a plane: ADR-0040's addendum). With `faceB >= 0` the
   * curve is BRepAlgoAPI_Section of the two faces and the cut is the plane
   * through (aox, aoy, aoz) square to (anx, any, anz) (plane B is ignored);
   * with `faceB < 0` the curve is the section of faceA with plane A and the
   * cut is plane B. The curve's edges go into a compound and every vertex
   * where the compound meets the cut plane comes back, deduplicated within
   * Precision::Confusion(). geometryNumbers: the points xyz. Returns the
   * number of points (0 when the first section has no edge), or -1.
   */
  int facesMeetPlane(int faceA, int faceB, double aox, double aoy, double aoz, double anx, double any,
                     double anz, double box, double boy, double boz, double bnx, double bny,
                     double bnz) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* a = find(faceA);
    if (a == nullptr) {
      fail("Unknown shape.");
      return -1;
    }
    try {
      const gp_Vec normalA(anx, any, anz);
      if (normalA.Magnitude() <= Precision::Confusion()) {
        fail("The plane's normal has no length.");
        return -1;
      }
      const gp_Vec normalB(bnx, bny, bnz);
      if (normalB.Magnitude() <= Precision::Confusion()) {
        fail("The plane's normal has no length.");
        return -1;
      }
      const gp_Pln planeA(gp_Pnt(aox, aoy, aoz), gp_Dir(normalA));
      const gp_Pln planeB(gp_Pnt(box, boy, boz), gp_Dir(normalB));
      TopoDS_Shape curve;
      if (faceB >= 0) {
        const TopoDS_Shape* b = find(faceB);
        if (b == nullptr) {
          fail("Unknown shape.");
          return -1;
        }
        BRepAlgoAPI_Section section(*a, *b, false);
        section.Approximation(false);
        section.ComputePCurveOn1(false);
        section.ComputePCurveOn2(false);
        section.Build();
        if (!section.IsDone()) {
          fail("The faces don't meet.");
          return -1;
        }
        curve = section.Shape();
      } else {
        BRepAlgoAPI_Section section(*a, planeA, false);
        section.Approximation(false);
        section.ComputePCurveOn1(false);
        section.Build();
        if (!section.IsDone()) {
          fail("The section failed.");
          return -1;
        }
        curve = section.Shape();
      }
      // The curve may be several edges: put them in a compound and cut it.
      TopoDS_Compound compound;
      BRep_Builder builder;
      builder.MakeCompound(compound);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> curveEdges;
      TopExp::MapShapes(curve, TopAbs_EDGE, curveEdges);
      int edges = 0;
      for (int i = 1; i <= curveEdges.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(curveEdges(i));
        if (BRep_Tool::Degenerated(e)) continue;
        builder.Add(compound, e);
        ++edges;
      }
      if (edges == 0) return 0;
      const gp_Pln& cut = faceB >= 0 ? planeA : planeB;
      BRepAlgoAPI_Section section(compound, cut, false);
      section.Approximation(false);
      section.ComputePCurveOn1(false);
      section.Build();
      if (!section.IsDone()) {
        fail("The section failed.");
        return -1;
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices;
      TopExp::MapShapes(section.Shape(), TopAbs_VERTEX, vertices);
      int count = 0;
      for (int i = 1; i <= vertices.Extent(); ++i) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vertices(i)));
        bool seen = false;
        for (int k = 0; k < count; ++k) {
          const gp_Pnt q(geometry_[3 * k], geometry_[3 * k + 1], geometry_[3 * k + 2]);
          if (p.Distance(q) <= Precision::Confusion()) {
            seen = true;
            break;
          }
        }
        if (seen) continue;
        pushPoint(p);
        ++count;
      }
      return count;
    } catch (...) {
      geometry_.clear();
      failFromException("Section failed");
      return -1;
    }
  }

  /**
   * Which edges of a shape are seen along (dx, dy, dz) (P4-12, projecting a
   * body: ADR-0031's amendment), through OCCT's hidden-line removal
   * (HLRBRep_Algo) looking from the side the vector points to, so a sketch's
   * Look At sees what the sketch projects. Returns the number of edges
   * (MapShapes order), or -1. geometryNumbers: one flag sum per edge,
   * 1 = some of it is visible, 2 = an outline (its two faces, at its middle,
   * face opposite ways along the view), 4 = sharp (its faces don't meet
   * smoothly, and it is no seam).
   */
  int edgeVisibility(int shape, double dx, double dy, double dz) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* s = find(shape);
    if (s == nullptr) {
      fail("Unknown shape.");
      return -1;
    }
    try {
      const gp_Vec view(dx, dy, dz);
      if (view.Magnitude() <= Precision::Confusion()) {
        fail("The view direction has no length.");
        return -1;
      }
      const gp_Dir d(view);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
      TopExp::MapShapes(*s, TopAbs_EDGE, edges);
      NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>
          edgeFaces;
      TopExp::MapShapesAndUniqueAncestors(*s, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
      std::vector<double> flags(edges.Extent(), 0.0);
      for (int i = 1; i <= edges.Extent(); ++i) {
        const TopoDS_Edge e = TopoDS::Edge(edges(i));
        if (BRep_Tool::Degenerated(e) || !edgeFaces.Contains(e)) continue;
        const NCollection_List<TopoDS_Shape>& around = edgeFaces.FindFromKey(e);
        if (around.Extent() != 2) continue;
        const TopoDS_Face f1 = TopoDS::Face(around.First());
        const TopoDS_Face f2 = TopoDS::Face(around.Last());
        if (BRep_Tool::Continuity(e, f1, f2) < GeomAbs_G1) flags[i - 1] += 4;
        double a = 0, b = 0;
        if (normalAlong(e, f1, d, a) && normalAlong(e, f2, d, b) &&
            ((a > 1e-9 && b < -1e-9) || (a < -1e-9 && b > 1e-9))) {
          flags[i - 1] += 2;
        }
      }
      // HLR's eye is on the +Z side of its frame, looking down -Z: the view vector's side.
      HLRAlgo_Projector projector(gp_Ax2(gp_Pnt(0, 0, 0), d));
      occ::handle<HLRBRep_Algo> algo = new HLRBRep_Algo();
      algo->Add(*s, 0);
      algo->Projector(projector);
      algo->Update();
      algo->Hide();
      occ::handle<HLRBRep_Data> data = algo->DataStructure();
      if (!data.IsNull()) {
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& hlrEdges = data->EdgeMap();
        for (int ie = 1; ie <= hlrEdges.Extent(); ++ie) {
          const int i = edges.FindIndex(hlrEdges(ie));
          if (i == 0 || (static_cast<int>(flags[i - 1]) & 1)) continue;
          HLRBRep_EdgeData& ed = data->EDataArray().ChangeValue(ie);
          HLRAlgo_EdgeIterator it;
          for (it.InitVisible(ed.Status()); it.MoreVisible(); it.NextVisible()) {
            double sta = 0, end = 0;
            float tolsta = 0, tolend = 0;
            it.Visible(sta, tolsta, end, tolend);
            if (std::abs(end - sta) > Precision::PConfusion()) {
              flags[i - 1] += 1;
              break;
            }
          }
        }
      }
      geometry_ = flags;
      return edges.Extent();
    } catch (...) {
      geometry_.clear();
      failFromException("Visibility failed");
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
   * A sketch conic exactly (P4-12, ADR-0063's amendment): the rational
   * quadratic Bézier with poles start, shoulder, end and weights
   * (1, rho / (1 − rho), 1), as a degree-2 B-spline with knots [0, 1] of
   * multiplicity 3. Below rho 0.5 an ellipse arc, 0.5 a parabola, above a
   * hyperbola arc. A conic arc can't cross itself, so it is one edge; a
   * shoulder on the chord is the straight curve the cubic route made too.
   */
  int sketchConic(double x0, double y0, double xs, double ys, double x1, double y1, double rho) {
    beginOp();
    try {
      if (!(rho > 0 && rho < 1)) return failCurve("The conic's rho must lie between 0 and 1.");
      const gp_Pnt start(x0, y0, 0);
      const gp_Pnt shoulder(xs, ys, 0);
      const gp_Pnt end(x1, y1, 0);
      if (start.Distance(end) <= Precision::Confusion()) return failCurve("The conic has no length.");
      NCollection_Array1<gp_Pnt> poles(1, 3);
      poles(1) = start;
      poles(2) = shoulder;
      poles(3) = end;
      NCollection_Array1<double> weights(1, 3);
      weights(1) = 1;
      weights(2) = rho / (1 - rho);
      weights(3) = 1;
      NCollection_Array1<double> knots(1, 2);
      knots(1) = 0;
      knots(2) = 1;
      NCollection_Array1<int> mults(1, 2);
      mults(1) = 3;
      mults(2) = 3;
      Handle(Geom_BSplineCurve) curve = new Geom_BSplineCurve(poles, weights, knots, mults, 2);
      BRepBuilderAPI_MakeEdge builder(curve);
      if (!builder.IsDone()) return failCurve("Couldn't make an edge from the conic.");
      return addSketchEdge(builder.Edge());
    } catch (...) {
      failFromException("Conic failed");
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
        measured_[8] = edgesLength(*s, props);
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
   * Colours the shapes of the next writeStep() in order (P4-12, ADR-0034's
   * amendment): one stageStepColor() per shape, r, g and b in 0..1 (sRGB, as
   * STEP's COLOUR_RGB holds them), or -1 for a shape without a colour.
   */
  void clearStepColors() { stepColors_.clear(); }
  void stageStepColor(double r, double g, double b) {
    stepColors_.push_back(r);
    stepColors_.push_back(g);
    stepColors_.push_back(b);
  }

  /**
   * Groups the shapes of the next writeStep() into assemblies (P6-05,
   * ADR-0081 §7): one pushStepGroup() per shape, the index of its group or -1
   * for none, and one pushStepGroupName() per group index, in order (a STEP
   * string, as pushStepName()'s).
   */
  void clearStepGroups() {
    stepGroups_.clear();
    stepGroupNames_.clear();
  }
  void pushStepGroup(int group) { stepGroups_.push_back(group); }
  void pushStepGroupName(const char* name) {
    stepGroupNames_.emplace_back(name == nullptr ? "" : name);
  }

  /**
   * Writes the shapes staged with clearArgs()/pushArg() as one STEP AP242
   * file in millimetres, each shape a product named by pushStepName() (a
   * missing or empty name leaves OCCT's "Product <n>"). Names are STEP strings: encode
   * non-ASCII characters as \X2\…\X0\ first. When stageStepColor() gave some
   * shape a colour, the file is written through XDE (STEPCAFControl_Writer)
   * with each coloured solid's colour as a styled item; with none it is
   * STEPControl_Writer's, exactly as before. When pushStepGroup() put some
   * shape in a group, each group is an assembly product of its parts
   * (writeStepAssembly()). Read the text with
   * exportTextPtr/Size. Returns its length in bytes, or -1.
   */
  int writeStep() {
    beginOp();
    clearExport();
    quietMessages();
    try {
      for (size_t i = 0; i < args_.size(); ++i) {
        if (find(args_[i]) == nullptr) return failExport("STEP export failed: unknown shape.");
      }
      if (stepGrouped()) return writeStepAssembly();
      if (stepColored()) return writeStepXde();
      STEPControl_Writer writer;
      int scanned = 0;
      for (size_t i = 0; i < args_.size(); ++i) {
        if (writer.Transfer(*find(args_[i]), STEPControl_AsIs, stepParameters()) != IFSelect_RetDone) {
          return failExport("STEP export failed: a body couldn't be translated.");
        }
        nameStepProduct(writer.Model(), scanned, i);
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

  // ---------------------------------------------------------- mesh to solid --

  /**
   * Mesh to Solid's input buffers (ADR-0097 §3), written in place by the
   * kernel right after it reads each pointer: nodes as x, y, z doubles,
   * triangles as three 0-based uint32 node indices each, facing outward.
   * Returns 1, or 0 for a count out of range.
   */
  int meshNodes(int count) {
    if (count <= 0 || count > 3000000) return fail("Mesh to Solid failed: the mesh has too many or no nodes.");
    clearMeshRegions();
    meshNodes_.assign(3 * static_cast<size_t>(count), 0.0);
    return 1;
  }
  uintptr_t meshNodesPtr() const { return reinterpret_cast<uintptr_t>(meshNodes_.data()); }

  int meshTriangles(int count) {
    if (count <= 0 || count > 1000000) return fail("Mesh to Solid failed: the mesh has too many or no triangles.");
    meshTriangles_.assign(3 * static_cast<size_t>(count), 0u);
    return 1;
  }
  uintptr_t meshTrianglesPtr() const { return reinterpret_cast<uintptr_t>(meshTriangles_.data()); }

  /**
   * Turns the staged mesh into a solid (ADR-0097 §3). method 0 = faceted (one
   * planar face per coplanar patch), 1 = prismatic (exact planes, cylinders,
   * cones, spheres and tori). A tolerance of 0 or less means Auto (slice D2).
   * Frees the input buffers either way. Returns a handle, or 0;
   * the report (meshReportPtr/Size) is filled on success, and by prismatic
   * on a refusal after segmentation too.
   */
  int meshToSolid(int method, double tolerance) {
    beginOp();
    meshReport_.clear();
    const int handle = method == 0   ? facetedFromMesh()
                       : method == 1 ? prismaticFromMesh(tolerance)
                                     : fail("Mesh to Solid failed: unknown method.");
    meshNodes_.clear();
    meshNodes_.shrink_to_fit();
    meshTriangles_.clear();
    meshTriangles_.shrink_to_fit();
    return handle;
  }

  /**
   * Mesh to Solid's region preview (ADR-0097 §5 and its 2026-10-22
   * amendment): prismatic's segmentation and fits over the staged mesh, no
   * solid. Fills meshReport_ as a refusal would (faces 0), one surface index
   * per triangle (meshRegionsPtr, int32, in the staged triangle order) and
   * one kind per surface (meshRegionKindsPtr, int32: 0 plane, 1 cylinder,
   * 2 cone, 3 sphere, 4 torus, -1 unfit). Frees the input buffers. Returns 1,
   * or 0 with lastError for a bad tolerance or an empty or inconsistent
   * mesh. The region buffers live until clearMeshRegions, the next
   * meshNodes or the next meshRegions.
   */
  int meshRegions(double tolerance) {
    beginOp();
    meshReport_.clear();
    clearMeshRegions();
    int ok = 0;
    try {
      MeshSegmentation seg;
      double chosen = tolerance;
      // A tolerance of 0 or less means Auto (ADR-0097, slice D2).
      const bool segmented =
          tolerance <= 0 ? meshAutoTolerance(chosen, seg) : segmentMesh(tolerance, seg);
      if (segmented) {
        meshRegionOf_.assign(seg.regionOf.size(), -1);
        meshRegionKinds_.resize(seg.surfaces.size());
        for (size_t s = 0; s < seg.surfaces.size(); ++s) {
          meshRegionKinds_[s] = seg.surfaces[s].kind;
          for (int r : seg.surfaces[s].regions)
            for (int t : seg.regions[r].triangles) meshRegionOf_[t] = static_cast<int32_t>(s);
        }
        ok = 1;
      }
    } catch (...) {
      ok = failFromException("Mesh to Solid failed");
    }
    meshNodes_.clear();
    meshNodes_.shrink_to_fit();
    meshTriangles_.clear();
    meshTriangles_.shrink_to_fit();
    return ok;
  }

  uintptr_t meshRegionsPtr() const { return reinterpret_cast<uintptr_t>(meshRegionOf_.data()); }
  int meshRegionTriangles() const { return static_cast<int>(meshRegionOf_.size()); }
  uintptr_t meshRegionKindsPtr() const { return reinterpret_cast<uintptr_t>(meshRegionKinds_.data()); }
  int meshRegionCount() const { return static_cast<int>(meshRegionKinds_.size()); }

  void clearMeshRegions() {
    meshRegionOf_.clear();
    meshRegionOf_.shrink_to_fit();
    meshRegionKinds_.clear();
    meshRegionKinds_.shrink_to_fit();
  }

  /**
   * Mesh to Solid's loops for tests (ADR-0097, slice D1): prismatic's
   * segmentation over the staged mesh, then the hybrid rebuild's regions and
   * their boundary loops, no solid. Fills meshLoopsPtr/Size (int32): per
   * region its kind (-1 unfit), its surface, its loop count (0 when it is
   * exploded or unfit), then each loop's edge count, the outer loop first;
   * then the boundary chains (slice D3): their count, and per chain its left
   * and right region, 1 when closed, its edge count and its curve (0 line,
   * 1 circle, 2 ellipse; -1 when its nodes fail the curve, -2 when it isn't
   * between two recognised regions). Frees the input buffers. Returns the
   * region count, or 0 with lastError.
   */
  int meshLoopsDebug(double tolerance) {
    beginOp();
    meshReport_.clear();
    meshLoops_.clear();
    int count = 0;
    try {
      MeshSegmentation seg;
      if (segmentMesh(tolerance, seg)) {
        std::vector<int> hybridOf;
        const std::vector<MeshHybridRegion> regions = hybridRegions(seg, hybridOf);
        for (const MeshHybridRegion& r : regions) {
          const bool built = r.kind >= 0 && r.why.empty();
          meshLoops_.push_back(r.kind);
          meshLoops_.push_back(r.surface);
          meshLoops_.push_back(built ? static_cast<int32_t>(r.loops.size()) : 0);
          if (built)
            for (const auto& loop : r.loops) meshLoops_.push_back(static_cast<int32_t>(loop.size()));
        }
        std::unordered_map<uint64_t, int> chainOf;
        std::vector<char> breakNode;
        const std::vector<MeshChain> chains = meshChains(regions, hybridOf, seg.neighbour, chainOf, breakNode);
        std::map<std::pair<int, int>, std::pair<std::vector<MeshChainCurve>, std::string>> cache;
        std::map<std::pair<int, int>, bool> coaxial;
        meshLoops_.push_back(static_cast<int32_t>(chains.size()));
        for (const MeshChain& chain : chains) {
          int curve = -2;
          if (chain.right >= 0 && regions[chain.right].kind >= 0 && regions[chain.right].why.empty()) {
            const MeshChainFit fit = chainCurve(chain, regions, seg, tolerance, cache, coaxial);
            curve = fit.why.empty() ? fit.curve.type : -1;
          }
          meshLoops_.insert(meshLoops_.end(), {chain.left, chain.right, chain.closed ? 1 : 0,
                                               static_cast<int32_t>(chain.closed ? chain.nodes.size() : chain.nodes.size() - 1), curve});
        }
        count = static_cast<int>(regions.size());
      }
    } catch (...) {
      count = failFromException("Mesh to Solid failed");
    }
    meshNodes_.clear();
    meshNodes_.shrink_to_fit();
    meshTriangles_.clear();
    meshTriangles_.shrink_to_fit();
    return count;
  }
  uintptr_t meshLoopsPtr() const { return reinterpret_cast<uintptr_t>(meshLoops_.data()); }
  int meshLoopsSize() const { return static_cast<int>(meshLoops_.size()); }

  /**
   * Diagnostics for a built shape (tests and the spike harness only; the app
   * never calls this). Fills geometry_ with, in order: the largest vertex,
   * edge and face tolerance (mm), the vertex/edge/face counts, the edges that
   * aren't SameParameter, the faces that sit on a Geom_Surface another face
   * also has (one analytic surface split across several faces), the free
   * edges (one face) and over-shared edges (more than two), and the invalid
   * faces and edges. Sets lastError() to a readable summary. Returns 1, or 0
   * on an unknown shape.
   */
  int shapeDiagnose(int shape) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Diagnose: unknown input shape.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> vertices, edges, faces;
      TopExp::MapShapes(*input, TopAbs_VERTEX, vertices);
      TopExp::MapShapes(*input, TopAbs_EDGE, edges);
      TopExp::MapShapes(*input, TopAbs_FACE, faces);
      double maxVertex = 0, maxEdge = 0, maxFace = 0;
      for (int i = 1; i <= vertices.Extent(); ++i)
        maxVertex = std::max(maxVertex, BRep_Tool::Tolerance(TopoDS::Vertex(vertices(i))));
      for (int i = 1; i <= edges.Extent(); ++i)
        maxEdge = std::max(maxEdge, BRep_Tool::Tolerance(TopoDS::Edge(edges(i))));
      for (int i = 1; i <= faces.Extent(); ++i)
        maxFace = std::max(maxFace, BRep_Tool::Tolerance(TopoDS::Face(faces(i))));
      int notSameParameter = 0;
      for (int i = 1; i <= edges.Extent(); ++i)
        if (!BRep_Tool::SameParameter(TopoDS::Edge(edges(i)))) ++notSameParameter;
      std::vector<std::string> surfaces;
      int splitSurfaces = 0;
      for (int i = 1; i <= faces.Extent(); ++i) {
        const BRepAdaptor_Surface surface(TopoDS::Face(faces(i)), false);
        std::string key;
        const auto point = [](const auto& p) {
          return std::to_string(p.X()) + "," + std::to_string(p.Y()) + "," + std::to_string(p.Z());
        };
        const auto axis = [&](const gp_Ax3& frame) { return point(frame.Location()) + "|" + point(frame.Direction()); };
        switch (surface.GetType()) {
          case GeomAbs_Plane:
            key = "plane " + axis(surface.Plane().Position());
            break;
          case GeomAbs_Cylinder:
            key = "cylinder " + axis(surface.Cylinder().Position()) + "|" + std::to_string(surface.Cylinder().Radius());
            break;
          case GeomAbs_Cone:
            key = "cone " + axis(surface.Cone().Position()) + "|" + std::to_string(surface.Cone().RefRadius()) + "|" +
                  std::to_string(surface.Cone().SemiAngle());
            break;
          case GeomAbs_Sphere:
            key = "sphere " + axis(surface.Sphere().Position()) + "|" + std::to_string(surface.Sphere().Radius());
            break;
          case GeomAbs_Torus:
            key = "torus " + axis(surface.Torus().Position()) + "|" + std::to_string(surface.Torus().MajorRadius()) +
                  "|" + std::to_string(surface.Torus().MinorRadius());
            break;
          default:
            break;
        }
        if (key.empty()) continue;
        if (std::find(surfaces.begin(), surfaces.end(), key) != surfaces.end()) ++splitSurfaces;
        else surfaces.push_back(key);
      }
      NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
      TopExp::MapShapesAndUniqueAncestors(*input, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
      int freeEdges = 0, overEdges = 0;
      for (int i = 1; i <= edgeFaces.Extent(); ++i) {
        const int around = edgeFaces(i).Extent();
        if (around == 1) ++freeEdges;
        else if (around > 2) ++overEdges;
      }
      int invalidFaces = 0, invalidEdges = 0;
      for (int i = 1; i <= faces.Extent(); ++i)
        if (!BRepCheck_Analyzer(faces(i)).IsValid()) ++invalidFaces;
      for (int i = 1; i <= edges.Extent(); ++i)
        if (!BRepCheck_Analyzer(edges(i)).IsValid()) ++invalidEdges;
      geometry_.push_back(maxVertex);
      geometry_.push_back(maxEdge);
      geometry_.push_back(maxFace);
      geometry_.push_back(static_cast<double>(vertices.Extent()));
      geometry_.push_back(static_cast<double>(edges.Extent()));
      geometry_.push_back(static_cast<double>(faces.Extent()));
      geometry_.push_back(static_cast<double>(notSameParameter));
      geometry_.push_back(static_cast<double>(splitSurfaces));
      geometry_.push_back(static_cast<double>(freeEdges));
      geometry_.push_back(static_cast<double>(overEdges));
      geometry_.push_back(static_cast<double>(invalidFaces));
      geometry_.push_back(static_cast<double>(invalidEdges));
      lastError_ = "max tolerance: vertex " + std::to_string(maxVertex) + ", edge " + std::to_string(maxEdge) +
                   ", face " + std::to_string(maxFace) + " mm; " + std::to_string(vertices.Extent()) + " vertices, " +
                   std::to_string(edges.Extent()) + " edges (" + std::to_string(notSameParameter) +
                   " not same-parameter, " + std::to_string(invalidEdges) + " invalid), " +
                   std::to_string(faces.Extent()) + " faces (" + std::to_string(splitSurfaces) +
                   " on a surface another face has, " + std::to_string(invalidFaces) + " invalid), " +
                   std::to_string(freeEdges) + " free edges, " + std::to_string(overEdges) + " over-shared edges";
      return 1;
    } catch (...) {
      return failFromException("Diagnose failed");
    }
  }

  /**
   * The exact and hybrid rebuild refusals of the last Mesh to Solid call
   * (tests and the spike harness only), in lastError(). Returns 1.
   */
  int meshRefusalDebug() {
    beginOp();
    lastError_ = "exact: " + rebuildRefusal_ + " | hybrid: " + hybridRefusal_ + " | exploded " +
                 std::to_string(hybridExploded_);
    return 1;
  }

  /**
   * Probes one plain `BRepOffset_MakeOffset` build of `face` by `distance`
   * (tests and the spike harness only): geometry_ holds [built, IsDone,
   * Error(), result not null, result volume]. The builder's own error code is
   * the OCCT fact an offset refusal rests on. Returns 1, or 0 on a bad
   * argument.
   */
  int offsetProbe(int shape, int face, double distance) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Probe: unknown input shape.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(*input, TopAbs_FACE, faces);
      if (face < 0 || face >= faces.Extent()) return fail("Probe: face index out of range.");
      const TopoDS_Shape copy = BRepBuilderAPI_Copy(*input, true, false).Shape();
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> copyFaces;
      TopExp::MapShapes(copy, TopAbs_FACE, copyFaces);
      BRepOffset_MakeOffset builder;
      TopoDS_Shape result;
      const bool built = buildOffset(builder, copy, copyFaces, std::vector<int>{face}, distance, result);
      const BRepOffset_Error error = builder.Error();
      // The builder's own shape, before asSolid: what shape kind it is, how
      // many shells, and how many of them close (a null result from asSolid
      // means its shape wasn't a closeable solid).
      const TopoDS_Shape raw = builder.Shape();
      int rawShells = 0, rawClosed = 0;
      for (TopExp_Explorer shell(raw, TopAbs_SHELL); shell.More(); shell.Next()) {
        ++rawShells;
        if (BRep_Tool::IsClosed(TopoDS::Shell(shell.Current()))) ++rawClosed;
      }
      geometry_.push_back(built ? 1 : 0);
      geometry_.push_back(builder.IsDone() ? 1 : 0);
      geometry_.push_back(static_cast<double>(error));
      geometry_.push_back(result.IsNull() ? 0 : 1);
      geometry_.push_back(result.IsNull() ? 0 : exactVolume(result));
      geometry_.push_back(raw.IsNull() ? -1 : static_cast<double>(raw.ShapeType()));
      geometry_.push_back(static_cast<double>(rawShells));
      geometry_.push_back(static_cast<double>(rawClosed));
      lastError_ = "offset probe: built " + std::to_string(built) + ", done " + std::to_string(builder.IsDone()) +
                   ", error " + std::to_string(static_cast<int>(error)) + ", null " + std::to_string(result.IsNull()) +
                   ", raw kind " + std::to_string(raw.IsNull() ? -1 : static_cast<int>(raw.ShapeType())) + ", shells " +
                   std::to_string(rawShells) + " (" + std::to_string(rawClosed) + " closed)";
      return 1;
    } catch (...) {
      return failFromException("Probe failed");
    }
  }

  /**
   * Mesh to Solid's report, 13 doubles: faces, planes, cylinders, cones,
   * spheres, tori, unfit regions, unfit triangles, unfit fraction, suggested
   * tolerance (-1 = none), rebuild (0 exact, 1 hybrid, -1 none: faceted or
   * no solid), facets (the hybrid result's facet faces), the tolerance used
   * in mm (always for prismatic, Auto or not; -1 for faceted).
   */
  uintptr_t meshReportPtr() const { return reinterpret_cast<uintptr_t>(meshReport_.data()); }
  int meshReportSize() const { return static_cast<int>(meshReport_.size()); }

  /**
   * The colours of a STEP file's solids (P4-12, ADR-0034's amendment): the
   * same text as readStep(), read through XDE (STEPCAFControl_Reader into an
   * XCAF document that lives only for this call). Per solid, in the order
   * readStep()'s shape lists them (TopExp::MapShapes, as count()/subShape()
   * do), [r, g, b] in 0..1 (sRGB) or [-1, -1, -1]: the solid's own colour
   * (surface, then generic), else its part's, else the nearest assembly
   * instance's, else none. A face's colour never colours a solid. Read with
   * geometryPtr/Size: [faces with a colour of their own, then r, g, b per
   * solid]. Returns the number of solids, or -1.
   */
  int readStepColors(const char* text) {
    beginOp();
    quietMessages();
    geometry_.clear();
    try {
      // Declared first, so the reader (which keeps labels) goes before it.
      Handle(TDocStd_Document) doc = new TDocStd_Document("BinXCAF");
      XCAFDoc_DocumentTool::Set(doc->Main(), false);
      int solids = -1;
      int faces = 0;
      {
        STEPCAFControl_Reader reader;
        reader.SetColorMode(true);
        reader.SetNameMode(false);
        reader.SetLayerMode(false);
        reader.SetPropsMode(false);
        reader.SetMetaMode(false);
        reader.SetProductMetaMode(false);
        reader.SetSHUOMode(false);
        reader.SetGDTMode(false);
        reader.SetMatMode(false);
        reader.SetViewMode(false);
        std::istringstream in(text == nullptr ? "" : text);
        if (reader.ReadStream("extrudo.step", in) == IFSelect_RetDone && reader.Transfer(doc)) {
          const Handle(XCAFDoc_ShapeTool) shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
          geometry_.push_back(0);
          NCollection_Sequence<TDF_Label> roots;
          shapes->GetFreeShapes(roots);
          for (NCollection_Sequence<TDF_Label>::Iterator root(roots); root.More(); root.Next()) {
            stepSolidColors(shapes, root.Value(), nullptr);
          }
          solids = static_cast<int>((geometry_.size() - 1) / 3);
          NCollection_Sequence<TDF_Label> labels;
          shapes->GetShapes(labels);
          for (NCollection_Sequence<TDF_Label>::Iterator label(labels); label.More(); label.Next()) {
            NCollection_Sequence<TDF_Label> subs;
            XCAFDoc_ShapeTool::GetSubShapes(label.Value(), subs);
            for (NCollection_Sequence<TDF_Label>::Iterator sub(subs); sub.More(); sub.Next()) {
              Quantity_Color color;
              const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(sub.Value());
              if (!shape.IsNull() && shape.ShapeType() == TopAbs_FACE &&
                  stepLabelColor(sub.Value(), color)) {
                ++faces;
              }
            }
          }
          geometry_[0] = faces;
        }
      }
      // An XCAF document is OCCT memory the facade owns (ADR-0001): drop its
      // attributes before the handle goes, so nothing outlives the call.
      doc->Main().Root().ForgetAllAttributes(true);
      if (solids < 0) {
        geometry_.clear();
        return fail("STEP import failed: the file's colours couldn't be read.");
      }
      return solids;
    } catch (...) {
      geometry_.clear();
      failFromException("STEP import failed");
      return -1;
    }
  }

  /**
   * The names of a STEP file's solids (ADR-0034's amendment): the same text as
   * readStep(), read through XDE (STEPCAFControl_Reader with the name mode on,
   * into an XCAF document that lives only for this call). Per solid, in the
   * order readStep()'s shape lists them, the name of the solid's own label,
   * else its part's, else the nearest assembly instance's, as UTF-8 and empty
   * for none. Read with readNamesPtr/Size: the names joined by '\0' (one entry
   * per solid, empty when it has none). Returns the number of solids, or -1.
   */
  int readStepNames(const char* text) {
    beginOp();
    quietMessages();
    readNames_.clear();
    readNameText_.clear();
    try {
      // Declared first, so the reader (which keeps labels) goes before it.
      Handle(TDocStd_Document) doc = new TDocStd_Document("BinXCAF");
      XCAFDoc_DocumentTool::Set(doc->Main(), false);
      int solids = -1;
      {
        STEPCAFControl_Reader reader;
        reader.SetColorMode(false);
        reader.SetNameMode(true);
        reader.SetLayerMode(false);
        reader.SetPropsMode(false);
        reader.SetMetaMode(false);
        reader.SetProductMetaMode(false);
        reader.SetSHUOMode(false);
        reader.SetGDTMode(false);
        reader.SetMatMode(false);
        reader.SetViewMode(false);
        std::istringstream in(text == nullptr ? "" : text);
        if (reader.ReadStream("extrudo.step", in) == IFSelect_RetDone && reader.Transfer(doc)) {
          const Handle(XCAFDoc_ShapeTool) shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
          NCollection_Sequence<TDF_Label> roots;
          shapes->GetFreeShapes(roots);
          for (NCollection_Sequence<TDF_Label>::Iterator root(roots); root.More(); root.Next()) {
            stepSolidNames(shapes, root.Value(), nullptr);
          }
          solids = static_cast<int>(readNames_.size());
          for (const std::string& name : readNames_) {
            readNameText_ += name;
            readNameText_ += '\0';
          }
        }
      }
      // An XCAF document is OCCT memory the facade owns (ADR-0001): drop its
      // attributes before the handle goes, so nothing outlives the call.
      doc->Main().Root().ForgetAllAttributes(true);
      if (solids < 0) {
        readNames_.clear();
        readNameText_.clear();
        return fail("STEP import failed: the file's part names couldn't be read.");
      }
      return solids;
    } catch (...) {
      readNames_.clear();
      readNameText_.clear();
      failFromException("STEP import failed");
      return -1;
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
  uintptr_t readNamesPtr() const { return reinterpret_cast<uintptr_t>(readNameText_.data()); }
  int readNamesSize() const { return static_cast<int>(readNameText_.size()); }

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
      TopoDS_Wire wire;
      switch (helixWire(frame, radius, pitch, turns, taper, left, 1e-7, true, wire)) {
        case 1: return fail("Couldn't make the coil's helix.");
        case 2: return fail("Couldn't build the coil's helix as a 3D curve.");
        case 3: return fail("Couldn't make a wire of the coil's helix.");
        default: break;
      }
      return store(wire);
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
   * its own helix of the same pitch. A non-zero `taper` (radians, P4-12:
   * tapered threads) puts the path on a cone of that half angle instead
   * (`helixWire`, as a tapered coil's): the radius grows by tan(taper) per
   * mm along the axis, so every point of the profile runs on a conical helix
   * of the same taper (to within the frame's turn as the helix's lead angle
   * changes with the radius: under a micrometre for a pipe thread).
   *
   * Refused before OCCT runs: a profile that isn't a planar face through the
   * axis, touches the axis (at its start or, narrowing, at its end) or is as
   * long along the axis as the pitch (the turns would touch), more than 2000
   * turns, and a taper of 90° or more. The result must pass
   * BRepCheck_Analyzer. History for input 0 as for prism: generated (1) side
   * faces per profile edge (one per turn), first (4) and last (5) for the
   * profile face.
   */
  int threadSweep(int profile, double ox, double oy, double oz, double dx, double dy, double dz,
                  double pitch, double turns, bool left, double taper) {
    beginOp();
    const TopoDS_Shape* input = find(profile);
    if (input == nullptr) return fail("Thread failed: unknown profile shape.");
    if (!(pitch > Precision::Confusion())) return fail("Thread failed: the pitch must be greater than 0.");
    if (!(turns > 1e-6) || turns > 2000) return fail("Thread failed: the number of turns is out of range.");
    if (!(std::abs(taper) < M_PI / 2 - 1e-3)) return fail("Thread failed: the taper must be between -90° and 90°.");
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
      // A narrowing cone brings the profile nearer the axis turn by turn.
      const double narrows = std::min(0.0, std::tan(taper) * pitch * turns);
      if (!(rMin + narrows > 1e-4)) return fail("Thread failed: the profile touches the axis.");
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
      TopoDS_Wire spine;
      switch (helixWire(frame, rc, pitch, turns, taper, left, 1e-5, false, spine)) {
        case 1: return fail("Thread failed: couldn't make the helix.");
        case 2: return fail("Thread failed: couldn't build the helix.");
        case 3: return fail("Thread failed: couldn't join the helix's turns.");
        default: break;
      }

      BRepOffsetAPI_MakePipeShell pipe(spine);
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
   * What a thread needs to know of a cylindrical or conical face `face` of
   * `shape` (P4-02, ADR-0056; cones P4-12, its third amendment), in
   * geometryNumbers: [ox, oy, oz, dx, dy, dz, radius, inside, h0, h1, whole,
   * open0, open1, taper]. The axis runs through (ox, oy, oz) along (dx, dy,
   * dz) (canonical sign); the face spans h0 to h1 along it from that point.
   * `radius` is the face's radius at h0; `taper` is a cone's half angle
   * (radians), signed along (dx, dy, dz): the radius at h is radius +
   * (h − h0)·tan(taper). A cylinder's taper is 0. `inside` is 1 when the face's material lies outside the
   * cylinder (a hole's wall: an internal thread), 0 for a shaft. `whole` is 1
   * when the face goes all the way round. `open0` / `open1` say whether the
   * face's edge at h0 / h1 is an outward corner (1: the shaft's end, a hole's
   * mouth, where a thread gets its lead-in chamfer) or not (0: a shoulder,
   * a hole's floor, a smooth join, or no edge right round). Returns 14, or -1
   * (not a cylinder or a cone, unknown shape).
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
      const GeomAbs_SurfaceType type = surface.GetType();
      if (type != GeomAbs_Cylinder && type != GeomAbs_Cone) return failCurve("The face isn't cylindrical or conical.");
      // A cone (P4-12, tapered threads): v runs along its generator, so a height
      // along the axis is v·cos(halfAngle) and the radius there RefRadius + v·sin.
      const bool conical = type == GeomAbs_Cone;
      const gp_Ax1 axis1 = conical ? surface.Cone().Axis() : surface.Cylinder().Axis();
      const gp_Pnt origin = conical ? surface.Cone().Location() : surface.Cylinder().Location();
      const double halfAngle = conical ? surface.Cone().SemiAngle() : 0.0;
      const double refRadius = conical ? surface.Cone().RefRadius() : surface.Cylinder().Radius();
      const double alongV = std::cos(halfAngle);
      const gp_Dir axis = axis1.Direction();
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
      const double h0 = (flip > 0 ? v0 : -v1) * alongV;
      const double h1 = (flip > 0 ? v1 : -v0) * alongV;
      // The radius at the face's lower end along `out`, and the half angle signed along `out`.
      const double radius = refRadius + (flip > 0 ? v0 : v1) * std::sin(halfAngle);
      geometry_.insert(geometry_.end(), {radius, inside ? 1.0 : 0.0, h0, h1, whole ? 1.0 : 0.0,
                                         flip > 0 ? open[0] : open[1], flip > 0 ? open[1] : open[0],
                                         flip * halfAngle});
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
    return wrapOn(face, ox, oy, oz, ax, ay, az, rx, ry, rz, radius, 0, px, py, pz, sx, sy, sz, depth, outward);
  }

  /**
   * Wraps the planar face `face` around a cone (P4-12, ADR-0060's amendment):
   * wrapOnCylinder() with the cylinder of radius `radius` replaced by the cone
   * through the same circle -- centre (ox, oy, oz), axis (ax, ay, az),
   * reference (rx, ry, rz) -- whose radius grows by tan(halfAngle) per
   * millimetre along the axis (a negative half-angle narrows it). The map is
   * the cylinder's: a sketch point (s, z) lands at the cone's (u, v) =
   * (s / radius, z + lift), u the angle from the reference and v the distance
   * along the generator, so a line stays a line, a circle an ellipse in (u, v)
   * and a B-spline is mapped pole by pole; widths are exact on the circle the
   * frame names and scale with the radius above and below it. The far cap lies
   * on the cone offset by `depth` along its normal, the walls along that
   * normal, so the depth is measured square to the surface. History as
   * wrapOnCylinder(). Returns the solid's handle, or 0 with lastError().
   */
  int wrapOnCone(int face, double ox, double oy, double oz, double ax, double ay, double az, double rx, double ry,
                 double rz, double radius, double halfAngle, double px, double py, double pz, double sx, double sy,
                 double sz, double depth, bool outward) {
    beginOp();
    if (!(std::abs(halfAngle) > 1e-9) || !(std::abs(halfAngle) < M_PI / 2 - 1e-6)) {
      return fail("Emboss failed: the cone's half-angle must lie between 0 and 90 degrees.");
    }
    return wrapOn(face, ox, oy, oz, ax, ay, az, rx, ry, rz, radius, halfAngle, px, py, pz, sx, sy, sz, depth,
                  outward);
  }

  /**
   * What an emboss needs of a conical face `face` of `shape` (P4-12,
   * ADR-0060's amendment), in geometryNumbers: [ox, oy, oz, dx, dy, dz,
   * radius, halfAngle, inside]. (ox, oy, oz) is a point of the axis, which runs
   * along (dx, dy, dz) (canonical sign); the cone's radius there is `radius`
   * and grows by tan(halfAngle) per millimetre along (dx, dy, dz) (a negative
   * half-angle narrows it). `inside` is 1 when the face's material lies
   * outside the cone (a countersink's wall, a funnel's inside), 0 for a
   * spike's or a frustum's outside. Returns 9, or -1 (not a cone, unknown
   * shape).
   */
  int coneFace(int shape, int face) {
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
      if (surface.GetType() != GeomAbs_Cone) return failCurve("The face isn't conical.");
      const gp_Cone cone = surface.Cone();
      const gp_Pnt origin = cone.Location();
      const gp_Dir axis = cone.Axis().Direction();
      const gp_Dir out = canonical(axis);
      const double flip = out.Dot(axis) < 0 ? -1.0 : 1.0;
      double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
      BRepTools::UVBounds(f, u0, u1, v0, v1);
      BRepLProp_SLProps props(surface, (u0 + u1) / 2, (v0 + v1) / 2, 1, Precision::Confusion());
      if (!props.IsNormalDefined()) return failCurve("The face has no normal.");
      gp_Dir normal = props.Normal();
      if (f.Orientation() == TopAbs_REVERSED) normal.Reverse();
      const gp_Vec toMid(origin, props.Value());
      const gp_Vec radial = toMid - gp_Vec(axis) * toMid.Dot(gp_Vec(axis));
      const bool inside = gp_Vec(normal).Dot(radial) < 0;
      pushPoint(origin);
      pushDir(out);
      geometry_.insert(geometry_.end(), {cone.RefRadius(), flip * cone.SemiAngle(), inside ? 1.0 : 0.0});
      return static_cast<int>(geometry_.size());
    } catch (...) {
      failFromException("Cone face failed");
      return -1;
    }
  }

  /**
   * Projects the planar face `profile` onto face `face` of `shape` along the
   * profile's plane normal (P4-12, ADR-0060's amendment: spheres, tori and
   * free-form faces, where no map keeps lengths) and returns the solid an
   * emboss joins or a deboss cuts: the part of the profile's prism between
   * the face and the face offset by `depth` along its outward normal
   * (`outward`) or against it. The offset is OCCT's simple offset of a copy of
   * the face (a sphere's is the concentric sphere, exactly).
   *
   * The profiles travel from the side of the sketch the face looks at (the
   * nearest hit of the line through the profile's centre where the face looks
   * back at the sketch), and every sample of the profile's outline has to meet
   * the face, where it looks back, and the offset face: anything else reaches
   * past the face's edge or its silhouette as seen from the sketch, and is
   * refused with lastError() "The profiles reach past the face's edge as seen
   * from the sketch."; a profile whose line misses the face is "The profiles
   * don't touch the face.".
   *
   * History for input 0 (the profile): first (4) for the pieces of the face,
   * last (5) for the offset face's, generated (1) from each edge for its wall.
   */
  int projectOnFace(int profileHandle, int shape, int face, double depth, bool outward) {
    beginOp();
    TopoDS_Face profile;
    if (const char* why = singleProfile(profileHandle, profile)) return fail(why);
    const TopoDS_Shape* body = find(shape);
    if (body == nullptr) return fail("Emboss failed: unknown shape.");
    if (!(depth > Precision::Confusion())) return fail("Emboss failed: the depth must be greater than 0.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> bodyFaces;
      TopExp::MapShapes(*body, TopAbs_FACE, bodyFaces);
      if (face < 0 || face >= bodyFaces.Extent()) return fail("Emboss failed: face index out of range.");
      const TopoDS_Face target = TopoDS::Face(bodyFaces(face + 1));
      BRepAdaptor_Surface carried(profile);
      if (carried.GetType() != GeomAbs_Plane) return fail("Emboss failed: the profile isn't flat.");
      const gp_Dir n = carried.Plane().Axis().Direction();

      // The face's outward normal at (u, v): its surface's, turned for a reversed face.
      // At a singular point (a sphere's pole, where a line through a sketch's centre
      // may well land) the first derivatives give none, so the second ones are asked.
      BRepAdaptor_Surface surface(target);
      const bool reversed = target.Orientation() == TopAbs_REVERSED;
      const auto outwardAt = [&](double u, double v, gp_Vec& normal) {
        gp_Pnt at;
        gp_Vec du, dv;
        surface.D1(u, v, at, du, dv);
        normal = du.Crossed(dv);
        if (normal.Magnitude() <= 1e-12) {
          BRepLProp_SLProps props(surface, u, v, 2, Precision::Confusion());
          if (!props.IsNormalDefined()) return false;
          normal = gp_Vec(props.Normal());
        }
        normal.Normalize();
        if (reversed) normal.Reverse();
        return true;
      };

      // Which way the profiles travel: along the line through their centre, the hit
      // nearest the sketch where the face looks back at it.
      GProp_GProps areaProps;
      BRepGProp::SurfaceProperties(profile, areaProps);
      const gp_Pnt middle = areaProps.CentreOfMass();
      const double tol = Precision::Confusion();
      IntCurvesFace_Intersector onFace(target, tol);
      onFace.Perform(gp_Lin(middle, n), -RealLast(), RealLast());
      double nearest = RealLast();
      double sense = 0;
      for (int i = 1; onFace.IsDone() && i <= onFace.NbPnt(); ++i) {
        gp_Vec normal;
        if (!outwardAt(onFace.UParameter(i), onFace.VParameter(i), normal)) continue;
        const double w = onFace.WParameter(i);
        const double towards = w >= 0 ? 1.0 : -1.0;  // from the sketch to the hit
        if (!(normal.Dot(gp_Vec(n)) * towards < 0)) continue;
        if (std::abs(w) < nearest) {
          nearest = std::abs(w);
          sense = towards;
        }
      }
      // The line through a ring's centre may miss it (a letter O): any sample of the
      // outline will do then.
      std::vector<gp_Pnt> samples;
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> profileEdges;
      TopExp::MapShapes(profile, TopAbs_EDGE, profileEdges);
      for (int e = 1; e <= profileEdges.Extent(); ++e) {
        BRepAdaptor_Curve curve(TopoDS::Edge(profileEdges(e)));
        const int steps = curve.GetType() == GeomAbs_Line ? 2 : 12;
        for (int k = 0; k < steps; ++k) {
          samples.push_back(curve.Value(curve.FirstParameter() +
                                        (curve.LastParameter() - curve.FirstParameter()) * k / steps));
        }
      }
      for (size_t k = 0; sense == 0 && k < samples.size(); ++k) {
        onFace.Perform(gp_Lin(samples[k], n), -RealLast(), RealLast());
        for (int i = 1; onFace.IsDone() && i <= onFace.NbPnt(); ++i) {
          gp_Vec normal;
          if (!outwardAt(onFace.UParameter(i), onFace.VParameter(i), normal)) continue;
          const double towards = onFace.WParameter(i) >= 0 ? 1.0 : -1.0;
          if (normal.Dot(gp_Vec(n)) * towards < 0) sense = towards;
        }
      }
      if (sense == 0) return fail("The profiles don't touch the face.");
      const gp_Dir d = sense > 0 ? n : n.Reversed();
      const gp_Vec along(d);

      // The thick piece of the face: the face, the face moved `depth` along (or against)
      // its outward normal, and the walls between them along the normal.
      TopoDS_Solid shell;
      TopoDS_Face skin;
      TopoDS_Face farFace;
      if (const char* why = thickPiece(target, surface, d, middle, depth, outward, shell, skin, farFace)) {
        return fail(why);
      }
      IntCurvesFace_Intersector onFar(farFace, tol);

      // Every sample's first hit, coming from behind the sketch, must be on the face
      // where it looks back, and the sample must meet the offset face too.
      const char* past = "The profiles reach past the face's edge as seen from the sketch.";
      for (const gp_Pnt& p : samples) {
        onFace.Perform(gp_Lin(p, d), -RealLast(), RealLast());
        if (!onFace.IsDone() || onFace.NbPnt() == 0) return fail(past);
        int first = 0;
        for (int i = 1; i <= onFace.NbPnt(); ++i) {
          if (first == 0 || onFace.WParameter(i) < onFace.WParameter(first)) first = i;
        }
        gp_Vec normal;
        if (!outwardAt(onFace.UParameter(first), onFace.VParameter(first), normal)) return fail(past);
        if (!(normal.Dot(along) < -1e-3)) return fail(past);
        onFar.Perform(gp_Lin(p, d), -RealLast(), RealLast());
        if (!onFar.IsDone() || onFar.NbPnt() == 0) return fail(past);
      }

      // The prism: the profile moved back along d behind the thick piece, swept through it.
      Bnd_Box box;
      BRepBndLib::Add(shell, box);
      BRepBndLib::Add(profile, box);
      double x0, y0, z0, x1, y1, z1;
      box.Get(x0, y0, z0, x1, y1, z1);
      const gp_Pnt origin = carried.Plane().Location();
      double low = RealLast();
      double high = -RealLast();
      for (int c = 0; c < 8; ++c) {
        const gp_Pnt corner(c & 1 ? x1 : x0, c & 2 ? y1 : y0, c & 4 ? z1 : z0);
        const double t = gp_Vec(origin, corner).Dot(along);
        low = std::min(low, t);
        high = std::max(high, t);
      }
      const double margin = 1 + 1e-3 * (high - low);
      gp_Trsf back;
      back.SetTranslation(along * (low - margin));
      BRepBuilderAPI_Transform moved(profile, back, true);
      if (!moved.IsDone()) return fail("Emboss failed: couldn't move the profile.");
      BRepPrimAPI_MakePrism prism(moved.Shape(), along * (high - low + 2 * margin), true);
      if (!prism.IsDone()) return fail("Emboss failed: couldn't sweep the profile.");

      BRepAlgoAPI_Common common(prism.Shape(), shell);
      common.Build();
      if (!common.IsDone() || common.HasErrors()) return fail("Emboss failed: couldn't cut the profile to the face.");
      const TopoDS_Shape cut = common.Shape();
      const auto imagesOf = [&common](const TopoDS_Shape& s) {
        std::vector<TopoDS_Shape> out;
        const NCollection_List<TopoDS_Shape>& modified = common.Modified(s);
        for (NCollection_List<TopoDS_Shape>::Iterator it(modified); it.More(); it.Next()) out.push_back(it.Value());
        if (out.empty() && !common.IsDeleted(s)) out.push_back(s);
        return out;
      };
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> onSkin;
      for (const TopoDS_Shape& piece : imagesOf(skin)) onSkin.Add(piece);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> onFarFace;
      for (const TopoDS_Shape& piece : imagesOf(farFace)) onFarFace.Add(piece);
      // The prism's wall of each profile edge, and their pieces in the result.
      std::vector<std::vector<TopoDS_Shape>> walls(static_cast<size_t>(profileEdges.Extent()));
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> onWalls;
      for (int k = 1; k <= profileEdges.Extent(); ++k) {
        const NCollection_List<TopoDS_Shape>& made = prism.Generated(moved.ModifiedShape(profileEdges(k)));
        for (NCollection_List<TopoDS_Shape>::Iterator it(made); it.More(); it.Next()) {
          if (it.Value().ShapeType() != TopAbs_FACE) continue;
          for (const TopoDS_Shape& piece : imagesOf(it.Value())) {
            walls[static_cast<size_t>(k - 1)].push_back(piece);
            onWalls.Add(piece);
          }
        }
      }

      // Keep the solids that stand on the face where it looks at the sketch: a closed
      // face (a whole sphere) gives its far side's piece too, which isn't the emboss.
      const auto facing = [&](const TopoDS_Face& piece) {
        GProp_GProps props;
        BRepGProp::SurfaceProperties(piece, props);
        GeomAPI_ProjectPointOnSurf foot(props.CentreOfMass(), BRep_Tool::Surface(target));
        if (!foot.IsDone() || foot.NbPoints() == 0) return 0;
        double u = 0, v = 0;
        foot.LowerDistanceParameters(u, v);
        gp_Vec normal;
        if (!outwardAt(u, v, normal)) return 0;
        return normal.Dot(along) < 0 ? 1 : -1;
      };
      BRep_Builder builder;
      TopoDS_Compound kept;
      builder.MakeCompound(kept);
      int count = 0;
      TopoDS_Solid only;
      for (TopExp_Explorer solid(cut, TopAbs_SOLID); solid.More(); solid.Next()) {
        int front = 0;
        int backs = 0;
        for (TopExp_Explorer e(solid.Current(), TopAbs_FACE); e.More(); e.Next()) {
          if (!onSkin.Contains(e.Current())) continue;
          const int looks = facing(TopoDS::Face(e.Current()));
          if (looks > 0) ++front;
          if (looks < 0) ++backs;
        }
        if (front == 0) continue;
        if (backs > 0) return fail(past);
        // Only the face, its offset and the prism's walls may bound it: a wall of the
        // thick piece or an end of the prism means the profile reaches past the face.
        for (TopExp_Explorer e(solid.Current(), TopAbs_FACE); e.More(); e.Next()) {
          const TopoDS_Shape& f = e.Current();
          if (!onSkin.Contains(f) && !onFarFace.Contains(f) && !onWalls.Contains(f)) return fail(past);
        }
        builder.Add(kept, solid.Current());
        only = TopoDS::Solid(solid.Current());
        ++count;
      }
      if (count == 0) return fail("The profiles don't touch the face.");
      const TopoDS_Shape result = count == 1 ? TopoDS_Shape(only) : TopoDS_Shape(kept);
      if (!BRepCheck_Analyzer(result).IsValid()) return fail("Emboss failed: the projected solid isn't sound.");
      if (!(exactVolume(result) > 0)) return fail("Emboss failed: the projected solid has no volume.");

      // History for input 0 (the profile as passed in).
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
      TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
      std::vector<TopoDS_Shape> starts;
      for (int k = 1; k <= onSkin.Extent(); ++k) starts.push_back(onSkin(k));
      std::vector<TopoDS_Shape> ends;
      for (int k = 1; k <= onFarFace.Extent(); ++k) ends.push_back(onFarFace(k));
      recordFaces(0, 0, 0, 4, starts, resultFaces);
      recordFaces(0, 0, 0, 5, ends, resultFaces);
      for (int k = 1; k <= profileEdges.Extent(); ++k) {
        recordFaces(0, 1, k - 1, 1, walls[static_cast<size_t>(k - 1)], resultFaces);
      }
      return store(result);
    } catch (...) {
      return failFromException("Emboss failed");
    }
  }

private:
  /**
   * The solid between face `target` and its offset by `depth` along its
   * outward normal (`outward`) or against it, for projectOnFace(): `skin` is
   * the face of it on the target's surface, `farFace` the offset one. A sphere
   * or a torus (a whole one is a closed face OCCT's offset can't take) is the
   * shell between two concentric spheres or two tori of the same centre circle,
   * exactly, their seams turned away from the profile at `profile` coming along
   * `d`; any other face is OCCT's simple offset of a copy of it. Returns
   * the reason it can't be built, or nullptr.
   */
  const char* thickPiece(const TopoDS_Face& target, const BRepAdaptor_Surface& surface, const gp_Dir& d,
                         const gp_Pnt& profile, double depth, bool outward, TopoDS_Solid& shell, TopoDS_Face& skin,
                         TopoDS_Face& farFace) {
    const GeomAbs_SurfaceType type = surface.GetType();
    if (type == GeomAbs_Sphere || type == GeomAbs_Torus) {
      // Whether the outward normal points away from the centre (a ball, a ring's
      // outside) or towards it (a spherical hollow), from the middle of the face.
      double u0 = 0, u1 = 0, v0 = 0, v1 = 0;
      BRepTools::UVBounds(target, u0, u1, v0, v1);
      gp_Pnt at;
      gp_Vec du, dv;
      surface.D1((u0 + u1) / 2, (v0 + v1) / 2, at, du, dv);
      gp_Vec normal = du.Crossed(dv);
      if (target.Orientation() == TopAbs_REVERSED) normal.Reverse();
      gp_Pnt centre;
      double r = 0;
      gp_Ax2 place;
      double major = 0;
      if (type == GeomAbs_Sphere) {
        const gp_Sphere sphere = surface.Sphere();
        centre = sphere.Location();
        r = sphere.Radius();
        // The seam along d, the poles square to it: both on the side of the sphere away
        // from the sketch or on its outline, never through the letters.
        const gp_Dir side = std::abs(d.Z()) < 0.9 ? gp_Dir(0, 0, 1) : gp_Dir(1, 0, 0);
        place = gp_Ax2(centre, d.Crossed(side), d);
      } else {
        const gp_Torus torus = surface.Torus();
        place = torus.Position().Ax2();
        // The seam round the axis on the far side from the profile (the tube's own
        // seam, round its outer equator, stays where it is).
        const gp_Vec up(place.Direction());
        gp_Vec away(profile, torus.Location());
        away -= up * away.Dot(up);
        if (away.Magnitude() > 1e-6) place.SetXDirection(gp_Dir(away));
        major = torus.MajorRadius();
        r = torus.MinorRadius();
        // The tube's centre nearest the point: on the centre circle, below it.
        gp_Vec flat(torus.Location(), at);
        const gp_Vec axis(place.Direction());
        flat -= axis * flat.Dot(axis);
        if (flat.Magnitude() <= Precision::Confusion()) return "Emboss failed: the torus has no tube here.";
        centre = torus.Location().Translated(flat.Normalized() * major);
      }
      const double away = normal.Dot(gp_Vec(centre, at)) > 0 ? 1.0 : -1.0;
      const double other = r + (outward ? depth : -depth) * away;
      if (!(other > Precision::Confusion())) return "Emboss failed: the depth is bigger than the face's radius.";
      const auto shellOf = [&](double radius) -> TopoDS_Shell {
        if (type == GeomAbs_Sphere) return BRepPrimAPI_MakeSphere(place, radius).Shell();
        return BRepPrimAPI_MakeTorus(place, major, radius).Shell();
      };
      const TopoDS_Shell own = shellOf(r);
      const TopoDS_Shell moved = shellOf(other);
      BRep_Builder builder;
      builder.MakeSolid(shell);
      builder.Add(shell, other > r ? moved : own);
      builder.Add(shell, other > r ? own.Reversed() : moved.Reversed());
      for (TopExp_Explorer e(own, TopAbs_FACE); e.More(); e.Next()) skin = TopoDS::Face(e.Current());
      for (TopExp_Explorer e(moved, TopAbs_FACE); e.More(); e.Next()) farFace = TopoDS::Face(e.Current());
      if (skin.IsNull() || farFace.IsNull()) return "Emboss failed: couldn't offset the face.";
      return nullptr;
    }
    skin = TopoDS::Face(BRepBuilderAPI_Copy(target).Shape());
    BRepOffset_MakeSimpleOffset thick(skin, outward ? depth : -depth);
    thick.SetBuildSolidFlag(true);
    thick.Perform();
    if (!thick.IsDone()) return "Emboss failed: couldn't offset the face.";
    for (TopExp_Explorer solid(thick.GetResultShape(), TopAbs_SOLID); solid.More(); solid.Next()) {
      shell = TopoDS::Solid(solid.Current());
    }
    if (shell.IsNull()) return "Emboss failed: the offset face didn't make a solid.";
    BRepLib::OrientClosedSolid(shell);
    const TopoDS_Shape far = thick.Generated(skin);
    for (TopExp_Explorer e(far, TopAbs_FACE); e.More(); e.Next()) farFace = TopoDS::Face(e.Current());
    if (farFace.IsNull()) return "Emboss failed: the offset lost the face.";
    return nullptr;
  }

  /**
   * The profile `handle` names as one flat face whose loops all close, or the
   * reason it isn't one (wrapOn(), projectOnFace()).
   */
  const char* singleProfile(int handle, TopoDS_Face& profile) {
    const TopoDS_Shape* input = find(handle);
    if (input == nullptr) return "Emboss failed: unknown face.";
    int faces = 0;
    for (TopExp_Explorer e(*input, TopAbs_FACE); e.More(); e.Next()) {
      profile = TopoDS::Face(e.Current());
      ++faces;
    }
    if (faces != 1) return "Emboss failed: the profile isn't a single face.";
    if (!BRep_Tool::IsClosed(BRepTools::OuterWire(profile))) {
      return "Emboss failed: the profile's outline doesn't close up.";
    }
    for (TopExp_Explorer w(profile, TopAbs_WIRE); w.More(); w.Next()) {
      if (!BRep_Tool::IsClosed(TopoDS::Wire(w.Current()))) return "Emboss failed: a hole of the profile doesn't close up.";
    }
    return nullptr;
  }

  /**
   * wrapOnCylinder() (halfAngle 0) and wrapOnCone(): the profile wrapped onto
   * the cylinder or the cone through the circle of `radius` the frame names.
   */
  int wrapOn(int face, double ox, double oy, double oz, double ax, double ay, double az, double rx, double ry,
             double rz, double radius, double halfAngle, double px, double py, double pz, double sx, double sy,
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
    // A cone's radius varies over the profile: its own check follows the mapping below.
    const double far = outward ? radius + depth : radius - depth;
    if (halfAngle == 0 && !(far > Precision::Confusion())) {
      return fail("Emboss failed: the depth is bigger than the radius.");
    }
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
          mine.push_back(static_cast<int>(sourceEdges.size()));
          sourceEdges.push_back(edge.Current());
          edgeAt.push_back(index);
          wrapped.push_back(on);
        }
        if (mine.empty()) return fail("Emboss failed: a loop of the profile has no edges.");
        loopEdges.push_back(std::move(mine));
      }

      // How far round and along the profile runs in (u, v): a wrap may go almost the
      // whole way round (P4-12), and on a cone it may not reach the tip.
      Bnd_Box2d reach;
      for (const Wrapped& on : wrapped) {
        BndLib_Add2dCurve::AddOptimal(on.curve, on.from, on.to, 0, reach);
      }
      double uLow = 0, vLow = 0, uHigh = 0, vHigh = 0;
      reach.Get(uLow, vLow, uHigh, vHigh);
      const double sine = std::sin(halfAngle);
      const double cosine = std::cos(halfAngle);
      // The smallest radius the profile reaches, on the face and on the far cap.
      const double nearest = std::min(radius + vLow * sine, radius + vHigh * sine);
      const double farthest = outward ? nearest + depth * cosine : nearest - depth * cosine;
      if (halfAngle != 0 && !(nearest > Precision::Confusion())) {
        return fail("The profiles reach past the cone's tip.");
      }
      if (halfAngle != 0 && !(farthest > Precision::Confusion())) {
        return fail("Emboss failed: the depth reaches past the cone's axis.");
      }
      // Short of a whole turn by a hundredth of a millimetre where the profile is
      // narrowest round, so its two ends never meet.
      if (uHigh - uLow > 2 * M_PI - 0.01 / std::max(nearest, Precision::Confusion())) {
        return fail("The profile is wider than the face's circumference.");
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
      Handle(Geom_Surface) inner;
      if (halfAngle == 0) {
        inner = new Geom_CylindricalSurface(gp_Ax3(origin, axis, rdir), radius);
      } else {
        inner = new Geom_ConicalSurface(gp_Ax3(origin, axis, rdir), halfAngle, radius);
      }
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
  /**
   * The helix both `helix` (a coil's path) and `threadSweep` (a thread's
   * spine, P4-12's tapered threads) run along: it starts at `frame`'s origin
   * + `radius` along its X, turns about its Z for `turns` turns, rising
   * `pitch` along Z per turn, counter-clockwise seen from Z's tip (clockwise
   * with `left`), on a cylinder, or with a non-zero `taper` on a cone of that
   * half angle (the radius grows by tan(taper) per mm of height). One edge
   * per turn (the last one the fraction left), each edge's 3D B-spline within
   * `tolerance` of the exact helix. With `shareVertices` the turns are cut
   * from one line between shared vertices (the coil's way, P4-01); without,
   * each turn is a line of its own that the wire builder joins (the thread's
   * way, P4-02). Both are kept as they were, so that a straight thread and a
   * coil compute exactly as before (the two differ by about 1e-7 of a
   * thread's volume, which a mesh fingerprint would see).
   * 0 on success, else what failed: 1 an edge, 2 its 3D curve, 3 the wire.
   * The caller checks the numbers.
   */
  static int helixWire(const gp_Ax3& frame, double radius, double pitch, double turns, double taper, bool left,
                       double tolerance, bool shareVertices, TopoDS_Wire& out) {
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
    // One edge per turn: a sweep then has a face per turn, which booleans prune
    // by their boxes; one face for all the turns made a 200-turn cut take
    // minutes, and one long edge needs a B-spline of thousands of poles.
    const double perTurn = std::sqrt(4 * M_PI * M_PI + rise * rise);
    const double length = turns * perTurn;
    const int pieces = std::max(1, static_cast<int>(std::ceil(turns - 1e-6)));
    BRepBuilderAPI_MakeWire wire;
    TopoDS_Vertex joint;
    for (int k = 0; k < pieces; ++k) {
      const double from = k * perTurn;
      const double to = k + 1 == pieces ? length : (k + 1) * perTurn;
      TopoDS_Edge piece;
      if (shareVertices) {
        const gp_Pnt2d uv = line->Value(to);
        const TopoDS_Vertex end = BRepBuilderAPI_MakeVertex(surface->Value(uv.X(), uv.Y())).Vertex();
        if (k == 0) {
          const gp_Pnt2d start = line->Value(from);
          joint = BRepBuilderAPI_MakeVertex(surface->Value(start.X(), start.Y())).Vertex();
        }
        BRepBuilderAPI_MakeEdge edge(line, surface, joint, end, from, to);
        if (!edge.IsDone()) return 1;
        piece = edge.Edge();
        joint = end;
      } else {
        // A line of its own per turn, from the turn's start, joined by the wire builder.
        const double span = k + 1 == pieces ? turns - k : 1.0;
        Handle(Geom2d_Line) own = new Geom2d_Line(gp_Pnt2d(turnSign * 2 * M_PI * k, rise * k), direction);
        BRepBuilderAPI_MakeEdge edge(own, surface, 0, span * perTurn);
        if (!edge.IsDone()) return 1;
        piece = edge.Edge();
      }
      if (!BRepLib::BuildCurves3d(piece, tolerance, GeomAbs_C2, 14, 200)) return 2;
      wire.Add(piece);
      if (!wire.IsDone()) return 3;
    }
    out = wire.Wire();
    return 0;
  }

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

  /** A triangle of a face's mesh, with the sphere round it. */
  struct ProximityTriangle {
    double p[3][3];
    double lo[3];
    double hi[3];
  };

  /**
   * A face of a proximity session: its box and its mesh in its shape's own
   * frame, and how far the mesh may stray from the face (`deflection`).
   */
  struct ProximityFace {
    TopoDS_Face face;
    int index;
    double centre[3];
    double half[3];
    std::vector<ProximityTriangle> triangles;
    double deflection = 0;
    /** The triangles moved to pose `pose` (moving faces only). */
    std::vector<ProximityTriangle> placed;
    int pose = -1;
  };

  /** A solid of a proximity session, for one body inside the other. */
  struct ProximitySolid {
    TopoDS_Shape solid;
    gp_Pnt probe;
    double centre[3];
    double half[3];
    std::shared_ptr<BRepClass3d_SolidClassifier> classifier;
  };

  struct ProximitySession {
    std::vector<ProximityFace> moving;
    std::vector<ProximityFace> other;
    std::vector<ProximitySolid> movingSolids;
    std::vector<ProximitySolid> otherSolids;
    double search = 0;
    int pose = 0;
    /** The pair of faces (positions) nearest at the last pose. */
    std::pair<int, int> last = {-1, -1};
  };

  std::unordered_map<int, ProximitySession> proximity_;
  int nextProximity_ = 1;

  /** Centre and half-size of a box grown by `by`; a void box gets an infinite one. */
  static void proximityBox(const Bnd_Box& box, double centre[3], double half[3]) {
    if (box.IsVoid()) {
      for (int k = 0; k < 3; ++k) {
        centre[k] = 0;
        half[k] = Precision::Infinite();
      }
      return;
    }
    double lo[3];
    double hi[3];
    box.Get(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
    // Grown a little: a bound must never be above the true distance.
    const double grow = 1e-6;
    for (int k = 0; k < 3; ++k) {
      centre[k] = 0.5 * (lo[k] + hi[k]);
      half[k] = 0.5 * (hi[k] - lo[k]) + grow;
    }
  }

  /** The mesh a proximity session bounds faces with: mm and radians. */
  static constexpr double kProximityDeflection = 0.01;
  static constexpr double kProximityAngle = 0.5;

  static void proximityFaces(const TopoDS_Shape& shape, std::vector<ProximityFace>& out) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
    TopExp::MapShapes(shape, TopAbs_FACE, faces);
    // A copy is meshed, as exportMesh() does, so the shape's own (display)
    // triangulation stays as it is; its faces are the shape's, in order.
    BRepBuilderAPI_Copy copier(shape, false, false);
    const TopoDS_Shape copy = copier.Shape();
    BRepMesh_IncrementalMesh mesher(copy, kProximityDeflection, false, kProximityAngle, false);
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> meshed;
    TopExp::MapShapes(copy, TopAbs_FACE, meshed);
    const bool paired = meshed.Extent() == faces.Extent();
    for (int i = 1; i <= faces.Extent(); ++i) {
      ProximityFace f;
      f.face = TopoDS::Face(faces(i));
      f.index = i - 1;
      Bnd_Box box;
      // From the geometry, not a mesh, and grown by the face's tolerance.
      BRepBndLib::AddOptimal(f.face, box, false, true);
      proximityBox(box, f.centre, f.half);
      if (paired) proximityMesh(TopoDS::Face(meshed(i)), f);
      out.push_back(f);
    }
  }

  /**
   * A face's triangles in its shape's frame and how far they may be from the
   * face: the larger of the deflection asked for and the one BRepMesh measured,
   * with a margin, plus the face's tolerance. A face that couldn't be meshed
   * keeps no triangles, and its pairs are bounded by their boxes alone.
   */
  static void proximityMesh(const TopoDS_Face& face, ProximityFace& f) {
    TopLoc_Location location;
    const Handle(Poly_Triangulation)& triangulation = BRep_Tool::Triangulation(face, location);
    if (triangulation.IsNull() || triangulation->NbTriangles() == 0) return;
    const gp_Trsf transform = location.Transformation();
    // A flat face bounded by straight edges is its triangles exactly (a box,
    // a rib): only its tolerance is left. Ties between such faces are common
    // (a rib's edge belongs to two faces), so this keeps them from all being
    // measured.
    bool exact = BRepAdaptor_Surface(face, false).GetType() == GeomAbs_Plane;
    for (TopExp_Explorer e(face, TopAbs_EDGE); exact && e.More(); e.Next()) {
      const TopoDS_Edge& edge = TopoDS::Edge(e.Current());
      if (BRep_Tool::Degenerated(edge)) continue;
      exact = BRepAdaptor_Curve(edge).GetType() == GeomAbs_Line;
    }
    f.deflection = BRep_Tool::Tolerance(face) + 1e-9;
    if (!exact) f.deflection += 2 * std::max(kProximityDeflection, triangulation->Deflection());
    f.triangles.reserve(triangulation->NbTriangles());
    for (int t = 1; t <= triangulation->NbTriangles(); ++t) {
      int n[3];
      triangulation->Triangle(t).Get(n[0], n[1], n[2]);
      ProximityTriangle tri;
      for (int k = 0; k < 3; ++k) {
        const gp_Pnt p = triangulation->Node(n[k]).Transformed(transform);
        tri.p[k][0] = p.X();
        tri.p[k][1] = p.Y();
        tri.p[k][2] = p.Z();
      }
      proximityTriangleBox(tri);
      f.triangles.push_back(tri);
    }
  }

  static void proximityTriangleBox(ProximityTriangle& t) {
    for (int j = 0; j < 3; ++j) {
      t.lo[j] = std::min({t.p[0][j], t.p[1][j], t.p[2][j]});
      t.hi[j] = std::max({t.p[0][j], t.p[1][j], t.p[2][j]});
    }
  }

  static void proximityMove(ProximityTriangle& t, const gp_Trsf& trsf) {
    for (int k = 0; k < 3; ++k) trsf.Transforms(t.p[k][0], t.p[k][1], t.p[k][2]);
    proximityTriangleBox(t);
  }

  /** The smallest distance between two triangle sets, or `cutoff` if none is nearer. */
  static double proximityMeshDistance(const std::vector<ProximityTriangle>& a,
                                      const std::vector<ProximityTriangle>& b, double cutoff) {
    double best = cutoff;
    for (const ProximityTriangle& ta : a) {
      for (const ProximityTriangle& tb : b) {
        // The boxes' distance first: most triangles are far apart.
        double gap = 0;
        for (int j = 0; j < 3; ++j) {
          const double g = std::max(ta.lo[j] - tb.hi[j], tb.lo[j] - ta.hi[j]);
          if (g > 0) gap += g * g;
        }
        if (gap >= best * best) continue;
        best = std::min(best, proximityTriangles(ta, tb));
        if (best <= 0) return 0;
      }
    }
    return best;
  }

  static double proximityDot(const double a[3], const double b[3]) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  static void proximitySub(const double a[3], const double b[3], double out[3]) {
    for (int j = 0; j < 3; ++j) out[j] = a[j] - b[j];
  }

  /** Squared distance from point p to triangle t (Ericson, Real-Time Collision Detection 5.1.5). */
  static double proximityPointTriangle(const double p[3], const ProximityTriangle& t) {
    const double* a = t.p[0];
    const double* b = t.p[1];
    const double* c = t.p[2];
    double ab[3], ac[3], ap[3], q[3];
    proximitySub(b, a, ab);
    proximitySub(c, a, ac);
    proximitySub(p, a, ap);
    const auto at = [&](double u, double v) {
      for (int j = 0; j < 3; ++j) q[j] = a[j] + u * ab[j] + v * ac[j];
      double d[3];
      proximitySub(p, q, d);
      return proximityDot(d, d);
    };
    const double d1 = proximityDot(ab, ap);
    const double d2 = proximityDot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return at(0, 0);
    double bp[3];
    proximitySub(p, b, bp);
    const double d3 = proximityDot(ab, bp);
    const double d4 = proximityDot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return at(1, 0);
    const double vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
    double cp[3];
    proximitySub(p, c, cp);
    const double d5 = proximityDot(ab, cp);
    const double d6 = proximityDot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return at(0, 1);
    const double vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
    const double va = d3 * d6 - d5 * d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      const double w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      return at(1 - w, w);
    }
    const double denom = 1 / (va + vb + vc);
    return at(vb * denom, vc * denom);
  }

  /** Squared distance between segments p1q1 and p2q2 (Ericson 5.1.9). */
  static double proximitySegments(const double p1[3], const double q1[3], const double p2[3],
                                  const double q2[3]) {
    double d1[3], d2[3], r[3];
    proximitySub(q1, p1, d1);
    proximitySub(q2, p2, d2);
    proximitySub(p1, p2, r);
    const double a = proximityDot(d1, d1);
    const double e = proximityDot(d2, d2);
    const double f = proximityDot(d2, r);
    double s = 0;
    double t = 0;
    const double eps = 1e-30;
    if (a <= eps && e <= eps) {
      s = t = 0;
    } else if (a <= eps) {
      t = std::clamp(f / e, 0.0, 1.0);
    } else {
      const double c = proximityDot(d1, r);
      if (e <= eps) {
        s = std::clamp(-c / a, 0.0, 1.0);
      } else {
        const double b = proximityDot(d1, d2);
        const double denom = a * e - b * b;
        s = denom > eps ? std::clamp((b * f - c * e) / denom, 0.0, 1.0) : 0.0;
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = std::clamp(-c / a, 0.0, 1.0);
        } else if (t > 1) {
          t = 1;
          s = std::clamp((b - c) / a, 0.0, 1.0);
        }
      }
    }
    double d = 0;
    for (int j = 0; j < 3; ++j) {
      const double x = (p1[j] + d1[j] * s) - (p2[j] + d2[j] * t);
      d += x * x;
    }
    return d;
  }

  /** Whether segment pq crosses triangle t (Möller–Trumbore, both ends included). */
  static bool proximityCrosses(const double p[3], const double q[3], const ProximityTriangle& t) {
    double dir[3], e1[3], e2[3], h[3], sv[3], qv[3];
    proximitySub(q, p, dir);
    proximitySub(t.p[1], t.p[0], e1);
    proximitySub(t.p[2], t.p[0], e2);
    h[0] = dir[1] * e2[2] - dir[2] * e2[1];
    h[1] = dir[2] * e2[0] - dir[0] * e2[2];
    h[2] = dir[0] * e2[1] - dir[1] * e2[0];
    const double a = proximityDot(e1, h);
    if (std::abs(a) < 1e-30) return false;  // parallel: the edge distances cover it
    const double f = 1 / a;
    proximitySub(p, t.p[0], sv);
    const double u = f * proximityDot(sv, h);
    if (u < 0 || u > 1) return false;
    qv[0] = sv[1] * e1[2] - sv[2] * e1[1];
    qv[1] = sv[2] * e1[0] - sv[0] * e1[2];
    qv[2] = sv[0] * e1[1] - sv[1] * e1[0];
    const double v = f * proximityDot(dir, qv);
    if (v < 0 || u + v > 1) return false;
    const double w = f * proximityDot(e2, qv);
    return w >= 0 && w <= 1;
  }

  /** The distance between two triangles: 0 where they cross. */
  static double proximityTriangles(const ProximityTriangle& a, const ProximityTriangle& b) {
    for (int k = 0; k < 3; ++k) {
      if (proximityCrosses(a.p[k], a.p[(k + 1) % 3], b)) return 0;
      if (proximityCrosses(b.p[k], b.p[(k + 1) % 3], a)) return 0;
    }
    double best = Precision::Infinite();
    for (int k = 0; k < 3; ++k) {
      best = std::min(best, proximityPointTriangle(a.p[k], b));
      best = std::min(best, proximityPointTriangle(b.p[k], a));
      for (int l = 0; l < 3; ++l) {
        best = std::min(best, proximitySegments(a.p[k], a.p[(k + 1) % 3], b.p[l], b.p[(l + 1) % 3]));
      }
    }
    return std::sqrt(best);
  }

  static void proximitySolids(const TopoDS_Shape& shape, std::vector<ProximitySolid>& out) {
    for (TopExp_Explorer it(shape, TopAbs_SOLID); it.More(); it.Next()) {
      ProximitySolid s;
      s.solid = it.Current();
      TopExp_Explorer vertex(s.solid, TopAbs_VERTEX);
      if (!vertex.More()) continue;
      s.probe = BRep_Tool::Pnt(TopoDS::Vertex(vertex.Current()));
      Bnd_Box box;
      BRepBndLib::AddOptimal(s.solid, box, false, true);
      proximityBox(box, s.centre, s.half);
      out.push_back(s);
    }
  }

  /**
   * A lower bound of the distance between an oriented box (centre `a`, unit
   * axes `axes[k]`, half-sizes `ha`) and an axis-aligned one (`b`, `hb`): the
   * widest gap between their shadows on the 15 separating axes. A shadow on a
   * unit axis is never longer than the distance it comes from, so the bound
   * is safe, and it is exact for boxes apart across a face.
   */
  static double proximityBound(const double a[3], const double axes[3][3], const double ha[3],
                               const double b[3], const double hb[3]) {
    const double d[3] = {b[0] - a[0], b[1] - a[1], b[2] - a[2]};
    // A sphere first: most pairs are far apart.
    const double ra = std::sqrt(ha[0] * ha[0] + ha[1] * ha[1] + ha[2] * ha[2]);
    const double rb = std::sqrt(hb[0] * hb[0] + hb[1] * hb[1] + hb[2] * hb[2]);
    const double centres = std::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    double best = centres - ra - rb;
    const auto gap = [&](const double l[3]) {
      double rA = 0;
      for (int k = 0; k < 3; ++k) {
        rA += ha[k] * std::abs(l[0] * axes[k][0] + l[1] * axes[k][1] + l[2] * axes[k][2]);
      }
      const double rB = hb[0] * std::abs(l[0]) + hb[1] * std::abs(l[1]) + hb[2] * std::abs(l[2]);
      return std::abs(l[0] * d[0] + l[1] * d[1] + l[2] * d[2]) - rA - rB;
    };
    for (int j = 0; j < 3; ++j) {
      double l[3] = {0, 0, 0};
      l[j] = 1;
      best = std::max(best, gap(l));
    }
    for (int k = 0; k < 3; ++k) best = std::max(best, gap(axes[k]));
    for (int j = 0; j < 3; ++j) {
      for (int k = 0; k < 3; ++k) {
        const double* u = axes[k];
        // e_j × u_k, normalised.
        double l[3] = {0, 0, 0};
        l[(j + 1) % 3] = -u[(j + 2) % 3];
        l[(j + 2) % 3] = u[(j + 1) % 3];
        const double n = std::sqrt(l[0] * l[0] + l[1] * l[1] + l[2] * l[2]);
        if (n < 1e-9) continue;
        for (double& c : l) c /= n;
        best = std::max(best, gap(l));
      }
    }
    return std::max(0.0, best);
  }

  /** Whether a box (centre, half) moved by `trsf` lies inside another (axis-aligned). */
  static bool proximityBoxInside(const double c[3], const double h[3], const gp_Trsf& trsf,
                                 const double oc[3], const double oh[3]) {
    for (int corner = 0; corner < 8; ++corner) {
      gp_Pnt p(c[0] + ((corner & 1) ? h[0] : -h[0]), c[1] + ((corner & 2) ? h[1] : -h[1]),
               c[2] + ((corner & 4) ? h[2] : -h[2]));
      p.Transform(trsf);
      const double q[3] = {p.X(), p.Y(), p.Z()};
      for (int k = 0; k < 3; ++k) {
        if (std::abs(q[k] - oc[k]) > oh[k]) return false;
      }
    }
    return true;
  }

  static bool proximityIn(ProximitySolid& solid, const gp_Pnt& p) {
    if (!solid.classifier) solid.classifier = std::make_shared<BRepClass3d_SolidClassifier>(solid.solid);
    solid.classifier->Perform(p, Precision::Confusion());
    return solid.classifier->State() == TopAbs_IN;
  }

  /**
   * With no face near another: whether a solid of one shape lies inside a
   * solid of the other at this pose (only asked where its box fits in the
   * other's), and a point of the inner one.
   */
  static bool proximityInside(ProximitySession& s, const gp_Trsf& trsf, gp_Pnt& inner) {
    const gp_Trsf back = trsf.Inverted();
    for (ProximitySolid& a : s.movingSolids) {
      for (ProximitySolid& b : s.otherSolids) {
        if (proximityBoxInside(a.centre, a.half, trsf, b.centre, b.half)) {
          const gp_Pnt p = a.probe.Transformed(trsf);
          if (proximityIn(b, p)) {
            inner = p;
            return true;
          }
        }
        if (proximityBoxInside(b.centre, b.half, back, a.centre, a.half)) {
          if (proximityIn(a, b.probe.Transformed(back))) {
            inner = b.probe;
            return true;
          }
        }
      }
    }
    return false;
  }
  int nextHandle_;
  std::vector<int> args_;
  std::vector<int> blends_;
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
  /** The settings of every STEP transfer: AP242, millimetres (P2-12). */
  static DESTEP_Parameters stepParameters() {
    DESTEP_Parameters parameters;
    parameters.WriteSchema = DESTEP_Parameters::WriteMode_StepSchema_AP242DIS;
    parameters.WriteUnit = UnitsMethods_LengthUnit_Millimeter;
    return parameters;
  }

  /** Whether stageStepColor() gave any staged part a colour. */
  bool stepColored() const {
    for (size_t i = 0; i < args_.size() && 3 * i + 2 < stepColors_.size(); ++i) {
      if (stepColors_[3 * i] >= 0) return true;
    }
    return false;
  }

  /**
   * OCCT names products "<name> <level>" ("Product 1"): the first product a
   * transfer made (its root), scanning on from `scanned`, gets part i's name
   * as is.
   */
  void nameStepProduct(const Handle(StepData_StepModel)& model, int& scanned, size_t i) const {
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

  /**
   * writeStep() with colours: each part a free shape of an XCAF document
   * (with its colour as XCAFDoc_ColorSurf on its label), transferred one
   * label at a time so its product is named as on the plain path; names stay
   * ours (XDE's name mode off), colours are XDE's styled items.
   */
  int writeStepXde() {
    // Declared first, so the writer (which keeps labels) goes before it.
    Handle(TDocStd_Document) doc = new TDocStd_Document("BinXCAF");
    XCAFDoc_DocumentTool::Set(doc->Main(), false);
    XCAFDoc_DocumentTool::SetLengthUnit(doc, 1, UnitsMethods_LengthUnit_Millimeter);
    int result = -1;
    {
      const Handle(XCAFDoc_ShapeTool) shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
      const Handle(XCAFDoc_ColorTool) colors = XCAFDoc_DocumentTool::ColorTool(doc->Main());
      STEPCAFControl_Writer writer;
      writer.SetNameMode(false);
      writer.SetLayerMode(false);
      writer.SetPropsMode(false);
      writer.SetMetadataMode(false);
      writer.SetSHUOMode(false);
      writer.SetDimTolMode(false);
      writer.SetMaterialMode(false);
      int scanned = 0;
      bool ok = true;
      for (size_t i = 0; ok && i < args_.size(); ++i) {
        const TDF_Label label = shapes->AddShape(*find(args_[i]), false, false);
        if (3 * i + 2 < stepColors_.size() && stepColors_[3 * i] >= 0) {
          const Quantity_Color color(clamp01(stepColors_[3 * i]), clamp01(stepColors_[3 * i + 1]),
                                     clamp01(stepColors_[3 * i + 2]), Quantity_TOC_sRGB);
          colors->SetColor(label, color, XCAFDoc_ColorSurf);
        }
        if (!writer.Transfer(label, stepParameters())) {
          ok = false;
          failExport("STEP export failed: a body couldn't be translated.");
          break;
        }
        nameStepProduct(writer.ChangeWriter().Model(), scanned, i);
      }
      if (ok) {
        std::ostringstream out;
        if (writer.WriteStream(out) != IFSelect_RetDone) {
          failExport("STEP export failed: the file couldn't be written.");
        } else {
          exportText_ = out.str();
          result = static_cast<int>(exportText_.size());
        }
      }
    }
    doc->Main().Root().ForgetAllAttributes(true);
    return result;
  }

  /** Whether pushStepGroup() put any staged part in a group that has a name. */
  bool stepGrouped() const {
    for (size_t i = 0; i < args_.size() && i < stepGroups_.size(); ++i) {
      const int g = stepGroups_[i];
      if (g >= 0 && static_cast<size_t>(g) < stepGroupNames_.size()) return true;
    }
    return false;
  }

  /**
   * writeStep() with groups (P6-05, ADR-0081 §7): an XCAF document holding
   * one assembly per group, named after it, whose components are its parts
   * at identity, and the parts in no group as free shapes. Every label is
   * named through TDataStd_Name and written with XDE's name mode, so the
   * names (already STEP strings) reach the products as they are; colours are
   * the parts' as in writeStepXde(). The groups are transferred in order,
   * then the loose parts.
   */
  int writeStepAssembly() {
    // Declared first, so the writer (which keeps labels) goes before it.
    Handle(TDocStd_Document) doc = new TDocStd_Document("BinXCAF");
    XCAFDoc_DocumentTool::Set(doc->Main(), false);
    XCAFDoc_DocumentTool::SetLengthUnit(doc, 1, UnitsMethods_LengthUnit_Millimeter);
    int result = -1;
    {
      const Handle(XCAFDoc_ShapeTool) shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
      const Handle(XCAFDoc_ColorTool) colors = XCAFDoc_DocumentTool::ColorTool(doc->Main());
      std::vector<TDF_Label> groups;
      std::vector<bool> used(stepGroupNames_.size(), false);
      for (size_t i = 0; i < args_.size() && i < stepGroups_.size(); ++i) {
        const int g = stepGroups_[i];
        if (g >= 0 && static_cast<size_t>(g) < used.size()) used[g] = true;
      }
      for (size_t g = 0; g < stepGroupNames_.size(); ++g) {
        TDF_Label label;
        if (used[g]) {
          label = shapes->NewShape();
          TDataStd_Name::Set(label, TCollection_ExtendedString(stepGroupNames_[g].c_str()));
        }
        groups.push_back(label);
      }
      std::vector<TDF_Label> loose;
      for (size_t i = 0; i < args_.size(); ++i) {
        const TDF_Label label = shapes->AddShape(*find(args_[i]), false, false);
        if (3 * i + 2 < stepColors_.size() && stepColors_[3 * i] >= 0) {
          const Quantity_Color color(clamp01(stepColors_[3 * i]), clamp01(stepColors_[3 * i + 1]),
                                     clamp01(stepColors_[3 * i + 2]), Quantity_TOC_sRGB);
          colors->SetColor(label, color, XCAFDoc_ColorSurf);
        }
        if (i < stepNames_.size() && !stepNames_[i].empty()) {
          TDataStd_Name::Set(label, TCollection_ExtendedString(stepNames_[i].c_str()));
        }
        const int g = i < stepGroups_.size() ? stepGroups_[i] : -1;
        if (g >= 0 && static_cast<size_t>(g) < groups.size()) {
          shapes->AddComponent(groups[g], label, TopLoc_Location());
        } else {
          loose.push_back(label);
        }
      }
      shapes->UpdateAssemblies();
      STEPCAFControl_Writer writer;
      writer.SetNameMode(true);
      writer.SetLayerMode(false);
      writer.SetPropsMode(false);
      writer.SetMetadataMode(false);
      writer.SetSHUOMode(false);
      writer.SetDimTolMode(false);
      writer.SetMaterialMode(false);
      bool ok = true;
      std::vector<TDF_Label> roots;
      for (const TDF_Label& label : groups) {
        if (!label.IsNull()) roots.push_back(label);
      }
      roots.insert(roots.end(), loose.begin(), loose.end());
      for (const TDF_Label& label : roots) {
        if (!writer.Transfer(label, stepParameters())) {
          ok = false;
          failExport("STEP export failed: a body couldn't be translated.");
          break;
        }
      }
      if (ok) {
        std::ostringstream out;
        if (writer.WriteStream(out) != IFSelect_RetDone) {
          failExport("STEP export failed: the file couldn't be written.");
        } else {
          exportText_ = out.str();
          result = static_cast<int>(exportText_.size());
        }
      }
    }
    doc->Main().Root().ForgetAllAttributes(true);
    return result;
  }

  static double clamp01(double v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /** A label's colour: XCAFDoc_ColorSurf, else XCAFDoc_ColorGen. */
  static bool stepLabelColor(const TDF_Label& label, Quantity_Color& color) {
    return XCAFDoc_ColorTool::GetColor(label, XCAFDoc_ColorSurf, color) ||
           XCAFDoc_ColorTool::GetColor(label, XCAFDoc_ColorGen, color);
  }

  /** A label's name (`TDataStd_Name`) as UTF-8, empty when it has none. */
  static bool stepLabelName(const TDF_Label& label, std::string& name) {
    Handle(TDataStd_Name) attr;
    if (!label.FindAttribute(TDataStd_Name::GetID(), attr)) return false;
    const TCollection_ExtendedString& ext = attr->Get();
    if (ext.IsEmpty()) return false;
    TCollection_AsciiString utf8(ext, true);
    name = utf8.ToCString();
    return !name.empty();
  }

  /**
   * readStepColors()'s walk: an assembly's components in order (each passes
   * down its own instance colour, else the one it was given), a part's solids
   * in TopExp::MapShapes order (each its own sub-shape colour, else the
   * part's, else the instance's), so the solids come in the order the
   * compound of the file's roots lists them.
   */
  void stepSolidColors(const Handle(XCAFDoc_ShapeTool)& shapes, const TDF_Label& label,
                       const Quantity_Color* inherited) {
    Quantity_Color own;
    const Quantity_Color* given = stepLabelColor(label, own) ? &own : inherited;
    TDF_Label referred;
    if (XCAFDoc_ShapeTool::IsReference(label) && XCAFDoc_ShapeTool::GetReferredShape(label, referred)) {
      stepSolidColors(shapes, referred, given);
      return;
    }
    if (XCAFDoc_ShapeTool::IsAssembly(label)) {
      NCollection_Sequence<TDF_Label> components;
      XCAFDoc_ShapeTool::GetComponents(label, components, false);
      for (NCollection_Sequence<TDF_Label>::Iterator c(components); c.More(); c.Next()) {
        stepSolidColors(shapes, c.Value(), given);
      }
      return;
    }
    const TopoDS_Shape part = XCAFDoc_ShapeTool::GetShape(label);
    if (part.IsNull()) return;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> solids;
    TopExp::MapShapes(part, TopAbs_SOLID, solids);
    for (int i = 1; i <= solids.Extent(); ++i) {
      Quantity_Color color;
      const Quantity_Color* found = given;
      TDF_Label sub;
      if (shapes->FindSubShape(label, solids(i), sub) && stepLabelColor(sub, color)) found = &color;
      if (found == nullptr) {
        geometry_.insert(geometry_.end(), {-1.0, -1.0, -1.0});
      } else {
        double r = 0, g = 0, b = 0;
        found->Values(r, g, b, Quantity_TOC_sRGB);
        geometry_.insert(geometry_.end(), {r, g, b});
      }
    }
  }

  /**
   * readStepNames()'s walk, the same shape as stepSolidColors(): an assembly's
   * components in order (each passes down its own instance name, else the one
   * it was given), a part's solids in TopExp::MapShapes order (each its own
   * sub-shape name, else the part's, else the instance's), one entry per solid
   * (empty for none) in readNames_.
   */
  void stepSolidNames(const Handle(XCAFDoc_ShapeTool)& shapes, const TDF_Label& label,
                      const std::string* inherited) {
    std::string own;
    const std::string* given = stepLabelName(label, own) ? &own : inherited;
    TDF_Label referred;
    if (XCAFDoc_ShapeTool::IsReference(label) && XCAFDoc_ShapeTool::GetReferredShape(label, referred)) {
      stepSolidNames(shapes, referred, given);
      return;
    }
    if (XCAFDoc_ShapeTool::IsAssembly(label)) {
      NCollection_Sequence<TDF_Label> components;
      XCAFDoc_ShapeTool::GetComponents(label, components, false);
      for (NCollection_Sequence<TDF_Label>::Iterator c(components); c.More(); c.Next()) {
        stepSolidNames(shapes, c.Value(), given);
      }
      return;
    }
    const TopoDS_Shape part = XCAFDoc_ShapeTool::GetShape(label);
    if (part.IsNull()) return;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> solids;
    TopExp::MapShapes(part, TopAbs_SOLID, solids);
    for (int i = 1; i <= solids.Extent(); ++i) {
      std::string name;
      const std::string* found = given;
      TDF_Label sub;
      if (shapes->FindSubShape(label, solids(i), sub) && stepLabelName(sub, name)) found = &name;
      readNames_.push_back(found == nullptr ? std::string() : *found);
    }
  }

  std::vector<std::string> stepNames_;
  /** Per staged STEP part, [r, g, b] in 0..1 (sRGB), or -1s for none (P4-12). */
  std::vector<double> stepColors_;
  /** Per staged STEP part, its group's index or -1, and the groups' names (P6-05). */
  std::vector<int> stepGroups_;
  std::vector<std::string> stepGroupNames_;
  /** readStepNames(): one name per solid of the file, in readStep order. */
  std::vector<std::string> readNames_;
  /** The names above joined by '\0', which JS copies out (readNamesPtr/Size). */
  std::string readNameText_;
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
  /** Mesh to Solid's input (meshNodes, meshTriangles) and its report. */
  std::vector<double> meshNodes_;
  std::vector<uint32_t> meshTriangles_;
  std::vector<double> meshReport_;
  /** meshRegions' output: a surface index per triangle, a kind per surface. */
  std::vector<int32_t> meshRegionOf_;
  std::vector<int32_t> meshRegionKinds_;
  /** Faceted refuses a result with more faces than this (ADR-0097 §3; 5,000 since slice D4). */
  static constexpr int FACETED_FACE_CAP = 5000;
  /** The pre-count refuses only this far over the cap: the estimate over-counts by up to about 40 % on real meshes (ADR-0097, 2026-10-22 slice D). */
  static constexpr double FACETED_ESTIMATE_MARGIN = 1.5;

  /**
   * What faceted would produce, from the triangle buffers alone (ADR-0097 §3,
   * 2026-10-22): adjacent triangles (sharing an edge) whose unit normals agree
   * within 1e-3 rad and whose planes agree within 1e-3 mm are one face — the
   * tolerances ShapeUpgrade_UnifySameDomain gets — with a union-find over the
   * triangles; the number of groups is the estimate. A zero-area triangle joins
   * a neighbour. Also counts the mesh's non-manifold edges (shared by more than
   * two triangles), open edges (used by one) and pinched vertices (a vertex
   * whose triangles belong to more than one edge-connected shell), the reasons
   * a closed solid is refused. Returns false when a triangle refers to a node
   * the mesh doesn't have.
   */
  bool facetedMeshCounts(int& estimate, int& nonManifoldEdges, int& openEdges, int& nonManifoldVertices) {
    const int nodes = static_cast<int>(meshNodes_.size() / 3);
    const int triangles = static_cast<int>(meshTriangles_.size() / 3);
    estimate = nonManifoldEdges = openEdges = nonManifoldVertices = 0;
    if (triangles == 0) return true;
    const uint32_t nodeCount = static_cast<uint32_t>(nodes);
    struct EdgeUse {
      uint64_t key;
      int triangle;
    };
    std::vector<EdgeUse> uses;
    uses.reserve(static_cast<size_t>(triangles) * 3);
    for (int t = 0; t < triangles; ++t) {
      const uint32_t a = meshTriangles_[3 * t], b = meshTriangles_[3 * t + 1], c = meshTriangles_[3 * t + 2];
      if (a >= nodeCount || b >= nodeCount || c >= nodeCount) return false;
      const uint32_t v[3] = {a, b, c};
      for (int k = 0; k < 3; ++k) {
        const uint32_t x = v[k], y = v[(k + 1) % 3];
        uses.push_back({(static_cast<uint64_t>(std::min(x, y)) << 32) | std::max(x, y), t});
      }
    }
    std::sort(uses.begin(), uses.end(), [](const EdgeUse& l, const EdgeUse& r) { return l.key < r.key; });
    // Per-triangle unit normal and first corner, for the coplanar test.
    std::vector<std::array<double, 3>> normal(triangles), corner(triangles);
    std::vector<char> degenerate(triangles, 0);
    for (int t = 0; t < triangles; ++t) {
      const int p0 = 3 * meshTriangles_[3 * t], p1 = 3 * meshTriangles_[3 * t + 1], p2 = 3 * meshTriangles_[3 * t + 2];
      const double ax = meshNodes_[p0], ay = meshNodes_[p0 + 1], az = meshNodes_[p0 + 2];
      const double ux = meshNodes_[p1] - ax, uy = meshNodes_[p1 + 1] - ay, uz = meshNodes_[p1 + 2] - az;
      const double vx = meshNodes_[p2] - ax, vy = meshNodes_[p2 + 1] - ay, vz = meshNodes_[p2 + 2] - az;
      const double nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const double len = std::sqrt(nx * nx + ny * ny + nz * nz);
      corner[t] = {ax, ay, az};
      if (len <= 1e-12) {
        degenerate[t] = 1;
        normal[t] = {0, 0, 0};
      } else {
        normal[t] = {nx / len, ny / len, nz / len};
      }
      // The shared edge's two nodes decide which vertex of a neighbour may be off the plane.
    }
    auto find = [](std::vector<int>& p, int x) {
      while (p[x] != x) {
        p[x] = p[p[x]];
        x = p[x];
      }
      return x;
    };
    std::vector<int> group(triangles), shell(triangles);
    for (int t = 0; t < triangles; ++t) group[t] = shell[t] = t;
    auto join = [&](std::vector<int>& p, int a, int b) {
      const int ra = find(p, a), rb = find(p, b);
      if (ra != rb) p[ra] = rb;
    };
    const double cosTolerance = std::cos(1e-3);
    size_t i = 0;
    while (i < uses.size()) {
      size_t j = i + 1;
      while (j < uses.size() && uses[j].key == uses[i].key) ++j;
      const int count = static_cast<int>(j - i);
      if (count == 1) ++openEdges;
      else if (count > 2) ++nonManifoldEdges;
      const int first = uses[i].triangle;
      const uint32_t lo = static_cast<uint32_t>(uses[i].key >> 32), hi = static_cast<uint32_t>(uses[i].key & 0xffffffffu);
      for (size_t k = i + 1; k < j; ++k) {
        const int other = uses[k].triangle;
        join(shell, first, other);
        if (degenerate[first] || degenerate[other]) {
          join(group, first, other);
          continue;
        }
        const double dot = normal[first][0] * normal[other][0] + normal[first][1] * normal[other][1] +
                           normal[first][2] * normal[other][2];
        if (dot < cosTolerance) continue;
        const uint32_t oa = meshTriangles_[3 * other], ob = meshTriangles_[3 * other + 1], oc = meshTriangles_[3 * other + 2];
        const uint32_t third = (oa != lo && oa != hi) ? oa : ((ob != lo && ob != hi) ? ob : oc);
        const int q = 3 * third;
        const double off = normal[first][0] * (meshNodes_[q] - corner[first][0]) +
                           normal[first][1] * (meshNodes_[q + 1] - corner[first][1]) +
                           normal[first][2] * (meshNodes_[q + 2] - corner[first][2]);
        if (std::fabs(off) <= 1e-3) join(group, first, other);
      }
      i = j;
    }
    for (int t = 0; t < triangles; ++t)
      if (find(group, t) == t) ++estimate;
    // A vertex is pinched when its triangles belong to more than one edge-connected shell.
    std::vector<int> nodeShell(nodes, -1);
    std::vector<char> pinched(nodes, 0);
    for (int t = 0; t < triangles; ++t) {
      const int root = find(shell, t);
      for (int k = 0; k < 3; ++k) {
        const uint32_t v = meshTriangles_[3 * t + k];
        if (nodeShell[v] < 0) nodeShell[v] = root;
        else if (nodeShell[v] != root) pinched[v] = 1;
      }
    }
    for (int v = 0; v < nodes; ++v)
      if (pinched[v]) ++nonManifoldVertices;
    return true;
  }

  /**
   * Makes one solid per closed shell, with a shell whose faces enclose a
   * negative volume (below -1e-6 x max(1, |meshVolume|), ADR-0097 slice D1's
   * rule) as a **cavity**: never a solid of its own, but an inner shell of
   * the solid that contains one of its nodes. `shells` and `insidePoints`
   * are parallel (a point on each shell, strictly inside the solid that
   * holds it); the non-cavity solids are appended to `solids`. The hybrid
   * and (slice D2) faceted both call this. Returns false with `why` when a
   * shell won't make a solid ("MakeSolid failed") or a cavity won't go in
   * ("a cavity that won't go in its solid") or lies in none ("a cavity in no
   * solid").
   */
  bool solidsWithCavities(const std::vector<TopoDS_Shell>& shells,
                          const std::vector<gp_Pnt>& insidePoints,
                          double meshVolume,
                          std::vector<TopoDS_Shape>& solids,
                          std::string& why) {
    std::vector<std::pair<TopoDS_Shell, gp_Pnt>> cavities;
    for (size_t i = 0; i < shells.size(); ++i) {
      BRepBuilderAPI_MakeSolid makeSolid(shells[i]);
      if (!makeSolid.IsDone()) {
        why = "MakeSolid failed";
        return false;
      }
      TopoDS_Shape solid = makeSolid.Solid();
      // A real void (a sliver's rounding of ±1e-17 mm³ is no cavity).
      if (volumeOf(solid) < -1e-6 * std::max(1.0, std::fabs(meshVolume))) {
        cavities.push_back({shells[i], insidePoints[i]});
        continue;
      }
      solids.push_back(solid);
    }
    for (const auto& [cavity, inside] : cavities) {
      bool held = false;
      for (TopoDS_Shape& solid : solids) {
        if (BRepClass3d_SolidClassifier(solid, inside, 1e-7).State() != TopAbs_IN) continue;
        BRepBuilderAPI_MakeSolid hollow(TopoDS::Solid(solid));
        hollow.Add(cavity);
        if (!hollow.IsDone()) {
          why = "a cavity that won't go in its solid";
          return false;
        }
        solid = hollow.Solid();
        held = true;
        break;
      }
      if (!held) {
        why = "a cavity in no solid";
        return false;
      }
    }
    return true;
  }

  /** meshToSolid's faceted method (ADR-0097 §3), over the staged buffers. */
  int facetedFromMesh() {
    static const char* const notClosed =
        "Mesh to Solid couldn't make a closed solid from this mesh: repair it in your slicer or a mesh tool and try again.";
    // FACETED_DEBUG=1 tells which refusal fired (ADR-0097 §3, 2026-10-22).
    auto debug = [] {
      const char* flag = std::getenv("FACETED_DEBUG");
      return flag != nullptr && *flag != '\0';
    };
    auto notClosedAt = [&](const char* where) {
      if (debug()) std::fprintf(stderr, "[faceted] notClosed at %s\n", where);
      return fail(notClosed);
    };
    try {
      const int nodes = static_cast<int>(meshNodes_.size() / 3);
      const int triangles = static_cast<int>(meshTriangles_.size() / 3);
      if (nodes == 0 || triangles == 0) return fail("Mesh to Solid failed: the mesh is empty.");
      // The face count first, so an over-cap mesh is refused before anything is built.
      int estimate = 0, nonManifoldEdges = 0, openEdges = 0, nonManifoldVertices = 0;
      if (!facetedMeshCounts(estimate, nonManifoldEdges, openEdges, nonManifoldVertices))
        return fail("Mesh to Solid failed: the mesh refers to a node it doesn't have.");
      if (debug()) std::fprintf(stderr, "[faceted] estimate %d faces from %d triangles\n", estimate, triangles);
      // The estimate over-counts by up to about 40 % on real meshes
      // (ADR-0097, 2026-10-22 slice D), so it refuses only past the cap times
      // the margin; between the cap and that the build runs and the exact
      // count below decides.
      if (estimate > FACETED_FACE_CAP * FACETED_ESTIMATE_MARGIN) {
        const std::string message = "Faceted would give about " + std::to_string(estimate) +
                                    " faces; Extrudo converts up to " + thousands(FACETED_FACE_CAP) +
                                    ". Use Prismatic, or simplify the mesh in your slicer.";
        return fail(message.c_str());
      }
      // A refusal names the reason (ADR-0097 §3, 2026-10-22): what happened, then what to do.
      auto refuseReason = [&](const std::string& clause) {
        return fail(("Mesh to Solid couldn't make a closed solid from this mesh: " + clause +
                     " Repair it in your slicer or a mesh tool and try again.")
                        .c_str());
      };
      if (nonManifoldEdges > 0)
        return refuseReason(std::to_string(nonManifoldEdges) +
                            (nonManifoldEdges == 1 ? " edge is shared by more than two triangles." : " edges are shared by more than two triangles."));
      if (openEdges > 0)
        return refuseReason(std::to_string(openEdges) +
                            (openEdges == 1 ? " edge has only one triangle." : " edges have only one triangle."));
      if (nonManifoldVertices > 0)
        return refuseReason(std::to_string(nonManifoldVertices) +
                            (nonManifoldVertices == 1 ? " vertex joins shells that only touch at a point." : " vertices join shells that only touch at a point."));
      Handle(Poly_Triangulation) mesh = new Poly_Triangulation(nodes, triangles, false);
      for (int i = 0; i < nodes; ++i) {
        mesh->SetNode(i + 1, gp_Pnt(meshNodes_[3 * i], meshNodes_[3 * i + 1], meshNodes_[3 * i + 2]));
      }
      for (int i = 0; i < triangles; ++i) {
        const uint32_t a = meshTriangles_[3 * i], b = meshTriangles_[3 * i + 1], c = meshTriangles_[3 * i + 2];
        mesh->SetTriangle(i + 1, Poly_Triangle(a + 1, b + 1, c + 1));
      }
      BRepBuilderAPI_MakeShapeOnMesh maker(mesh);
      maker.Build();
      if (!maker.IsDone()) return fail("Mesh to Solid failed: OCCT couldn't build faces on this mesh.");
      std::vector<TopoDS_Shape> allFaces;
      for (TopExp_Explorer face(maker.Shape(), TopAbs_FACE); face.More(); face.Next()) allFaces.push_back(face.Current());
      const int faceCount = static_cast<int>(allFaces.size());
      if (faceCount == 0) return fail("Mesh to Solid failed: OCCT couldn't build faces on this mesh.");
      // Faces sharing an edge are one shell; a multi-part STL (disjoint closed
      // shells) becomes one solid per shell and a compound result (ADR-0097 §3).
      std::vector<int> parent(faceCount);
      for (int f = 0; f < faceCount; ++f) parent[f] = f;
      auto faceFind = [&](int x) {
        while (parent[x] != x) {
          parent[x] = parent[parent[x]];
          x = parent[x];
        }
        return x;
      };
      NCollection_DataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher> edgeOwner;
      for (int f = 0; f < faceCount; ++f) {
        for (TopExp_Explorer edge(allFaces[f], TopAbs_EDGE); edge.More(); edge.Next()) {
          const TopoDS_Shape& e = edge.Current();
          if (edgeOwner.IsBound(e)) {
            const int ra = faceFind(f), rb = faceFind(edgeOwner.Find(e));
            if (ra != rb) parent[ra] = rb;
          } else {
            edgeOwner.Bind(e, f);
          }
        }
      }
      std::map<int, std::vector<int>> components;
      for (int f = 0; f < faceCount; ++f) components[faceFind(f)].push_back(f);
      BRep_Builder builder;
      std::vector<TopoDS_Shape> pieces;
      int totalFaces = 0;
      // One solid per shell; a shell whose faces enclose negative volume is a
      // cavity (ADR-0097, slice D2: D1's rule in the hybrid): an inner shell
      // of the solid that holds one of its nodes, never a solid of its own.
      double meshVolume = 0;
      {
        const int triangleCount = static_cast<int>(meshTriangles_.size() / 3);
        for (int t = 0; t < triangleCount; ++t) {
          const gp_XYZ a = meshNode(meshTriangles_[3 * t]), b = meshNode(meshTriangles_[3 * t + 1]),
                        c = meshNode(meshTriangles_[3 * t + 2]);
          meshVolume += a.Dot(b.Crossed(c)) / 6;
        }
      }
      std::vector<TopoDS_Shell> shells;
      std::vector<gp_Pnt> insidePoints;
      for (auto& [root, faceIdx] : components) {
        TopoDS_Shell shell;
        builder.MakeShell(shell);
        for (int f : faceIdx) builder.Add(shell, allFaces[f]);
        shell.Closed(BRep_Tool::IsClosed(shell));
        gp_Pnt inside;
        for (TopExp_Explorer v(shell, TopAbs_VERTEX); v.More(); v.Next()) {
          inside = BRep_Tool::Pnt(TopoDS::Vertex(v.Current()));
          break;
        }
        shells.push_back(shell);
        insidePoints.push_back(inside);
      }
      std::vector<TopoDS_Shape> solids;
      std::string cavityWhy;
      if (!solidsWithCavities(shells, insidePoints, meshVolume, solids, cavityWhy)) {
        if (cavityWhy == "a cavity in no solid") return refuseReason("a hollow lies in no solid.");
        return notClosedAt("solids with cavities");
      }
      for (TopoDS_Shape& solid : solids) {
        ShapeFix_Solid fixSolid(TopoDS::Solid(solid));
        fixSolid.Perform();
        solid = fixSolid.Solid();
        if (solid.IsNull()) return notClosedAt("null solid");
        if (volumeOf(solid) < 0) solid.Reverse();
        if (!BRepCheck_Analyzer(solid).IsValid()) return notClosedAt("invalid before unify");
        ShapeUpgrade_UnifySameDomain unify(solid, true, true, true);
        unify.SetLinearTolerance(1e-3);
        unify.SetAngularTolerance(1e-3);
        unify.Build();
        TopoDS_Shape piece = unify.Shape();
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> pieceFaces;
        TopExp::MapShapes(piece, TopAbs_FACE, pieceFaces);
        totalFaces += pieceFaces.Extent();
        pieces.push_back(piece);
      }
      // The exact count stays a backstop: the estimate can be off by a few faces.
      if (totalFaces > FACETED_FACE_CAP) {
        const std::string message = "Faceted would give " + std::to_string(totalFaces) +
                                    " faces; Extrudo converts up to " + thousands(FACETED_FACE_CAP) +
                                    ". Use Prismatic, or simplify the mesh in your slicer.";
        return fail(message.c_str());
      }
      for (TopoDS_Shape& piece : pieces) {
        if (BRepCheck_Analyzer(piece).IsValid()) continue;
        ShapeFix_Shape healer(piece);
        healer.Perform();
        piece = healer.Shape();
        BRepLib::BuildCurves3d(piece);
        if (!BRepCheck_Analyzer(piece).IsValid()) return notClosedAt("invalid after heal");
      }
      TopoDS_Shape result;
      if (pieces.size() == 1) {
        result = pieces[0];
      } else {
        TopoDS_Compound compound;
        builder.MakeCompound(compound);
        for (const TopoDS_Shape& piece : pieces) builder.Add(compound, piece);
        result = compound;
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
      TopExp::MapShapes(result, TopAbs_FACE, faces);
      int planes = 0;
      for (int i = 1; i <= faces.Extent(); ++i) {
        if (BRepAdaptor_Surface(TopoDS::Face(faces(i))).GetType() == GeomAbs_Plane) ++planes;
      }
      meshReport_ = {static_cast<double>(faces.Extent()), static_cast<double>(planes), 0, 0, 0, 0, 0, 0, 0, -1, -1, 0, -1};
      return store(result);
    } catch (...) {
      return failFromException("Mesh to Solid failed");
    }
  }

  /** Prismatic refuses more recognised surfaces than this (ADR-0097 §3). */
  static constexpr int PRISMATIC_SURFACE_CAP = 500;
  /**
   * Prismatic's rebuild (everything after segmentMesh) gives up after this much
   * wall-clock time (ADR-0097's hardening slice A amendment; 30 s lowered to 12 s in
   * slice D4: the exact files finish in under 5 s each). The overrun inside one
   * long BOPAlgo_MakerVolume step is bounded by the exact stage's skip rule.
   */
  static constexpr double PRISMATIC_REBUILD_BUDGET_MS = 12000;
  /** Unfit regions covering at most this share of the surface area are left out of the rebuild instead of refusing (slice C). */
  static constexpr double PRISMATIC_UNFIT_ALLOWED = 0.02;
  /**
   * Auto's tolerance ladder (ADR-0097, slice D2): a tolerance of 0 or less
   * means Auto, and the kernel tries these in order, stopping at the first
   * step whose unfit share is at most PRISMATIC_UNFIT_ALLOWED (the share the
   * exact rebuild tolerates) and reusing that step's segmentation. When no
   * step qualifies it takes the step with the smallest share (ties: the
   * smaller tolerance). A fixed default was the wrong knob: at 0.01 mm many
   * parts keep hundreds of facets that fit at 0.05 mm, while 0.05 mm makes
   * other parts worse (ADR-0097's D1 sweep).
   */
  static constexpr double MESH_AUTO_LADDER[] = {0.01, 0.02, 0.05, 0.1};
  // Tests and the spike harness (spikes/stl-to-solid) only; the app never calls these.
  /** The budget the next rebuild gets: PRISMATIC_REBUILD_BUDGET_MS, lowered only by the spike harness. */
  double prismaticBudgetMs_ = PRISMATIC_REBUILD_BUDGET_MS;
  /** The last rebuild's oversized faces, one per surface, when the spike harness asks (GAPS=1). */
  bool keepRebuildFaces_ = false;
  std::vector<TopoDS_Shape> rebuildFaces_;
  std::string rebuildWarnings_;
  /** Why the last rebuild refused, for the spike harness (TIMES=1). */
  std::string rebuildRefusal_;
  /** The last rebuild's stage timings in ms (the spike harness prints them under TIMES=1). */
  std::vector<std::pair<std::string, double>> rebuildTimes_;

  static double nowMs() {
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
  }

  /** A progress indicator that breaks the OCCT algorithm it is passed to once a deadline is past. */
  class MeshDeadline : public Message_ProgressIndicator {
   public:
    explicit MeshDeadline(double deadline) : deadline_(deadline) {}
    bool expired() const { return nowMs() > deadline_; }
    /** The time left, ms (negative past the deadline). */
    double left() const { return deadline_ - nowMs(); }

   protected:
    bool UserBreak() override { return expired(); }
    void Show(const Message_ProgressScope&, const bool) override {}

   private:
    double deadline_;
  };

  /**
   * One surface prismatic recognised (ADR-0097 §3, slices 4a1 and 4a2): a
   * plane (kind 0), a cylinder (kind 1), a cone (kind 2), a sphere (kind 3),
   * a torus (kind 4) or an unfit region (kind -1), with the planar regions
   * and triangles it covers.
   */
  struct MeshSurface {
    int kind = -1;
    std::vector<int> regions;
    double area = 0;
    /** A sphere's or torus's centre or a cone's apex, else a point on a plane or a cylinder's axis. */
    gp_Pnt origin;
    /** A plane's normal (outward), a cylinder's, cone's (from the apex to the nodes) or torus's axis, a sphere's frame. */
    gp_Dir direction;
    /** A cylinder's or sphere's radius, a torus's tube radius r. */
    double radius = 0;
    /** A torus's major radius R (its spine circle's). */
    double majorRadius = 0;
    /** A cone's half-angle, radians. */
    double semiAngle = 0;
    /**
     * A curved surface's chord error: r (1 - cos(θ/2)) for a cylinder or a
     * sphere, (ρmax / cos α)(1 - cos(θ/2)) for a cone, (R + r)(1 - cos(θ/2))
     * for a torus.
     */
    double sag = 0;
    /** The smallest tolerance a fitted surface would need here (unfit regions). */
    double deviation = 0;
  };

  /** One planar region of prismatic's segmentation. */
  struct MeshRegion {
    std::vector<int> triangles;
    std::vector<int> nodes;
    double area = 0;
    gp_Pnt origin;
    gp_Dir normal;
  };

  /** A plane a cylinder touches tangentially, and the side of it the axis is on. */
  struct MeshTangent {
    gp_XYZ n, p;
    double side;
  };

  /** A face of prismatic's result (a plane, cylinder, cone, sphere or torus), ready to measure mesh nodes against. */
  struct MeshCheckedFace {
    TopoDS_Face face;
    Bnd_Box box;
    int kind = 0;
    gp_Pln plane;
    gp_Cylinder cylinder;
    gp_Cone cone;
    gp_Sphere sphere;
    gp_Torus torus;
    /** The face's lowest u and v: ElSLib's angles are moved by whole turns to start there. */
    double u0 = 0, v0 = 0;
    std::unique_ptr<BRepTopAdaptor_FClass2d> inside;
  };

  /** A plane, cylinder, cone, sphere or torus fit over a set of mesh nodes (MeshSurface's fields). */
  struct MeshFit {
    bool ok = false;
    gp_Pnt origin;
    gp_Dir direction;
    double radius = 0;
    double majorRadius = 0;
    double semiAngle = 0;
    double deviation = 1e300;
  };

  /** A symmetric 3x3 matrix's eigenvalues, ascending, and their unit eigenvectors (Jacobi rotations). */
  static void symmetricEigen(const double m[3][3], double values[3], gp_XYZ vectors[3]) {
    double a[3][3], v[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
    for (int i = 0; i < 3; ++i)
      for (int j = 0; j < 3; ++j) a[i][j] = m[i][j];
    const double scale = std::fabs(a[0][0]) + std::fabs(a[1][1]) + std::fabs(a[2][2]) + 1e-300;
    for (int sweep = 0; sweep < 60; ++sweep) {
      const double off = std::fabs(a[0][1]) + std::fabs(a[0][2]) + std::fabs(a[1][2]);
      if (off <= 1e-18 * scale) break;
      static const int pairs[3][2] = {{0, 1}, {0, 2}, {1, 2}};
      for (const auto& pq : pairs) {
        const int p = pq[0], q = pq[1];
        if (std::fabs(a[p][q]) <= 1e-300) continue;
        const double theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const double t = (theta >= 0 ? 1.0 : -1.0) / (std::fabs(theta) + std::sqrt(theta * theta + 1));
        const double c = 1 / std::sqrt(t * t + 1), s = t * c;
        for (int k = 0; k < 3; ++k) {
          const double kp = a[k][p], kq = a[k][q];
          a[k][p] = c * kp - s * kq;
          a[k][q] = s * kp + c * kq;
        }
        for (int k = 0; k < 3; ++k) {
          const double pk = a[p][k], qk = a[q][k];
          a[p][k] = c * pk - s * qk;
          a[q][k] = s * pk + c * qk;
        }
        for (int k = 0; k < 3; ++k) {
          const double kp = v[k][p], kq = v[k][q];
          v[k][p] = c * kp - s * kq;
          v[k][q] = s * kp + c * kq;
        }
      }
    }
    int order[3] = {0, 1, 2};
    std::sort(order, order + 3, [&](int i, int j) { return a[i][i] < a[j][j]; });
    for (int i = 0; i < 3; ++i) {
      values[i] = a[order[i]][order[i]];
      vectors[i] = gp_XYZ(v[0][order[i]], v[1][order[i]], v[2][order[i]]);
    }
  }

  /** Solves a 3x3 linear system by Cramer's rule; false when it is singular. */
  static bool solve3(const double m[3][3], const double b[3], double x[3]) {
    auto det = [](const double a[3][3]) {
      return a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
             a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    };
    const double d = det(m);
    double norm = 0;
    for (int i = 0; i < 3; ++i)
      for (int j = 0; j < 3; ++j) norm = std::max(norm, std::fabs(m[i][j]));
    if (!(std::fabs(d) > 1e-14 * norm * norm * norm)) return false;
    for (int c = 0; c < 3; ++c) {
      double t[3][3];
      for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) t[i][j] = j == c ? b[i] : m[i][j];
      x[c] = det(t) / d;
    }
    return true;
  }

  /** Solves an n x n linear system (n <= 8, row-major `a`) by Gaussian elimination with partial pivoting; false when it is singular. */
  static bool solveN(int n, const double* a, const double* b, double* x) {
    double m[8][9];
    double norm = 0;
    for (int i = 0; i < n; ++i) {
      for (int j = 0; j < n; ++j) {
        m[i][j] = a[i * n + j];
        norm = std::max(norm, std::fabs(m[i][j]));
      }
      m[i][n] = b[i];
    }
    if (!(norm > 0)) return false;
    for (int c = 0; c < n; ++c) {
      int pivot = c;
      for (int r = c + 1; r < n; ++r)
        if (std::fabs(m[r][c]) > std::fabs(m[pivot][c])) pivot = r;
      if (!(std::fabs(m[pivot][c]) > 1e-14 * norm)) return false;
      if (pivot != c)
        for (int j = c; j <= n; ++j) std::swap(m[c][j], m[pivot][j]);
      for (int r = c + 1; r < n; ++r) {
        const double f = m[r][c] / m[c][c];
        for (int j = c; j <= n; ++j) m[r][j] -= f * m[c][j];
      }
    }
    for (int r = n - 1; r >= 0; --r) {
      double sum = m[r][n];
      for (int j = r + 1; j < n; ++j) sum -= m[r][j] * x[j];
      x[r] = sum / m[r][r];
    }
    return true;
  }

  gp_XYZ meshNode(int node) const {
    return gp_XYZ(meshNodes_[3 * node], meshNodes_[3 * node + 1], meshNodes_[3 * node + 2]);
  }

  /** The least-squares plane through `nodes`, its normal on the side of `outward`. */
  MeshFit fitMeshPlane(const std::vector<int>& nodes, const gp_XYZ& outward) const {
    MeshFit fit;
    if (nodes.size() < 3) return fit;
    gp_XYZ c(0, 0, 0);
    for (int n : nodes) c += meshNode(n);
    c /= static_cast<double>(nodes.size());
    double m[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    for (int n : nodes) {
      const gp_XYZ d = meshNode(n) - c;
      for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) m[i][j] += d.Coord(i + 1) * d.Coord(j + 1);
    }
    double values[3];
    gp_XYZ vectors[3];
    symmetricEigen(m, values, vectors);
    gp_XYZ normal = vectors[0];
    if (normal.Modulus() < 1e-12) return fit;
    if (normal.Dot(outward) < 0) normal.Reverse();
    fit.origin = gp_Pnt(c);
    fit.direction = gp_Dir(normal);
    fit.deviation = 0;
    const gp_XYZ nd = fit.direction.XYZ();
    for (int n : nodes) fit.deviation = std::max(fit.deviation, std::fabs((meshNode(n) - c).Dot(nd)));
    fit.ok = true;
    return fit;
  }

  /**
   * The cylinder through `nodes`: the axis is the facet normals' direction of
   * least spread (their area-weighted covariance's smallest eigenvector), the
   * centre and radius an algebraic circle fit of the nodes projected along it,
   * refined by Gauss-Newton on the geometric distance.
   */
  MeshFit fitMeshCylinder(const std::vector<int>& nodes, const std::vector<int>& triangles,
                          const std::vector<gp_XYZ>& normals, const std::vector<double>& areas) const {
    MeshFit fit;
    if (nodes.size() < 6) return fit;
    double m[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    for (int t : triangles) {
      const gp_XYZ& n = normals[t];
      for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) m[i][j] += areas[t] * n.Coord(i + 1) * n.Coord(j + 1);
    }
    double values[3];
    gp_XYZ vectors[3];
    symmetricEigen(m, values, vectors);
    const double trace = values[0] + values[1] + values[2];
    // Normals that all point one way are a plane, not a cylinder.
    if (!(values[1] > 1e-6 * trace) || vectors[0].Modulus() < 1e-12) return fit;
    return fitMeshCylinderAlong(nodes, gp_Dir(vectors[0]));
  }

  /** The cylinder through `nodes` about a given axis direction: fitMeshCylinder's circle fit. */
  MeshFit fitMeshCylinderAlong(const std::vector<int>& nodes, const gp_Dir& axis) const {
    MeshFit fit;
    if (nodes.size() < 6) return fit;
    const gp_Ax3 frame(gp_Pnt(0, 0, 0), axis);
    const gp_XYZ ux = frame.XDirection().XYZ(), uy = frame.YDirection().XYZ();
    const size_t count = nodes.size();
    std::vector<double> xs(count), ys(count);
    double mx = 0, my = 0;
    for (size_t i = 0; i < count; ++i) {
      const gp_XYZ p = meshNode(nodes[i]);
      xs[i] = p.Dot(ux);
      ys[i] = p.Dot(uy);
      mx += xs[i];
      my += ys[i];
    }
    mx /= count;
    my /= count;
    double a[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}}, b[3] = {0, 0, 0};
    for (size_t i = 0; i < count; ++i) {
      const double x = xs[i] - mx, y = ys[i] - my, z = x * x + y * y;
      const double row[3] = {x, y, 1};
      for (int r = 0; r < 3; ++r) {
        for (int c = 0; c < 3; ++c) a[r][c] += row[r] * row[c];
        b[r] -= row[r] * z;
      }
    }
    double s[3];
    if (!solve3(a, b, s)) return fit;
    double cx = -s[0] / 2, cy = -s[1] / 2;
    const double r2 = cx * cx + cy * cy - s[2];
    if (!(r2 > 0)) return fit;
    double radius = std::sqrt(r2);
    for (int iteration = 0; iteration < 8; ++iteration) {
      double jtj[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}}, jtr[3] = {0, 0, 0};
      for (size_t i = 0; i < count; ++i) {
        const double dx = xs[i] - mx - cx, dy = ys[i] - my - cy, d = std::hypot(dx, dy);
        if (d < 1e-12) continue;
        const double row[3] = {-dx / d, -dy / d, -1}, residual = d - radius;
        for (int r = 0; r < 3; ++r) {
          for (int c = 0; c < 3; ++c) jtj[r][c] += row[r] * row[c];
          jtr[r] -= row[r] * residual;
        }
      }
      double step[3];
      if (!solve3(jtj, jtr, step)) break;
      cx += step[0];
      cy += step[1];
      radius += step[2];
      if (std::fabs(step[0]) + std::fabs(step[1]) + std::fabs(step[2]) < 1e-13 * (1 + radius)) break;
    }
    if (!(radius > 0) || !std::isfinite(radius)) return fit;
    fit.deviation = 0;
    for (size_t i = 0; i < count; ++i) {
      fit.deviation = std::max(fit.deviation, std::fabs(std::hypot(xs[i] - mx - cx, ys[i] - my - cy) - radius));
    }
    fit.origin = gp_Pnt((mx + cx) * ux + (my + cy) * uy);
    fit.direction = axis;
    fit.radius = radius;
    fit.ok = true;
    return fit;
  }

  /**
   * The sphere through `nodes`: the centre an algebraic fit (the linear system
   * 2 Σ q qᵀ c' = Σ q |q|² over the centroid), refined by Gauss-Newton on the
   * geometric distance, the radius the mean distance. Rejected when the nodes
   * are nearly coplanar (a plane's covariance's smallest eigenvalue is tiny).
   */
  MeshFit fitMeshSphere(const std::vector<int>& nodes) const {
    MeshFit fit;
    if (nodes.size() < 8) return fit;
    const double count = static_cast<double>(nodes.size());
    gp_XYZ m(0, 0, 0);
    for (int n : nodes) m += meshNode(n);
    m /= count;
    double cov[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}}, rhs[3] = {0, 0, 0};
    for (int n : nodes) {
      const gp_XYZ q = meshNode(n) - m;
      const double q2 = q.SquareModulus();
      for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) cov[i][j] += q.Coord(i + 1) * q.Coord(j + 1);
        rhs[i] += q.Coord(i + 1) * q2;
      }
    }
    double values[3];
    gp_XYZ vectors[3];
    symmetricEigen(cov, values, vectors);
    // Nearly coplanar nodes are a plane, not a sphere.
    if (!(values[0] > 1e-6 * values[2])) return fit;
    double matrix[3][3];
    for (int i = 0; i < 3; ++i)
      for (int j = 0; j < 3; ++j) matrix[i][j] = 2 * cov[i][j];
    double offset[3];
    if (!solve3(matrix, rhs, offset)) return fit;
    gp_XYZ c = m + gp_XYZ(offset[0], offset[1], offset[2]);
    double radius = 0;
    for (int n : nodes) radius += (meshNode(n) - c).Modulus();
    radius /= count;
    for (int iteration = 0; iteration < 8; ++iteration) {
      double jtj[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}}, jtr[3] = {0, 0, 0};
      for (int n : nodes) {
        const gp_XYZ q = meshNode(n) - c;
        const double d = q.Modulus();
        if (d < 1e-12) continue;
        const double row[3] = {-q.X() / d, -q.Y() / d, -q.Z() / d}, residual = d - radius;
        for (int r = 0; r < 3; ++r) {
          for (int cc = 0; cc < 3; ++cc) jtj[r][cc] += row[r] * row[cc];
          jtr[r] -= row[r] * residual;
        }
      }
      double step[3];
      if (!solve3(jtj, jtr, step)) break;
      c += gp_XYZ(step[0], step[1], step[2]);
      radius = 0;
      for (int n : nodes) radius += (meshNode(n) - c).Modulus();
      radius /= count;
      if (std::fabs(step[0]) + std::fabs(step[1]) + std::fabs(step[2]) < 1e-13 * (1 + radius)) break;
    }
    if (!(radius > 0) || !std::isfinite(radius)) return fit;
    fit.deviation = 0;
    for (int n : nodes) fit.deviation = std::max(fit.deviation, std::fabs((meshNode(n) - c).Modulus() - radius));
    fit.origin = gp_Pnt(c);
    fit.radius = radius;
    fit.ok = true;
    return fit;
  }

  /**
   * The cone through `nodes`: the axis the facet normals' area-weighted
   * covariance's smallest eigenvector (the normals all lie on a cone about
   * it), the half-angle from their mean along it, the apex the least-squares
   * meeting point of the facets' tangent planes, the half-angle refined from
   * the nodes. `origin` is the apex, `direction` points from it towards the
   * nodes.
   */
  MeshFit fitMeshCone(const std::vector<int>& nodes, const std::vector<int>& triangles,
                      const std::vector<gp_XYZ>& normals, const std::vector<double>& areas) const {
    MeshFit fit;
    if (nodes.size() < 8) return fit;
    double areaSum = 0;
    gp_XYZ mean(0, 0, 0);
    for (int t : triangles) {
      mean += areas[t] * normals[t];
      areaSum += areas[t];
    }
    if (!(areaSum > 0)) return fit;
    mean /= areaSum;
    double cov[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}};
    for (int t : triangles) {
      const gp_XYZ d = normals[t] - mean;
      for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) cov[i][j] += areas[t] * d.Coord(i + 1) * d.Coord(j + 1);
    }
    double values[3];
    gp_XYZ vectors[3];
    symmetricEigen(cov, values, vectors);
    const double trace = values[0] + values[1] + values[2];
    // Normals that all point one way (a plane) or lie in a plane (a cylinder)
    // have no cone axis; a sphere's are isotropic but give a zero half-angle.
    if (!(values[1] > 1e-6 * trace) || vectors[0].Modulus() < 1e-12) return fit;
    gp_XYZ axis = vectors[0].Normalized();
    double along = 0;
    for (int t : triangles) along += areas[t] * normals[t].Dot(axis);
    along /= areaSum;
    const double alpha0 = std::asin(std::min(1.0, std::fabs(along)));
    if (!(alpha0 > M_PI / 180) || !(alpha0 < 89 * M_PI / 180)) return fit;
    // The apex: the point every tangent plane passes through, least squares.
    double matrix[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}}, rhs[3] = {0, 0, 0};
    for (int t : triangles) {
      const gp_XYZ n = normals[t];
      gp_XYZ centroid(0, 0, 0);
      for (int k = 0; k < 3; ++k) centroid += meshNode(static_cast<int>(meshTriangles_[3 * t + k]));
      centroid /= 3;
      const double nd = n.Dot(centroid);
      for (int i = 0; i < 3; ++i) {
        for (int j = 0; j < 3; ++j) matrix[i][j] += areas[t] * n.Coord(i + 1) * n.Coord(j + 1);
        rhs[i] += areas[t] * n.Coord(i + 1) * nd;
      }
    }
    double apex[3];
    if (!solve3(matrix, rhs, apex)) return fit;
    gp_XYZ x(apex[0], apex[1], apex[2]);
    // Orient the axis towards the nodes; a double cone (nodes on both sides)
    // is out.
    std::vector<double> heights(nodes.size());
    double heightSum = 0;
    for (size_t i = 0; i < nodes.size(); ++i) {
      heights[i] = (meshNode(nodes[i]) - x).Dot(axis);
      heightSum += heights[i];
    }
    if (heightSum < 0) {
      axis.Reverse();
      for (double& h : heights) h = -h;
    }
    double low = 1e300, high = -1e300;
    for (double h : heights) {
      low = std::min(low, h);
      high = std::max(high, h);
    }
    // A genuine double cone has nodes on both sides in comparable amount; a
    // tessellated apex sits a chord error past the facet least-squares apex,
    // so a small negative side is the tip, not a second cone.
    if (low < -0.5 * high) return fit;
    // The half-angle from the nodes, the tip (at or behind the apex) aside.
    double alphaSum = 0;
    int alphaCount = 0;
    for (int n : nodes) {
      const gp_XYZ q = meshNode(n) - x;
      const double height = q.Dot(axis);
      if (height <= 0) continue;
      alphaSum += std::atan2((q - height * axis).Modulus(), height);
      ++alphaCount;
    }
    if (alphaCount == 0) return fit;
    const double alpha = alphaSum / alphaCount;
    if (!(alpha > 0) || !(alpha < M_PI / 2)) return fit;
    double rhoMax = 0;
    fit.deviation = 0;
    for (int n : nodes) {
      const gp_XYZ q = meshNode(n) - x;
      const double height = q.Dot(axis);
      const double rho = (q - height * axis).Modulus();
      rhoMax = std::max(rhoMax, rho);
      fit.deviation = std::max(fit.deviation, std::fabs(rho * std::cos(alpha) - height * std::sin(alpha)));
    }
    fit.origin = gp_Pnt(x);
    fit.direction = gp_Dir(axis);
    fit.semiAngle = alpha;
    fit.ok = true;
    return fit;
  }

  /** A point's distance from the torus about the axis (o, a) with major radius R and tube radius r. */
  static double torusDistance(const gp_XYZ& o, const gp_XYZ& a, double R, double r, const gp_XYZ& p) {
    const gp_XYZ q = p - o;
    const double h = q.Dot(a);
    const double rho = (q - h * a).Modulus();
    return std::hypot(rho - R, h) - r;
  }

  /**
   * The torus through `nodes` (ADR-0097 §3, slice 4a2). Every normal line of
   * a torus meets its spine circle: for the signed tube radius ρ (> 0 when
   * the normals point away from the spine, a donut or an outside fillet;
   * < 0 on the concave side) the points centroid_t − ρ n_t lie on one
   * circle, so they are coplanar. ρ minimises their area-weighted
   * covariance's smallest eigenvalue over its trace (sampled, then golden
   * section); the axis is that eigenvector, the spine an algebraic circle
   * fit in its plane, the tube radius the nodes' mean distance from the
   * spine, and all seven parameters are refined by Gauss-Newton on the
   * nodes' distances. `origin` is the centre, `direction` the axis,
   * `majorRadius` R and `radius` r.
   */
  MeshFit fitMeshTorus(const std::vector<int>& nodes, const std::vector<int>& triangles,
                       const std::vector<gp_XYZ>& normals, const std::vector<double>& areas, double tolerance) const {
    MeshFit fit;
    if (nodes.size() < 12 || triangles.size() < 6) return fit;
    // Moments of the facet centroids g and normals n, about their means, so
    // that the covariance of g − ρ n is Sgg − ρ (Sgn + Sng) + ρ² Snn.
    double weight = 0;
    gp_XYZ gMean(0, 0, 0), nMean(0, 0, 0);
    std::vector<gp_XYZ> centroids(triangles.size());
    for (size_t i = 0; i < triangles.size(); ++i) {
      const int t = triangles[i];
      gp_XYZ c(0, 0, 0);
      for (int k = 0; k < 3; ++k) c += meshNode(static_cast<int>(meshTriangles_[3 * t + k]));
      centroids[i] = c / 3;
      weight += areas[t];
      gMean += areas[t] * centroids[i];
      nMean += areas[t] * normals[t];
    }
    if (!(weight > 0)) return fit;
    gMean /= weight;
    nMean /= weight;
    double sgg[3][3] = {}, sgn[3][3] = {}, snn[3][3] = {};
    for (size_t i = 0; i < triangles.size(); ++i) {
      const int t = triangles[i];
      const gp_XYZ g = centroids[i] - gMean, n = normals[t] - nMean;
      for (int r = 0; r < 3; ++r) {
        for (int c = 0; c < 3; ++c) {
          sgg[r][c] += areas[t] * g.Coord(r + 1) * g.Coord(c + 1) / weight;
          sgn[r][c] += areas[t] * g.Coord(r + 1) * n.Coord(c + 1) / weight;
          snn[r][c] += areas[t] * n.Coord(r + 1) * n.Coord(c + 1) / weight;
        }
      }
    }
    auto flatness = [&](double rho, gp_XYZ* axis) {
      double m[3][3];
      for (int r = 0; r < 3; ++r)
        for (int c = 0; c < 3; ++c) m[r][c] = sgg[r][c] - rho * (sgn[r][c] + sgn[c][r]) + rho * rho * snn[r][c];
      double values[3];
      gp_XYZ vectors[3];
      symmetricEigen(m, values, vectors);
      if (axis) *axis = vectors[0];
      const double trace = values[0] + values[1] + values[2];
      return trace > 1e-300 ? std::max(0.0, values[0]) / trace : 1.0;
    };
    Bnd_Box box;
    for (int n : nodes) box.Add(gp_Pnt(meshNode(n)));
    const double diagonal = std::sqrt(box.SquareExtent());
    if (!(diagonal > tolerance)) return fit;
    // Each side sampled at 32 geometrically spaced points, the best refined
    // between its neighbours by golden section.
    const int samples = 32;
    double best = 1e300, bestRho = 0;
    for (int sign = -1; sign <= 1; sign += 2) {
      double values[samples], rhos[samples];
      int at = 0;
      for (int k = 0; k < samples; ++k) {
        rhos[k] = sign * tolerance * std::pow(diagonal / tolerance, k / double(samples - 1));
        values[k] = flatness(rhos[k], nullptr);
        if (values[k] < values[at]) at = k;
      }
      double lo = rhos[std::max(0, at - 1)], hi = rhos[std::min(samples - 1, at + 1)];
      const double golden = (std::sqrt(5.0) - 1) / 2;
      double x1 = hi - golden * (hi - lo), x2 = lo + golden * (hi - lo);
      double f1 = flatness(x1, nullptr), f2 = flatness(x2, nullptr);
      for (int iteration = 0; iteration < 40; ++iteration) {
        if (f1 < f2) {
          hi = x2;
          x2 = x1;
          f2 = f1;
          x1 = hi - golden * (hi - lo);
          f1 = flatness(x1, nullptr);
        } else {
          lo = x1;
          x1 = x2;
          f1 = f2;
          x2 = lo + golden * (hi - lo);
          f2 = flatness(x2, nullptr);
        }
      }
      const double candidates[3] = {rhos[at], x1, x2}, scores[3] = {values[at], f1, f2};
      for (int k = 0; k < 3; ++k) {
        if (scores[k] < best) {
          best = scores[k];
          bestRho = candidates[k];
        }
      }
    }
    if (!(best <= 1e-3)) return fit;
    gp_XYZ axisVector;
    flatness(bestRho, &axisVector);
    if (axisVector.Modulus() < 1e-12) return fit;
    gp_XYZ a = axisVector.Normalized();
    // The spine: a circle fit (Kåsa) of the points in their plane.
    const gp_XYZ mean = gMean - bestRho * nMean;
    const gp_Ax3 plane{gp_Pnt(mean), gp_Dir(a)};
    const gp_XYZ ux = plane.XDirection().XYZ(), uy = plane.YDirection().XYZ();
    double m[3][3] = {}, b[3] = {};
    for (size_t i = 0; i < triangles.size(); ++i) {
      const int t = triangles[i];
      const gp_XYZ q = centroids[i] - bestRho * normals[t] - mean;
      const double x = q.Dot(ux), y = q.Dot(uy), z = x * x + y * y;
      const double row[3] = {x, y, 1};
      for (int r = 0; r < 3; ++r) {
        for (int c = 0; c < 3; ++c) m[r][c] += areas[t] * row[r] * row[c];
        b[r] -= areas[t] * row[r] * z;
      }
    }
    double sol[3];
    if (!solve3(m, b, sol)) return fit;
    const double cx = -sol[0] / 2, cy = -sol[1] / 2, R2 = cx * cx + cy * cy - sol[2];
    if (!(R2 > tolerance * tolerance)) return fit;
    gp_XYZ o = mean + cx * ux + cy * uy;
    double R = std::sqrt(R2), r = 0;
    for (int n : nodes) r += torusDistance(o, a, R, 0, meshNode(n));
    r /= static_cast<double>(nodes.size());
    // Gauss-Newton on all seven parameters: the centre, two tilts of the
    // axis, R and r; a central-difference Jacobian, the step halved while
    // the residual sum grows.
    auto residualSum = [&](const gp_XYZ& oo, const gp_XYZ& aa, double RR, double rr) {
      double sum = 0;
      for (int n : nodes) {
        const double d = torusDistance(oo, aa, RR, rr, meshNode(n));
        sum += d * d;
      }
      return sum;
    };
    double current = residualSum(o, a, R, r);
    for (int iteration = 0; iteration < 12; ++iteration) {
      const gp_Ax3 frame(gp_Pnt(0, 0, 0), gp_Dir(a));
      const gp_XYZ e1 = frame.XDirection().XYZ(), e2 = frame.YDirection().XYZ();
      auto at = [&](const double* x, gp_XYZ& oo, gp_XYZ& aa, double& RR, double& rr) {
        oo = o + gp_XYZ(x[0], x[1], x[2]);
        aa = (a + x[3] * e1 + x[4] * e2).Normalized();
        RR = R + x[5];
        rr = r + x[6];
      };
      const double hl = 1e-6 * (1 + R + r), steps[7] = {hl, hl, hl, 1e-6, 1e-6, hl, hl};
      double jtj[49] = {}, jtr[7] = {};
      for (int n : nodes) {
        const gp_XYZ p = meshNode(n);
        double row[7];
        for (int k = 0; k < 7; ++k) {
          double x[7] = {0, 0, 0, 0, 0, 0, 0};
          gp_XYZ oo, aa;
          double RR, rr;
          x[k] = steps[k];
          at(x, oo, aa, RR, rr);
          const double plus = torusDistance(oo, aa, RR, rr, p);
          x[k] = -steps[k];
          at(x, oo, aa, RR, rr);
          const double minus = torusDistance(oo, aa, RR, rr, p);
          row[k] = (plus - minus) / (2 * steps[k]);
        }
        const double residual = torusDistance(o, a, R, r, p);
        for (int i = 0; i < 7; ++i) {
          for (int j = 0; j < 7; ++j) jtj[7 * i + j] += row[i] * row[j];
          jtr[i] -= row[i] * residual;
        }
      }
      double step[7];
      if (!solveN(7, jtj, jtr, step)) break;
      double scale = 1;
      bool improved = false;
      gp_XYZ no, na;
      double nR = R, nr = r;
      for (int halving = 0; halving <= 6; ++halving) {
        double x[7];
        for (int k = 0; k < 7; ++k) x[k] = scale * step[k];
        at(x, no, na, nR, nr);
        const double next = residualSum(no, na, nR, nr);
        if (next <= current) {
          improved = true;
          current = next;
          break;
        }
        scale /= 2;
      }
      if (!improved) break;
      o = no;
      a = na;
      R = nR;
      r = nr;
      double size = 0;
      for (int k = 0; k < 7; ++k) size += std::fabs(scale * step[k]);
      if (size < 1e-12 * (1 + R + r)) break;
    }
    if (!(R > 0) || !(r > 0) || !std::isfinite(R) || !std::isfinite(r)) return fit;
    fit.deviation = 0;
    for (int n : nodes) fit.deviation = std::max(fit.deviation, std::fabs(torusDistance(o, a, R, r, meshNode(n))));
    // A deterministic axis: its largest component positive.
    int largest = 1;
    for (int k = 2; k <= 3; ++k)
      if (std::fabs(a.Coord(k)) > std::fabs(a.Coord(largest))) largest = k;
    if (a.Coord(largest) < 0) a.Reverse();
    fit.origin = gp_Pnt(o);
    fit.direction = gp_Dir(a);
    fit.radius = r;
    fit.majorRadius = R;
    fit.ok = true;
    return fit;
  }

  /** A point's distance from a recognised surface (plane, cylinder, cone, sphere or torus; unbounded). */
  static double distanceToSurface(const MeshSurface& s, const gp_XYZ& p) {
    const gp_XYZ q = p - s.origin.XYZ(), a = s.direction.XYZ();
    const double h = q.Dot(a), rho = (q - h * a).Modulus();
    switch (s.kind) {
      case 0:
        return std::fabs(h);
      case 1:
        return std::fabs(rho - s.radius);
      case 2:
        return std::fabs(rho * std::cos(s.semiAngle) - h * std::sin(s.semiAngle));
      case 3:
        return std::fabs(q.Modulus() - s.radius);
      case 4:
        return std::fabs(std::hypot(rho - s.majorRadius, h) - s.radius);
      default:
        return 1e300;
    }
  }

  /** "1", "0.05", "0.012": up to 3 decimals, trailing zeros dropped. */
  static std::string millimetres(double value) {
    char text[32];
    std::snprintf(text, sizeof text, "%.3f", value);
    std::string out(text);
    while (!out.empty() && out.back() == '0') out.pop_back();
    if (!out.empty() && out.back() == '.') out.pop_back();
    return out;
  }

  /** Whether `p` is inside the staged mesh: the parity of a ray's crossings, the majority of three rays. */
  bool insideMesh(const gp_XYZ& p) const {
    static const double rays[3][3] = {{0.5773, 0.5774, 0.5775}, {-0.6, 0.48, 0.64}, {0.3, -0.81, 0.5}};
    const size_t triangles = meshTriangles_.size() / 3;
    int votes = 0;
    for (const auto& ray : rays) {
      const gp_XYZ d = gp_XYZ(ray[0], ray[1], ray[2]).Normalized();
      int crossings = 0;
      for (size_t t = 0; t < triangles; ++t) {
        const gp_XYZ a = meshNode(meshTriangles_[3 * t]), b = meshNode(meshTriangles_[3 * t + 1]),
                     c = meshNode(meshTriangles_[3 * t + 2]);
        const gp_XYZ e1 = b - a, e2 = c - a, h = d.Crossed(e2);
        const double det = e1.Dot(h);
        if (std::fabs(det) < 1e-300) continue;
        const double inv = 1 / det;
        const gp_XYZ s = p - a;
        const double u = s.Dot(h) * inv;
        if (u < 0 || u > 1) continue;
        const gp_XYZ q = s.Crossed(e1);
        const double v = d.Dot(q) * inv;
        if (v < 0 || u + v > 1) continue;
        if (e2.Dot(q) * inv > 0) ++crossings;
      }
      if (crossings % 2 == 1) ++votes;
    }
    return votes >= 2;
  }

  /** Prismatic's segmentation and fits over the staged mesh (segmentMesh), what meshRegions and prismaticFromMesh share. */
  struct MeshSegmentation {
    std::vector<gp_XYZ> normals;
    std::vector<double> areas;
    double meshArea = 0, meshVolume = 0;
    std::vector<int> regionOf;
    std::vector<MeshRegion> regions;
    std::vector<std::vector<int>> regionNeighbours;
    std::vector<MeshSurface> surfaces;
    /** neighbour[3t + k]: the triangle across triangle t's edge from corner k to k + 1, or -1. */
    std::vector<int> neighbour;
    int planes = 0, cylinders = 0, cones = 0, spheres = 0, tori = 0, unfitRegions = 0;
    double unfitFraction = 0, suggested = -1;
  };

  /**
   * Prismatic's segmentation and fits (ADR-0097 §3 and its 2026-10-21
   * amendments), over the staged buffers: planar regions, then smooth clusters
   * fitted as planes, cylinders, cones, spheres or tori, a cluster that fits
   * nothing whole split into several. Fills `out` and meshReport_ (the counts, no
   * faces yet). Returns 1, or 0 with lastError for a bad tolerance or mesh.
   * The region preview (meshRegions) and the conversion (prismaticFromMesh)
   * both run this, so they always agree. May throw.
   */
  int segmentMesh(double tolerance, MeshSegmentation& out) {
    {
      if (!(tolerance > 0) || !std::isfinite(tolerance)) return fail("Mesh to Solid needs a tolerance above 0 mm.");
      const int nodeCount = static_cast<int>(meshNodes_.size() / 3);
      const int triangleCount = static_cast<int>(meshTriangles_.size() / 3);
      if (nodeCount == 0 || triangleCount == 0) return fail("Mesh to Solid failed: the mesh is empty.");
      for (uint32_t index : meshTriangles_) {
        if (index >= static_cast<uint32_t>(nodeCount)) {
          return fail("Mesh to Solid failed: the mesh refers to a node it doesn't have.");
        }
      }
      auto corner = [&](int t, int k) { return static_cast<int>(meshTriangles_[3 * t + k]); };

      // Facet normals and areas.
      std::vector<gp_XYZ>& normals = out.normals;
      std::vector<double>& areas = out.areas;
      normals.assign(triangleCount, gp_XYZ(0, 0, 0));
      areas.assign(triangleCount, 0);
      std::vector<double> altitudes(triangleCount);
      double meshArea = 0, meshVolume = 0;
      for (int t = 0; t < triangleCount; ++t) {
        const gp_XYZ a = meshNode(corner(t, 0)), b = meshNode(corner(t, 1)), c = meshNode(corner(t, 2));
        const gp_XYZ cross = (b - a).Crossed(c - a);
        const double twice = cross.Modulus();
        areas[t] = twice / 2;
        normals[t] = twice > 0 ? cross / twice : gp_XYZ(0, 0, 0);
        const double longest = std::max({(b - a).Modulus(), (c - b).Modulus(), (a - c).Modulus()});
        altitudes[t] = longest > 0 ? twice / longest : 0;
        meshArea += areas[t];
        meshVolume += a.Dot(b.Crossed(c)) / 6;
      }

      // Adjacency by shared edge: neighbour[3t + k] is the triangle across
      // the edge from corner k to corner k + 1, or -1.
      std::vector<int>& neighbour = out.neighbour;
      neighbour.assign(3 * static_cast<size_t>(triangleCount), -1);
      {
        std::vector<std::pair<uint64_t, int>> edges(3 * static_cast<size_t>(triangleCount));
        for (int t = 0; t < triangleCount; ++t) {
          for (int k = 0; k < 3; ++k) {
            const uint64_t a = static_cast<uint64_t>(corner(t, k)), b = static_cast<uint64_t>(corner(t, (k + 1) % 3));
            edges[3 * t + k] = {std::min(a, b) << 32 | std::max(a, b), 3 * t + k};
          }
        }
        std::sort(edges.begin(), edges.end());
        for (size_t i = 0; i + 1 < edges.size();) {
          size_t j = i + 1;
          while (j < edges.size() && edges[j].first == edges[i].first) ++j;
          if (j - i == 2) {
            neighbour[edges[i].second] = edges[i + 1].second / 3;
            neighbour[edges[i + 1].second] = edges[i].second / 3;
          }
          i = j;
        }
      }

      // 1. Planar regions, grown from the largest triangle left: a neighbour
      // joins when its corners lie within the tolerance of the seed's plane
      // and its normal is within 1 degree of it (a sliver narrower than a
      // hundredth of the tolerance has no reliable normal, so its corners
      // decide alone).
      const double cosOne = std::cos(M_PI / 180);
      std::vector<int>& regionOf = out.regionOf;
      std::vector<MeshRegion>& regions = out.regions;
      regionOf.assign(triangleCount, -1);
      {
        std::vector<int> order(triangleCount);
        for (int t = 0; t < triangleCount; ++t) order[t] = t;
        std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return areas[a] > areas[b]; });
        std::vector<int> queue, stamp(nodeCount, -1);
        for (int seed : order) {
          if (regionOf[seed] >= 0) continue;
          const int id = static_cast<int>(regions.size());
          regions.emplace_back();
          MeshRegion& region = regions.back();
          const gp_XYZ n0 = normals[seed], p0 = meshNode(corner(seed, 0));
          const bool flat = n0.Modulus() > 0.5;
          regionOf[seed] = id;
          queue.assign(1, seed);
          for (size_t head = 0; head < queue.size(); ++head) {
            const int t = queue[head];
            region.triangles.push_back(t);
            for (int k = 0; k < 3; ++k) {
              const int u = neighbour[3 * t + k];
              if (u < 0 || regionOf[u] >= 0 || !flat) continue;
              if (altitudes[u] >= tolerance / 100 && normals[u].Dot(n0) < cosOne) continue;
              bool near = true;
              for (int c = 0; c < 3 && near; ++c) near = std::fabs((meshNode(corner(u, c)) - p0).Dot(n0)) <= tolerance;
              if (!near) continue;
              regionOf[u] = id;
              queue.push_back(u);
            }
          }
          // The region's plane: its facets' area-weighted normal through
          // their area-weighted centroid, so that slivers along its edge
          // don't tilt it; else the least-squares plane, else the seed's.
          gp_XYZ outward(0, 0, 0), centre(0, 0, 0);
          for (int t : region.triangles) {
            region.area += areas[t];
            outward += areas[t] * normals[t];
            for (int c = 0; c < 3; ++c) {
              const int node = corner(t, c);
              centre += (areas[t] / 3) * meshNode(node);
              if (stamp[node] != id) {
                stamp[node] = id;
                region.nodes.push_back(node);
              }
            }
          }
          const bool weighted = outward.Modulus() > 1e-300;
          if (!weighted) outward = flat ? n0 : gp_XYZ(0, 0, 1);
          MeshFit plane;
          if (weighted) {
            plane.origin = gp_Pnt(centre / region.area);
            plane.direction = gp_Dir(outward);
            plane.deviation = 0;
            for (int node : region.nodes) {
              plane.deviation = std::max(
                  plane.deviation, std::fabs((meshNode(node) - plane.origin.XYZ()).Dot(plane.direction.XYZ())));
            }
            plane.ok = true;
          }
          if (!plane.ok || plane.deviation > tolerance) plane = fitMeshPlane(region.nodes, outward);
          if (plane.ok && plane.deviation <= tolerance) {
            region.origin = plane.origin;
            region.normal = plane.direction;
          } else {
            region.origin = gp_Pnt(p0);
            region.normal = gp_Dir(flat ? n0 : outward);
          }
        }
      }
      const int regionCount = static_cast<int>(regions.size());

      // Region adjacency, and smooth boundaries (normals under 30 degrees
      // apart, ADR-0066's CREASE) grouping regions into clusters.
      // regionBorders[r][k] is the length of the border between r and
      // regionNeighbours[r][k].
      std::vector<std::vector<int>>& regionNeighbours = out.regionNeighbours;
      regionNeighbours.assign(regionCount, {});
      std::vector<std::vector<double>> regionBorders(regionCount);
      {
        std::vector<std::pair<uint64_t, double>> pairs;
        for (int t = 0; t < triangleCount; ++t) {
          for (int k = 0; k < 3; ++k) {
            const int u = neighbour[3 * t + k];
            if (u < 0) continue;
            const uint64_t a = static_cast<uint64_t>(regionOf[t]), b = static_cast<uint64_t>(regionOf[u]);
            if (a < b) pairs.push_back({a << 32 | b, (meshNode(corner(t, (k + 1) % 3)) - meshNode(corner(t, k))).Modulus()});
          }
        }
        std::sort(pairs.begin(), pairs.end());
        for (size_t i = 0; i < pairs.size();) {
          double length = 0;
          size_t j = i;
          for (; j < pairs.size() && pairs[j].first == pairs[i].first; ++j) length += pairs[j].second;
          const int a = static_cast<int>(pairs[i].first >> 32), b = static_cast<int>(pairs[i].first & 0xffffffffu);
          regionNeighbours[a].push_back(b);
          regionNeighbours[b].push_back(a);
          regionBorders[a].push_back(length);
          regionBorders[b].push_back(length);
          i = j;
        }
      }
      const double cosCrease = std::cos(M_PI / 6);
      auto smooth = [&](int a, int b) { return regions[a].normal.Dot(regions[b].normal) > cosCrease; };

      // Connected components of `members` over smooth boundaries.
      std::vector<int> mark(regionCount, -1);
      int markRound = 0;
      auto components = [&](const std::vector<int>& members) {
        const int inSet = markRound++, seen = markRound++;
        for (int r : members) mark[r] = inSet;
        std::vector<std::vector<int>> out;
        for (int start : members) {
          if (mark[start] != inSet) continue;
          out.emplace_back(1, start);
          mark[start] = seen;
          std::vector<int>& component = out.back();
          for (size_t head = 0; head < component.size(); ++head) {
            for (int other : regionNeighbours[component[head]]) {
              if (mark[other] == inSet && smooth(component[head], other)) {
                mark[other] = seen;
                component.push_back(other);
              }
            }
          }
        }
        return out;
      };

      // 2. Fits. A component of planar regions is one plane when all its
      // nodes are within the tolerance of one, else one cylinder, cone,
      // sphere or torus when they are of one, else unfit (and split).
      std::vector<int> nodeStamp(nodeCount, -1);
      int nodeRound = 0;
      std::vector<MeshSurface>& surfaces = out.surfaces;
      auto planeOf = [&](int r) {
        MeshSurface s;
        s.kind = 0;
        s.regions.assign(1, r);
        s.area = regions[r].area;
        s.origin = regions[r].origin;
        s.direction = regions[r].normal;
        return s;
      };
      // The largest facet-to-facet angle inside a component, for the chord error.
      auto largestAngle = [&](const std::vector<int>& members, const std::vector<int>& triangles) {
        const int inside = markRound++;
        for (int r : members) mark[r] = inside;
        double cosMax = 1;
        for (int t : triangles) {
          for (int k = 0; k < 3; ++k) {
            const int u = neighbour[3 * t + k];
            if (u > t && mark[regionOf[u]] == inside) cosMax = std::min(cosMax, normals[t].Dot(normals[u]));
          }
        }
        return std::acos(std::max(-1.0, std::min(1.0, cosMax)));
      };
      // The nodes, triangles, area and mean outward normal of a set of regions.
      struct Gathered {
        std::vector<int> nodes, triangles;
        gp_XYZ outward;
        double area = 0;
        int largest = -1;
      };
      auto gather = [&](const std::vector<int>& members) {
        Gathered g;
        g.outward = gp_XYZ(0, 0, 0);
        const int round = nodeRound++;
        for (int r : members) {
          if (g.largest < 0 || regions[r].area > regions[g.largest].area) g.largest = r;
          g.area += regions[r].area;
          g.outward += regions[r].area * regions[r].normal.XYZ();
          g.triangles.insert(g.triangles.end(), regions[r].triangles.begin(), regions[r].triangles.end());
          for (int n : regions[r].nodes) {
            if (nodeStamp[n] != round) {
              nodeStamp[n] = round;
              g.nodes.push_back(n);
            }
          }
        }
        if (g.outward.Modulus() < 1e-300) g.outward = regions[members[0]].normal.XYZ();
        return g;
      };
      // One kind's fit (0 plane, 1 cylinder, 2 cone, 3 sphere, 4 torus).
      auto fitKind = [&](int kind, const Gathered& g) {
        switch (kind) {
          case 0: {
            // The largest region's own plane when it holds every node (a
            // flat face and the slivers of a fillet along its edge: the
            // slivers would tilt any other), else the facets' area-weighted
            // plane, as a region's (a large flat face's few nodes would lose
            // a least-squares plane to the many nodes of the slivers), else
            // the least-squares plane.
            MeshFit own;
            own.origin = regions[g.largest].origin;
            own.direction = regions[g.largest].normal;
            own.deviation = 0;
            for (int n : g.nodes) {
              own.deviation =
                  std::max(own.deviation, std::fabs((meshNode(n) - own.origin.XYZ()).Dot(own.direction.XYZ())));
            }
            own.ok = true;
            if (own.deviation <= tolerance) return own;
            MeshFit plane;
            gp_XYZ centre(0, 0, 0);
            for (int t : g.triangles) {
              for (int k = 0; k < 3; ++k) centre += (areas[t] / 3) * meshNode(corner(t, k));
            }
            if (g.area > 0 && g.outward.Modulus() > 1e-300) {
              plane.origin = gp_Pnt(centre / g.area);
              plane.direction = gp_Dir(g.outward);
              plane.deviation = 0;
              for (int n : g.nodes) {
                plane.deviation = std::max(
                    plane.deviation, std::fabs((meshNode(n) - plane.origin.XYZ()).Dot(plane.direction.XYZ())));
              }
              plane.ok = true;
            }
            if (plane.ok && plane.deviation <= tolerance) return plane;
            const MeshFit squares = fitMeshPlane(g.nodes, g.outward);
            return squares.ok && (!plane.ok || squares.deviation < plane.deviation) ? squares : plane;
          }
          case 1:
            return fitMeshCylinder(g.nodes, g.triangles, normals, areas);
          case 2:
            return fitMeshCone(g.nodes, g.triangles, normals, areas);
          case 3:
            return fitMeshSphere(g.nodes);
          default:
            return fitMeshTorus(g.nodes, g.triangles, normals, areas, tolerance);
        }
      };
      // The surface of a fit within the tolerance, with its chord error.
      auto surfaceOfFit = [&](int kind, const MeshFit& fit, const std::vector<int>& members, const Gathered& g) {
        MeshSurface s;
        s.kind = kind;
        s.regions = members;
        s.area = g.area;
        s.origin = fit.origin;
        s.direction = fit.direction;
        s.radius = fit.radius;
        s.majorRadius = fit.majorRadius;
        s.semiAngle = fit.semiAngle;
        if (kind == 0) return s;
        const double theta = largestAngle(members, g.triangles), chord = 1 - std::cos(theta / 2);
        if (kind == 1 || kind == 3) {
          s.sag = fit.radius * chord;
        } else if (kind == 2) {
          const gp_XYZ axis = fit.direction.XYZ();
          double rhoMax = 0;
          for (int n : g.nodes) {
            const gp_XYZ q = meshNode(n) - fit.origin.XYZ();
            rhoMax = std::max(rhoMax, (q - q.Dot(axis) * axis).Modulus());
          }
          s.sag = (rhoMax / std::cos(fit.semiAngle)) * chord;
        } else {
          s.sag = (fit.majorRadius + fit.radius) * chord;
        }
        if (kind == 3) {
          // A full sphere's mean normal cancels to nothing; any axis is a
          // frame for it, so fall back to Z.
          gp_XYZ dir = g.outward;
          if (dir.Modulus() < 1e-6 * s.area) dir = gp_XYZ(0, 0, 1);
          s.direction = gp_Dir(dir.Normalized());
        }
        return s;
      };
      // The first of plane, cylinder, cone, sphere and torus that holds
      // every node of `members` within the tolerance, else unfit with the
      // smallest deviation. The cone before the sphere: a frustum with only
      // its two end rings (manifold's cylinder) has all its nodes on a sphere
      // too, and the facet normals are the only thing that tells them apart.
      auto bestFit = [&](const std::vector<int>& members) {
        const Gathered g = gather(members);
        double deviation = 1e300;
        for (int kind = 0; kind <= 4; ++kind) {
          const MeshFit fit = fitKind(kind, g);
          if (!fit.ok) continue;
          if (fit.deviation <= tolerance) return surfaceOfFit(kind, fit, members, g);
          deviation = std::min(deviation, fit.deviation);
        }
        MeshSurface s;
        s.kind = -1;
        s.regions = members;
        s.area = g.area;
        s.deviation = deviation;
        return s;
      };
      auto fitOfKind = [&](int kind, const std::vector<int>& members) {
        const Gathered g = gather(members);
        const MeshFit fit = fitKind(kind, g);
        if (fit.ok && fit.deviation <= tolerance) return surfaceOfFit(kind, fit, members, g);
        MeshSurface s;
        s.kind = -1;
        return s;
      };
      // Splits a smooth component that fits nothing whole into primitives by
      // seeded region growing (ADR-0097 §3, slice 4a2). The seed is the
      // largest region left. A large one (4 x the component's median region
      // area: a flat face between fillets) is a plane. Else its patch adds
      // the neighbour sharing the longest border with it, one at a time,
      // until it has 16 nodes, and is fitted, dropping the last region added
      // while 16 nodes are left (fewer let a curved fit pass through
      // anything); a seed whose patch fits nothing waits for a later piece
      // to take it. A piece grows in rounds: the neighbours whose every node is
      // within the tolerance of its surface join, and the same kind is
      // refitted over the piece; a refit outside the tolerance undoes the
      // round. What no piece took is unfit, one piece per smooth component;
      // when such a piece has 4 regions or more, the split explains too
      // little (a freeform surface fits small primitives here and there) and
      // the component stays whole and unfit.
      std::vector<int> pieceOf(regionCount, -2), frontierMark(regionCount, -1);
      int frontierRound = 0;
      constexpr int minimumNodes = 16;
      auto splitComponent = [&](const MeshSurface& whole) {
        const std::vector<int>& members = whole.regions;
        constexpr int unassigned = -1, patched = -3;
        for (int r : members) pieceOf[r] = unassigned;
        std::vector<int> order(members);
        std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return regions[a].area > regions[b].area; });
        const double median = regions[order[order.size() / 2]].area;
        std::vector<MeshSurface> pieces;
        std::vector<int> frontier;
        for (int seed : order) {
          if (pieceOf[seed] != unassigned) continue;
          MeshSurface s;
          s.kind = -1;
          std::vector<int> patch(1, seed);
          // A large seed is a plane (the flat face between fillets) and grows as one.
          const bool large = regions[seed].area >= 4 * median;
          if (large) s = planeOf(seed);
          // Else the seed patch, and its node count after each region.
          std::vector<int> nodesAfter;
          pieceOf[seed] = patched;
          std::vector<std::pair<int, double>> candidates;
          auto offer = [&](int r) {
            for (size_t k = 0; k < regionNeighbours[r].size(); ++k) {
              const int other = regionNeighbours[r][k];
              if (pieceOf[other] != unassigned || !smooth(r, other)) continue;
              auto found = std::find_if(candidates.begin(), candidates.end(),
                                        [&](const std::pair<int, double>& c) { return c.first == other; });
              if (found == candidates.end()) candidates.push_back({other, regionBorders[r][k]});
              else found->second += regionBorders[r][k];
            }
          };
          const int round = nodeRound++;
          int patchNodes = 0;
          auto count = [&](int r) {
            for (int n : regions[r].nodes) {
              if (nodeStamp[n] != round) {
                nodeStamp[n] = round;
                ++patchNodes;
              }
            }
            nodesAfter.push_back(patchNodes);
          };
          count(seed);
          offer(seed);
          while (!large && patchNodes < minimumNodes && !candidates.empty()) {
            size_t best = 0;
            for (size_t i = 1; i < candidates.size(); ++i)
              if (candidates[i].second > candidates[best].second) best = i;
            const int r = candidates[best].first;
            candidates.erase(candidates.begin() + static_cast<std::ptrdiff_t>(best));
            if (pieceOf[r] != unassigned) continue;
            pieceOf[r] = patched;
            patch.push_back(r);
            count(r);
            offer(r);
          }
          size_t size = patch.size();
          // The whole patch even when it is small (nothing more to add);
          // smaller prefixes only while they keep 16 nodes.
          for (; !large && size >= 2; --size) {
            if (size < patch.size() && nodesAfter[size - 1] < minimumNodes) {
              size = 1;
              break;
            }
            s = bestFit(std::vector<int>(patch.begin(), patch.begin() + static_cast<std::ptrdiff_t>(size)));
            if (s.kind >= 0) break;
          }
          for (int r : patch) pieceOf[r] = unassigned;
          if (s.kind < 0) continue;
          patch.resize(size);
          const int id = static_cast<int>(pieces.size());
          for (int r : patch) pieceOf[r] = id;
          // Grow in rounds.
          frontier.clear();
          ++frontierRound;
          auto extend = [&](int r) {
            for (int other : regionNeighbours[r]) {
              if (pieceOf[other] == unassigned && frontierMark[other] != frontierRound && smooth(r, other)) {
                frontierMark[other] = frontierRound;
                frontier.push_back(other);
              }
            }
          };
          for (int r : patch) extend(r);
          std::vector<int> piece(patch);
          for (;;) {
            std::vector<int> accepted, rejected;
            for (int r : frontier) {
              if (pieceOf[r] != unassigned) continue;
              bool near = true;
              for (size_t i = 0; i < regions[r].nodes.size() && near; ++i)
                near = distanceToSurface(s, meshNode(regions[r].nodes[i])) <= tolerance;
              (near ? accepted : rejected).push_back(r);
            }
            if (accepted.empty()) break;
            std::vector<int> trial(piece);
            trial.insert(trial.end(), accepted.begin(), accepted.end());
            MeshSurface refit = fitOfKind(s.kind, trial);
            if (refit.kind < 0) break;
            s = std::move(refit);
            piece = std::move(trial);
            frontier = std::move(rejected);
            for (int r : accepted) pieceOf[r] = id;
            for (int r : accepted) extend(r);
          }
          pieces.push_back(std::move(s));
        }
        // A region on a border between two pieces goes to the one whose
        // surface is nearer its nodes: a piece grown first takes its
        // neighbour's slivers along a tangent border (within the tolerance,
        // but a few thousandths off), which biases its refit.
        {
          auto farthest = [&](int r, const MeshSurface& surface) {
            double d = 0;
            for (int n : regions[r].nodes) d = std::max(d, distanceToSurface(surface, meshNode(n)));
            return d;
          };
          std::vector<std::pair<int, int>> moves;
          std::vector<int> sizes(pieces.size(), 0);
          for (int r : members)
            if (pieceOf[r] >= 0) ++sizes[pieceOf[r]];
          for (int r : members) {
            const int own = pieceOf[r];
            if (own < 0 || sizes[own] < 2) continue;
            double best = farthest(r, pieces[own]);
            int to = own;
            for (int other : regionNeighbours[r]) {
              const int q = pieceOf[other];
              if (q < 0 || q == own) continue;
              const double d = farthest(r, pieces[q]);
              if (d < best) {
                best = d;
                to = q;
              }
            }
            if (to != own) {
              moves.push_back({r, to});
              --sizes[own];
            }
          }
          // A piece that lost or gained a region is refitted (one can do both
          // and keep its size: its old region list would then miss a region
          // and name one of another piece's, ADR-0097's hardening slice A amendment).
          std::vector<char> moved(pieces.size(), 0);
          for (const auto& [r, to] : moves) {
            moved[pieceOf[r]] = moved[to] = 1;
            pieceOf[r] = to;
          }
          std::vector<std::vector<int>> membersOf(pieces.size());
          for (int r : members)
            if (pieceOf[r] >= 0) membersOf[pieceOf[r]].push_back(r);
          for (size_t p = 0; p < pieces.size(); ++p) {
            if (!moved[p]) continue;
            MeshSurface refit = fitOfKind(pieces[p].kind, membersOf[p]);
            if (refit.kind >= 0) {
              pieces[p] = std::move(refit);
            } else {
              // Its nodes were all within the old surface: keep it.
              pieces[p].regions = membersOf[p];
              pieces[p].area = 0;
              for (int r : membersOf[p]) pieces[p].area += regions[r].area;
            }
          }
        }
        // What no piece took: unfit pieces, one per smooth component.
        std::vector<int> left;
        for (int r : members) {
          if (pieceOf[r] == unassigned) left.push_back(r);
          // Outside the component, pieceOf means nothing (the next split's own).
          pieceOf[r] = -2;
        }
        for (const std::vector<int>& component : components(left)) {
          if (component.size() >= 4) return std::vector<MeshSurface>(1, whole);
          pieces.push_back(component.size() == 1 ? planeOf(component[0]) : bestFit(component));
        }
        return pieces;
      };
      // A cluster is a smooth component of all regions. When it fits nothing
      // whole, its large planar regions (4 times the median region's area or
      // more: the planes a fillet's facets lean on) are planes of their own,
      // and what is left is fitted again, component by component. A finely
      // tessellated cylinder's facets are thin planar regions of one size, so
      // none of them is large and they stay together.
      std::vector<int> all(regionCount);
      for (int r = 0; r < regionCount; ++r) all[r] = r;
      for (const std::vector<int>& cluster : components(all)) {
        if (cluster.size() == 1) {
          surfaces.push_back(planeOf(cluster[0]));
          continue;
        }
        MeshSurface whole = bestFit(cluster);
        if (whole.kind >= 0) {
          surfaces.push_back(std::move(whole));
          continue;
        }
        std::vector<double> sizes;
        for (int r : cluster) sizes.push_back(regions[r].area);
        std::sort(sizes.begin(), sizes.end());
        const double median = sizes[(sizes.size() - 1) / 2];
        std::vector<int> large, rest;
        for (int r : cluster) {
          if (regions[r].area >= 4 * median) large.push_back(r);
          else rest.push_back(r);
        }
        // Fewer than four planar regions meeting at shallow angles are
        // planes (a draft, a shallow bevel): a cylinder has more facets.
        // A larger one is split into primitives (splitComponent), and each
        // piece settled by the same rule.
        auto keep = [&](MeshSurface s) {
          if (s.kind < 0 && s.regions.size() < 4) {
            for (int r : s.regions) surfaces.push_back(planeOf(r));
          } else {
            surfaces.push_back(std::move(s));
          }
        };
        auto settle = [&](MeshSurface s) {
          if (s.kind >= 0 || s.regions.size() < 4) {
            keep(std::move(s));
            return;
          }
          for (MeshSurface& piece : splitComponent(s)) keep(std::move(piece));
        };
        if (large.empty()) {
          settle(std::move(whole));
          continue;
        }
        // The large regions are the flat faces a curved patch leans on, but
        // they can also be a coarser curved patch's facets (a dome's cylinder
        // next to a finer sphere): fit them in smooth components too, not one
        // plane each.
        for (const std::vector<int>& component : components(large)) {
          settle(component.size() == 1 ? planeOf(component[0]) : bestFit(component));
        }
        for (const std::vector<int>& component : components(rest)) {
          settle(component.size() == 1 ? planeOf(component[0]) : bestFit(component));
        }
      }

      // Each curved surface is refitted over its own nodes: those no
      // neighbouring surface is much nearer to. A planar region of a
      // fillet's strip can carry the ends of a corner sphere's facets (within
      // 1 degree and the tolerance), whose nodes pull a cylinder off by
      // thousandths: enough to keep fillets that meet from being exactly
      // tangent. A refit outside the tolerance keeps the old surface.
      {
        std::vector<int> surfaceOfRegion(regionCount, -1);
        for (size_t i = 0; i < surfaces.size(); ++i)
          for (int r : surfaces[i].regions) surfaceOfRegion[r] = static_cast<int>(i);
        for (size_t i = 0; i < surfaces.size(); ++i) {
          const int kind = surfaces[i].kind;
          if (kind <= 0) continue;
          std::vector<int> near;
          for (int r : surfaces[i].regions) {
            for (int other : regionNeighbours[r]) {
              const int q = surfaceOfRegion[other];
              if (q >= 0 && q != static_cast<int>(i) && surfaces[q].kind >= 0 &&
                  std::find(near.begin(), near.end(), q) == near.end())
                near.push_back(q);
            }
          }
          if (near.empty()) continue;
          const Gathered g = gather(surfaces[i].regions);
          // A node is the neighbour's when it is off this surface by more
          // than twice the median node (the bias the stray nodes cause) and
          // much nearer that surface; a node on the border is on both, and
          // stays. The facets fitted are those whose nodes all stayed. Up to
          // four passes: each refit shows the strays the last one hid.
          for (int pass = 0; pass < 4; ++pass) {
            Gathered own;
            own.outward = g.outward;
            own.area = g.area;
            own.largest = g.largest;
            std::vector<double> mine(g.nodes.size());
            for (size_t k = 0; k < g.nodes.size(); ++k) mine[k] = distanceToSurface(surfaces[i], meshNode(g.nodes[k]));
            std::vector<double> order(mine);
            std::nth_element(order.begin(), order.begin() + static_cast<std::ptrdiff_t>(order.size() / 2), order.end());
            const double off = std::max(2 * order[order.size() / 2], tolerance / 100);
            const int round = nodeRound++;
            for (size_t k = 0; k < g.nodes.size(); ++k) {
              bool theirs = false;
              for (size_t q = 0; q < near.size() && !theirs && mine[k] > off; ++q)
                theirs = distanceToSurface(surfaces[near[q]], meshNode(g.nodes[k])) < mine[k] / 2;
              if (theirs) continue;
              own.nodes.push_back(g.nodes[k]);
              nodeStamp[g.nodes[k]] = round;
            }
            for (int t : g.triangles) {
              if (nodeStamp[corner(t, 0)] == round && nodeStamp[corner(t, 1)] == round &&
                  nodeStamp[corner(t, 2)] == round)
                own.triangles.push_back(t);
            }
            if (own.nodes.size() == g.nodes.size() || own.nodes.size() < 12 || own.triangles.size() < 6) break;
            const MeshFit fit = fitKind(kind, own);
            if (!fit.ok) break;
            MeshSurface refit = surfaceOfFit(kind, fit, surfaces[i].regions, g);
            double deviation = 0;
            for (int n : g.nodes) deviation = std::max(deviation, distanceToSurface(refit, meshNode(n)));
            if (!(deviation <= tolerance)) break;
            surfaces[i] = std::move(refit);
          }
        }
      }

      // The report, before any refusal.
      int planes = 0, cylinders = 0, cones = 0, spheres = 0, tori = 0, unfitRegions = 0, unfitTriangles = 0;
      double unfitArea = 0, worstUnfitArea = -1, worstDeviation = 1e300;
      for (const MeshSurface& s : surfaces) {
        if (s.kind == 0) ++planes;
        if (s.kind == 1) ++cylinders;
        if (s.kind == 2) ++cones;
        if (s.kind == 3) ++spheres;
        if (s.kind == 4) ++tori;
        if (s.kind >= 0) continue;
        ++unfitRegions;
        unfitArea += s.area;
        for (int r : s.regions) unfitTriangles += static_cast<int>(regions[r].triangles.size());
        if (s.area > worstUnfitArea) {
          worstUnfitArea = s.area;
          worstDeviation = s.deviation;
        }
      }
      const double unfitFraction = meshArea > 0 ? unfitArea / meshArea : 0;
      double suggested = -1;
      if (unfitRegions > 0 && worstDeviation < 10 * tolerance) {
        suggested = std::ceil(worstDeviation * 1.1 * 1000 - 1e-9) / 1000;
        if (suggested <= tolerance) suggested = std::ceil(tolerance * 1000 + 1e-9) / 1000;
        if (suggested <= tolerance) suggested += 0.001;
      }
      meshReport_ = {0,
                     static_cast<double>(planes),
                     static_cast<double>(cylinders),
                     static_cast<double>(cones),
                     static_cast<double>(spheres),
                     static_cast<double>(tori),
                     static_cast<double>(unfitRegions),
                     static_cast<double>(unfitTriangles),
                     unfitFraction,
                     suggested,
                     -1,
                     0,
                     tolerance};
      out.meshArea = meshArea;
      out.meshVolume = meshVolume;
      out.planes = planes;
      out.cylinders = cylinders;
      out.cones = cones;
      out.spheres = spheres;
      out.tori = tori;
      out.unfitRegions = unfitRegions;
      out.unfitFraction = unfitFraction;
      out.suggested = suggested;
      return 1;
    }
  }

  /**
   * Auto's tolerance (ADR-0097, slice D2): segmentMesh at each step of
   * MESH_AUTO_LADDER in order and stop at the first whose unfit share is at
   * most PRISMATIC_UNFIT_ALLOWED (the share the exact rebuild tolerates);
   * that step's tolerance and segmentation are returned and reused, so the
   * caller doesn't segment again. When no step qualifies, the one with the
   * smallest unfit share (ties: the smaller tolerance). Fills `out` and
   * meshReport_ (the chosen step's report, with its tolerance in slot 12).
   * Each extra step costs a segmentation (~0.3 s on 20,000 triangles);
   * under TIMES (the spike harness) each step's tolerance, unfit share and
   * time is printed as "auto <tol>: unfit <share> %". Returns 1, or 0 with
   * lastError for an empty or inconsistent mesh.
   */
  int meshAutoTolerance(double& chosen, MeshSegmentation& out) {
    bool haveBest = false;
    double bestShare = 0;
    std::vector<double> bestReport;
    for (double step : MESH_AUTO_LADDER) {
      MeshSegmentation seg;
      const double start = nowMs();
      if (!segmentMesh(step, seg)) return 0;
      const int tenths = static_cast<int>(std::lround(seg.unfitFraction * 1000));
      rebuildTimes_.push_back(
          {"auto " + millimetres(step) + ": unfit " + std::to_string(tenths / 10) + "." +
               std::to_string(tenths % 10) + " %",
           nowMs() - start});
      if (seg.unfitFraction <= PRISMATIC_UNFIT_ALLOWED) {
        chosen = step;
        out = std::move(seg);
        return 1;
      }
      if (!haveBest || seg.unfitFraction < bestShare) {
        haveBest = true;
        bestShare = seg.unfitFraction;
        chosen = step;
        out = std::move(seg);
        bestReport = meshReport_;
      }
    }
    meshReport_ = bestReport;
    return 1;
  }

  /**
   * A surface's parameters for the hybrid rebuild (ADR-0097, slice D1): its
   * frame and numbers, and the centres its periodic parameters are taken
   * near (within half a turn), so that a region's pcurves never wrap. A
   * sphere's frame puts its poles as far from the region's nodes as it can
   * (a cap's pole would otherwise be a node of its loops).
   */
  struct MeshChart {
    int kind = -1;
    gp_Ax3 frame;
    double radius = 0, majorRadius = 0, semiAngle = 0;
    double uCentre = 0, vCentre = 0;

    bool uPeriodic() const { return kind >= 1; }
    bool vPeriodic() const { return kind == 4; }
    /** ElSLib's parameters of `p`, angles in [0, 2π). */
    void raw(const gp_Pnt& p, double& u, double& v) const {
      switch (kind) {
        case 1:
          ElSLib::Parameters(gp_Cylinder(frame, radius), p, u, v);
          break;
        case 2:
          ElSLib::Parameters(gp_Cone(frame, semiAngle, 0), p, u, v);
          break;
        case 3:
          ElSLib::Parameters(gp_Sphere(frame, radius), p, u, v);
          break;
        case 4:
          ElSLib::Parameters(gp_Torus(frame, majorRadius, radius), p, u, v);
          break;
        default:
          ElSLib::Parameters(gp_Pln(frame), p, u, v);
      }
    }
    /** `p`'s parameters, a periodic one moved by whole turns to within half a turn of its centre. */
    gp_Pnt2d uv(const gp_Pnt& p) const {
      double u = 0, v = 0;
      raw(p, u, v);
      if (uPeriodic()) u += 2 * M_PI * std::round((uCentre - u) / (2 * M_PI));
      if (vPeriodic()) v += 2 * M_PI * std::round((vCentre - v) / (2 * M_PI));
      return gp_Pnt2d(u, v);
    }
    gp_Pnt value(double u, double v) const {
      switch (kind) {
        case 1:
          return ElSLib::Value(u, v, gp_Cylinder(frame, radius));
        case 2:
          return ElSLib::Value(u, v, gp_Cone(frame, semiAngle, 0));
        case 3:
          return ElSLib::Value(u, v, gp_Sphere(frame, radius));
        case 4:
          return ElSLib::Value(u, v, gp_Torus(frame, majorRadius, radius));
        default:
          return ElSLib::Value(u, v, gp_Pln(frame));
      }
    }
    /** The surface's natural normal (∂u × ∂v) at (u, v). */
    gp_Vec normal(double u, double v) const {
      gp_Pnt p;
      gp_Vec du, dv;
      switch (kind) {
        case 1:
          ElSLib::D1(u, v, gp_Cylinder(frame, radius), p, du, dv);
          break;
        case 2:
          ElSLib::D1(u, v, gp_Cone(frame, semiAngle, 0), p, du, dv);
          break;
        case 3:
          ElSLib::D1(u, v, gp_Sphere(frame, radius), p, du, dv);
          break;
        case 4:
          ElSLib::D1(u, v, gp_Torus(frame, majorRadius, radius), p, du, dv);
          break;
        default:
          ElSLib::D1(u, v, gp_Pln(frame), p, du, dv);
      }
      return du.Crossed(dv);
    }
    Handle(Geom_Surface) surface() const {
      switch (kind) {
        case 1:
          return new Geom_CylindricalSurface(frame, radius);
        case 2:
          return new Geom_ConicalSurface(frame, semiAngle, 0);
        case 3:
          return new Geom_SphericalSurface(frame, radius);
        case 4:
          return new Geom_ToroidalSurface(frame, majorRadius, radius);
        default:
          return new Geom_Plane(frame);
      }
    }
  };

  /**
   * One region of the hybrid rebuild (ADR-0097, slice D1): a connected piece
   * of one recognised surface's triangles (kinds 0–4), or of the unfit
   * triangles (kind -1, always facets). `loops` are its boundary's node
   * lists in order, the region on the left seen from outside; the outer one
   * first (the largest area in the chart's parameters). `why` set: the
   * region is exploded, its triangles become facets.
   */
  struct MeshHybridRegion {
    int surface = -1;
    int kind = -1;
    MeshChart chart;
    std::vector<int> triangles;
    std::vector<std::vector<int>> loops;
    double area = 0;
    std::string why;
  };

  /** The angles' range past their largest gap: its start, its span (radians). */
  static void angularSpan(std::vector<double> angles, double& start, double& span) {
    start = 0;
    span = 0;
    if (angles.empty()) return;
    std::sort(angles.begin(), angles.end());
    double gap = angles.front() + 2 * M_PI - angles.back(), gapEnd = angles.front();
    for (size_t k = 1; k < angles.size(); ++k) {
      if (angles[k] - angles[k - 1] > gap) {
        gap = angles[k] - angles[k - 1];
        gapEnd = angles[k];
      }
    }
    start = gapEnd;
    span = 2 * M_PI - gap;
  }

  /**
   * The hybrid rebuild's regions and loops (ADR-0097, slice D1), from the
   * segmentation: every surface's triangles by connected piece (over the
   * mesh's edges), a periodic surface spanning more than 3/4 of a turn split
   * by its triangles' centroid angle into halves (u; a torus's v too, so
   * quarters when both are closed), each piece's chart centred on its own
   * angles, and each region's boundary ordered into loops (`meshLoops`).
   * `hybridOf` gets each triangle's region.
   */
  std::vector<MeshHybridRegion> hybridRegions(const MeshSegmentation& seg, std::vector<int>& hybridOf) const {
    const int triangleCount = static_cast<int>(seg.regionOf.size());
    auto corner = [&](int t, int k) { return static_cast<int>(meshTriangles_[3 * t + k]); };
    std::vector<int> surfaceOf(triangleCount, -1);
    for (size_t s = 0; s < seg.surfaces.size(); ++s)
      for (int r : seg.surfaces[s].regions)
        for (int t : seg.regions[r].triangles) surfaceOf[t] = static_cast<int>(s);
    // Connected pieces of one label over the mesh's edges.
    auto pieces = [&](const std::vector<int>& label) {
      std::vector<std::vector<int>> out;
      std::vector<char> seen(triangleCount, 0);
      std::vector<int> queue;
      for (int seed = 0; seed < triangleCount; ++seed) {
        if (seen[seed]) continue;
        seen[seed] = 1;
        queue.assign(1, seed);
        for (size_t head = 0; head < queue.size(); ++head) {
          const int t = queue[head];
          for (int k = 0; k < 3; ++k) {
            const int u = seg.neighbour[3 * t + k];
            if (u < 0 || seen[u] || label[u] != label[t]) continue;
            seen[u] = 1;
            queue.push_back(u);
          }
        }
        out.push_back(queue);
      }
      return out;
    };
    auto centroid = [&](int t) {
      return gp_Pnt((meshNode(corner(t, 0)) + meshNode(corner(t, 1)) + meshNode(corner(t, 2))) / 3);
    };
    // A chart per connected piece of a surface; a periodic one spanning more
    // than 3/4 of a turn is split into pieces.
    std::vector<int> label(triangleCount);
    for (int t = 0; t < triangleCount; ++t) label[t] = 4 * (surfaceOf[t] + 1);
    std::vector<MeshChart> chartOf;
    std::vector<int> chartIndex(triangleCount, -1);
    for (const std::vector<int>& piece : pieces(label)) {
      const int s = surfaceOf[piece.front()];
      MeshChart chart;
      if (s >= 0 && seg.surfaces[s].kind >= 0) {
        const MeshSurface& surface = seg.surfaces[s];
        chart.kind = surface.kind;
        chart.radius = surface.radius;
        chart.majorRadius = surface.majorRadius;
        chart.semiAngle = surface.semiAngle;
        chart.frame = gp_Ax3(surface.origin, surface.direction);
        if (surface.kind == 3) {
          // The poles away from the nodes: the mean normal, or one of six
          // directions square to it, whichever is farthest from every node.
          std::vector<gp_XYZ> directions;
          for (int t : piece)
            for (int k = 0; k < 3; ++k) {
              const gp_XYZ d = meshNode(corner(t, k)) - surface.origin.XYZ();
              if (d.Modulus() > 0) directions.push_back(d.Normalized());
            }
          const gp_Ax3 base(surface.origin, surface.direction);
          double best = -1;
          for (int c = 0; c < 7; ++c) {
            const double a = M_PI * (c - 1) / 6;
            const gp_XYZ z = c == 0 ? surface.direction.XYZ()
                                    : std::cos(a) * base.XDirection().XYZ() + std::sin(a) * base.YDirection().XYZ();
            double clearance = 1;
            for (const gp_XYZ& d : directions) clearance = std::min(clearance, 1 - std::fabs(d.Dot(z)));
            if (clearance > best + 1e-12) {
              best = clearance;
              chart.frame = gp_Ax3(surface.origin, gp_Dir(z));
            }
          }
        }
        if (chart.uPeriodic()) {
          std::vector<double> us, vs;
          for (int t : piece) {
            double u = 0, v = 0;
            chart.raw(centroid(t), u, v);
            us.push_back(u);
            vs.push_back(v);
          }
          double uStart, uSpan, vStart = 0, vSpan = 0;
          angularSpan(us, uStart, uSpan);
          if (chart.vPeriodic()) angularSpan(vs, vStart, vSpan);
          const bool splitU = uSpan > 1.5 * M_PI, splitV = chart.vPeriodic() && vSpan > 1.5 * M_PI;
          for (size_t i = 0; i < piece.size(); ++i) {
            int part = 0;
            if (splitU && std::fmod(us[i] - uStart + 4 * M_PI, 2 * M_PI) >= uSpan / 2) part += 1;
            if (splitV && std::fmod(vs[i] - vStart + 4 * M_PI, 2 * M_PI) >= vSpan / 2) part += 2;
            label[piece[i]] += part;
          }
        }
      }
      for (int t : piece) chartIndex[t] = static_cast<int>(chartOf.size());
      chartOf.push_back(chart);
    }
    // The regions: connected pieces of each label, centred on their own angles.
    std::vector<MeshHybridRegion> out;
    hybridOf.assign(triangleCount, -1);
    for (std::vector<int>& piece : pieces(label)) {
      MeshHybridRegion region;
      region.surface = surfaceOf[piece.front()];
      region.chart = chartOf[chartIndex[piece.front()]];
      region.kind = region.chart.kind;
      for (int t : piece) {
        region.area += seg.areas[t];
        hybridOf[t] = static_cast<int>(out.size());
      }
      if (region.chart.uPeriodic()) {
        std::vector<double> us, vs;
        for (int t : piece) {
          double u = 0, v = 0;
          region.chart.raw(centroid(t), u, v);
          us.push_back(u);
          vs.push_back(v);
        }
        double start, span;
        angularSpan(us, start, span);
        region.chart.uCentre = start + span / 2;
        if (region.chart.vPeriodic()) {
          angularSpan(vs, start, span);
          region.chart.vCentre = start + span / 2;
        }
      }
      region.triangles = std::move(piece);
      out.push_back(std::move(region));
    }
    for (size_t i = 0; i < out.size(); ++i)
      if (out[i].kind >= 0) meshLoops(out[i], static_cast<int>(i), hybridOf, seg.neighbour);
    return out;
  }

  /**
   * A hybrid region's boundary loops (ADR-0097, slice D1): its triangles'
   * edges whose other triangle is in another region (or none), each from
   * corner k to k + 1 (the region on its left seen from outside), chained
   * node to node into closed loops, then the outer one first (the largest
   * area in the chart's parameters; its sign must say the region is on its
   * left, every inner loop's the opposite). A node two boundary edges leave
   * (the region touches itself there) or a loop that doesn't close explodes
   * the region (`why`). Where three or more regions meet is just a node of
   * the loop: every mesh edge is its own B-rep edge, so chains between two
   * regions aren't needed here.
   */
  void meshLoops(MeshHybridRegion& region, int id, const std::vector<int>& hybridOf,
                 const std::vector<int>& neighbour) const {
    std::map<int, int> next;
    for (int t : region.triangles) {
      for (int k = 0; k < 3; ++k) {
        const int u = neighbour[3 * t + k];
        if (u >= 0 && hybridOf[u] == id) continue;
        const int a = static_cast<int>(meshTriangles_[3 * t + k]), b = static_cast<int>(meshTriangles_[3 * t + (k + 1) % 3]);
        if (!next.emplace(a, b).second) {
          region.why = "touches itself at node " + std::to_string(a);
          return;
        }
      }
    }
    while (!next.empty()) {
      const int start = next.begin()->first;
      std::vector<int> loop;
      int node = start;
      do {
        const auto it = next.find(node);
        if (it == next.end()) {
          region.why = "a loop that doesn't close";
          region.loops.clear();
          return;
        }
        loop.push_back(node);
        node = it->second;
        next.erase(it);
      } while (node != start);
      region.loops.push_back(std::move(loop));
    }
    if (region.loops.empty()) {
      region.why = "no boundary";
      return;
    }
    // The outer loop: the largest area in the chart's parameters.
    std::vector<double> signedArea;
    for (const std::vector<int>& loop : region.loops) {
      double a = 0;
      gp_Pnt2d previous = region.chart.uv(gp_Pnt(meshNode(loop.back())));
      for (int n : loop) {
        const gp_Pnt2d p = region.chart.uv(gp_Pnt(meshNode(n)));
        a += previous.X() * p.Y() - p.X() * previous.Y();
        previous = p;
      }
      signedArea.push_back(a / 2);
    }
    size_t outer = 0;
    for (size_t i = 1; i < signedArea.size(); ++i)
      if (std::fabs(signedArea[i]) > std::fabs(signedArea[outer])) outer = i;
    std::swap(region.loops[0], region.loops[outer]);
    std::swap(signedArea[0], signedArea[outer]);
    // The region's side: does the chart's normal agree with its triangles'?
    int largest = region.triangles.front();
    for (int t : region.triangles)
      if (triangleArea(t) > triangleArea(largest)) largest = t;
    const gp_Pnt2d c = region.chart.uv(gp_Pnt((meshNode(meshTriangles_[3 * largest]) + meshNode(meshTriangles_[3 * largest + 1]) +
                                               meshNode(meshTriangles_[3 * largest + 2])) /
                                              3));
    const gp_XYZ a = meshNode(meshTriangles_[3 * largest]), b = meshNode(meshTriangles_[3 * largest + 1]),
                 d = meshNode(meshTriangles_[3 * largest + 2]);
    const double side = region.chart.normal(c.X(), c.Y()).XYZ().Dot((b - a).Crossed(d - a)) < 0 ? -1 : 1;
    for (size_t i = 0; i < signedArea.size(); ++i) {
      if ((i == 0) != (side * signedArea[i] > 0)) {
        region.why = i == 0 ? "its outer loop runs the wrong way" : "an inner loop runs the wrong way";
        return;
      }
    }
  }

  /**
   * A boundary chain of the hybrid rebuild (ADR-0097, slice D3): a maximal
   * run of boundary mesh edges with the same two regions on its sides, in
   * the left region's loop order, split at every node where three or more
   * regions meet or where the boundary doesn't simply pass through (two
   * boundary edges) — stl2step's invariant I8. A closed chain is a whole
   * loop between the same two regions; its first node isn't repeated.
   * `right` is -1 across an open mesh edge.
   */
  struct MeshChain {
    int left = -1, right = -1;
    std::vector<int> nodes;
    bool closed = false;
  };

  /** A chain's candidate curve (slice D3): a line, circle or ellipse, `type` 0, 1, 2 (-1 none). */
  struct MeshChainCurve {
    int type = -1;
    gp_Lin line;
    gp_Circ circle;
    gp_Elips ellipse;
  };

  /** What chainCurve found for a chain: the curve trimmed to its nodes, or why not. */
  struct MeshChainFit {
    MeshChainCurve curve;
    double first = 0, last = 0;
    /** The largest node distance to the curve. */
    double off = 0;
    std::string why;
  };

  static constexpr const char* MESH_KIND_NAMES[5] = {"plane", "cylinder", "cone", "sphere", "torus"};

  /**
   * The hybrid regions' boundary chains (slice D3), over every region that
   * has loops (recognised and not exploded when the regions were made).
   * `chainOf` maps a boundary mesh edge (keyOf) to its chain, `breakNode`
   * says where chains end.
   */
  std::vector<MeshChain> meshChains(const std::vector<MeshHybridRegion>& regions, const std::vector<int>& hybridOf,
                                    const std::vector<int>& neighbour, std::unordered_map<uint64_t, int>& chainOf,
                                    std::vector<char>& breakNode) const {
    const int nodeCount = static_cast<int>(meshNodes_.size() / 3);
    const int triangleCount = static_cast<int>(hybridOf.size());
    auto keyOf = [](int a, int b) {
      return static_cast<uint64_t>(std::min(a, b)) << 32 | static_cast<uint64_t>(std::max(a, b));
    };
    // Per node: the regions around it and its boundary edges; per directed
    // boundary edge (a, b): the region on its right (the triangle with b → a).
    std::vector<int> boundaryEdges(nodeCount, 0);
    std::vector<std::vector<int>> regionsAt(nodeCount);
    std::unordered_map<uint64_t, int> rightOf;
    for (int t = 0; t < triangleCount; ++t) {
      for (int k = 0; k < 3; ++k) {
        const int a = static_cast<int>(meshTriangles_[3 * t + k]), b = static_cast<int>(meshTriangles_[3 * t + (k + 1) % 3]);
        std::vector<int>& at = regionsAt[a];
        if (std::find(at.begin(), at.end(), hybridOf[t]) == at.end()) at.push_back(hybridOf[t]);
        const int u = neighbour[3 * t + k];
        if (u >= 0 && hybridOf[u] == hybridOf[t]) continue;
        rightOf[static_cast<uint64_t>(a) << 32 | static_cast<uint64_t>(b)] = u >= 0 ? hybridOf[u] : -1;
        if (u < 0 || t < u) {
          ++boundaryEdges[a];
          ++boundaryEdges[b];
        }
      }
    }
    breakNode.assign(nodeCount, 0);
    for (int n = 0; n < nodeCount; ++n) breakNode[n] = regionsAt[n].size() >= 3 || (boundaryEdges[n] != 0 && boundaryEdges[n] != 2);
    auto right = [&](int a, int b) {
      const auto it = rightOf.find(static_cast<uint64_t>(a) << 32 | static_cast<uint64_t>(b));
      return it == rightOf.end() ? -1 : it->second;
    };
    std::vector<MeshChain> chains;
    chainOf.clear();
    for (size_t r = 0; r < regions.size(); ++r) {
      const MeshHybridRegion& region = regions[r];
      if (region.kind < 0 || !region.why.empty()) continue;
      for (const std::vector<int>& loop : region.loops) {
        const size_t m = loop.size();
        size_t start = m;
        for (size_t i = 0; i < m && start == m; ++i)
          if (breakNode[loop[i]]) start = i;
        if (start == m) {
          // No break: the whole loop is one closed chain.
          if (chainOf.count(keyOf(loop[0], loop[1 % m]))) continue;
          MeshChain chain;
          chain.left = static_cast<int>(r);
          chain.right = right(loop[0], loop[1 % m]);
          chain.nodes = loop;
          chain.closed = true;
          for (size_t i = 0; i < m; ++i) chainOf[keyOf(loop[i], loop[(i + 1) % m])] = static_cast<int>(chains.size());
          chains.push_back(std::move(chain));
          continue;
        }
        for (size_t j = 0; j < m;) {
          // One chain: from this break node to the next.
          MeshChain chain;
          chain.left = static_cast<int>(r);
          chain.nodes.push_back(loop[(start + j) % m]);
          do {
            ++j;
            chain.nodes.push_back(loop[(start + j) % m]);
          } while (j < m && !breakNode[loop[(start + j) % m]]);
          chain.right = right(chain.nodes[0], chain.nodes[1]);
          if (chainOf.count(keyOf(chain.nodes[0], chain.nodes[1]))) continue;  // the other region's, reversed
          for (size_t i = 0; i + 1 < chain.nodes.size(); ++i)
            chainOf[keyOf(chain.nodes[i], chain.nodes[i + 1])] = static_cast<int>(chains.size());
          chains.push_back(std::move(chain));
        }
      }
    }
    return chains;
  }

  static gp_Pln meshPlane(const MeshSurface& s) { return gp_Pln(s.origin, s.direction); }
  static gp_Cylinder meshCylinder(const MeshSurface& s) { return gp_Cylinder(gp_Ax3(s.origin, s.direction), s.radius); }
  static gp_Cone meshCone(const MeshSurface& s) { return gp_Cone(gp_Ax3(s.origin, s.direction), s.semiAngle, 0); }
  static gp_Sphere meshSphere(const MeshSurface& s) { return gp_Sphere(gp_Ax3(s.origin, s.direction), s.radius); }
  static gp_Torus meshTorus(const MeshSurface& s) { return gp_Torus(gp_Ax3(s.origin, s.direction), s.majorRadius, s.radius); }

  /**
   * The curves two recognised surfaces meet in (slice D3), from the surfaces
   * alone (IntAna_QuadQuadGeo): lines, circles and ellipses where the pair
   * gives them, at most two. Empty with `why` when the pair has none we
   * collapse to (no intersection, the same surface, a parabola or hyperbola,
   * off-axis curved pairs). Coaxial cylinders give no curve here: their
   * circle depends on the chain (`coaxial` set).
   */
  static std::vector<MeshChainCurve> surfaceCurves(const MeshSurface& first, const MeshSurface& second, double tolerance,
                                                   bool& coaxial, std::string& why) {
    std::vector<MeshChainCurve> out;
    coaxial = false;
    const bool swap = first.kind > second.kind;
    const MeshSurface& a = swap ? second : first;
    MeshSurface b = swap ? first : second;
    const double angular = M_PI / 180;
    // Two curved surfaces meet in circles only when they share an axis (a
    // sphere: its centre on the other's axis): within 1° and the tolerance,
    // the second is moved onto the first's axis so that IntAna sees them
    // coaxial. Coaxial cylinders meet nowhere or everywhere: their circle is
    // the chain's own (`coaxial`); parallel ones meet in lines.
    if (a.kind >= 1 && !(a.kind == 3 && b.kind == 3)) {
      const bool sphereA = a.kind == 3, sphereB = b.kind == 3;
      const gp_Lin axisA(a.origin, a.direction), axisB(b.origin, b.direction);
      bool shared = false;
      if (sphereA) {
        shared = axisB.Distance(a.origin) <= tolerance;
      } else if (sphereB) {
        shared = axisA.Distance(b.origin) <= tolerance;
        if (shared) b.origin = ElCLib::Value(ElCLib::Parameter(axisA, b.origin), axisA);
      } else {
        shared = a.direction.IsParallel(b.direction, angular) && axisA.Distance(b.origin) <= tolerance &&
                 axisB.Distance(a.origin) <= tolerance;
        if (shared) {
          b.origin = ElCLib::Value(ElCLib::Parameter(axisA, b.origin), axisA);
          b.direction = a.direction.Dot(b.direction) < 0 ? a.direction.Reversed() : a.direction;
        }
      }
      if (shared && a.kind == 1 && b.kind == 1) {
        coaxial = true;
        return out;
      }
      if (!shared && !(a.kind == 1 && b.kind == 1)) {
        why = "no curve: off axis";
        return out;
      }
    }
    IntAna_QuadQuadGeo q;
    bool circlesOnly = true;
    switch (a.kind * 5 + b.kind) {
      case 0:  // plane|plane
        q.Perform(meshPlane(a), meshPlane(b), Precision::Angular(), tolerance);
        circlesOnly = false;
        break;
      case 1:  // plane|cylinder
        q.Perform(meshPlane(a), meshCylinder(b), angular, tolerance);
        circlesOnly = false;
        break;
      case 2:  // plane|cone
        q.Perform(meshPlane(a), meshCone(b), angular, tolerance);
        circlesOnly = false;
        break;
      case 3:  // plane|sphere
        q.Perform(meshPlane(a), meshSphere(b));
        break;
      case 4:  // plane|torus: square to the axis, or through it
        q.Perform(meshPlane(a), meshTorus(b), tolerance);
        break;
      case 6:  // cylinder|cylinder, parallel: lines
        q.Perform(meshCylinder(a), meshCylinder(b), tolerance);
        circlesOnly = false;
        break;
      case 7:
        q.Perform(meshCylinder(a), meshCone(b), tolerance);
        break;
      case 8:
        q.Perform(meshCylinder(a), meshSphere(b), tolerance);
        break;
      case 9:
        q.Perform(meshCylinder(a), meshTorus(b), tolerance);
        break;
      case 12:
        q.Perform(meshCone(a), meshCone(b), tolerance);
        break;
      case 13:
        q.Perform(meshSphere(b), meshCone(a), tolerance);
        break;
      case 14:
        q.Perform(meshCone(a), meshTorus(b), tolerance);
        break;
      case 18:
        q.Perform(meshSphere(a), meshSphere(b), tolerance);
        break;
      case 19:
        q.Perform(meshSphere(a), meshTorus(b), tolerance);
        break;
      case 24:
        q.Perform(meshTorus(a), meshTorus(b), tolerance);
        break;
      default:
        why = "no curve: unknown pair";
        return out;
    }
    if (!q.IsDone()) {
      why = "no curve: IntAna failed";
      return out;
    }
    const IntAna_ResultType type = q.TypeInter();
    if (type == IntAna_Empty || type == IntAna_Same || type == IntAna_NoGeometricSolution || type == IntAna_Point) {
      why = type == IntAna_Empty  ? "no curve: empty"
            : type == IntAna_Same ? "no curve: same surface"
            : type == IntAna_Point ? "no curve: a point"
                                   : "no curve: no geometric solution";
      return out;
    }
    if ((type == IntAna_Parabola || type == IntAna_Hyperbola) || (circlesOnly && type != IntAna_Circle && type != IntAna_PointAndCircle)) {
      why = type == IntAna_Parabola ? "no curve: parabola" : type == IntAna_Hyperbola ? "no curve: hyperbola" : "no curve: not a circle";
      return out;
    }
    for (int i = 1; i <= q.NbSolutions(); ++i) {
      MeshChainCurve c;
      try {
        if (type == IntAna_Line) {
          c.type = 0;
          c.line = q.Line(i);
        } else if (type == IntAna_Circle || type == IntAna_PointAndCircle) {
          c.type = 1;
          c.circle = q.Circle(i);
        } else if (type == IntAna_Ellipse) {
          c.type = 2;
          c.ellipse = q.Ellipse(i);
        }
      } catch (const Standard_Failure&) {
        c.type = -1;
      }
      if (c.type >= 0) out.push_back(c);
    }
    if (out.size() > 2) {
      why = "no curve: " + std::to_string(out.size()) + " curves";
      out.clear();
    } else if (out.empty()) {
      why = "no curve";
    }
    return out;
  }

  /** `p`'s parameter on `c` and its distance from it (an ellipse's by extrema). */
  static double curveParameter(const MeshChainCurve& c, const gp_Pnt& p, double& distance) {
    if (c.type == 0) {
      distance = c.line.Distance(p);
      return ElCLib::Parameter(c.line, p);
    }
    if (c.type == 1) {
      distance = c.circle.Distance(p);
      return ElCLib::Parameter(c.circle, p);
    }
    double u = ElCLib::Parameter(c.ellipse, p);
    distance = p.Distance(ElCLib::Value(u, c.ellipse));
    Extrema_ExtPElC extrema(p, c.ellipse, Precision::Confusion(), 0, 2 * M_PI);
    if (extrema.IsDone()) {
      for (int i = 1; i <= extrema.NbExt(); ++i) {
        const double d = std::sqrt(extrema.SquareDistance(i));
        if (d < distance) {
          distance = d;
          u = extrema.Point(i).Parameter();
        }
      }
    }
    return u;
  }

  static gp_Pnt curveValue(const MeshChainCurve& c, double t) {
    return c.type == 0 ? ElCLib::Value(t, c.line) : c.type == 1 ? ElCLib::Value(t, c.circle) : ElCLib::Value(t, c.ellipse);
  }

  static Handle(Geom_Curve) curveGeom(const MeshChainCurve& c) {
    if (c.type == 0) return new Geom_Line(c.line);
    if (c.type == 1) return new Geom_Circle(c.circle);
    return new Geom_Ellipse(c.ellipse);
  }

  /** "plane|cylinder". */
  static std::string pairName(int a, int b) {
    auto name = [](int k) { return k >= 0 && k < 5 ? std::string(MESH_KIND_NAMES[k]) : std::string("facets"); };
    return name(a) + "|" + name(b);
  }

  /**
   * A chain's curve (slice D3): the nearer of the two surfaces' curves
   * (`surfaceCurves`, cached per surface pair in `cache`), accepted when
   * every node is within 1.5 × the tolerance of it, the nodes' parameters
   * run one way along it, and a circle's or ellipse's span is under a turn
   * (a closed chain: exactly one). The curve is turned to run with the
   * chain; `first`/`last` are its end nodes' parameters.
   */
  MeshChainFit chainCurve(const MeshChain& chain, const std::vector<MeshHybridRegion>& regions,
                          const MeshSegmentation& seg, double tolerance,
                          std::map<std::pair<int, int>, std::pair<std::vector<MeshChainCurve>, std::string>>& cache,
                          std::map<std::pair<int, int>, bool>& coaxialPairs) const {
    MeshChainFit fit;
    const MeshHybridRegion& left = regions[chain.left];
    const MeshHybridRegion& right = regions[chain.right];
    if (left.surface == right.surface) {
      // Two pieces of one periodic surface (the split): their seam stays the mesh's.
      fit.why = "no curve: same surface";
      return fit;
    }
    const std::pair<int, int> pair(std::min(left.surface, right.surface), std::max(left.surface, right.surface));
    auto cached = cache.find(pair);
    if (cached == cache.end()) {
      bool coaxial = false;
      std::string why;
      std::vector<MeshChainCurve> curves =
          surfaceCurves(seg.surfaces[pair.first], seg.surfaces[pair.second], tolerance, coaxial, why);
      if (coaxial) why.clear();
      coaxialPairs[pair] = coaxial;
      cached = cache.emplace(pair, std::make_pair(std::move(curves), why)).first;
    }
    std::vector<MeshChainCurve> curves = cached->second.first;
    if (coaxialPairs[pair]) {
      // Coaxial cylinders: the circle square to the axis through the nodes' mean height, the radii's mean.
      const MeshSurface& a = seg.surfaces[pair.first];
      const MeshSurface& b = seg.surfaces[pair.second];
      double height = 0;
      for (int n : chain.nodes) height += (meshNode(n) - a.origin.XYZ()).Dot(a.direction.XYZ());
      height /= static_cast<double>(chain.nodes.size());
      MeshChainCurve c;
      c.type = 1;
      c.circle = gp_Circ(gp_Ax2(gp_Pnt(a.origin.XYZ() + height * a.direction.XYZ()), a.direction), (a.radius + b.radius) / 2);
      curves.assign(1, c);
    }
    if (curves.empty()) {
      fit.why = cached->second.second.empty() ? "no curve" : cached->second.second;
      return fit;
    }
    // The nearer curve (the sum of the nodes' distances).
    double best = 1e300;
    for (const MeshChainCurve& c : curves) {
      double sum = 0, d = 0;
      for (int n : chain.nodes) {
        curveParameter(c, gp_Pnt(meshNode(n)), d);
        sum += d;
      }
      if (sum < best) {
        best = sum;
        fit.curve = c;
      }
    }
    // Every node near it, its parameters one way along it.
    const double reach = 1.5 * tolerance;
    for (int pass = 0; pass < 2; ++pass) {
      std::vector<double> ts;
      fit.off = 0;
      for (size_t i = 0; i < chain.nodes.size(); ++i) {
        double d = 0;
        ts.push_back(curveParameter(fit.curve, gp_Pnt(meshNode(chain.nodes[i])), d));
        fit.off = std::max(fit.off, d);
        if (d > reach) {
          char text[96];
          std::snprintf(text, sizeof text, "node %zu off by %.4g", i, d);
          fit.why = text;
          return fit;
        }
      }
      const bool periodic = fit.curve.type > 0;
      std::vector<double> steps;
      const size_t count = chain.closed ? ts.size() : ts.size() - 1;
      for (size_t i = 0; i < count; ++i) {
        double step = ts[(i + 1) % ts.size()] - ts[i];
        if (periodic) step -= 2 * M_PI * std::round(step / (2 * M_PI));
        steps.push_back(step);
      }
      const bool up = std::all_of(steps.begin(), steps.end(), [](double s) { return s > 0; });
      const bool down = std::all_of(steps.begin(), steps.end(), [](double s) { return s < 0; });
      if (!up && !down) {
        fit.why = "not monotone";
        return fit;
      }
      if (down) {
        // Turn the curve to run with the chain, and measure again.
        if (pass == 1) {
          fit.why = "not monotone";
          return fit;
        }
        auto flipped = [](const gp_Ax2& ax) { return gp_Ax2(ax.Location(), ax.Direction().Reversed(), ax.XDirection()); };
        if (fit.curve.type == 0) fit.curve.line.Reverse();
        else if (fit.curve.type == 1) fit.curve.circle.SetPosition(flipped(fit.curve.circle.Position()));
        else fit.curve.ellipse.SetPosition(flipped(fit.curve.ellipse.Position()));
        continue;
      }
      double span = 0;
      for (double s : steps) span += s;
      if (periodic && (chain.closed ? std::fabs(span - 2 * M_PI) > 1e-6 : span >= 2 * M_PI - 1e-9)) {
        fit.why = "spans " + std::to_string(span / (2 * M_PI)) + " turns";
        return fit;
      }
      fit.first = ts.front();
      fit.last = periodic ? ts.front() + span : ts.back();
      return fit;
    }
    return fit;
  }

  double triangleArea(int t) const {
    const gp_XYZ a = meshNode(meshTriangles_[3 * t]), b = meshNode(meshTriangles_[3 * t + 1]), c = meshNode(meshTriangles_[3 * t + 2]);
    return (b - a).Crossed(c - a).Modulus() / 2;
  }

  /** The hybrid regions' loops for tests (ADR-0097, slice D1): see meshLoopsDebug. */
  std::vector<int32_t> meshLoops_;

  /**
   * meshToSolid's prismatic method (ADR-0097 §3 and its amendments), over
   * the staged buffers, in two stages: segmentMesh, then the exact rebuild
   * (rebuildPrismatic: one oversized face per surface, BOPAlgo_MakerVolume,
   * the cells inside the mesh kept, the result checked against the mesh),
   * skipped when the segmentation already rules it out (any unfit region, or
   * surfaces over PRISMATIC_SURFACE_CAP; slice D4); then,
   * when it was skipped or refused, the hybrid rebuild (rebuildHybrid, slice
   * D1) on a deadline of its own. The tolerance retries run only when both
   * refused. Fills meshReport_ before a refusal too.
   */
  int prismaticFromMesh(double tolerance) {
    rebuildTimes_.clear();
    rebuildRefusal_.clear();
    hybridRefusal_.clear();
    hybridExploded_ = 0;
    try {
      // A tolerance of 0 or less means Auto (ADR-0097, slice D2): the ladder
      // picks one from the mesh and its segmentation is reused.
      const bool autoTolerance = !(tolerance > 0);
      MeshSegmentation seg;
      double used = tolerance;
      if (autoTolerance) {
        if (!meshAutoTolerance(used, seg)) return 0;
      } else {
        if (!segmentMesh(tolerance, seg)) return 0;
      }
      const int planes = seg.planes, cylinders = seg.cylinders, cones = seg.cones, spheres = seg.spheres, tori = seg.tori;
      const int unfitRegions = seg.unfitRegions;
      const double unfitFraction = seg.unfitFraction, suggested = seg.suggested;
      const std::string rebuildFailed = "Mesh to Solid couldn't rebuild this mesh as an exact solid within " +
                                        millimetres(used) + " mm. " +
                                        (autoTolerance ? "Use Faceted, or simplify the mesh in your slicer."
                                                       : "Raise the tolerance, or use Faceted.");
      std::string unfitFailed;
      if (unfitRegions > 0) {
        const std::string regionsText =
            std::to_string(unfitRegions) + (unfitRegions == 1 ? " region (" : " regions (") +
            std::to_string(static_cast<int>(std::lround(unfitFraction * 100))) + " % of the surface) " +
            (unfitRegions == 1 ? "fits" : "fit") + " no plane, cylinder, sphere, cone or torus. ";
        // Auto already went up the ladder: no "raise to" clause then.
        const std::string advice =
            autoTolerance ? std::string("Use Faceted, or simplify the mesh in your slicer.")
            : suggested > 0 ? "Raise the tolerance to " + millimetres(suggested) + " mm, or use Faceted."
                            : std::string("Use Faceted, or simplify the mesh in your slicer.");
        unfitFailed = "Mesh to Solid couldn't close the body: " + regionsText + advice;
      }
      // The exact stage runs only when the segmentation has no unfit region at
      // all and at most PRISMATIC_SURFACE_CAP surfaces (slice D4). An unfit
      // region left out (slice C) changes the geometry — its triangles are
      // dropped and the neighbours' faces extended to meet — where the hybrid
      // keeps it as facets, which is more faithful and is where such a file
      // ends up anyway when the exact stage fails; and the exact rebuild can
      // burn its whole budget (MakerVolume overruns it inside one long step).
      // PRISMATIC_UNFIT_ALLOWED stays rebuildPrismatic's own rule (the share
      // it leaves out) and the Auto ladder's stopping rule.
      const int recognisedSurfaces = planes + cylinders + cones + spheres + tori;
      const bool exactSkipped = unfitRegions > 0 || recognisedSurfaces > PRISMATIC_SURFACE_CAP;
      // An exception in the booleans is a failed rebuild like any other;
      // past the budget, the rebuild gives up (a refusal, never a trap).
      const std::string gaveUp =
          "Mesh to Solid gave up after " + std::to_string(static_cast<int>(PRISMATIC_REBUILD_BUDGET_MS / 1000)) +
          " s: this mesh has too many surfaces to rebuild exactly. Use Faceted, or "
          "simplify the mesh in your slicer.";
      Handle(MeshDeadline) deadline;
      auto rebuild = [&](double t, MeshSegmentation& s, const std::string& failed) {
        try {
          return rebuildPrismatic(t, s.surfaces, s.regions, s.regionOf, s.regionNeighbours, s.normals, s.areas,
                                  s.meshArea, s.meshVolume, failed, deadline);
        } catch (...) {
          if (rebuildRefusal_.empty()) {
            failFromException("an exception");
            rebuildRefusal_ = lastError_ + (rebuildTimes_.empty() ? "" : " after " + rebuildTimes_.back().first);
          }
          return fail(failed.c_str());
        }
      };
      // The exact rebuild snaps and merges the surfaces in place; the hybrid takes them as fitted.
      const std::vector<MeshSurface> fitted = seg.surfaces;
      bool exactExpired = false;
      if (!exactSkipped) {
        deadline = new MeshDeadline(nowMs() + prismaticBudgetMs_);
        const int handle = rebuild(used, seg, rebuildFailed);
        if (handle) return handle;
        exactExpired = deadline->expired();
        deadlineLeft_ = deadline->left();
      }
      const std::vector<double> report = meshReport_;
      // What the exact budget had left; the retries get that much after the hybrid.
      const double exactLeft = deadline.IsNull() ? prismaticBudgetMs_ : std::max(0.0, deadlineLeft_);
      seg.surfaces = fitted;
      std::string capMessage;
      bool hybridExpired = false, hybridThrew = false;
      {
        const std::string exactWhy = rebuildRefusal_;
        Handle(MeshDeadline) hybridDeadline = new MeshDeadline(nowMs() + hybridBudgetMs_);
        try {
          const int handle = rebuildHybrid(used, seg, rebuildFailed, hybridDeadline, capMessage);
          if (handle) return handle;
        } catch (const HybridOutOfTime&) {
          hybridExpired = true;
          hybridRefusal_ = "past the budget";
        } catch (...) {
          hybridThrew = true;
          failFromException("an exception");
          hybridRefusal_ = lastError_ + (rebuildTimes_.empty() ? "" : " after " + rebuildTimes_.back().first);
        }
        rebuildRefusal_ = exactWhy;
      }
      meshReport_ = report;
      if (!capMessage.empty()) return fail(capMessage.c_str());
      if (hybridExpired) {
        const std::string message = "Mesh to Solid gave up after " + std::to_string(static_cast<int>(hybridBudgetMs_ / 1000)) +
                                    " s: this mesh is too large to rebuild. Use Faceted, or simplify the mesh in your slicer.";
        return fail(message.c_str());
      }
      // The exact rebuild ran out of time: no retries; the hybrid's own refusal says what happened.
      if (exactExpired) return fail(hybridThrew ? gaveUp.c_str() : rebuildFailed.c_str());
      // A tolerance to suggest: the exact rebuild (segmentation included) at
      // 2 and 5 x the tolerance, within what is left of its budget (a budget
      // of its own when it was skipped). The result there is dropped (the
      // user chose this tolerance); the report and the stage times stay this
      // tolerance's.
      deadline = new MeshDeadline(nowMs() + exactLeft);
      const auto times = rebuildTimes_;
      const std::string why = rebuildRefusal_, hybridWhy = hybridRefusal_;
      double works = -1;
      // Auto already went up the ladder: the 2 T / 5 T retries make no sense then.
      for (double factor : {2.0, 5.0}) {
        if (autoTolerance || deadline->expired()) break;
        try {
          MeshSegmentation wider;
          if (!segmentMesh(factor * used, wider)) break;
          if (wider.unfitFraction > PRISMATIC_UNFIT_ALLOWED ||
              wider.planes + wider.cylinders + wider.cones + wider.spheres + wider.tori > PRISMATIC_SURFACE_CAP)
            continue;
          const int h = rebuild(factor * used, wider, rebuildFailed);
          if (h) {
            release(h);
            works = factor * tolerance;
            break;
          }
        } catch (...) {
        }
      }
      meshReport_ = report;
      rebuildTimes_ = times;
      rebuildRefusal_ = why;
      hybridRefusal_ = hybridWhy;
      // The hybrid's own refusal (validity, the checks) wins over the unfit
      // message: its unfit regions were facets there. An exception keeps it.
      if (hybridThrew && unfitRegions > 0) {
        if (works > 0) {
          unfitFailed = unfitFailed.substr(0, unfitFailed.find(" torus. ") + 8) + "Raise the tolerance to " +
                        millimetres(works) + " mm, or use Faceted.";
        }
        return fail(unfitFailed.c_str());
      }
      if (works > 0) {
        const std::string message = "Mesh to Solid couldn't rebuild this mesh as an exact solid within " +
                                    millimetres(tolerance) + " mm. Raise the tolerance to " + millimetres(works) +
                                    " mm, or use Faceted.";
        return fail(message.c_str());
      }
      return fail(rebuildFailed.c_str());
    } catch (...) {
      return failFromException("Mesh to Solid failed");
    }
  }

  /**
   * Prismatic's rebuild and verification (ADR-0097 §3): snaps each cylinder
   * to the planes it is tangent or square to (a sphere to the cylinders it
   * shares a radius with, a cone or a torus to its cylinder's or end plane's
   * axis, a torus's spine to the plane it touches) and
   * makes one oversized face per surface, splits space with
   * BOPAlgo_MakerVolume, keeps the cells inside the mesh, merges them, and
   * checks the solid against the mesh.
   */
  int rebuildPrismatic(double tolerance, std::vector<MeshSurface>& surfaces, const std::vector<MeshRegion>& regions,
                       const std::vector<int>& regionOf, const std::vector<std::vector<int>>& regionNeighbours,
                       const std::vector<gp_XYZ>& normals, const std::vector<double>& areas, double meshArea,
                       double meshVolume, const std::string& rebuildFailed, const Handle(MeshDeadline)& deadline) {
    // The stage times are cleared by prismaticFromMesh, so Auto's ladder
    // entries (ADR-0097, slice D2) stay in front of the rebuild's.
    rebuildRefusal_.clear();
    rebuildWarnings_.clear();
    // Which check refused (the spike harness prints it under TIMES=1).
    auto refuse = [&](const std::string& why) {
      rebuildRefusal_ = why;
      return fail(rebuildFailed.c_str());
    };
    double stageStart = nowMs();
    auto stage = [&](const std::string& name) {
      const double t = nowMs();
      rebuildTimes_.push_back({name, t - stageStart});
      stageStart = t;
    };
    // Past the deadline, the rebuild stops between its own loops too (prismaticFromMesh words the refusal).
    struct OutOfTime {};
    auto check = [&] {
      if (deadline->expired()) throw OutOfTime();
    };
    const double sinOne = std::sin(M_PI / 180), cosOne = std::cos(M_PI / 180);
    // Surfaces that are one surface (a cylinder the segmentation found in
    // pieces between other faces, two coplanar faces) become one: two faces
    // a few thousandths apart on one surface leave MakerVolume slivers or no
    // cell at all (ADR-0097's hardening slice A amendment). A surface joins a larger
    // one of its kind with a parallel normal or axis (and a radius within
    // the tolerance) when every node of it is within the tolerance of that one.
    {
      std::vector<int> order(surfaces.size());
      for (size_t i = 0; i < order.size(); ++i) order[i] = static_cast<int>(i);
      std::stable_sort(order.begin(), order.end(), [&](int a, int b) { return surfaces[a].area > surfaces[b].area; });
      std::vector<int> roots;
      std::vector<char> merged(surfaces.size(), 0);
      for (int b : order) {
        MeshSurface& small = surfaces[b];
        for (int a : roots) {
          if (small.kind < 0) break;
          MeshSurface& large = surfaces[a];
          if (large.kind != small.kind) continue;
          const double along = large.direction.XYZ().Dot(small.direction.XYZ());
          if (large.kind == 0 ? along < cosOne : large.kind != 3 && std::fabs(along) < cosOne) continue;
          if (large.kind > 0 && std::fabs(large.radius - small.radius) > tolerance) continue;
          if (large.kind == 4 && std::fabs(large.majorRadius - small.majorRadius) > tolerance) continue;
          if (large.kind == 2 && std::fabs(large.semiAngle - small.semiAngle) > sinOne) continue;
          bool on = true;
          for (size_t k = 0; k < small.regions.size() && on; ++k)
            for (size_t j = 0; j < regions[small.regions[k]].nodes.size() && on; ++j)
              on = distanceToSurface(large, meshNode(regions[small.regions[k]].nodes[j])) <= tolerance;
          if (!on) {
            // Else one fit over both that holds every node of both.
            std::vector<int> nodes, triangles;
            for (const MeshSurface* piece : {&large, &small}) {
              for (int r : piece->regions) {
                nodes.insert(nodes.end(), regions[r].nodes.begin(), regions[r].nodes.end());
                triangles.insert(triangles.end(), regions[r].triangles.begin(), regions[r].triangles.end());
              }
            }
            std::sort(nodes.begin(), nodes.end());
            nodes.erase(std::unique(nodes.begin(), nodes.end()), nodes.end());
            MeshFit fit = large.kind == 0   ? fitMeshPlane(nodes, large.direction.XYZ())
                          : large.kind == 1 ? fitMeshCylinder(nodes, triangles, normals, areas)
                          : large.kind == 2 ? fitMeshCone(nodes, triangles, normals, areas)
                          : large.kind == 3 ? fitMeshSphere(nodes)
                                            : fitMeshTorus(nodes, triangles, normals, areas, tolerance);
            // A cylinder's pieces: about either one's axis too (a short arc's facets tilt a free axis).
            for (const MeshSurface* piece : {&large, &small}) {
              if (large.kind != 1 || (fit.ok && fit.deviation <= tolerance)) break;
              fit = fitMeshCylinderAlong(nodes, piece->direction);
            }
            if (!fit.ok || !(fit.deviation <= tolerance)) continue;
            MeshSurface joint = large;
            joint.origin = fit.origin;
            if (large.kind != 3) joint.direction = fit.direction;
            joint.radius = fit.radius;
            joint.majorRadius = fit.majorRadius;
            joint.semiAngle = fit.semiAngle;
            for (size_t k = 0; k < nodes.size() && on; ++k) on = distanceToSurface(joint, meshNode(nodes[k])) <= tolerance;
            if (!on) continue;
            large = joint;
          }
          large.regions.insert(large.regions.end(), small.regions.begin(), small.regions.end());
          large.area += small.area;
          large.sag = std::max(large.sag, small.sag);
          merged[b] = 1;
          break;
        }
        if (!merged[b]) roots.push_back(b);
      }
      std::vector<MeshSurface> kept;
      for (size_t i = 0; i < surfaces.size(); ++i)
        if (!merged[i]) kept.push_back(std::move(surfaces[i]));
      surfaces = std::move(kept);
    }
    stage("same surfaces merged");
    const int surfaceCount = static_cast<int>(surfaces.size());
    std::vector<int> surfaceOf(regions.size(), -1);
    for (int s = 0; s < surfaceCount; ++s)
      for (int r : surfaces[s].regions) surfaceOf[r] = s;
    // Every region is on exactly one surface (segmentMesh's promise); one on
    // none would index adjacent[-1] (the trap of ADR-0097's hardening slice A amendment).
    for (int s : surfaceOf)
      if (s < 0) return refuse("a region on no surface");
    std::vector<std::vector<int>> adjacent(surfaceCount);
    for (size_t r = 0; r < regions.size(); ++r) {
      for (int other : regionNeighbours[r]) {
        const int a = surfaceOf[r], b = surfaceOf[other];
        if (a != b && std::find(adjacent[a].begin(), adjacent[a].end(), b) == adjacent[a].end()) adjacent[a].push_back(b);
      }
    }

    // The surfaces as fitted, for the snaps' check below.
    const std::vector<MeshSurface> fitted(surfaces);

    // Neighbouring cylinders, spheres and tori (their tube) whose radii agree
    // within the tolerance are one rolling ball's fillets: they take their
    // area-weighted mean radius, so that the snaps below make them exactly
    // tangent to each other (a fitted fillet that took a sliver of its
    // corner is a few thousandths off).
    {
      std::vector<int> group(surfaceCount);
      for (int i = 0; i < surfaceCount; ++i) group[i] = i;
      auto root = [&](int i) {
        while (group[i] != i) i = group[i] = group[group[i]];
        return i;
      };
      auto rolling = [&](const MeshSurface& s) { return s.kind == 1 || s.kind == 3 || s.kind == 4; };
      for (int i = 0; i < surfaceCount; ++i) {
        if (!rolling(surfaces[i])) continue;
        for (int other : adjacent[i]) {
          if (rolling(surfaces[other]) && std::fabs(surfaces[i].radius - surfaces[other].radius) <= tolerance)
            group[root(i)] = root(other);
        }
      }
      std::vector<double> weighted(surfaceCount, 0), weights(surfaceCount, 0);
      for (int i = 0; i < surfaceCount; ++i) {
        if (!rolling(surfaces[i])) continue;
        weighted[root(i)] += surfaces[i].area * surfaces[i].radius;
        weights[root(i)] += surfaces[i].area;
      }
      for (int i = 0; i < surfaceCount; ++i) {
        if (rolling(surfaces[i]) && weights[root(i)] > 0) surfaces[i].radius = weighted[root(i)] / weights[root(i)];
      }
    }

    // Snap each cylinder to its neighbouring planes: tangent ones (a fillet
    // between two planes, a slot's end between two walls) fix its axis and
    // position exactly, square ones (an end cap, a hole's plate) its axis.
    // Booleans are weak on nearly tangent surfaces; exactly tangent ones they
    // handle.
    for (MeshSurface& c : surfaces) {
      if (c.kind != 1) continue;
      gp_XYZ axis = c.direction.XYZ(), o = c.origin.XYZ();
      std::vector<MeshTangent> tangents;
      std::vector<gp_XYZ> squares;
      for (int other : adjacent[&c - surfaces.data()]) {
        const MeshSurface& p = surfaces[other];
        if (p.kind != 0) continue;
        const gp_XYZ n = p.direction.XYZ();
        const double along = std::fabs(axis.Dot(n));
        if (along < sinOne) {
          const double d = (o - p.origin.XYZ()).Dot(n);
          if (std::fabs(std::fabs(d) - c.radius) <= tolerance) tangents.push_back({n, p.origin.XYZ(), d >= 0 ? 1.0 : -1.0});
        } else if (along > cosOne) {
          squares.push_back(n);
        }
      }
      bool snapped = false;
      for (size_t i = 0; i < tangents.size() && !snapped; ++i) {
        for (size_t j = i + 1; j < tangents.size() && !snapped; ++j) {
          const MeshTangent &a = tangents[i], &b = tangents[j];
          const double dot = a.n.Dot(b.n);
          if (std::fabs(dot) < cosOne) {
            gp_XYZ dir = a.n.Crossed(b.n).Normalized();
            if (dir.Dot(axis) < 0) dir.Reverse();
            const double m[3][3] = {{a.n.X(), a.n.Y(), a.n.Z()}, {b.n.X(), b.n.Y(), b.n.Z()}, {dir.X(), dir.Y(), dir.Z()}};
            const double rhs[3] = {a.p.Dot(a.n) + a.side * c.radius, b.p.Dot(b.n) + b.side * c.radius, o.Dot(dir)};
            double x[3];
            if (solve3(m, rhs, x)) {
              axis = dir;
              o = gp_XYZ(x[0], x[1], x[2]);
              snapped = true;
            }
          } else if (dot < -cosOne) {
            // Two opposite walls: the cylinder fills the gap between them.
            const double gap = std::fabs((b.p - a.p).Dot(a.n));
            if (std::fabs(gap - 2 * c.radius) <= 2 * tolerance) {
              c.radius = gap / 2;
              axis = (axis - axis.Dot(a.n) * a.n).Normalized();
              o = o - ((o - a.p).Dot(a.n) - a.side * c.radius) * a.n;
              snapped = true;
            }
          }
        }
      }
      if (!snapped && !tangents.empty()) {
        // One tangent plane: the axis in it, along a square plane's normal
        // when there is one (an end cap), else the fitted axis's projection.
        const MeshTangent& a = tangents[0];
        gp_XYZ along = axis;
        for (const gp_XYZ& n : squares) {
          if (std::fabs(n.Dot(a.n)) < sinOne) {
            along = n.Dot(axis) < 0 ? n.Reversed() : n;
            break;
          }
        }
        axis = (along - along.Dot(a.n) * a.n).Normalized();
        o = o - ((o - a.p).Dot(a.n) - a.side * c.radius) * a.n;
        snapped = true;
      }
      if (!snapped && !squares.empty()) axis = axis.Dot(squares[0]) < 0 ? squares[0].Reversed() : squares[0];
      c.direction = gp_Dir(axis);
      c.origin = gp_Pnt(o);
    }

    // A sphere next to cylinders it shares its radius with (a dome): take
    // their radius and the point nearest to their axes.
    for (int i = 0; i < surfaceCount; ++i) {
      MeshSurface& sphere = surfaces[i];
      if (sphere.kind != 3) continue;
      std::vector<int> axes;
      for (int other : adjacent[i]) {
        const MeshSurface& c = surfaces[other];
        if (c.kind == 1 && std::fabs(c.radius - sphere.radius) <= tolerance) axes.push_back(other);
      }
      if (axes.empty()) continue;
      if (axes.size() == 1) {
        const gp_XYZ o = surfaces[axes[0]].origin.XYZ(), a = surfaces[axes[0]].direction.XYZ();
        const gp_XYZ c = sphere.origin.XYZ();
        sphere.origin = gp_Pnt(o + (c - o).Dot(a) * a);
      } else {
        double m[3][3] = {{0, 0, 0}, {0, 0, 0}, {0, 0, 0}}, b[3] = {0, 0, 0};
        for (int other : axes) {
          const gp_XYZ a = surfaces[other].direction.XYZ(), o = surfaces[other].origin.XYZ();
          for (int r = 0; r < 3; ++r) {
            for (int cc = 0; cc < 3; ++cc)
              m[r][cc] += (r == cc ? 1.0 : 0.0) - a.Coord(r + 1) * a.Coord(cc + 1);
            b[r] += o.Coord(r + 1) - a.Coord(r + 1) * o.Dot(a);
          }
        }
        double x[3];
        if (solve3(m, b, x)) sphere.origin = gp_Pnt(x[0], x[1], x[2]);
      }
      double radius = 0;
      for (int other : axes) radius += surfaces[other].radius;
      sphere.radius = radius / static_cast<double>(axes.size());
    }

    // A cone next to a cylinder shares its axis (a countersink); next to a
    // plane it is square to, that plane's normal.
    for (int i = 0; i < surfaceCount; ++i) {
      MeshSurface& cone = surfaces[i];
      if (cone.kind != 2) continue;
      const gp_XYZ a = cone.direction.XYZ();
      bool snapped = false;
      for (int other : adjacent[i]) {
        const MeshSurface& c = surfaces[other];
        if (c.kind != 1) continue;
        const gp_XYZ ca = c.direction.XYZ();
        if (std::fabs(a.Dot(ca)) <= cosOne) continue;
        const gp_XYZ axis = a.Dot(ca) < 0 ? gp_XYZ(-ca.X(), -ca.Y(), -ca.Z()) : ca;
        const gp_XYZ o = c.origin.XYZ(), apex = cone.origin.XYZ();
        cone.direction = gp_Dir(axis);
        cone.origin = gp_Pnt(o + (apex - o).Dot(axis) * axis);
        snapped = true;
        break;
      }
      if (snapped) continue;
      for (int other : adjacent[i]) {
        const MeshSurface& p = surfaces[other];
        if (p.kind != 0) continue;
        const gp_XYZ n = p.direction.XYZ();
        if (std::fabs(a.Dot(n)) <= cosOne) continue;
        cone.direction = gp_Dir(a.Dot(n) < 0 ? gp_XYZ(-n.X(), -n.Y(), -n.Z()) : n);
        break;
      }
    }

    // A torus next to a cylinder it shares its axis with (a fillet on a
    // cylinder's end or on a hole's edge) takes that axis line, and its
    // spine the cylinder's radius minus or plus the tube's; next to a plane
    // it is square to, that plane's normal. Either way, a plane it touches
    // (the spine plane the tube radius from it) puts the spine plane exactly
    // that far.
    for (int i = 0; i < surfaceCount; ++i) {
      MeshSurface& torus = surfaces[i];
      if (torus.kind != 4) continue;
      gp_XYZ a = torus.direction.XYZ(), c = torus.origin.XYZ();
      bool axial = false;
      for (int other : adjacent[i]) {
        const MeshSurface& cyl = surfaces[other];
        if (cyl.kind != 1) continue;
        const gp_XYZ ca = cyl.direction.XYZ();
        if (std::fabs(a.Dot(ca)) <= cosOne) continue;
        a = a.Dot(ca) < 0 ? gp_XYZ(-ca.X(), -ca.Y(), -ca.Z()) : ca;
        const gp_XYZ o = cyl.origin.XYZ();
        c = o + (c - o).Dot(a) * a;
        const double r = torus.radius, R = torus.majorRadius;
        if (std::fabs(R + r - cyl.radius) <= 10 * tolerance) torus.majorRadius = cyl.radius - r;
        else if (std::fabs(R - r - cyl.radius) <= 10 * tolerance) torus.majorRadius = cyl.radius + r;
        axial = true;
        break;
      }
      for (int other : adjacent[i]) {
        const MeshSurface& p = surfaces[other];
        if (p.kind != 0) continue;
        const gp_XYZ n = p.direction.XYZ();
        const double along = a.Dot(n);
        if (std::fabs(along) <= cosOne) continue;
        if (!axial) a = along < 0 ? gp_XYZ(-n.X(), -n.Y(), -n.Z()) : n;
        const double h = (c - p.origin.XYZ()).Dot(n);
        if (std::fabs(std::fabs(h) - torus.radius) > 10 * tolerance) continue;
        c += ((h >= 0 ? torus.radius : -torus.radius) - h) / a.Dot(n) * a;
        break;
      }
      torus.direction = gp_Dir(a);
      torus.origin = gp_Pnt(c);
    }

    // A snap only takes when the surface still holds its own nodes within
    // the tolerance: a torus within 10 x the tolerance of tangent to a
    // cylinder it really meets at a crease would otherwise move off its own
    // facets (ADR-0097's hardening slice A amendment). Such a surface keeps its fit.
    for (int i = 0; i < surfaceCount; ++i) {
      if (surfaces[i].kind < 0) continue;
      double off = 0;
      for (int r : surfaces[i].regions)
        for (int n : regions[r].nodes) off = std::max(off, distanceToSurface(surfaces[i], meshNode(n)));
      if (off > tolerance) {
        if (keepRebuildFaces_) rebuildWarnings_ += "\n     surface " + std::to_string(i) + " back to its fit, snapped off by " + std::to_string(off);
        surfaces[i] = fitted[i];
      }
    }

    // 3. One oversized face per surface: grown by 10 x the tolerance, plus
    // twice the largest chord error of it and its neighbours (a coarse
    // circle's true curve leaves its polygon's box by up to that). Its
    // neighbours', not the whole mesh's: one coarse torus would grow every
    // face, and MakerVolume would intersect more of them (ADR-0097's
    // hardening slice A amendment).
    // An unfit region left out of the rebuild (at most
    // PRISMATIC_UNFIT_ALLOWED of the surface) has no face: its neighbours
    // grow across the gap it leaves, so that they meet there. Each of the
    // region's nodes is measured to the nearest node of every neighbour; the
    // second nearest neighbour grows by its distance (a node on one border
    // of a chamfer is the chamfer's width from the other border's face, a
    // wall's foot the wall's height from its top).
    std::vector<double> margins(surfaceCount), gaps(surfaceCount, 0);
    auto nodesOf = [&](const MeshSurface& s) {
      std::vector<int> nodes;
      for (int r : s.regions) nodes.insert(nodes.end(), regions[r].nodes.begin(), regions[r].nodes.end());
      std::sort(nodes.begin(), nodes.end());
      nodes.erase(std::unique(nodes.begin(), nodes.end()), nodes.end());
      return nodes;
    };
    for (int i = 0; i < surfaceCount; ++i) {
      if (surfaces[i].kind >= 0) continue;
      const std::vector<int> mine = nodesOf(surfaces[i]);
      std::vector<int> around;
      std::vector<std::vector<int>> theirs;
      size_t total = 0;
      for (int other : adjacent[i]) {
        if (surfaces[other].kind < 0) continue;
        around.push_back(other);
        theirs.push_back(nodesOf(surfaces[other]));
        total += theirs.back().size();
      }
      if (around.size() < 2) continue;
      const size_t stride = std::max<size_t>(1, mine.size() * total / 8000000);
      for (int u : mine) {
        int first = -1, second = -1;
        double d1 = 1e300, d2 = 1e300;
        for (size_t j = 0; j < around.size(); ++j) {
          double nearest = 1e300;
          for (size_t k = 0; k < theirs[j].size(); k += stride)
            nearest = std::min(nearest, (meshNode(u) - meshNode(theirs[j][k])).SquareModulus());
          if (nearest < d1) {
            second = first, d2 = d1;
            first = static_cast<int>(j), d1 = nearest;
          } else if (nearest < d2) {
            second = static_cast<int>(j), d2 = nearest;
          }
        }
        if (second >= 0) gaps[around[second]] = std::max(gaps[around[second]], std::sqrt(d2));
      }
      check();
    }
    for (int i = 0; i < surfaceCount; ++i) {
      double sag = surfaces[i].sag;
      for (int other : adjacent[i]) sag = std::max(sag, surfaces[other].sag);
      margins[i] = 10 * tolerance + 2 * sag + gaps[i];
    }
    // An angle's range over a surface's nodes (radians in [0, 2π)): from the
    // end of the largest gap between them round to its start, grown by
    // `grow`; the full turn when that gap is under twice `grow` plus twice
    // the facets' angle (a closed surface's largest gap is one facet, wider
    // than the margin when coarse). A fillet's quarter of a cylinder, or a
    // corner's cap of a sphere, would otherwise wrap round inside its
    // neighbours, where MakerVolume meets them along whole tangent circles.
    auto angularRange = [](std::vector<double>& angles, double grow, double facet, double& from, double& to) {
      from = 0;
      to = 2 * M_PI;
      if (angles.empty()) return;
      std::sort(angles.begin(), angles.end());
      double gap = angles.front() + 2 * M_PI - angles.back(), gapStart = angles.back();
      for (size_t k = 1; k < angles.size(); ++k) {
        if (angles[k] - angles[k - 1] > gap) {
          gap = angles[k] - angles[k - 1];
          gapStart = angles[k - 1];
        }
      }
      if (gap < 2 * grow + 2 * facet) return;
      from = gapStart + gap - grow;
      to = gapStart + 2 * M_PI + grow;
      if (to - from > 2 * M_PI) to = from + 2 * M_PI;
    };
    // A curved surface's facet angle, from its chord error and the radius it was measured on.
    auto facetAngle = [](double sag, double radius) {
      return radius > 0 ? 2 * std::acos(std::max(-1.0, 1 - sag / radius)) : 0.0;
    };
    NCollection_List<TopoDS_Shape> faces;
    for (const MeshSurface& s : surfaces) {
      if (s.kind < 0) continue;
      const double margin = margins[&s - surfaces.data()];
      const gp_Ax3 frame(s.origin, s.direction);
      const gp_XYZ ux = frame.XDirection().XYZ(), uy = frame.YDirection().XYZ(), uz = s.direction.XYZ();
      double lo[2] = {1e300, 1e300}, hi[2] = {-1e300, -1e300};
      for (int r : s.regions) {
        for (int n : regions[r].nodes) {
          const gp_XYZ d = meshNode(n) - s.origin.XYZ();
          const double u = s.kind == 0 ? d.Dot(ux) : d.Dot(uz), v = s.kind == 0 ? d.Dot(uy) : 0;
          lo[0] = std::min(lo[0], u);
          hi[0] = std::max(hi[0], u);
          lo[1] = std::min(lo[1], v);
          hi[1] = std::max(hi[1], v);
        }
      }
      if (s.kind == 0) {
        faces.Append(BRepBuilderAPI_MakeFace(gp_Pln(frame), lo[0] - margin, hi[0] + margin, lo[1] - margin,
                                             hi[1] + margin)
                         .Face());
      } else if (s.kind == 1) {
        std::vector<double> us;
        for (int r : s.regions) {
          for (int n : regions[r].nodes) {
            const gp_XYZ d = meshNode(n) - s.origin.XYZ();
            const double u = std::atan2(d.Dot(uy), d.Dot(ux));
            us.push_back(u < 0 ? u + 2 * M_PI : u);
          }
        }
        double u1, u2;
        angularRange(us, margin / s.radius, facetAngle(s.sag, s.radius), u1, u2);
        faces.Append(
            BRepBuilderAPI_MakeFace(gp_Cylinder(frame, s.radius), u1, u2, lo[0] - margin, hi[0] + margin).Face());
      } else if (s.kind == 2) {
        // A cone: v along a generatrix from the apex (h / cos α), from the
        // lowest node to above the highest.
        const double cosAlpha = std::cos(s.semiAngle);
        const double v1 = std::max(0.0, lo[0] / cosAlpha - margin), v2 = hi[0] / cosAlpha + margin;
        faces.Append(
            BRepBuilderAPI_MakeFace(gp_Cone(gp_Ax3(s.origin, s.direction), s.semiAngle, 0), 0, 2 * M_PI, v1, v2).Face());
      } else if (s.kind == 3) {
        // A sphere: its frame's Z is the mean outward normal, so a cap (a
        // dome, a corner) is a range of latitude v round the pole; the
        // longitude u by the largest gap, as a cylinder's.
        std::vector<double> us;
        double v1 = M_PI / 2, v2 = -M_PI / 2;
        for (int r : s.regions) {
          for (int n : regions[r].nodes) {
            const gp_XYZ d = meshNode(n) - s.origin.XYZ();
            const double v = std::asin(std::max(-1.0, std::min(1.0, d.Dot(uz) / s.radius)));
            v1 = std::min(v1, v);
            v2 = std::max(v2, v);
            const double u = std::atan2(d.Dot(uy), d.Dot(ux));
            us.push_back(u < 0 ? u + 2 * M_PI : u);
          }
        }
        const double grow = margin / s.radius, facet = facetAngle(s.sag, s.radius);
        double u1, u2;
        angularRange(us, grow, facet, u1, u2);
        v1 = v1 - grow - facet <= -M_PI / 2 ? -M_PI / 2 : v1 - grow;
        v2 = v2 + grow + facet >= M_PI / 2 ? M_PI / 2 : v2 + grow;
        faces.Append(BRepBuilderAPI_MakeFace(gp_Sphere(gp_Ax3(s.origin, s.direction), s.radius), u1, u2, v1, v2).Face());
      } else {
        // A torus: the full turn about the axis, and the tube angle v
        // (atan2(h, ρ - R)) over the nodes' range (angularRange).
        const gp_XYZ o = s.origin.XYZ(), a = s.direction.XYZ();
        std::vector<double> vs;
        for (int r : s.regions) {
          for (int n : regions[r].nodes) {
            const gp_XYZ q = meshNode(n) - o;
            const double h = q.Dot(a), rho = (q - h * a).Modulus();
            double v = std::atan2(h, rho - s.majorRadius);
            if (v < 0) v += 2 * M_PI;
            vs.push_back(v);
          }
        }
        double v1, v2;
        angularRange(vs, margin / s.radius, facetAngle(s.sag, s.majorRadius + s.radius), v1, v2);
        faces.Append(
            BRepBuilderAPI_MakeFace(gp_Torus(gp_Ax3(s.origin, s.direction), s.majorRadius, s.radius), 0, 2 * M_PI, v1, v2)
                .Face());
      }
    }
    stage("snaps and faces");
    rebuildFaces_.clear();
    if (keepRebuildFaces_) {
      // One per surface, a null shape for an unfit one left out.
      auto face = faces.begin();
      for (const MeshSurface& s : surfaces) rebuildFaces_.push_back(s.kind < 0 ? TopoDS_Shape() : *face++);
    }
    check();
    BOPAlgo_MakerVolume maker;
    maker.SetArguments(faces);
    maker.SetIntersect(true);
    // A face's margin that bounds nothing (a flap past a tangent line, a
    // cylinder's end inside a plate) would stay in its cell as an internal face.
    maker.SetAvoidInternalShapes(true);
    maker.SetRunParallel(false);
    maker.Perform(deadline->Start());
    stage("MakerVolume");
    if (keepRebuildFaces_) {
      std::ostringstream warnings;
      warnings << rebuildWarnings_ << "\n     ";
      maker.DumpWarnings(warnings);
      for (const Handle(Message_Alert)& alert : maker.GetReport()->GetAlerts(Message_Warning)) {
        Handle(TopoDS_AlertWithShape) withShape = Handle(TopoDS_AlertWithShape)::DownCast(alert);
        if (withShape.IsNull()) continue;
        Bnd_Box box;
        BRepBndLib::Add(withShape->GetShape(), box);
        double x0, y0, z0, x1, y1, z1;
        if (!box.IsVoid()) {
          box.Get(x0, y0, z0, x1, y1, z1);
          warnings << " [" << x0 << "," << y0 << "," << z0 << " .. " << x1 << "," << y1 << "," << z1 << "]";
        }
      }
      rebuildWarnings_ = warnings.str();
    }
    check();
    if (maker.HasErrors()) return refuse("MakerVolume failed");
    std::vector<TopoDS_Shape> cells;
    for (TopExp_Explorer e(maker.Shape(), TopAbs_SOLID); e.More(); e.Next()) cells.push_back(e.Current());
    if (cells.empty()) return refuse("MakerVolume made no cell");

    // Which cells are inside the mesh: points just inside and just outside
    // a sample of triangles (centroids moved along the normal by 3 x the
    // tolerance plus twice the chord error), each counted for the cell that
    // holds it; a cell no sample reached asks the mesh about its centre.
    const int triangleCount = static_cast<int>(regionOf.size());
    std::vector<int> samples;
    {
      const int target = 3000;
      const int stride = std::max(1, triangleCount / target);
      for (int t = 0; t < triangleCount; t += stride)
        if (surfaces[surfaceOf[regionOf[t]]].kind >= 0) samples.push_back(t);
      for (const MeshRegion& region : regions) {
        if (surfaces[surfaceOf[&region - regions.data()]].kind < 0) continue;
        // The region's largest triangle, so that small regions count too.
        int best = region.triangles[0];
        for (int t : region.triangles)
          if (areas[t] > areas[best]) best = t;
        if (static_cast<int>(samples.size()) < 4 * target) samples.push_back(best);
      }
    }
    std::vector<Bnd_Box> cellBoxes(cells.size());
    std::vector<std::unique_ptr<BRepClass3d_SolidClassifier>> classifiers;
    for (size_t i = 0; i < cells.size(); ++i) {
      BRepBndLib::Add(cells[i], cellBoxes[i]);
      cellBoxes[i].Enlarge(1e-6);
      classifiers.emplace_back(new BRepClass3d_SolidClassifier(cells[i]));
    }
    std::vector<int> inside(cells.size(), 0), outside(cells.size(), 0);
    // A cell whose votes agree (16 or more, 90 % one way) is decided: later
    // samples skip it, since a point is in one cell at most (a torus's or a
    // sphere's cell is slow to classify; ADR-0097's hardening slice A amendment).
    std::vector<char> decided(cells.size(), 0);
    size_t undecided = cells.size();
    // Neighbouring samples tend to fall in the same cell: try the last one first.
    size_t last[2] = {0, 0};
    std::map<int, int> lostBySurface;  // the spike harness's GAPS=1: inside samples in no cell, by surface
    for (int t : samples) {
      if (undecided == 0 && !keepRebuildFaces_) break;
      if (areas[t] <= 0) continue;
      check();
      const MeshSurface& s = surfaces[surfaceOf[regionOf[t]]];
      const double step = 3 * tolerance + 2 * s.sag;
      gp_XYZ centroid(0, 0, 0);
      for (int k = 0; k < 3; ++k) centroid += meshNode(static_cast<int>(meshTriangles_[3 * t + k]));
      centroid /= 3;
      for (int side = 0; side < 2; ++side) {
        const gp_Pnt p(centroid + (side == 0 ? -step : step) * normals[t]);
        bool found = false;
        for (size_t k = 0; k < cells.size() && !found; ++k) {
          const size_t i = k == 0 ? last[side] : k <= last[side] ? k - 1 : k;
          if ((decided[i] && !keepRebuildFaces_) || cellBoxes[i].IsOut(p)) continue;
          classifiers[i]->Perform(p, 1e-7);
          if (classifiers[i]->State() == TopAbs_IN) {
            (side == 0 ? inside : outside)[i]++;
            if (keepRebuildFaces_ && side == 1 && outside[i] % 20 == 1)
              rebuildWarnings_ += "\n     out vote cell " + std::to_string(i) + " at " + std::to_string(p.X()) + "," +
                                  std::to_string(p.Y()) + "," + std::to_string(p.Z()) + " surface " +
                                  std::to_string(surfaceOf[regionOf[t]]);
            last[side] = i;
            const int votes = inside[i] + outside[i];
            if (!decided[i] && votes >= 16 && std::max(inside[i], outside[i]) >= 0.9 * votes) {
              decided[i] = 1;
              --undecided;
            }
            found = true;
          }
        }
        if (keepRebuildFaces_ && side == 0 && !found) lostBySurface[surfaceOf[regionOf[t]]]++;
      }
    }
    if (keepRebuildFaces_) {
      std::ostringstream lost;
      for (const auto& [surface, count] : lostBySurface) lost << " " << surface << ":" << count;
      rebuildWarnings_ += "\n     inside samples in no cell, by surface:" + lost.str();
    }
    std::vector<TopoDS_Shape> kept;
    for (size_t i = 0; i < cells.size(); ++i) {
      bool keep = inside[i] > outside[i];
      if (inside[i] == 0 && outside[i] == 0) {
        GProp_GProps props;
        BRepGProp::VolumeProperties(cells[i], props);
        const gp_Pnt centre = props.CentreOfMass();
        classifiers[i]->Perform(centre, 1e-7);
        keep = classifiers[i]->State() == TopAbs_IN && insideMesh(centre.XYZ());
      }
      if (keep) kept.push_back(cells[i]);
      if (keepRebuildFaces_) {
        GProp_GProps props;
        BRepGProp::VolumeProperties(cells[i], props);
        const gp_Pnt c = props.CentreOfMass();
        rebuildWarnings_ += "\n     cell " + std::to_string(i) + (keep ? " kept" : " dropped") + " volume " +
                            std::to_string(props.Mass()) + " in " + std::to_string(inside[i]) + " out " +
                            std::to_string(outside[i]) + " centre " + std::to_string(c.X()) + "," + std::to_string(c.Y()) +
                            "," + std::to_string(c.Z());
      }
    }
    classifiers.clear();
    {
      int lost = 0, in = 0, out = 0;
      for (size_t i = 0; i < cells.size(); ++i) in += inside[i], out += outside[i];
      lost = 2 * static_cast<int>(samples.size()) - in - out;  // or skipped once every cell was decided
      stage("cells classified (" + std::to_string(cells.size()) + " cells, " + std::to_string(kept.size()) + " kept; samples " +
            std::to_string(in) + " in, " + std::to_string(out) + " out, " + std::to_string(lost) + " in no cell)");
    }
    check();
    if (kept.empty()) return refuse("no cell inside the mesh");

    // Merge the kept cells: a face two of them share is inside the body.
    auto bounding = [](const TopoDS_Shape& face) {
      return face.Orientation() == TopAbs_FORWARD || face.Orientation() == TopAbs_REVERSED;
    };
    NCollection_IndexedDataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher> uses;
    for (const TopoDS_Shape& cell : kept) {
      for (TopExp_Explorer e(cell, TopAbs_FACE); e.More(); e.Next()) {
        if (!bounding(e.Current())) continue;
        const int found = uses.FindIndex(e.Current());
        if (found == 0) uses.Add(e.Current(), 1);
        else uses(found)++;
      }
    }
    BRep_Builder builder;
    TopoDS_Shell shell;
    builder.MakeShell(shell);
    for (const TopoDS_Shape& cell : kept) {
      for (TopExp_Explorer e(cell, TopAbs_FACE); e.More(); e.Next()) {
        if (bounding(e.Current()) && uses.FindFromKey(e.Current()) == 1) builder.Add(shell, e.Current());
      }
    }
    shell.Closed(BRep_Tool::IsClosed(shell));
    BRepBuilderAPI_MakeSolid makeSolid(shell);
    if (!makeSolid.IsDone()) return refuse("MakeSolid failed");
    TopoDS_Shape solid = makeSolid.Solid();
    if (!BRepCheck_Analyzer(solid).IsValid()) {
      ShapeFix_Solid fixSolid(TopoDS::Solid(solid));
      fixSolid.Perform(deadline->Start());
      solid = fixSolid.Solid();
    }
    check();
    if (volumeOf(solid) < 0) solid.Reverse();
    // The cells split surfaces where other faces crossed them: one face per surface again.
    ShapeUpgrade_UnifySameDomain unify(solid, true, true, false);
    unify.Build();
    TopoDS_Shape result = unify.Shape();
    stage("merged and unified");
    check();
    if (!BRepCheck_Analyzer(result).IsValid()) {
      // Unify can break a valid solid (a sliver face it can't bound); heal
      // it, else keep the cells' solid as it was, split faces and all.
      bool healed = false;
      try {
        ShapeFix_Shape healer(result);
        healer.Perform(deadline->Start());
        result = healer.Shape();
        healed = BRepCheck_Analyzer(result).IsValid();
      } catch (const Standard_Failure&) {
      }
      check();
      if (!healed) {
        if (!BRepCheck_Analyzer(solid).IsValid()) return refuse("invalid after healing");
        result = solid;
        stage("unify undone");
      }
    }
    stage("validity");

    // 4. Verify: the volume within the mesh's chord error (or 1 %), and
    // every sampled mesh node within the tolerance of the solid's surface.
    // The sagitta sum is doubled: an inscribed mesh's measured polyhedral
    // deficit is up to ~1.5 x it (a 48-meridian sphere: 41.9 mm3 against
    // 28.9), so the 1 % floor alone was 0.5 % short.
    double sagSum = 0;
    for (const MeshSurface& s : surfaces) sagSum += s.area * s.sag;
    const double allowed = std::max(0.01 * std::fabs(meshVolume), 2 * sagSum + tolerance * meshArea);
    if (std::fabs(volumeOf(result) - meshVolume) > allowed)
      return refuse("volume off: " + std::to_string(volumeOf(result)) + " against " + std::to_string(meshVolume) +
                    ", allowed " + std::to_string(allowed));
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
    TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
    std::vector<MeshCheckedFace> checked;
    int resultPlanes = 0, resultCylinders = 0, resultCones = 0, resultSpheres = 0, resultTori = 0;
    for (int i = 1; i <= resultFaces.Extent(); ++i) {
      MeshCheckedFace c;
      c.face = TopoDS::Face(resultFaces(i));
      const BRepAdaptor_Surface surface(c.face, false);
      const GeomAbs_SurfaceType type = surface.GetType();
      c.kind = type == GeomAbs_Plane ? 0
               : type == GeomAbs_Cylinder ? 1
               : type == GeomAbs_Cone     ? 2
               : type == GeomAbs_Sphere   ? 3
               : type == GeomAbs_Torus    ? 4
                                          : -1;
      if (c.kind < 0) return refuse("a face of another kind");
      if (c.kind == 0) {
        c.plane = surface.Plane();
        ++resultPlanes;
      } else if (c.kind == 1) {
        c.cylinder = surface.Cylinder();
        ++resultCylinders;
      } else if (c.kind == 2) {
        c.cone = surface.Cone();
        ++resultCones;
      } else if (c.kind == 3) {
        c.sphere = surface.Sphere();
        ++resultSpheres;
      } else {
        c.torus = surface.Torus();
        ++resultTori;
      }
      double u1 = 0, v1 = 0;
      BRepTools::UVBounds(c.face, c.u0, u1, c.v0, v1);
      BRepBndLib::Add(c.face, c.box);
      c.box.Enlarge(tolerance * 1.01);
      c.inside.reset(new BRepTopAdaptor_FClass2d(c.face, 1e-7));
      checked.push_back(std::move(c));
    }
    const int nodeCount = static_cast<int>(meshNodes_.size() / 3);
    const int nodeStride = std::max(1, nodeCount / 2000);
    const double reach = tolerance * 1.01 + 1e-7;
    // The nodes of unfit regions left out have no face to be near.
    std::vector<char> leftOut(nodeCount, 0);
    for (const MeshSurface& s : surfaces)
      if (s.kind < 0)
        for (int r : s.regions)
          for (int n : regions[r].nodes) leftOut[n] = 1;
    for (int n = 0; n < nodeCount; n += nodeStride) {
      if (leftOut[n]) continue;
      check();
      const gp_Pnt p(meshNode(n));
      bool near = false;
      for (const MeshCheckedFace& c : checked) {
        if (c.box.IsOut(p)) continue;
        double u = 0, v = 0;
        gp_Pnt q;
        if (c.kind == 0) {
          ElSLib::Parameters(c.plane, p, u, v);
          q = ElSLib::Value(u, v, c.plane);
        } else if (c.kind == 1) {
          ElSLib::Parameters(c.cylinder, p, u, v);
          q = ElSLib::Value(u, v, c.cylinder);
        } else if (c.kind == 2) {
          ElSLib::Parameters(c.cone, p, u, v);
          q = ElSLib::Value(u, v, c.cone);
        } else if (c.kind == 3) {
          ElSLib::Parameters(c.sphere, p, u, v);
          q = ElSLib::Value(u, v, c.sphere);
        } else {
          ElSLib::Parameters(c.torus, p, u, v);
          q = ElSLib::Value(u, v, c.torus);
        }
        // A curved face's angles (u, and a torus's v) can start below 0 or
        // past 2π, where ElSLib's don't.
        const double turn = 2 * M_PI, slack = 1e-9;
        if (c.kind > 0) u += turn * std::ceil((c.u0 - slack - u) / turn);
        if (c.kind == 4) v += turn * std::ceil((c.v0 - slack - v) / turn);
        if (p.Distance(q) <= reach && c.inside->Perform(gp_Pnt2d(u, v)) != TopAbs_OUT) {
          near = true;
          break;
        }
      }
      if (!near) {
        BRepExtrema_DistShapeShape distance(BRepBuilderAPI_MakeVertex(p).Vertex(), result, Extrema_ExtFlag_MINMAX,
                                            Extrema_ExtAlgo_Grad, deadline->Start());
        if (!distance.IsDone() || distance.Value() > reach)
          return refuse("node " + std::to_string(n) + " off the solid by " +
                        std::to_string(distance.IsDone() ? distance.Value() : -1.0));
      }
    }
    stage("checked against the mesh");
    meshReport_[0] = static_cast<double>(resultFaces.Extent());
    meshReport_[1] = static_cast<double>(resultPlanes);
    meshReport_[2] = static_cast<double>(resultCylinders);
    meshReport_[3] = static_cast<double>(resultCones);
    meshReport_[4] = static_cast<double>(resultSpheres);
    meshReport_[5] = static_cast<double>(resultTori);
    meshReport_[10] = 0;
    meshReport_[11] = 0;
    return store(result);
  }

  /** The hybrid rebuild gives up after this much wall-clock time, a deadline of its own (ADR-0097, slice D1). */
  static constexpr double HYBRID_BUDGET_MS = 90000;
  /** The hybrid rebuild refuses a result with more facet faces than this (slice D1; 5,000 since slice D2). */
  static constexpr int HYBRID_FACET_CAP = 5000;
  /** A recognised region whose edges would need a larger tolerance (mm) is built as facets (slice D1). */
  static constexpr double HYBRID_EDGE_TOLERANCE_MAX = 1.0;
  /** Every hybrid edge has at least this tolerance (mm): twice unify's linear tolerance, so an edge unify moves onto a merged plane stays valid. */
  static constexpr double HYBRID_EDGE_TOLERANCE_MIN = 2e-3;
  // Tests and the spike harness (spikes/stl-to-solid) only; the app never calls these.
  /** The budget the next hybrid rebuild gets: HYBRID_BUDGET_MS, lowered only by the spike harness. */
  double hybridBudgetMs_ = HYBRID_BUDGET_MS;
  /** What the exact rebuild's budget had left when it refused (prismaticFromMesh's retries get it). */
  double deadlineLeft_ = 0;
  /** The last hybrid rebuild's exploded regions, and why it refused (the spike harness prints them). */
  int hybridExploded_ = 0;
  std::string hybridRefusal_;
  /** The last hybrid build's chains (slice D3): "chains: 12 collapsed (…), 3 polylines", and why chains stayed polylines. */
  std::string hybridChains_, hybridChainsKept_;
  /** Per recognised region of the last hybrid rebuild, when the spike harness asks (FACES=1). */
  bool keepHybridFaces_ = false;
  std::vector<std::string> hybridFaces_;
  /** The last unified result that failed the check, kept with keepHybridFaces_. */
  TopoDS_Shape hybridInvalid_;

  /** "5,120". */
  static std::string thousands(long n) {
    std::string digits = std::to_string(n < 0 ? -n : n), out;
    for (size_t i = 0; i < digits.size(); ++i) {
      if (i > 0 && (digits.size() - i) % 3 == 0) out += ',';
      out += digits[i];
    }
    return (n < 0 ? "-" : "") + out;
  }

  /**
   * Prismatic's second stage, the hybrid rebuild (ADR-0097, slice D1): the
   * solid built from the mesh itself with shared topology. Every recognised
   * region (`hybridRegions`) is one face on its surface, bounded by its own
   * mesh boundary (one B-rep edge per mesh edge, a line between two shared
   * vertices, so the two faces of an edge share it and the shell closes
   * without sewing); every unfit triangle, and every triangle of a region
   * whose face won't build, is a planar facet on the same edges. An edge's
   * pcurve on a curved face is the straight line between its nodes'
   * parameters, so the edge's tolerance is how far that line's image is from
   * the chord (the sag, plus the nodes' distance from the surface). Then the
   * solid per shell, UnifySameDomain (coplanar facets merge, split periodic
   * pieces merge back), the validity (a face that fails explodes its regions
   * and the build runs once more), the facet cap, the volume and the nodes.
   * Returns a handle, or 0: `capMessage` set when the facet cap refused (the
   * message to show), else lastError is `rebuildFailed` and hybridRefusal_
   * says why. Throws OutOfTime past the deadline.
   */
  struct HybridOutOfTime {};
  int rebuildHybrid(double tolerance, const MeshSegmentation& seg, const std::string& rebuildFailed,
                    const Handle(MeshDeadline)& deadline, std::string& capMessage) {
    hybridRefusal_.clear();
    hybridExploded_ = 0;
    hybridFaces_.clear();
    hybridChains_.clear();
    hybridChainsKept_.clear();
    capMessage.clear();
    auto refuse = [&](const std::string& why) {
      hybridRefusal_ = why;
      return fail(rebuildFailed.c_str());
    };
    double stageStart = nowMs();
    auto stage = [&](const std::string& name) {
      const double t = nowMs();
      rebuildTimes_.push_back({"hybrid " + name, t - stageStart});
      stageStart = t;
    };
    auto check = [&] {
      if (deadline->expired()) throw HybridOutOfTime();
    };
    const int nodeCount = static_cast<int>(meshNodes_.size() / 3);
    const int triangleCount = static_cast<int>(meshTriangles_.size() / 3);
    auto corner = [&](int t, int k) { return static_cast<int>(meshTriangles_[3 * t + k]); };
    std::vector<int> hybridOf;
    std::vector<MeshHybridRegion> regions = hybridRegions(seg, hybridOf);
    const int regionCount = static_cast<int>(regions.size());
    // The boundary chains (slice D3), once: an exploded region stays a region
    // (its triangles one facet island), so they only stop being candidates.
    std::unordered_map<uint64_t, int> chainOf;
    std::vector<char> breakNode;
    const std::vector<MeshChain> chains = meshChains(regions, hybridOf, seg.neighbour, chainOf, breakNode);
    std::vector<std::vector<int>> chainsOfRegion(regionCount);
    for (size_t c = 0; c < chains.size(); ++c) {
      chainsOfRegion[chains[c].left].push_back(static_cast<int>(c));
      if (chains[c].right >= 0) chainsOfRegion[chains[c].right].push_back(static_cast<int>(c));
    }
    std::vector<char> chainUndone(chains.size(), 0);
    std::vector<int> regionsOnSurface(seg.surfaces.size(), 0);
    for (const MeshHybridRegion& r : regions)
      if (r.surface >= 0) ++regionsOnSurface[r.surface];
    std::map<std::pair<int, int>, std::pair<std::vector<MeshChainCurve>, std::string>> curveCache;
    std::map<std::pair<int, int>, bool> coaxialPairs;
    stage("loops");
    check();

    // The mesh's shells: the faces of one connected piece of the mesh are one shell.
    std::vector<int> shellOf(triangleCount, -1);
    {
      int shells = 0;
      std::vector<int> queue;
      for (int seed = 0; seed < triangleCount; ++seed) {
        if (shellOf[seed] >= 0) continue;
        shellOf[seed] = shells;
        queue.assign(1, seed);
        for (size_t head = 0; head < queue.size(); ++head) {
          for (int k = 0; k < 3; ++k) {
            const int u = seg.neighbour[3 * queue[head] + k];
            if (u >= 0 && shellOf[u] < 0) {
              shellOf[u] = shells;
              queue.push_back(u);
            }
          }
        }
        ++shells;
      }
    }

    // Facets estimated before anything is built (the faceted pre-count's
    // rule over the facet triangles): coplanar neighbours are one face.
    auto facetEstimate = [&] {
      std::vector<int> parent(triangleCount);
      for (int t = 0; t < triangleCount; ++t) parent[t] = t;
      auto find = [&](int x) {
        while (parent[x] != x) x = parent[x] = parent[parent[x]];
        return x;
      };
      auto facet = [&](int t) { return regions[hybridOf[t]].kind < 0 || !regions[hybridOf[t]].why.empty(); };
      const double cosTolerance = std::cos(1e-3);
      int count = 0;
      for (int t = 0; t < triangleCount; ++t) {
        if (!facet(t)) continue;
        for (int k = 0; k < 3; ++k) {
          const int u = seg.neighbour[3 * t + k];
          if (u < 0 || u < t || !facet(u)) continue;
          const bool flat = seg.normals[t].Modulus() < 0.5 || seg.normals[u].Modulus() < 0.5;
          if (!flat && seg.normals[t].Dot(seg.normals[u]) < cosTolerance) continue;
          bool near = true;
          for (int c = 0; c < 3 && near && !flat; ++c)
            near = std::fabs((meshNode(corner(u, c)) - meshNode(corner(t, 0))).Dot(seg.normals[t])) <= 1e-3;
          if (!near) continue;
          const int a = find(t), b = find(u);
          if (a != b) parent[a] = b;
        }
      }
      for (int t = 0; t < triangleCount; ++t)
        if (facet(t) && find(t) == t) ++count;
      return count;
    };
    auto exactShare = [&] {
      double area = 0;
      for (const MeshHybridRegion& r : regions)
        if (r.kind >= 0 && r.why.empty()) area += r.area;
      return seg.meshArea > 0 ? area / seg.meshArea : 0;
    };
    auto capRefusal = [&](int facets, bool estimated) {
      capMessage = "Mesh to Solid could rebuild only " + std::to_string(static_cast<int>(std::floor(exactShare() * 100))) +
                   " % of this mesh as exact surfaces; the rest would be " + (estimated ? "about " : "") +
                   thousands(facets) + " facets (Extrudo keeps up to " + thousands(HYBRID_FACET_CAP) +
                   "). Raise the tolerance, or simplify the mesh in your slicer.";
      hybridRefusal_ = "facet cap";
      return fail(capMessage.c_str());
    };

    // Up to three builds: a face that fails the validity or the node check
    // explodes its region, and the build runs again. Where such a region has
    // collapsed chains, those become polylines first, in a build of its own
    // (up to two of those, slice D3).
    int undoBuilds = 0;
    // A failing region's collapsed chains back to polylines for the next build; false when it has none.
    auto undoCollapses = [&](const std::set<int>& failing, const std::vector<char>& collapsed) {
      if (undoBuilds >= 2) return false;
      int undone = 0;
      for (int region : failing)
        for (int c : chainsOfRegion[region])
          if (collapsed[c] && !chainUndone[c]) {
            chainUndone[c] = 1;
            ++undone;
          }
      if (undone == 0) return false;
      ++undoBuilds;
      return true;
    };
    std::vector<char> collapsedNow(chains.size(), 0);
    for (int attempt = 0; attempt < 3 + undoBuilds; ++attempt) {
      {
        const int estimate = facetEstimate();
        if (estimate > HYBRID_FACET_CAP * FACETED_ESTIMATE_MARGIN) return capRefusal(estimate, true);
      }
      BRep_Builder builder;
      std::vector<TopoDS_Vertex> vertices(nodeCount);
      std::unordered_map<uint64_t, TopoDS_Edge> edges;
      auto vertexOf = [&](int n) -> const TopoDS_Vertex& {
        if (vertices[n].IsNull()) builder.MakeVertex(vertices[n], gp_Pnt(meshNode(n)), Precision::Confusion());
        return vertices[n];
      };
      auto keyOf = [](int a, int b) {
        return static_cast<uint64_t>(std::min(a, b)) << 32 | static_cast<uint64_t>(std::max(a, b));
      };
      // The edge between two nodes, forward from the lower node to the higher.
      auto edgeOf = [&](int a, int b) -> const TopoDS_Edge& {
        const int lo = std::min(a, b), hi = std::max(a, b);
        TopoDS_Edge& e = edges[keyOf(a, b)];
        if (e.IsNull()) {
          const gp_Pnt p(meshNode(lo)), q(meshNode(hi));
          const Handle(Geom_Curve) line = new Geom_Line(p, gp_Dir(q.XYZ() - p.XYZ()));
          builder.MakeEdge(e, line, Precision::Confusion());
          builder.Add(e, vertexOf(lo).Oriented(TopAbs_FORWARD));
          builder.Add(e, vertexOf(hi).Oriented(TopAbs_REVERSED));
          builder.Range(e, 0, p.Distance(q));
        }
        return e;
      };
      // A straight pcurve from one node's parameters to another's, over [first, last].
      auto pcurveOf = [](const gp_Pnt2d& from, const gp_Pnt2d& to, double first, double last) {
        NCollection_Array1<gp_Pnt2d> poles(1, 2);
        poles(1) = from;
        poles(2) = to;
        NCollection_Array1<double> knots(1, 2);
        knots(1) = first;
        knots(2) = last;
        NCollection_Array1<int> mults(1, 2);
        mults(1) = mults(2) = 2;
        return Handle(Geom2d_Curve)(new Geom2d_BSplineCurve(poles, knots, mults, 1));
      };
      // How far the pcurve's image strays from the chord, sampled at the ends and 9 points between.
      auto deviation = [&](const MeshChart& chart, int lo, int hi, const gp_Pnt2d& from, const gp_Pnt2d& to) {
        const gp_XYZ p = meshNode(lo), q = meshNode(hi);
        double worst = 0;
        for (int i = 0; i <= 10; ++i) {
          const double s = i / 10.0;
          const gp_Pnt image = chart.value(from.X() + s * (to.X() - from.X()), from.Y() + s * (to.Y() - from.Y()));
          worst = std::max(worst, image.Distance(gp_Pnt(p + s * (q - p))));
        }
        return worst;
      };
      struct HybridFace {
        TopoDS_Face face;
        int region;
        bool facet;
      };
      std::vector<HybridFace> faces;
      // One face on `chart` bounded by `loops` (node lists, the region on the
      // left seen from outside); `side` -1 when the chart's normal points
      // into the material. Null when an edge would need more than the
      // largest tolerance; `worstTolerance` says how much.
      struct EdgeUse {
        TopoDS_Edge edge;
        Handle(Geom2d_Curve) pcurve;
        double tolerance;
        int lo, hi;
        bool forward;
        /** A collapsed chain's edge (lo and hi its end nodes), else -1: the mesh edge lo-hi. */
        int chain = -1;
      };

      // The chains between two recognised regions collapsed to one analytic
      // edge where their nodes lie on the surfaces' curve (slice D3), with a
      // pcurve per side: straight in the chart where the curve is a line or
      // an iso curve there, else projected.
      struct ChainEdge {
        TopoDS_Edge edge;
        Handle(Geom2d_Curve) pcurve[2];
        double tolerance = 0;
        int type = -1;
      };
      std::vector<ChainEdge> chainEdges(chains.size());
      std::map<std::string, int> keptWhy;
      int collapsedBy[3] = {0, 0, 0}, collapsesUndone = 0;
      // A collapsed edge's pcurve on `chart`, over the edge's range, from
      // `from` to `to`: the chart parameters of the chain's end nodes, where
      // the face's other edges' pcurves end too (pcurves that end at the
      // curve's own ends, up to 1.5 × the tolerance away, leave the face's
      // domain open, and its area and volume integrals drift with the
      // chart's origin: phone-stand-foldable +1.8 %). Straight in the chart
      // where that stays within 1.5 × the tolerance of the curve (a line on
      // a plane, an iso curve); else through the curve's chart parameters at
      // samples, the ends' offsets blended along it. Null when the image
      // strays further.
      auto pcurveFor = [&](const MeshChart& chart, const Handle(Geom_Curve)& curve, double first, double last,
                           const gp_Pnt2d& from, const gp_Pnt2d& to, double& off) -> Handle(Geom2d_Curve) {
        const double reach = 1.5 * tolerance;
        auto measure = [&](const Handle(Geom2d_Curve)& pcurve) {
          double worst = 0;
          for (int i = 0; i <= 10; ++i) {
            const double t = first + (last - first) * i / 10;
            const gp_Pnt2d uv = pcurve->Value(t);
            worst = std::max(worst, chart.value(uv.X(), uv.Y()).Distance(curve->Value(t)));
          }
          return worst;
        };
        if (from.Distance(to) > 1e-12) {
          off = measure(pcurveOf(from, to, first, last));
          if (off <= reach) return pcurveOf(from, to, first, last);
        }
        const int samples = std::max(8, static_cast<int>(std::ceil((last - first) / (M_PI / 16))));
        Handle(NCollection_HArray1<gp_Pnt2d>) points = new NCollection_HArray1<gp_Pnt2d>(1, samples + 1);
        Handle(NCollection_HArray1<double>) parameters = new NCollection_HArray1<double>(1, samples + 1);
        gp_Pnt2d previous;
        for (int i = 0; i <= samples; ++i) {
          const double t = first + (last - first) * i / samples;
          gp_Pnt2d uv = chart.uv(curve->Value(t));
          if (i > 0) {
            // Continuous across the chart's periods.
            if (chart.uPeriodic()) uv.SetX(uv.X() + 2 * M_PI * std::round((previous.X() - uv.X()) / (2 * M_PI)));
            if (chart.vPeriodic()) uv.SetY(uv.Y() + 2 * M_PI * std::round((previous.Y() - uv.Y()) / (2 * M_PI)));
          }
          previous = uv;
          points->SetValue(i + 1, uv);
          parameters->SetValue(i + 1, t);
        }
        const gp_XY startOffset = from.XY() - points->Value(1).XY(), endOffset = to.XY() - points->Value(samples + 1).XY();
        if (startOffset.Modulus() > 0.1 || endOffset.Modulus() > 0.1) return Handle(Geom2d_Curve)();
        for (int i = 0; i <= samples; ++i) {
          const double w = static_cast<double>(i) / samples;
          points->ChangeValue(i + 1).ChangeCoord() += (1 - w) * startOffset + w * endOffset;
        }
        Geom2dAPI_Interpolate interpolate(points, parameters, false, 1e-9);
        interpolate.Perform();
        if (!interpolate.IsDone()) return Handle(Geom2d_Curve)();
        const Handle(Geom2d_Curve) through = interpolate.Curve();
        off = measure(through);
        return off <= reach ? through : Handle(Geom2d_Curve)();
      };
      auto chainBuilt = [&](int r) { return r >= 0 && regions[r].kind >= 0 && regions[r].why.empty(); };
      for (size_t c = 0; c < chains.size(); ++c) {
        const MeshChain& chain = chains[c];
        std::string why;
        if (chainUndone[c]) {
          why = "undone";
        } else if (!chainBuilt(chain.left) || !chainBuilt(chain.right)) {
          why = "not a candidate";
        } else if ((regions[chain.left].kind == 3 && regionsOnSurface[regions[chain.left].surface] > 1) ||
                   (regions[chain.right].kind == 3 && regionsOnSurface[regions[chain.right].surface] > 1)) {
          // A sphere's pieces each have their own frame (their poles away
          // from their own nodes): unify merges them back only across
          // straight edges, so their chains stay the mesh's.
          why = "a sphere in pieces";
        } else {
          try {
            const MeshChainFit fit = chainCurve(chain, regions, seg, tolerance, curveCache, coaxialPairs);
            why = fit.why;
            // Slice D1's limit holds for the mesh edges a collapse replaces:
            // where a chord strays from its straight pcurve's image by more
            // than the largest edge tolerance, the surface bulges past the
            // mesh between the nodes (a curved fit over a few flat
            // triangles) and the chain stays the mesh's, so that region
            // still explodes.
            for (size_t i = 0; why.empty() && i + 1 < chain.nodes.size() + (chain.closed ? 1 : 0); ++i) {
              const int a = chain.nodes[i], b = chain.nodes[(i + 1) % chain.nodes.size()];
              const int lo = std::min(a, b), hi = std::max(a, b);
              for (const int r : {chain.left, chain.right}) {
                const MeshChart& chart = regions[r].chart;
                if (deviation(chart, lo, hi, chart.uv(gp_Pnt(meshNode(lo))), chart.uv(gp_Pnt(meshNode(hi)))) * 1.1 >
                    HYBRID_EDGE_TOLERANCE_MAX)
                  why = "a chord off its surface";
              }
            }
            if (why.empty()) {
              const Handle(Geom_Curve) curve = curveGeom(fit.curve);
              double offLeft = 0, offRight = 0;
              const int from = chain.nodes.front(), to = chain.closed ? from : chain.nodes.back();
              auto onChart = [&](int r, double& off) {
                const MeshChart& chart = regions[r].chart;
                return pcurveFor(chart, curve, fit.first, fit.last, chart.uv(gp_Pnt(meshNode(from))),
                                 chart.uv(gp_Pnt(meshNode(to))), off);
              };
              const Handle(Geom2d_Curve) onLeft = onChart(chain.left, offLeft);
              const Handle(Geom2d_Curve) onRight = onLeft.IsNull() ? onLeft : onChart(chain.right, offRight);
              const double tol = std::max(HYBRID_EDGE_TOLERANCE_MIN, 1.1 * std::max({fit.off, offLeft, offRight}));
              if (onLeft.IsNull() || onRight.IsNull()) {
                why = "pcurve failed";
              } else if (tol > HYBRID_EDGE_TOLERANCE_MAX) {
                why = "edge tolerance";
              } else {
                ChainEdge& ce = chainEdges[c];
                builder.MakeEdge(ce.edge, curve, tol);
                builder.Add(ce.edge, vertexOf(from).Oriented(TopAbs_FORWARD));
                builder.Add(ce.edge, vertexOf(to).Oriented(TopAbs_REVERSED));
                builder.Range(ce.edge, fit.first, fit.last);
                if (chain.closed) ce.edge.Closed(true);
                ce.pcurve[0] = onLeft;
                ce.pcurve[1] = onRight;
                ce.tolerance = tol;
                ce.type = fit.curve.type;
                if (keepHybridFaces_)
                  hybridFaces_.push_back("chain " + std::to_string(c) + " " +
                                         pairName(regions[chain.left].kind, regions[chain.right].kind) + ": " +
                                         (ce.type == 0 ? "line" : ce.type == 1 ? "circle" : "ellipse") + ", regions " +
                                         std::to_string(chain.left) + "|" + std::to_string(chain.right) + ", " +
                                         std::to_string(chain.closed ? chain.nodes.size() : chain.nodes.size() - 1) +
                                         " mesh edges, tolerance " + std::to_string(tol));
              }
            }
          } catch (const Standard_Failure& e) {
            why = std::string("threw ") + e.GetMessageString();
          }
        }
        if (!why.empty()) {
          if (keepHybridFaces_ && why != "not a candidate")
            hybridFaces_.push_back("chain " + std::to_string(c) + " " +
                                   pairName(regions[chain.left].kind, chain.right >= 0 ? regions[chain.right].kind : -1) +
                                   ": " + why + (attempt > 0 ? " (build " + std::to_string(attempt + 1) + ")" : ""));
          keptWhy[why.compare(0, 5, "node ") == 0 ? "a node off" : why.compare(0, 6, "spans ") == 0 ? "spans a turn" : why]++;
        }
        if (c % 256 == 0) check();
      }
      stage("chain curves");

      // A recognised region's loops (`region` >= 0) take its collapsed
      // chains as one edge each, walked from a node where chains end.
      auto makeFace = [&](const MeshChart& chart, const Handle(Geom_Surface)& surface,
                          const std::vector<std::vector<int>>& loops, bool flip, double& worstTolerance,
                          std::vector<EdgeUse>& used, int region) {
        worstTolerance = 0;
        used.clear();
        std::vector<std::vector<EdgeUse>> wires;
        for (const std::vector<int>& loop : loops) {
          wires.emplace_back();
          const size_t m = loop.size();
          size_t start = 0;
          if (region >= 0)
            for (size_t i = 0; i < m; ++i)
              if (breakNode[loop[i]]) {
                start = i;
                break;
              }
          for (size_t j = 0; j < m;) {
            const int a = loop[(start + j) % m], b = loop[(start + j + 1) % m];
            if (region >= 0) {
              const auto it = chainOf.find(keyOf(a, b));
              if (it != chainOf.end() && !chainEdges[it->second].edge.IsNull()) {
                const MeshChain& chain = chains[it->second];
                const ChainEdge& ce = chainEdges[it->second];
                const bool forward = chain.left == region;
                worstTolerance = std::max(worstTolerance, ce.tolerance);
                wires.back().push_back({TopoDS_Edge(), ce.pcurve[forward ? 0 : 1], ce.tolerance, chain.nodes.front(),
                                        chain.closed ? chain.nodes.front() : chain.nodes.back(), forward, it->second});
                j += chain.closed ? m : chain.nodes.size() - 1;
                continue;
              }
            }
            ++j;
            const int lo = std::min(a, b), hi = std::max(a, b);
            const gp_Pnt2d from = chart.uv(gp_Pnt(meshNode(lo))), to = chart.uv(gp_Pnt(meshNode(hi)));
            const double off = deviation(chart, lo, hi, from, to);
            const double tol = std::max(off * 1.1, HYBRID_EDGE_TOLERANCE_MIN);
            worstTolerance = std::max(worstTolerance, tol);
            wires.back().push_back({TopoDS_Edge(), Handle(Geom2d_Curve)(), tol, lo, hi, a == lo});
            wires.back().back().pcurve = pcurveOf(from, to, 0, meshNode(lo).Subtracted(meshNode(hi)).Modulus());
          }
        }
        TopoDS_Face face;
        if (worstTolerance > HYBRID_EDGE_TOLERANCE_MAX) return face;
        builder.MakeFace(face, surface, Precision::Confusion());
        for (std::vector<EdgeUse>& wireUses : wires) {
          TopoDS_Wire wire;
          builder.MakeWire(wire);
          if (flip) std::reverse(wireUses.begin(), wireUses.end());
          for (EdgeUse& use : wireUses) {
            use.edge = use.chain >= 0 ? chainEdges[use.chain].edge : edgeOf(use.lo, use.hi);
            builder.UpdateEdge(use.edge, use.pcurve, surface, TopLoc_Location(), use.tolerance);
            builder.UpdateVertex(vertexOf(use.lo), use.tolerance);
            builder.UpdateVertex(vertexOf(use.hi), use.tolerance);
            builder.Add(wire, use.forward != flip ? use.edge : TopoDS::Edge(use.edge.Reversed()));
            used.push_back(use);
          }
          wire.Closed(true);
          builder.Add(face, wire);
        }
        if (flip) face.Orientation(TopAbs_REVERSED);
        return face;
      };

      // The recognised regions, one face each. A face that won't build or
      // check is built again with its collapsed chains as polylines (the
      // regions across them, built already, again too: they share those
      // edges); one that still fails explodes its region (its pcurves come
      // off the shared edges).
      std::vector<TopoDS_Face> regionFace(regionCount);
      std::vector<std::vector<EdgeUse>> regionUsed(regionCount);
      std::vector<Handle(Geom_Surface)> regionSurface(regionCount);
      std::vector<double> regionWorst(regionCount, 0);
      auto strip = [&](int i) {
        for (const EdgeUse& use : regionUsed[i])
          if (!use.edge.IsNull()) builder.UpdateEdge(use.edge, Handle(Geom2d_Curve)(), regionSurface[i], TopLoc_Location(), 0);
        regionUsed[i].clear();
        regionFace[i].Nullify();
      };
      std::vector<int> again;
      auto undoChains = [&](int i) {
        bool any = false;
        for (int c : chainsOfRegion[i]) {
          if (chainEdges[c].edge.IsNull()) continue;
          chainEdges[c].edge.Nullify();
          chainUndone[c] = 1;
          ++collapsesUndone;
          any = true;
          const int other = chains[c].left == i ? chains[c].right : chains[c].left;
          if (other >= 0 && other != i && !regionFace[other].IsNull()) {
            strip(other);
            again.push_back(other);
          }
        }
        return any;
      };
      auto buildRegion = [&](int i) {
        MeshHybridRegion& region = regions[i];
        for (int pass = 0; pass < 2; ++pass) {
          std::string why;
          double& worst = regionWorst[i];
          try {
            const Handle(Geom_Surface) surface = region.chart.surface();
            regionSurface[i] = surface;
            int largest = region.triangles[0];
            for (int t : region.triangles)
              if (seg.areas[t] > seg.areas[largest]) largest = t;
            const gp_XYZ centre = (meshNode(corner(largest, 0)) + meshNode(corner(largest, 1)) + meshNode(corner(largest, 2))) / 3;
            const gp_Pnt2d at = region.chart.uv(gp_Pnt(centre));
            const bool flip = region.chart.normal(at.X(), at.Y()).XYZ().Dot(seg.normals[largest]) < 0;
            const TopoDS_Face face = makeFace(region.chart, surface, region.loops, flip, worst, regionUsed[i], i);
            if (face.IsNull()) {
              why = "edge tolerance " + std::to_string(worst) + " mm";
            } else if (!BRepCheck_Analyzer(face).IsValid()) {
              why = "invalid face";
            } else {
              regionFace[i] = face;
              return;
            }
          } catch (const Standard_Failure& e) {
            why = std::string("threw ") + e.GetMessageString();
          }
          strip(i);
          if (pass == 0 && undoChains(i)) continue;
          region.why = why;
          return;
        }
      };
      for (int i = 0; i < regionCount; ++i) {
        if (regions[i].kind >= 0 && regions[i].why.empty()) buildRegion(i);
        if (i % 64 == 0) check();
      }
      while (!again.empty()) {
        const int i = again.back();
        again.pop_back();
        if (regions[i].why.empty() && regionFace[i].IsNull()) buildRegion(i);
      }
      for (int i = 0; i < regionCount; ++i) {
        const MeshHybridRegion& region = regions[i];
        if (region.kind < 0) continue;
        if (!regionFace[i].IsNull()) faces.push_back({regionFace[i], i, false});
        if (keepHybridFaces_ && (attempt == 0 || !region.why.empty())) {
          size_t edgeCount = 0;
          for (const auto& loop : region.loops) edgeCount += loop.size();
          hybridFaces_.push_back("region " + std::to_string(i) + " surface " + std::to_string(region.surface) + " kind " +
                                 std::to_string(region.kind) + " triangles " + std::to_string(region.triangles.size()) +
                                 " loops " + std::to_string(region.loops.size()) + " edges " + std::to_string(edgeCount) +
                                 " tolerance " + std::to_string(regionWorst[i]) +
                                 (region.why.empty() ? " built" : " exploded: " + region.why));
        }
      }
      {
        // "chains: 412 collapsed (380 lines, 30 circles, 2 ellipses), 96 polylines".
        int polylines = 0;
        for (size_t c = 0; c < chains.size(); ++c) {
          if (!chainEdges[c].edge.IsNull()) ++collapsedBy[chainEdges[c].type];
          else ++polylines;
        }
        if (collapsesUndone > 0) keptWhy["undone"] += collapsesUndone;
        hybridChains_ = "chains: " + std::to_string(collapsedBy[0] + collapsedBy[1] + collapsedBy[2]) + " collapsed (" +
                        std::to_string(collapsedBy[0]) + " lines, " + std::to_string(collapsedBy[1]) + " circles, " +
                        std::to_string(collapsedBy[2]) + " ellipses), " + std::to_string(polylines) + " polylines";
        hybridChainsKept_.clear();
        for (const auto& [why, n] : keptWhy)
          hybridChainsKept_ += (hybridChainsKept_.empty() ? "" : ", ") + why + " " + std::to_string(n);
      }
      stage("faces");
      rebuildTimes_.push_back({"hybrid " + hybridChains_, 0});
      for (size_t c = 0; c < chains.size(); ++c) collapsedNow[c] = !chainEdges[c].edge.IsNull();

      // Facets: every triangle of an unfit or exploded region, a plane through its corners.
      for (int t = 0; t < triangleCount; ++t) {
        const MeshHybridRegion& region = regions[hybridOf[t]];
        if (region.kind >= 0 && region.why.empty()) continue;
        const gp_XYZ a = meshNode(corner(t, 0)), b = meshNode(corner(t, 1)), c = meshNode(corner(t, 2));
        gp_XYZ normal = (b - a).Crossed(c - a);
        if (normal.Modulus() <= 1e-300 || (b - a).Modulus() <= 1e-300) {
          // A sliver: a neighbour's normal, square to its longest side.
          gp_XYZ along = (b - a).Modulus() >= (c - a).Modulus() ? b - a : c - a;
          if (along.Modulus() <= 1e-300) along = c - b;
          normal = gp_XYZ(0, 0, 0);
          for (int k = 0; k < 3 && normal.Modulus() <= 1e-9; ++k) {
            const int u = seg.neighbour[3 * t + k];
            if (u >= 0 && along.Modulus() > 0)
              normal = seg.normals[u] - (seg.normals[u].Dot(along) / along.SquareModulus()) * along;
          }
        }
        MeshChart chart;
        chart.kind = 0;
        const gp_XYZ x = (b - a).Modulus() > 1e-300 ? b - a : c - a;
        chart.frame = gp_Ax3(gp_Pnt(a), gp_Dir(normal), gp_Dir(x - (x.Dot(normal) / normal.SquareModulus()) * normal));
        double worst = 0;
        std::vector<EdgeUse> used;
        const TopoDS_Face face =
            makeFace(chart, chart.surface(), {{corner(t, 0), corner(t, 1), corner(t, 2)}}, false, worst, used, -1);
        if (face.IsNull()) return refuse("a facet's edge tolerance " + std::to_string(worst));
        faces.push_back({face, hybridOf[t], true});
        if (t % 1024 == 0) check();
      }
      stage("facets");

      // One solid per shell of the mesh, unified, with a shell that encloses
      // a negative volume as a cavity of the solid that holds it (slice D1).
      std::map<int, std::vector<int>> byShell;
      for (size_t f = 0; f < faces.size(); ++f)
        byShell[shellOf[regions[faces[f].region].triangles[0]]].push_back(static_cast<int>(f));
      std::vector<TopoDS_Shape> solids, unified;
      std::vector<Handle(BRepTools_History)> histories;
      std::vector<TopoDS_Shell> shells;
      std::vector<gp_Pnt> insidePoints;
      for (auto& [shellIndex, members] : byShell) {
        TopoDS_Shell shell;
        builder.MakeShell(shell);
        for (int f : members) builder.Add(shell, faces[f].face);
        shell.Closed(BRep_Tool::IsClosed(shell));
        shells.push_back(shell);
        insidePoints.push_back(gp_Pnt(meshNode(corner(regions[faces[members.front()].region].triangles[0], 0))));
      }
      std::string cavityWhy;
      if (!solidsWithCavities(shells, insidePoints, seg.meshVolume, solids, cavityWhy))
        return refuse(cavityWhy);
      for (TopoDS_Shape& solid : solids) {
        if (!BRepCheck_Analyzer(solid).IsValid()) {
          ShapeFix_Solid fixSolid(TopoDS::Solid(solid));
          fixSolid.Perform(deadline->Start());
          solid = fixSolid.Solid();
        }
        check();
        if (volumeOf(solid) < 0) solid.Reverse();
      }
      stage("solid");
      for (const TopoDS_Shape& solid : solids) {
        ShapeUpgrade_UnifySameDomain unify(solid, true, true, true);
        unify.SetLinearTolerance(1e-3);
        unify.SetAngularTolerance(1e-3);
        unify.Build();
        unified.push_back(unify.Shape());
        histories.push_back(unify.History());
        check();
      }
      stage("unified");

      // Where each face of the result came from: facets, recognised regions or both.
      auto assemble = [&](const std::vector<TopoDS_Shape>& pieces) {
        if (pieces.size() == 1) return pieces[0];
        TopoDS_Compound compound;
        builder.MakeCompound(compound);
        for (const TopoDS_Shape& piece : pieces) builder.Add(compound, piece);
        return TopoDS_Shape(compound);
      };
      bool undone = false;
      TopoDS_Shape result = assemble(unified);
      bool healed = false, valid = BRepCheck_Analyzer(result).IsValid();
      if (!valid) {
        // Unify moves edges onto merged faces whose plane is up to its
        // linear tolerance off their own: ShapeFix raises their tolerances.
        if (keepHybridFaces_) hybridInvalid_ = result;
        try {
          // Healed into copies, kept only when every solid healed.
          std::vector<TopoDS_Shape> fixed = unified;
          std::vector<Handle(BRepTools_History)> fixes(unified.size());
          for (size_t s = 0; s < unified.size(); ++s) {
            if (BRepCheck_Analyzer(unified[s]).IsValid()) continue;
            ShapeFix_Shape healer(unified[s]);
            healer.Perform(deadline->Start());
            check();
            fixed[s] = healer.Shape();
            fixes[s] = healer.Context()->History();
          }
          // The healer's own history, onto unify's: what it replaced, the region map follows.
          for (size_t s = 0; s < unified.size(); ++s)
            if (!fixes[s].IsNull() && !histories[s].IsNull()) histories[s]->Merge(fixes[s]);
          unified = fixed;
          result = assemble(unified);
          healed = true;
          valid = BRepCheck_Analyzer(result).IsValid();
        } catch (const Standard_Failure&) {
        }
        stage("healed");
      }
      if (!valid) {
        // The faces that fail, back to their regions: those explode, once.
        std::set<int> culprits;
        NCollection_DataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher> regionOfFace;
        for (const HybridFace& hf : faces)
          if (!hf.facet) regionOfFace.Bind(hf.face, hf.region);
        NCollection_DataMap<TopoDS_Shape, std::vector<int>, TopTools_ShapeMapHasher> origins;
        for (size_t s = 0; s < solids.size(); ++s) {
          for (TopExp_Explorer e(solids[s], TopAbs_FACE); e.More(); e.Next()) {
            const TopoDS_Shape& f = e.Current();
            TopTools_ListOfShape images;
            if (!histories[s].IsNull()) images = histories[s]->Modified(f);
            if (images.IsEmpty() && (histories[s].IsNull() || !histories[s]->IsRemoved(f))) images.Append(f);
            if (!regionOfFace.IsBound(f)) continue;
            const int region = regionOfFace.Find(f);
            for (const TopoDS_Shape& image : images) {
              if (!origins.IsBound(image)) origins.Bind(image, {});
              origins.ChangeFind(image).push_back(region);
            }
          }
        }
        for (TopExp_Explorer e(result, TopAbs_FACE); e.More(); e.Next()) {
          if (BRepCheck_Analyzer(e.Current()).IsValid() || !origins.IsBound(e.Current())) continue;
          for (int region : origins.Find(e.Current())) culprits.insert(region);
        }
        check();
        if (undoCollapses(culprits, collapsedNow)) {
          stage("validity, undoing the collapses of " + std::to_string(culprits.size()));
          continue;
        }
        if (attempt - undoBuilds < 2 && !culprits.empty()) {
          for (int region : culprits) regions[region].why = "invalid after unify";
          stage("validity, exploding " + std::to_string(culprits.size()));
          continue;
        }
        bool cellsValid = true;
        for (const TopoDS_Shape& solid : solids) cellsValid = cellsValid && BRepCheck_Analyzer(solid).IsValid();
        if (!cellsValid) return refuse("invalid");
        result = assemble(solids);
        undone = true;
      }
      stage(undone ? "validity (unify undone)" : "validity");

      // The result's faces: a facet is a face only facets made.
      NCollection_DataMap<TopoDS_Shape, int, TopTools_ShapeMapHasher> origin;
      for (const HybridFace& hf : faces) {
        TopTools_ListOfShape images;
        for (size_t s = 0; s < solids.size() && !undone; ++s) {
          if (histories[s].IsNull()) continue;
          for (const TopoDS_Shape& image : histories[s]->Modified(hf.face)) images.Append(image);
        }
        if (images.IsEmpty()) images.Append(hf.face);
        for (const TopoDS_Shape& image : images) {
          const int bit = hf.facet ? 1 : 2;
          if (origin.IsBound(image)) origin.ChangeFind(image) |= bit;
          else origin.Bind(image, bit);
        }
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
      TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
      int facets = 0, counts[5] = {0, 0, 0, 0, 0};
      std::vector<char> isFacet(resultFaces.Extent() + 1, 0);
      for (int i = 1; i <= resultFaces.Extent(); ++i) {
        const GeomAbs_SurfaceType type = BRepAdaptor_Surface(TopoDS::Face(resultFaces(i)), false).GetType();
        const int bits = origin.IsBound(resultFaces(i)) ? origin.Find(resultFaces(i)) : (type == GeomAbs_Plane ? 1 : 2);
        if (bits == 1) {
          isFacet[i] = 1;
          ++facets;
          continue;
        }
        const int kind = type == GeomAbs_Plane      ? 0
                         : type == GeomAbs_Cylinder ? 1
                         : type == GeomAbs_Cone     ? 2
                         : type == GeomAbs_Sphere   ? 3
                         : type == GeomAbs_Torus    ? 4
                                                    : -1;
        if (kind >= 0) ++counts[kind];
      }
      hybridExploded_ = 0;
      for (const MeshHybridRegion& r : regions) hybridExploded_ += r.kind >= 0 && !r.why.empty();
      if (facets > HYBRID_FACET_CAP) return capRefusal(facets, false);

      // The checks: the volume within the analytic faces' sag (or 1 %), the
      // nodes within the tolerance of the solid.
      double sagSum = 0, exactArea = 0;
      for (const MeshHybridRegion& r : regions) {
        if (r.kind < 0 || !r.why.empty()) continue;
        sagSum += r.area * seg.surfaces[r.surface].sag;
        exactArea += r.area;
      }
      const double allowed = std::max(0.01 * std::fabs(seg.meshVolume), 2 * sagSum + tolerance * exactArea);
      const double volume = volumeOf(result);
      if (std::fabs(volume - seg.meshVolume) > allowed)
        return refuse("volume off: " + std::to_string(volume) + " against " + std::to_string(seg.meshVolume) +
                      ", allowed " + std::to_string(allowed));
      std::set<int> offRegions;
      {
        std::vector<MeshCheckedFace> checked;
        for (int i = 1; i <= resultFaces.Extent(); ++i) {
          MeshCheckedFace c;
          c.face = TopoDS::Face(resultFaces(i));
          const BRepAdaptor_Surface surface(c.face, false);
          const GeomAbs_SurfaceType type = surface.GetType();
          c.kind = type == GeomAbs_Plane      ? 0
                   : type == GeomAbs_Cylinder ? 1
                   : type == GeomAbs_Cone     ? 2
                   : type == GeomAbs_Sphere   ? 3
                   : type == GeomAbs_Torus    ? 4
                                              : -1;
          if (c.kind < 0) continue;
          if (c.kind == 0) c.plane = surface.Plane();
          if (c.kind == 1) c.cylinder = surface.Cylinder();
          if (c.kind == 2) c.cone = surface.Cone();
          if (c.kind == 3) c.sphere = surface.Sphere();
          if (c.kind == 4) c.torus = surface.Torus();
          double u1 = 0, v1 = 0;
          BRepTools::UVBounds(c.face, c.u0, u1, c.v0, v1);
          BRepBndLib::Add(c.face, c.box);
          c.box.Enlarge(tolerance * 1.01);
          checked.push_back(std::move(c));
        }
        const int nodeStride = std::max(1, nodeCount / 2000);
        std::vector<std::vector<int>> trianglesOf(nodeCount);
        for (int t = 0; t < triangleCount; ++t)
          for (int k = 0; k < 3; ++k) trianglesOf[corner(t, k)].push_back(t);
        const double reach = tolerance * 1.01 + 1e-7;
        // A collapsed chain's nodes were measured against its curve (within
        // 1.5 × the tolerance, an edge of the result): not again here.
        std::vector<char> onCollapsed(nodeCount, 0);
        for (size_t c = 0; c < chains.size(); ++c)
          if (collapsedNow[c])
            for (int n : chains[c].nodes) onCollapsed[n] = 1;
        for (int n = 0; n < nodeCount; n += nodeStride) {
          check();
          if (onCollapsed[n]) continue;
          const gp_Pnt p(meshNode(n));
          bool near = false;
          for (MeshCheckedFace& c : checked) {
            if (c.box.IsOut(p)) continue;
            double u = 0, v = 0;
            gp_Pnt q;
            if (c.kind == 0) {
              ElSLib::Parameters(c.plane, p, u, v);
              q = ElSLib::Value(u, v, c.plane);
            } else if (c.kind == 1) {
              ElSLib::Parameters(c.cylinder, p, u, v);
              q = ElSLib::Value(u, v, c.cylinder);
            } else if (c.kind == 2) {
              ElSLib::Parameters(c.cone, p, u, v);
              q = ElSLib::Value(u, v, c.cone);
            } else if (c.kind == 3) {
              ElSLib::Parameters(c.sphere, p, u, v);
              q = ElSLib::Value(u, v, c.sphere);
            } else {
              ElSLib::Parameters(c.torus, p, u, v);
              q = ElSLib::Value(u, v, c.torus);
            }
            if (p.Distance(q) > reach) continue;
            const double turn = 2 * M_PI, slack = 1e-9;
            if (c.kind > 0) u += turn * std::ceil((c.u0 - slack - u) / turn);
            if (c.kind == 4) v += turn * std::ceil((c.v0 - slack - v) / turn);
            if (!c.inside) c.inside.reset(new BRepTopAdaptor_FClass2d(c.face, 1e-7));
            if (c.inside->Perform(gp_Pnt2d(u, v)) != TopAbs_OUT) {
              near = true;
              break;
            }
          }
          if (!near) {
            int region = -1;
            for (int t : trianglesOf[n])
              if (regions[hybridOf[t]].kind >= 0 && regions[hybridOf[t]].why.empty()) region = hybridOf[t];
            if (offRegions.count(region)) continue;
            BRepExtrema_DistShapeShape distance(BRepBuilderAPI_MakeVertex(p).Vertex(), result, Extrema_ExtFlag_MINMAX,
                                                Extrema_ExtAlgo_Grad, deadline->Start());
            if (!distance.IsDone()) check();
            if (!distance.IsDone() || distance.Value() > reach) {
              // A node a recognised face doesn't cover (its parameters outside
              // the face's straight-edged domain): that region explodes.
              if (region >= 0 && attempt - undoBuilds < 2) {
                offRegions.insert(region);
                continue;
              }
              return refuse("node " + std::to_string(n) + " off the solid by " +
                            std::to_string(distance.IsDone() ? distance.Value() : -1.0) +
                            (region >= 0 ? " in a recognised region" : " on facets") + (undone ? ", unify undone" : "") +
                            (healed ? ", healed" : ""));
            }
          }
        }
      }
      if (undoCollapses(offRegions, collapsedNow)) {
        stage("checked against the mesh, undoing the collapses of " + std::to_string(offRegions.size()));
        continue;
      }
      if (!offRegions.empty()) {
        for (int region : offRegions) regions[region].why = "a node off its face";
        stage("checked against the mesh, exploding " + std::to_string(offRegions.size()));
        continue;
      }
      stage("checked against the mesh");
      meshReport_[0] = static_cast<double>(resultFaces.Extent());
      for (int k = 0; k < 5; ++k) meshReport_[1 + k] = static_cast<double>(counts[k]);
      meshReport_[10] = 1;
      meshReport_[11] = static_cast<double>(facets);
      return store(result);
    }
    return refuse("invalid after exploding");
  }

  /** Staged path pieces (pathLine and friends). */
  std::vector<TopoDS_Edge> pathEdges_;
  /** Where each face's record starts in profileRecords_, while sketchProfiles runs. */
  std::unordered_map<const TopoDS_TShape*, size_t> recordStarts_;

  void beginOp() {
    checkStackGuard();
    lastError_.clear();
    history_.clear();
  }

  /**
   * The stack guard (ADR-0001's amendment, 2026-10-11). The WASM stack is a
   * fixed block of linear memory just above the static data, and it grows
   * down towards that data with no check in an optimised build: an OCCT call
   * that needs more stack than STACK_SIZE (libcascade.config.ts) writes over
   * the data beneath it (vtables, globals) and returns as if nothing
   * happened; a later call then traps somewhere unrelated ("table index is
   * out of bounds", "memory access out of bounds") or, worse, computes with
   * the damage. So the stack's lowest STACK_GUARD_BYTES are painted with a
   * pattern when the facade is made and checked (every 16 bytes) when an
   * operation starts and before a result is stored. No call comes near that
   * depth (the deepest measured needs well under 1 % of the stack), so a
   * changed word means the stack ran over, and the module stops right there
   * (abort, which the kernel client treats as a crash) instead of carrying
   * on with damaged memory. A single word at the bottom is not enough: the
   * frame that overflows can be a large, partly used local array that skips
   * it.
   */
  static constexpr uint64_t STACK_GUARD = 0x45585452554453ULL;  // "EXTRUDS"
#ifndef EXTRUDO_STACK_GUARD_BYTES
#define EXTRUDO_STACK_GUARD_BYTES (64 * 1024)
#endif
  static constexpr uintptr_t STACK_GUARD_BYTES = EXTRUDO_STACK_GUARD_BYTES;

  /** The guard zone's first word, or null when the stack is too small to spare one. */
  static uint64_t* stackGuard() {
    const uintptr_t end = (emscripten_stack_get_end() + 15) & ~static_cast<uintptr_t>(15);
    if (emscripten_stack_get_base() - end < 4 * STACK_GUARD_BYTES) return nullptr;
    return reinterpret_cast<uint64_t*>(end);
  }

  static void armStackGuard() {
    uint64_t* guard = stackGuard();
    if (guard == nullptr) return;
    for (uintptr_t i = 0; i < STACK_GUARD_BYTES / 8; ++i) guard[i] = STACK_GUARD ^ i;
  }

  static void checkStackGuard() {
    const uint64_t* guard = stackGuard();
    if (guard == nullptr) return;
    for (uintptr_t i = 0; i < STACK_GUARD_BYTES / 8; i += 2) {
      if (guard[i] != (STACK_GUARD ^ i)) {
        std::fprintf(stderr, "Extrudo kernel: the WASM stack overflowed (STACK_SIZE); stopping.\n");
        std::abort();
      }
    }
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
      integrateArea(face, props);
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
    checkStackGuard();
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
   * wall is in its way. With `curves`, a curved boundary edge counts too
   * (a rod lying against the face, a hole): its nearest point within the
   * edge's length, sampled; a curve that starts at the edge's own ends is
   * left out, since the round ends there anyway. -1 when there is none or
   * it can't be told (the edge isn't a line, the face isn't flat).
   */
  static double wallBeside(const TopoDS_Edge& edge, const TopoDS_Face& face, bool curves) {
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
        const TopoDS_Edge& other = TopoDS::Edge(it.Current());
        BRepAdaptor_Curve wall(other);
        if (wall.GetType() != GeomAbs_Line) {
          TopoDS_Vertex shared;
          if (!curves || BRep_Tool::Degenerated(other) || TopExp::CommonVertex(edge, other, shared)) continue;
          const double first = wall.FirstParameter();
          const double last = wall.LastParameter();
          for (int k = 0; k <= 64; ++k) {
            const gp_Vec p(origin, wall.Value(first + (last - first) * k / 64.0));
            const double t = p.Dot(direction);
            const double distance = p.Dot(inside);
            if (distance < 1e-6 || t <= start + 1e-3 || t >= start + span - 1e-3) continue;
            if (nearest < 0 || distance < nearest) nearest = distance;
          }
          continue;
        }
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
   *
   * `corner` says the edge's chain meets another chain at a vertex (see
   * addFillets); then a curved boundary counts as a wall too. A round whose
   * contact line runs over a rod lying against the face (the top edge of a
   * step's wall, a rod along the step) builds alone, but where another round
   * meets it at a corner OCCT's rebuild of the solid (TopOpeBRepBuild's
   * MergeSolid under ChFi3d_Builder::Compute) reads a shape that isn't there
   * and traps ("memory access out of bounds"), or builds an invalid solid.
   */
  static bool filletRollsOff(const EdgeFaceMap& edgeFaces, const TopoDS_Edge& edge, double radius, bool corner) {
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
      const double wall = wallBeside(edge, face, corner);
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
    using VertexMap = NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>;
    std::vector<VertexMap> ends(static_cast<size_t>(builder.NbContours()) + 1);
    for (int contour = 1; contour <= builder.NbContours(); ++contour) {
      for (int j = 1; j <= builder.NbEdges(contour); ++j) {
        for (TopExp_Explorer v(builder.Edge(contour, j), TopAbs_VERTEX); v.More(); v.Next()) ends[contour].Add(v.Current());
      }
    }
    // Whether the chain's round meets another chain's at a vertex (a corner).
    const auto meets = [&](int contour) {
      for (int other = 1; other <= builder.NbContours(); ++other) {
        if (other == contour) continue;
        for (VertexMap::Iterator v(ends[other]); v.More(); v.Next()) {
          if (ends[contour].Contains(v.Key())) return true;
        }
      }
      return false;
    };
    for (int contour = 1; contour <= builder.NbContours(); ++contour) {
      const bool corner = meets(contour);
      for (size_t i = 0; i < staged.size(); ++i) {
        if (contourOf[i] != contour) continue;
        double widest = 0;
        for (int k = 0; k < perEdge; ++k) {
          widest = std::max(widest, radii[perEdge * i + static_cast<size_t>(k)]);
        }
        for (int j = 1; j <= builder.NbEdges(contour); ++j) {
          if (filletRollsOff(edgeFaces, builder.Edge(contour, j), widest, corner)) return 3;
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
   *
   * The smallest step is probed first: most callers fail at every value (a
   * body OCCT can't offset, shell or fillet at all, e.g. a Mesh to Solid
   * result before the 2026-10-24 fix), and that answer then costs one build
   * instead of seven. Under the bisection's own monotonicity assumption the
   * result is unchanged: when failing / 128 fails, every larger step does
   * too, so the old loop would have returned 0 as well.
   */
  template <typename Probe>
  static double largestThatWorks(Probe works, double failing) {
    if (!works(failing / 128.0)) return 0;
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
        // A tangent neighbour, or a crease with a flat face (square or slanted): the
        // wall under the face is the face's outline swept into the wall, and the
        // neighbouring wall's inner surface is a plane the moved cavity lands on.
        if (dot > 0.9994) continue;
        if (BRepAdaptor_Surface(TopoDS::Face(other)).GetType() == GeomAbs_Plane) continue;
        return false;
      }
    }
    return true;
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
                           std::vector<TopoDS_Shape>& plugs, std::vector<std::vector<TopoDS_Shape>>& corners) {
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
      std::vector<TopoDS_Shape> prisms;
      std::vector<gp_Dir> normals;
      std::vector<double> moves;
      std::vector<TopoDS_Shape> toolShapes;
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
        prisms.push_back(prism.Shape());
        normals.push_back(n);
        moves.push_back(move);
        plugs.push_back(plug.Shape());
        toolShapes.push_back(plug.Shape());
      }
      // Two removed faces that share an edge leave the bar between them (each plug
      // is inset from the edge: the moved cavity trims to the *neighbour's* inner
      // surface, and neither is the other's neighbour). Add a corner plug at each
      // edge/vertex shared by removed faces: their prisms in common, in common with
      // the cavity moved out along the sum of their normals, which reaches the bar.
      corners.assign(removed.size(), {});
      // A corner plug that fails leaves the bar between two touching removed
      // faces in the part, so a missing plug must refuse the whole shell.
      const auto addCorner = [&](const std::vector<int>& around) -> bool {
        TopoDS_Shape common = prisms[around[0]];
        gp_Vec sum(0, 0, 0);
        for (size_t k = 0; k < around.size(); ++k) {
          if (k > 0) {
            BRepAlgoAPI_Common next(common, prisms[around[k]]);
            if (!next.IsDone()) return false;
            common = next.Shape();
          }
          sum += gp_Vec(normals[around[k]]) * moves[around[k]];
        }
        BRepAlgoAPI_Common corner(common, shifted(cavity, sum.X(), sum.Y(), sum.Z()));
        if (!corner.IsDone() || !TopExp_Explorer(corner.Shape(), TopAbs_SOLID).More()) return false;
        corners[around[0]].push_back(corner.Shape());
        toolShapes.push_back(corner.Shape());
        return true;
      };
      const auto clusters = [&](TopAbs_ShapeEnum kind, int minimum) -> bool {
        NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> map;
        TopExp::MapShapesAndUniqueAncestors(input, kind, TopAbs_FACE, map);
        for (int e = 1; e <= map.Extent(); ++e) {
          std::vector<int> around;
          for (const TopoDS_Shape& other : map(e)) {
            const int at = faces.FindIndex(other) - 1;
            const auto found = std::find(removed.begin(), removed.end(), at);
            if (found == removed.end()) continue;
            const int position = static_cast<int>(found - removed.begin());
            if (std::find(around.begin(), around.end(), position) == around.end()) around.push_back(position);
          }
          if (static_cast<int>(around.size()) >= minimum && !addCorner(around)) return false;
        }
        return true;
      };
      if (!clusters(TopAbs_EDGE, 2) || !clusters(TopAbs_VERTEX, 3)) return false;
      // Fused into one tool: the corner plugs overlap the per-face plugs at the
      // shared edge, and cutting them as a compound counts that region twice and
      // drops the whole cut.
      TopoDS_Shape tool = toolShapes.front();
      for (size_t i = 1; i < toolShapes.size(); ++i) {
        BRepAlgoAPI_Fuse fused(tool, toolShapes[i]);
        fused.SimplifyResult();
        if (!fused.IsDone()) return false;
        tool = fused.Shape();
      }
      NCollection_List<TopoDS_Shape> arguments;
      NCollection_List<TopoDS_Shape> toolList;
      arguments.Append(hollow);
      toolList.Append(tool);
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
    std::vector<std::vector<TopoDS_Shape>> corners;
    return buildPlugged(thick, cut, copy, faces, removed, perFace, thickness, factor, outside, sharp, result,
                        plugs, corners) &&
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
        std::vector<std::vector<TopoDS_Shape>> corners;
        if (buildPlugged(thick, cut, copy, faces, removed, perFace, thickness, 1.0, outside, sharp, result, plugs, corners) &&
            shellFacesGood(thick, copy, faces, removed, perFace, 1.0, result, outside)) {
          recordPlugged(thick, cut, copy, removed, plugs, corners, result);
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
                     const std::vector<std::vector<TopoDS_Shape>>& corners, const TopoDS_Shape& result) {
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
          for (const TopoDS_Shape& corner : corners[static_cast<size_t>(at - removed.begin())]) {
            for (TopExp_Explorer it(corner, TopAbs_FACE); it.More(); it.Next()) {
              bool kept = false;
              through(it.Current(), rim, kept);
            }
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
    if (!farFacesKept(builder, input, faces, moving, result)) return false;
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
    if (buildOffset(builder, copy, faces, picked, distance, result) &&
        offsetIsGood(builder, copy, faces, moving, result, distance)) {
      return true;
    }
    if (!hasSeam(input)) return false;
    const TopoDS_Shape again = BRepBuilderAPI_Copy(input, true, false).Shape();
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> againFaces;
    TopExp::MapShapes(again, TopAbs_FACE, againFaces);
    DividedOffset divided;
    return buildDividedOffset(divided, again, againFaces, picked, moving, distance, result);
  }

  /**
   * Whether every face of `input` that neither moves nor shares an edge with
   * a moving face comes through the offset as it was: the same area at the
   * same place (ADR-0051's amendment, 2026-10-11). OCCT can build a valid,
   * smaller solid out of a face pushed through the body (a slot's cap pushed
   * 12 mm through a 12 mm slot across a cylinder's seam left a 5 mm disk of
   * the 21 mm cylinder, which grew no volume and kept its moved faces far
   * enough from where they were); a face far from the moved ones vanishing,
   * shrinking or moving gives it away (that disk's bottom kept its area at
   * another height). Faces next to a moving one are extended or trimmed by
   * design, so they are not checked.
   */
  static bool farFacesKept(BRepOffset_MakeOffset& builder, const TopoDS_Shape& input,
                           const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                           const std::vector<int>& moving, const TopoDS_Shape& result) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
    TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
    NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeFaces;
    TopExp::MapShapesAndUniqueAncestors(input, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> near;
    for (int index : moving) {
      const TopoDS_Shape& face = faces(index + 1);
      near.Add(face);
      for (TopExp_Explorer e(face, TopAbs_EDGE); e.More(); e.Next()) {
        const int at = edgeFaces.FindIndex(e.Current());
        if (at == 0) continue;
        for (NCollection_List<TopoDS_Shape>::Iterator f(edgeFaces(at)); f.More(); f.Next()) near.Add(f.Value());
      }
    }
    for (int i = 1; i <= faces.Extent(); ++i) {
      const TopoDS_Shape& face = faces(i);
      if (near.Contains(face)) continue;
      GProp_GProps before;
      BRepGProp::SurfaceProperties(face, before);
      GProp_GProps after;
      for (const TopoDS_Shape& made : builder.Generated(face)) {
        if (made.ShapeType() != TopAbs_FACE || resultFaces.FindIndex(made) == 0) continue;
        BRepGProp::SurfaceProperties(made, after);
      }
      if (std::fabs(after.Mass() - before.Mass()) > 1e-6 * before.Mass() + 1e-6) return false;
      if (after.Mass() > 0 && after.CentreOfMass().Distance(before.CentreOfMass()) > 1e-4) return false;
    }
    return true;
  }

  /** Whether some face of `shape` has a seam (a cylinder's or a cone's wall, a sphere). */
  static bool hasSeam(const TopoDS_Shape& shape) {
    for (TopExp_Explorer f(shape, TopAbs_FACE); f.More(); f.Next()) {
      const TopoDS_Face& face = TopoDS::Face(f.Current());
      for (TopExp_Explorer e(face, TopAbs_EDGE); e.More(); e.Next()) {
        if (BRep_Tool::IsClosed(TopoDS::Edge(e.Current()), face)) return true;
      }
    }
    return false;
  }

  /**
   * The history of an offset built on a body whose closed faces were divided
   * first and merged back after (buildDividedOffset): each step's images taken
   * through the next, with the relation (modified, generated, deleted) the
   * offset step gives, as recordHistory() reads a builder.
   */
  struct DividedOffset {
    Handle(BRepTools_History) divide;
    BRepOffset_MakeOffset offset;
    Handle(BRepTools_History) unify;

    NCollection_List<TopoDS_Shape> pieces(const TopoDS_Shape& sub) const {
      NCollection_List<TopoDS_Shape> out;
      if (divide->IsRemoved(sub)) return out;
      const NCollection_List<TopoDS_Shape>& modified = divide->Modified(sub);
      if (modified.IsEmpty()) out.Append(sub);
      else out = modified;
      return out;
    }

    void merged(const NCollection_List<TopoDS_Shape>& made, NCollection_List<TopoDS_Shape>& out,
                NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>& seen) const {
      for (NCollection_List<TopoDS_Shape>::Iterator it(made); it.More(); it.Next()) {
        if (unify->IsRemoved(it.Value())) continue;
        const NCollection_List<TopoDS_Shape>& modified = unify->Modified(it.Value());
        if (modified.IsEmpty()) {
          if (seen.Add(it.Value())) out.Append(it.Value());
          continue;
        }
        for (NCollection_List<TopoDS_Shape>::Iterator m(modified); m.More(); m.Next()) {
          if (seen.Add(m.Value())) out.Append(m.Value());
        }
      }
    }

    NCollection_List<TopoDS_Shape> Modified(const TopoDS_Shape& sub) {
      NCollection_List<TopoDS_Shape> out;
      NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> seen;
      const NCollection_List<TopoDS_Shape> all = pieces(sub);
      for (NCollection_List<TopoDS_Shape>::Iterator p(all); p.More(); p.Next()) merged(offset.Modified(p.Value()), out, seen);
      return out;
    }

    NCollection_List<TopoDS_Shape> Generated(const TopoDS_Shape& sub) {
      NCollection_List<TopoDS_Shape> out;
      NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> seen;
      const NCollection_List<TopoDS_Shape> all = pieces(sub);
      for (NCollection_List<TopoDS_Shape>::Iterator p(all); p.More(); p.Next()) merged(offset.Generated(p.Value()), out, seen);
      return out;
    }

    bool IsDeleted(const TopoDS_Shape& sub) {
      const NCollection_List<TopoDS_Shape> all = pieces(sub);
      for (NCollection_List<TopoDS_Shape>::Iterator p(all); p.More(); p.Next()) {
        if (!offset.IsDeleted(p.Value())) return false;
      }
      return true;
    }
  };

  /**
   * The offset of `input` (a copy) with its closed faces divided into
   * seamless pieces first (ShapeUpgrade_ShapeDivideClosed) and merged back
   * after (ShapeUpgrade_UnifySameDomain), into `result`, with `divided`
   * holding the history (ADR-0051's amendment, 2026-10-11). OCCT's offset
   * reports success with no shape at all for a body whose cylinder wall has
   * a notch across its seam (the seam edge split by the cut), whichever face
   * is moved; on seamless pieces it builds. A picked or moving face stands
   * for all of its pieces. Tried only after the plain offset failed.
   */
  static bool buildDividedOffset(DividedOffset& divided, const TopoDS_Shape& input,
                                 const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                                 const std::vector<int>& picked, const std::vector<int>& moving, double distance,
                                 TopoDS_Shape& result) {
    try {
      ShapeUpgrade_ShapeDivideClosed divide(input);
      divide.SetNbSplitPoints(1);
      if (!divide.Perform()) return false;
      const TopoDS_Shape split = divide.Result();
      divided.divide = divide.GetContext()->History();
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> splitFaces;
      TopExp::MapShapes(split, TopAbs_FACE, splitFaces);
      const auto piecesOf = [&](const std::vector<int>& indices) {
        std::vector<int> out;
        for (int index : indices) {
          const NCollection_List<TopoDS_Shape> all = divided.pieces(faces(index + 1));
          for (NCollection_List<TopoDS_Shape>::Iterator p(all); p.More(); p.Next()) {
            const int at = splitFaces.FindIndex(p.Value()) - 1;
            if (at >= 0 && std::find(out.begin(), out.end(), at) == out.end()) out.push_back(at);
          }
        }
        return out;
      };
      const std::vector<int> pickedPieces = piecesOf(picked);
      const std::vector<int> movingPieces = piecesOf(moving);
      if (pickedPieces.empty()) return false;
      TopoDS_Shape offset;
      if (!buildOffset(divided.offset, split, splitFaces, pickedPieces, distance, offset) ||
          !offsetIsGood(divided.offset, split, splitFaces, movingPieces, offset, distance)) {
        return false;
      }
      ShapeUpgrade_UnifySameDomain unify(offset, true, true, false);
      unify.Build();
      divided.unify = unify.History();
      result = asSolid(unify.Shape());
      if (result.IsNull() || !BRepCheck_Analyzer(result).IsValid()) return false;
      // The merge must not change the body: the same volume within the integration's bound.
      const double before = exactVolume(offset);
      return std::fabs(exactVolume(result) - before) <= 1e-6 * std::fabs(before) + 1e-9;
    } catch (...) {
      result.Nullify();
      return false;
    }
  }

  /**
   * The history of an offset whose rounds were removed first and made again
   * after (buildReblendedOffset): each sub-shape taken through the removal,
   * the offset (with the relation the offset gives) and the new rounds; a
   * re-made round's old face is modified into its new faces.
   */
  struct ReblendedOffset {
    BRepAlgoAPI_Defeaturing removal;
    BRepOffset_MakeOffset offset;
    std::unique_ptr<BRepFilletAPI_MakeFillet> rounds;
    NCollection_DataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> remade;

    NCollection_List<TopoDS_Shape> removed(const TopoDS_Shape& sub) {
      NCollection_List<TopoDS_Shape> out;
      if (removal.IsDeleted(sub)) return out;
      const NCollection_List<TopoDS_Shape>& modified = removal.Modified(sub);
      if (modified.IsEmpty()) out.Append(sub);
      else out = modified;
      return out;
    }

    void rounded(const NCollection_List<TopoDS_Shape>& made, NCollection_List<TopoDS_Shape>& out,
                 NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher>& seen) {
      for (NCollection_List<TopoDS_Shape>::Iterator it(made); it.More(); it.Next()) {
        if (rounds->IsDeleted(it.Value())) continue;
        const NCollection_List<TopoDS_Shape>& modified = rounds->Modified(it.Value());
        if (modified.IsEmpty()) {
          if (seen.Add(it.Value())) out.Append(it.Value());
          continue;
        }
        for (NCollection_List<TopoDS_Shape>::Iterator m(modified); m.More(); m.Next()) {
          if (seen.Add(m.Value())) out.Append(m.Value());
        }
      }
    }

    NCollection_List<TopoDS_Shape> Modified(const TopoDS_Shape& sub) {
      if (remade.IsBound(sub)) return remade(sub);
      NCollection_List<TopoDS_Shape> out;
      NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> seen;
      const NCollection_List<TopoDS_Shape> all = removed(sub);
      for (NCollection_List<TopoDS_Shape>::Iterator p(all); p.More(); p.Next()) rounded(offset.Modified(p.Value()), out, seen);
      return out;
    }

    NCollection_List<TopoDS_Shape> Generated(const TopoDS_Shape& sub) {
      NCollection_List<TopoDS_Shape> out;
      if (remade.IsBound(sub)) return out;
      NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> seen;
      const NCollection_List<TopoDS_Shape> all = removed(sub);
      for (NCollection_List<TopoDS_Shape>::Iterator p(all); p.More(); p.Next()) rounded(offset.Generated(p.Value()), out, seen);
      return out;
    }

    bool IsDeleted(const TopoDS_Shape& sub) {
      if (remade.IsBound(sub)) return false;
      const NCollection_List<TopoDS_Shape> all = removed(sub);
      for (NCollection_List<TopoDS_Shape>::Iterator p(all); p.More(); p.Next()) {
        if (!offset.IsDeleted(p.Value())) return false;
      }
      return true;
    }
  };

  /** The radius of a round's face: a cylinder's, or a torus's minor one; 0 for anything else. */
  static double roundRadius(const TopoDS_Face& face) {
    BRepAdaptor_Surface surface(face, false);
    if (surface.GetType() == GeomAbs_Cylinder) return surface.Cylinder().Radius();
    if (surface.GetType() == GeomAbs_Torus) return surface.Torus().MinorRadius();
    return 0;
  }

  /**
   * The offset of `input` (a copy) with the rounds `blends` (0-based face
   * indices, none of them picked) that run smoothly into a moving face
   * removed first (BRepAlgoAPI_Defeaturing), the picked faces moved by
   * `distance`, and each round made again at its radius on the edges
   * between the faces it ran between (ADR-0051's amendment, 2026-10-14).
   * The moving faces are found as OCCT's offset finds them, but without
   * passing through a round: a face past a round doesn't move. Into
   * `result`, with `made` holding the history. False when the rounds can't
   * be removed or made again, or the offset fails or isn't sound; each step
   * runs once (no retries), and the body's smooth chains are checked after
   * the removal as before an offset.
   */
  static bool buildReblendedOffset(ReblendedOffset& made, const TopoDS_Shape& input,
                                   const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& faces,
                                   const std::vector<int>& picked, const std::vector<int>& blends, double distance,
                                   TopoDS_Shape& result) {
    try {
      const int count = faces.Extent();
      // Faces next to each face across a smooth edge, as smoothChains() judges it.
      std::vector<std::vector<int>> smooth(static_cast<size_t>(count));
      EdgeFaceMap edgeFaces;
      TopExp::MapShapesAndUniqueAncestors(input, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
      for (int e = 1; e <= edgeFaces.Extent(); ++e) {
        std::vector<int> around;
        for (const TopoDS_Shape& other : edgeFaces(e)) {
          const int index = faces.FindIndex(other) - 1;
          if (index >= 0 && std::find(around.begin(), around.end(), index) == around.end()) around.push_back(index);
        }
        if (around.size() != 2) continue;
        const TopoDS_Edge edge = TopoDS::Edge(edgeFaces.FindKey(e));
        gp_Dir a;
        gp_Dir b;
        if (edgeNormal(edge, TopoDS::Face(faces(around[0] + 1)), a) &&
            edgeNormal(edge, TopoDS::Face(faces(around[1] + 1)), b) && a.Dot(b) > 0.99756) {
          smooth[static_cast<size_t>(around[0])].push_back(around[1]);
          smooth[static_cast<size_t>(around[1])].push_back(around[0]);
        }
      }
      std::vector<char> isBlend(static_cast<size_t>(count), 0);
      for (int index : blends) isBlend[static_cast<size_t>(index)] = 1;
      // The moving faces: the picked ones and their smooth neighbours, not through a round.
      std::vector<char> moves(static_cast<size_t>(count), 0);
      std::vector<int> queue;
      for (int index : picked) {
        if (!moves[static_cast<size_t>(index)]) {
          moves[static_cast<size_t>(index)] = 1;
          queue.push_back(index);
        }
      }
      for (size_t at = 0; at < queue.size(); ++at) {
        for (int next : smooth[static_cast<size_t>(queue[at])]) {
          if (moves[static_cast<size_t>(next)] || isBlend[static_cast<size_t>(next)]) continue;
          moves[static_cast<size_t>(next)] = 1;
          queue.push_back(next);
        }
      }
      // The rounds next to a moving face are made again; each runs between its smooth
      // neighbours that are not such rounds, and must have two.
      std::vector<int> remake;
      for (int index : blends) {
        for (int next : smooth[static_cast<size_t>(index)]) {
          if (moves[static_cast<size_t>(next)]) {
            remake.push_back(index);
            break;
          }
        }
      }
      if (remake.empty()) return false;
      std::vector<char> remade(static_cast<size_t>(count), 0);
      for (int index : remake) remade[static_cast<size_t>(index)] = 1;
      std::vector<std::vector<int>> rails;
      std::vector<double> radii;
      for (int index : remake) {
        std::vector<int> sides;
        for (int next : smooth[static_cast<size_t>(index)]) {
          if (!remade[static_cast<size_t>(next)] && std::find(sides.begin(), sides.end(), next) == sides.end()) {
            sides.push_back(next);
          }
        }
        const double radius = roundRadius(TopoDS::Face(faces(index + 1)));
        if (sides.size() != 2 || !(radius > 1e-6)) return false;
        rails.push_back(sides);
        radii.push_back(radius);
      }

      made.removal.SetShape(input);
      for (int index : remake) made.removal.AddFaceToRemove(faces(index + 1));
      made.removal.SetRunParallel(false);
      made.removal.SetToFillHistory(true);
      made.removal.Build();
      if (!made.removal.IsDone() || made.removal.HasErrors()) return false;
      const TopoDS_Shape plain = asSolid(made.removal.Shape());
      if (plain.IsNull() || !BRepCheck_Analyzer(plain).IsValid()) return false;
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> plainFaces;
      TopExp::MapShapes(plain, TopAbs_FACE, plainFaces);
      const auto plainIndices = [&](int index) {
        std::vector<int> out;
        const NCollection_List<TopoDS_Shape> all = made.removed(faces(index + 1));
        for (NCollection_List<TopoDS_Shape>::Iterator p(all); p.More(); p.Next()) {
          const int at = plainFaces.FindIndex(p.Value()) - 1;
          if (at >= 0 && std::find(out.begin(), out.end(), at) == out.end()) out.push_back(at);
        }
        return out;
      };
      std::vector<int> pickedPlain;
      for (int index : picked) {
        for (int at : plainIndices(index)) {
          if (std::find(pickedPlain.begin(), pickedPlain.end(), at) == pickedPlain.end()) pickedPlain.push_back(at);
        }
      }
      if (pickedPlain.empty()) return false;
      // OCCT's offset traps on a smooth chain with a crease inside (see smoothChains()).
      std::vector<int> chain;
      if (smoothChains(plain, plainFaces, chain)) return false;
      const std::vector<int> movingPlain = smoothClosure(chain, pickedPlain);
      TopoDS_Shape moved;
      if (!buildOffset(made.offset, plain, plainFaces, pickedPlain, distance, moved) ||
          !offsetIsGood(made.offset, plain, plainFaces, movingPlain, moved, distance)) {
        return false;
      }

      // Each round on the edges between the faces its two sides became.
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> movedFaces;
      TopExp::MapShapes(moved, TopAbs_FACE, movedFaces);
      const auto movedImages = [&](int index) {
        NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> out;
        for (int at : plainIndices(index)) {
          const TopoDS_Shape& face = plainFaces(at + 1);
          if (movedFaces.Contains(face)) out.Add(face);
          for (const TopoDS_Shape& m : made.offset.Modified(face)) {
            if (movedFaces.Contains(m)) out.Add(m);
          }
          for (const TopoDS_Shape& m : made.offset.Generated(face)) {
            if (m.ShapeType() == TopAbs_FACE && movedFaces.Contains(m)) out.Add(m);
          }
        }
        return out;
      };
      EdgeFaceMap movedEdgeFaces;
      TopExp::MapShapesAndUniqueAncestors(moved, TopAbs_EDGE, TopAbs_FACE, movedEdgeFaces);
      made.rounds = std::make_unique<BRepFilletAPI_MakeFillet>(moved);
      std::vector<std::vector<TopoDS_Shape>> roundEdges(remake.size());
      NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> taken;
      for (size_t k = 0; k < remake.size(); ++k) {
        const NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> one = movedImages(rails[k][0]);
        const NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> two = movedImages(rails[k][1]);
        for (int e = 1; e <= movedEdgeFaces.Extent(); ++e) {
          const NCollection_List<TopoDS_Shape>& around = movedEdgeFaces(e);
          if (around.Extent() != 2) continue;
          const TopoDS_Shape& a = around.First();
          const TopoDS_Shape& b = around.Last();
          if (!((one.Contains(a) && two.Contains(b)) || (one.Contains(b) && two.Contains(a)))) continue;
          const TopoDS_Shape& edge = movedEdgeFaces.FindKey(e);
          if (!taken.Add(edge)) continue;
          made.rounds->Add(radii[k], TopoDS::Edge(edge));
          roundEdges[k].push_back(edge);
        }
        if (roundEdges[k].empty()) return false;
      }
      made.rounds->Build();
      if (!made.rounds->IsDone()) return false;
      result = asSolid(made.rounds->Shape());
      if (result.IsNull() || !BRepCheck_Analyzer(result).IsValid()) return false;
      // The body grew where faces moved out and shrank where they moved in.
      const double before = exactVolume(input);
      const double after = exactVolume(result);
      const double slack = 1e-6 * before;
      if (!(after > 0) || (distance > 0 && after < before - slack) || (distance < 0 && after > before + slack)) {
        return false;
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
      TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
      for (size_t k = 0; k < remake.size(); ++k) {
        NCollection_List<TopoDS_Shape> news;
        for (const TopoDS_Shape& edge : roundEdges[k]) {
          for (const TopoDS_Shape& face : made.rounds->Generated(edge)) {
            if (face.ShapeType() == TopAbs_FACE && resultFaces.Contains(face)) news.Append(face);
          }
        }
        if (news.IsEmpty()) return false;
        made.remade.Bind(faces(remake[k] + 1), news);
      }
      return true;
    } catch (...) {
      result.Nullify();
      return false;
    }
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
   * Whether a taper has to go through `taperLoft`: it does when any side the
   * straight sweep made isn't a plane, a cylinder or a cone, that is, when a
   * profile edge is an ellipse or a B-spline (ADR-0028's amendment, P4-12).
   */
  static bool taperNeedsLoft(BRepPrimAPI_MakePrism& builder, const TopoDS_Shape& base) {
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(base, TopAbs_EDGE, edges);
    NCollection_Map<TopoDS_Shape, TopTools_ShapeMapHasher> seen;
    for (int i = 1; i <= edges.Extent(); ++i) {
      for (NCollection_List<TopoDS_Shape>::Iterator it(builder.Generated(edges(i))); it.More(); it.Next()) {
        if (it.Value().ShapeType() != TopAbs_FACE || seen.Contains(it.Value())) continue;
        seen.Add(it.Value());
        const GeomAbs_SurfaceType type = BRepAdaptor_Surface(TopoDS::Face(it.Value()), false).GetType();
        if (type != GeomAbs_Plane && type != GeomAbs_Cylinder && type != GeomAbs_Cone) return true;
      }
    }
    return false;
  }

  /**
   * A planar face from an outer wire and its holes (a tapered loft's far cap).
   * The face is checked like any result: an invalid one is null.
   */
  static TopoDS_Face faceFromWires(const TopoDS_Wire& outer, const std::vector<TopoDS_Wire>& holes) {
    if (outer.IsNull()) return TopoDS_Face();
    // Find the plane from the outline: an offset B-spline wire's plane can be a
    // fraction of a tolerance off the profile's, which makes a face built on the
    // profile's plane invalid.
    BRepBuilderAPI_MakeFace maker(outer, true);
    for (const TopoDS_Wire& hole : holes) maker.Add(hole);
    if (maker.IsDone() && BRepCheck_Analyzer(maker.Face()).IsValid()) return maker.Face();
    // The offset wires may come out with the other orientation.
    BRepBuilderAPI_MakeFace fallback(outer, true);
    for (const TopoDS_Wire& hole : holes) fallback.Add(TopoDS::Wire(hole.Reversed()));
    if (fallback.IsDone() && BRepCheck_Analyzer(fallback.Face()).IsValid()) return fallback.Face();
    return TopoDS_Face();
  }

  /** The result faces whose surface is `plane` (the caps of a tapered loft).
   * Geometric, not by the planes' origins: a plane's `Location()` is wherever
   * its surface was built (the profile's plane sits at the sketch origin, a
   * cap built by `faceFromWires` wherever its outline is), so the match is the
   * point-to-plane distance of the face's location. */
  static NCollection_List<TopoDS_Shape> facesInPlane(const TopoDS_Shape& result, const gp_Pln& plane) {
    NCollection_List<TopoDS_Shape> out;
    for (TopExp_Explorer f(result, TopAbs_FACE); f.More(); f.Next()) {
      BRepAdaptor_Surface surface(TopoDS::Face(f.Current()), false);
      if (surface.GetType() != GeomAbs_Plane) continue;
      const gp_Pln& pln = surface.Plane();
      if (plane.Distance(pln.Location()) > Precision::Confusion() * 1000) continue;
      if (std::abs(pln.Axis().Direction().Dot(plane.Axis().Direction())) < 0.999) continue;
      out.Append(f.Current());
    }
    return out;
  }

  /**
   * Tapers a profile that has an ellipse or B-spline side (ADR-0028's
   * amendment, P4-12). DraftAngle can't tilt such a side, so the far outline
   * is the profile's 2D offset in its plane by length*tan(taper) (positive
   * outwards, holes the other way; BRepOffsetAPI_MakeOffset with GeomAbs_Arc
   * joins, an offset curve for an ellipse or B-spline), moved along the
   * sweep, and the solid is a ruled loft (BRepOffsetAPI_ThruSections per
   * pair of wires) between the profile and the offset, its caps added and the
   * shell sewn into a solid. History as for `taperSweep`: input 0 is the
   * profile, the caps first/last and each profile edge's wall generated, so a
   * side keeps its sketch curve's name.
   *
   * Each profile wire is lofted to its own offset: the offset wire made of
   * the edges `MakeOffset::Generated` gives for its edges, so a hole never
   * meets another hole's offset whatever their sizes or order.
   *
   * The taper widens the outline for a positive angle and narrows it for a
   * negative one. An offset that fails, throws or crosses itself, an outline
   * the offset pinches in two and a hole the inward offset closes are refused
   * with a message for the user.
   */
  int taperLoft(const TopoDS_Shape& base, const gp_Vec& along, double taper) {
    static const char* const tooSteep = "The taper is too steep for this outline: a side would cross another.";
    static const char* const pinches =
        "The taper pinches the outline in two: use a smaller angle or a shorter distance.";
    static const char* const closesHole = "The taper closes a hole of the profile.";
    const double length = along.Magnitude();
    const double distance = length * std::tan(taper);
    gp_Trsf move;
    move.SetTranslation(along);
    const TopLoc_Location shift(move);

    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> baseFaces;
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> baseEdges;
    TopExp::MapShapes(base, TopAbs_FACE, baseFaces);
    TopExp::MapShapes(base, TopAbs_EDGE, baseEdges);
    if (baseFaces.IsEmpty()) return fail("Extrude failed: the profile has no face.");

    std::vector<TopoDS_Shape> solids;
    std::vector<NCollection_List<TopoDS_Shape>> walls(static_cast<size_t>(baseEdges.Extent()) + 1);
    std::vector<gp_Pln> startPlanes(static_cast<size_t>(baseFaces.Extent()) + 1);
    std::vector<gp_Pln> endPlanes(static_cast<size_t>(baseFaces.Extent()) + 1);

    for (int fi = 1; fi <= baseFaces.Extent(); ++fi) {
      const TopoDS_Face& face = TopoDS::Face(baseFaces(fi));
      BRepAdaptor_Surface surface(face, false);
      if (surface.GetType() != GeomAbs_Plane) {
        return fail("Can only taper a flat profile. Pick another profile.");
      }
      const gp_Pln plane = surface.Plane();
      BRepOffsetAPI_MakeOffset offset(face, GeomAbs_Arc);
      // OCCT throws (StdFail_NotDone and others) where an offset can't be built.
      try {
        offset.Perform(distance);
        if (!offset.IsDone() || offset.Shape().IsNull()) return fail(tooSteep);
      } catch (const Standard_Failure&) {
        return fail(tooSteep);
      }
      const TopoDS_Shape& offsetShape = offset.Shape();

      // Pair each wire of the face with its own offset: the offset wire holding
      // the edges its edges generated. Never by size or order, which an offset
      // can swap (a thin slot and a round hole) or tie (two equal holes).
      std::vector<TopoDS_Wire> startWires;
      for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) startWires.push_back(TopoDS::Wire(w.Current()));
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> offsetWires;
      TopExp::MapShapes(offsetShape, TopAbs_WIRE, offsetWires);
      if (offsetWires.IsEmpty()) return fail(tooSteep);
      NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> edgeWires;
      TopExp::MapShapesAndAncestors(offsetShape, TopAbs_EDGE, TopAbs_WIRE, edgeWires);
      const TopoDS_Wire outerStart = BRepTools::OuterWire(face);
      std::vector<int> partner(startWires.size(), 0);
      std::vector<int> claimedBy(static_cast<size_t>(offsetWires.Extent()) + 1, -1);
      bool split = offsetWires.Extent() > static_cast<int>(startWires.size());
      bool vanished = false;
      bool merged = false;
      for (size_t i = 0; i < startWires.size(); ++i) {
        NCollection_Map<int> found;
        for (TopExp_Explorer e(startWires[i], TopAbs_EDGE); e.More(); e.Next()) {
          for (NCollection_List<TopoDS_Shape>::Iterator it(offset.Generated(e.Current())); it.More(); it.Next()) {
            const int at = edgeWires.FindIndex(it.Value());
            if (at <= 0) continue;
            for (NCollection_List<TopoDS_Shape>::Iterator wi(edgeWires(at)); wi.More(); wi.Next()) {
              const int wire = offsetWires.FindIndex(wi.Value());
              if (wire > 0) found.Add(wire);
            }
          }
        }
        if (found.Extent() > 1) split = true;
        if (found.Extent() == 0) {
          if (startWires[i].IsSame(outerStart)) return fail(tooSteep);
          vanished = true;
          continue;
        }
        const int wire = NCollection_Map<int>::Iterator(found).Key();
        if (claimedBy[static_cast<size_t>(wire)] >= 0) merged = true;
        claimedBy[static_cast<size_t>(wire)] = static_cast<int>(i);
        partner[i] = wire;
      }
      if (split) return fail(pinches);
      if (vanished) return fail(closesHole);
      if (merged || offsetWires.Extent() != static_cast<int>(startWires.size())) return fail(tooSteep);

      TopoDS_Wire endOuter;
      std::vector<TopoDS_Wire> endHoles;
      std::vector<TopoDS_Wire> endWires(startWires.size());
      for (size_t i = 0; i < startWires.size(); ++i) {
        endWires[i] = TopoDS::Wire(offsetWires(partner[i]).Moved(shift));
        if (startWires[i].IsSame(outerStart)) {
          endOuter = endWires[i];
        } else {
          endHoles.push_back(endWires[i]);
        }
      }
      const gp_Pln endPlane(plane.Location().Translated(along), plane.Axis().Direction());
      const TopoDS_Face endCap = faceFromWires(endOuter, endHoles);
      if (endCap.IsNull()) return fail(tooSteep);

      BRepBuilderAPI_Sewing sewing(Precision::Confusion());
      std::vector<std::pair<int, NCollection_List<TopoDS_Shape>>> localWalls;
      for (size_t i = 0; i < startWires.size(); ++i) {
        BRepOffsetAPI_ThruSections loft(false, true, Precision::Confusion());
        try {
          loft.AddWire(startWires[i]);
          loft.AddWire(endWires[i]);
          loft.Build();
          if (!loft.IsDone()) return fail(tooSteep);
        } catch (const Standard_Failure&) {
          return fail(tooSteep);
        }
        for (TopExp_Explorer e(startWires[i], TopAbs_EDGE); e.More(); e.Next()) {
          const int edgeIndex = baseEdges.FindIndex(e.Current());
          NCollection_List<TopoDS_Shape> made;
          for (NCollection_List<TopoDS_Shape>::Iterator it(loft.Generated(e.Current())); it.More(); it.Next()) {
            if (it.Value().ShapeType() != TopAbs_FACE) continue;
            sewing.Add(it.Value());
            made.Append(it.Value());
          }
          if (edgeIndex > 0 && !made.IsEmpty()) localWalls.emplace_back(edgeIndex, std::move(made));
        }
      }
      sewing.Add(face);
      sewing.Add(endCap);
      sewing.Perform();
      if (sewing.NbFreeEdges() != 0) return fail(tooSteep);
      // Sewing may have rebuilt the faces it was handed: follow its modification
      // so the history names the faces that are really in the result.
      for (auto& [edgeIndex, made] : localWalls) {
        for (NCollection_List<TopoDS_Shape>::Iterator it(made); it.More(); it.Next()) {
          const TopoDS_Shape& now = sewing.Modified(it.Value());
          walls[static_cast<size_t>(edgeIndex)].Append(now.IsNull() ? it.Value() : now);
        }
      }
      TopoDS_Shell shell;
      for (TopExp_Explorer s(sewing.SewedShape(), TopAbs_SHELL); s.More() && shell.IsNull(); s.Next()) {
        shell = TopoDS::Shell(s.Current());
      }
      if (shell.IsNull()) return fail("Extrude failed: OCCT couldn't build the tapered solid.");
      BRepBuilderAPI_MakeSolid makeSolid(shell);
      TopoDS_Shape solid = makeSolid.Solid();
      if (volumeOf(solid) < 0) solid.Reverse();
      if (!BRepCheck_Analyzer(solid).IsValid() || !(volumeOf(solid) > 0) || crossesItself(solid)) {
        return fail(tooSteep);
      }
      solids.push_back(solid);
      startPlanes[static_cast<size_t>(fi)] = plane;
      endPlanes[static_cast<size_t>(fi)] = endPlane;
    }

    TopoDS_Shape result;
    if (solids.size() == 1) {
      result = solids[0];
    } else {
      TopoDS_Compound compound;
      BRep_Builder builder;
      builder.MakeCompound(compound);
      for (const TopoDS_Shape& solid : solids) builder.Add(compound, solid);
      result = compound;
    }

    // History as a prism's (input 0 = the profile). The caps are found by their
    // plane, since sewing may have rebuilt the ones handed to it.
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultMaps[3];
    for (int kind = 0; kind < 3; ++kind) TopExp::MapShapes(result, kindToEnum(kind), resultMaps[kind]);
    for (int fi = 1; fi <= baseFaces.Extent(); ++fi) {
      appendRelation(facesInPlane(result, startPlanes[static_cast<size_t>(fi)]), resultMaps, 0, 0, fi - 1, 4);
      appendRelation(facesInPlane(result, endPlanes[static_cast<size_t>(fi)]), resultMaps, 0, 0, fi - 1, 5);
    }
    for (int ei = 1; ei <= baseEdges.Extent(); ++ei) {
      appendRelation(walls[static_cast<size_t>(ei)], resultMaps, 0, 1, ei - 1, 1);
    }
    return store(result);
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
        // Every side is a plane, a cylinder or a cone here: `taperNeedsLoft`
        // sent the others to `taperLoft`.
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

  /** The view direction · the face's outward normal at the middle of edge e. */
  static bool normalAlong(const TopoDS_Edge& e, const TopoDS_Face& face, const gp_Dir& view,
                          double& out) {
    double first = 0, last = 0;
    const occ::handle<Geom2d_Curve> pcurve = BRep_Tool::CurveOnSurface(e, face, first, last);
    if (pcurve.IsNull()) return false;
    const gp_Pnt2d uv = pcurve->Value(0.5 * (first + last));
    BRepGProp_Face props(face);
    gp_Pnt p;
    gp_Vec n;
    props.Normal(uv.X(), uv.Y(), p, n);
    if (n.Magnitude() <= 1e-12) return false;
    out = n.Normalized().Dot(gp_Vec(view));
    return true;
  }

  /** faceSilhouettes for a cylinder or cone: closed form (P2-09). */
  int ruledSilhouettes(const TopoDS_Face& f, const BRepAdaptor_Surface& surface, const gp_Dir& d) {
    gp_Ax3 position;
    double semiAngle = 0;
    if (surface.GetType() == GeomAbs_Cylinder) {
      position = surface.Cylinder().Position();
    } else {
      position = surface.Cone().Position();
      semiAngle = surface.Cone().SemiAngle();
    }
    // The normal at angle u is proportional to cos(A)(cos u X + sin u Y) - sin(A) Z
    // (either sign), so the silhouette is where cos u a + sin u b = tan(A) c.
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
  }

  /**
   * faceSilhouettes for every other curved surface: Contap_Contour on the
   * face, as HLRTopoBRep_DSFiller runs it for HLRBRep_Algo's outlines.
   */
  int contourSilhouettes(const TopoDS_Shape& shape, TopoDS_Face f, const gp_Dir& d,
                         double deflection) {
    f.Orientation(TopAbs_FORWARD);
    BRepTopAdaptor_Tool tool(f, Precision::PConfusion());
    const gp_Vec direction(d);
    Contap_Contour contour(direction);
    contour.Perform(tool.GetSurface(), tool.GetTopolTool());
    if (!contour.IsDone() || contour.IsEmpty()) return 0;
    NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>
        edgeFaces;
    TopExp::MapShapesAndUniqueAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
    int pieces = 0;
    for (int l = 1; l <= contour.NbLines(); ++l) {
      const Contap_Line& line = contour.Line(l);
      const Contap_IType kind = line.TypeContour();
      if (kind == Contap_Restriction) {
        const TopoDS_Edge e = (*(BRepAdaptor_Curve2d*)(line.Arc().get())).Edge();
        if (!contourOnEdge(e, f, edgeFaces)) continue;
        BRepAdaptor_Curve curve(e);
        pieces += pushCurvePiece(curve, curve.FirstParameter(), curve.LastParameter(), deflection);
        continue;
      }
      const int nv = line.NbVertex();
      for (int k = 1; k < nv; ++k) {
        const double from = line.Vertex(k).ParameterOnLine();
        const double to = line.Vertex(k + 1).ParameterOnLine();
        if (!(to - from > Precision::PConfusion())) continue;
        if (kind == Contap_Lin) {
          const gp_Lin lin = line.Line();
          pieces += pushLine(ElCLib::Value(from, lin), ElCLib::Value(to, lin));
        } else if (kind == Contap_Circle) {
          const gp_Circ c = line.Circle();
          geometry_.push_back(1.0);
          pushPoint(c.Location());
          pushDir(c.Axis().Direction());
          pushDir(c.XAxis().Direction());
          geometry_.insert(geometry_.end(), {c.Radius(), from, to});
          ++pieces;
        } else {
          // A walked contour: its points between the two vertices.
          const int first = std::max(1, static_cast<int>(std::floor(from + 1e-9)));
          const int last = std::min(line.NbPnts(), static_cast<int>(std::ceil(to - 1e-9)));
          if (last - first < 1) continue;
          geometry_.push_back(2.0);
          geometry_.push_back(static_cast<double>(last - first + 1));
          for (int i = first; i <= last; ++i) pushPoint(line.Point(i).Value());
          ++pieces;
        }
      }
    }
    return pieces;
  }

  /**
   * Whether a contour found on edge e of face f is a silhouette of its own
   * (faceSilhouettes): yes on a seam, or where f meets its neighbour smoothly
   * (no sharp edge draws it then); no on any other boundary edge.
   */
  static bool contourOnEdge(
      const TopoDS_Edge& e, const TopoDS_Face& f,
      const NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>,
                                       TopTools_ShapeMapHasher>& edgeFaces) {
    if (BRep_Tool::IsClosed(e, f)) return true;
    if (!edgeFaces.Contains(e)) return false;
    const NCollection_List<TopoDS_Shape>& around = edgeFaces.FindFromKey(e);
    if (around.Extent() != 2) return false;
    return BRep_Tool::Continuity(e, TopoDS::Face(around.First()), TopoDS::Face(around.Last())) >=
           GeomAbs_G1;
  }

  int pushLine(const gp_Pnt& a, const gp_Pnt& b) {
    if (a.Distance(b) <= Precision::Confusion()) return 0;
    geometry_.push_back(0.0);
    pushPoint(a);
    pushPoint(b);
    return 1;
  }

  /**
   * One piece of faceSilhouettes' encoding for a curve from `first` to
   * `last`: exact for a line, circle or ellipse, else a polyline within
   * `deflection`.
   */
  int pushCurvePiece(const Adaptor3d_Curve& curve, double first, double last, double deflection) {
    if (!(last - first > Precision::PConfusion())) return 0;
    const GeomAbs_CurveType type = curve.GetType();
    if (type == GeomAbs_Line) return pushLine(curve.Value(first), curve.Value(last));
    if (type == GeomAbs_Circle || type == GeomAbs_Ellipse) {
      gp_Ax2 position;
      double major = 0, minor = 0;
      if (type == GeomAbs_Circle) {
        const gp_Circ c = curve.Circle();
        position = c.Position();
        major = minor = c.Radius();
      } else {
        const gp_Elips c = curve.Ellipse();
        position = c.Position();
        major = c.MajorRadius();
        minor = c.MinorRadius();
      }
      geometry_.push_back(type == GeomAbs_Circle ? 1.0 : 3.0);
      pushPoint(position.Location());
      pushDir(position.Direction());
      pushDir(position.XDirection());
      geometry_.push_back(major);
      if (type == GeomAbs_Ellipse) geometry_.push_back(minor);
      geometry_.insert(geometry_.end(), {first, last});
      return 1;
    }
    GCPnts_TangentialDeflection sampler(curve, first, last, 0.1, std::max(deflection, 1e-4));
    const int n = sampler.NbPoints();
    if (n < 2) return 0;
    geometry_.push_back(2.0);
    geometry_.push_back(static_cast<double>(n));
    for (int k = 1; k <= n; ++k) pushPoint(sampler.Value(k));
    return 1;
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
    return pushLine(surface.Value(u, from), surface.Value(u, to));
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
    pushNumbers(edgeLength(edge, props.Mass()), middle, hasDirection ? &direction : nullptr);
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
