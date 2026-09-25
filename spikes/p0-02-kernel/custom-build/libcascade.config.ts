// P0-02 step 6: a trimmed libcascade build for Extrudo. Rendered with
// `npx libcascade build --render-only` (no container needed); a real build
// needs Docker and the 2.4 GB ghcr.io/taucad/opencascade.js image.
//
// The binding list is the set the spike's raw scenario uses plus what Phase 1–3
// features need (sketch → face, extrude/revolve/sweep/loft, fillet/chamfer/
// shell, booleans, STEP/STL, meshing, measurement, healing).
import { defineBuild } from '@libcascade/toolchain';

export default defineBuild({
  name: 'extrudo_occt',
  bindings: [
    // geometry primitives
    'gp_Pnt', 'gp_Dir', 'gp_Vec', 'gp_Ax1', 'gp_Ax2', 'gp_Ax3', 'gp_Pln', 'gp_Trsf', 'gp_Pnt2d', 'gp_Dir2d',
    'gp_Circ', 'gp_Lin',
    // topology
    'TopoDS', 'TopoDS_Shape', 'TopoDS_Face', 'TopoDS_Edge', 'TopoDS_Wire', 'TopoDS_Vertex', 'TopoDS_Shell',
    'TopoDS_Solid', 'TopoDS_Compound', 'TopExp', 'TopExp_Explorer', 'TopLoc_Location', 'BRep_Tool', 'BRep_Builder',
    'TopTools_ShapeMapHasher', 'NCollection_BaseMap', 'NCollection_BaseList',
    // builders and features
    'BRepBuilderAPI_MakeShape', 'BRepBuilderAPI_MakeEdge', 'BRepBuilderAPI_MakeWire', 'BRepBuilderAPI_MakeFace',
    'BRepBuilderAPI_Transform', 'BRepPrimAPI_MakeBox', 'BRepPrimAPI_MakeCylinder', 'BRepPrimAPI_MakePrism',
    'BRepPrimAPI_MakeRevol', 'BRepOffsetAPI_MakePipeShell', 'BRepOffsetAPI_ThruSections',
    'BRepOffsetAPI_MakeThickSolid', 'BRepFilletAPI_MakeFillet', 'BRepFilletAPI_MakeChamfer',
    'BRepAlgoAPI_Fuse', 'BRepAlgoAPI_Cut', 'BRepAlgoAPI_Common', 'BRepAlgoAPI_BuilderAlgo', 'BOPAlgo_Builder',
    'BRepTools_History', 'GC_MakeArcOfCircle', 'GC_MakeSegment', 'Geom_Curve', 'Geom_Surface',
    // meshing, measurement, checks, healing
    'BRepMesh_IncrementalMesh', 'Poly_Triangulation', 'Poly_PolygonOnTriangulation', 'BRepGProp', 'GProp_GProps',
    'BRepCheck_Analyzer', 'BRepBndLib', 'Bnd_Box', 'BRepAdaptor_Surface', 'BRepAdaptor_Curve',
    'ShapeFix_Shape', 'ShapeUpgrade_UnifySameDomain',
    // exchange
    'STEPControl_Writer', 'STEPControl_Reader', 'STEPControl_StepModelType', 'Interface_Static',
    'Message_ProgressRange', 'StlAPI_Writer',
    // enums and collections the spike touches (found by `npx libcascade check ../src`)
    'TopAbs_ShapeEnum', 'TopAbs_Orientation', 'ChFi3d_FilletShape',
    'NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher', 'NCollection_List_TopoDS_Shape',
  ],
  // Where our own C++ would go (P0-09): bulk mesh extraction into one buffer,
  // and boolean/fillet wrappers that release builder memory deterministically.
  // customBindings: [{ file: 'wrappers/extrudo.cpp', symbols: ['ExtrudoMesh'] }],
  settings: {
    ALLOW_MEMORY_GROWTH: true,
    EXPORTED_RUNTIME_METHODS: ['FS', 'wasmMemory'],
    ENVIRONMENT: ['web', 'worker', 'node'],
  },
  compilerFlags: { exceptions: 'wasm', noEntry: true, simd: true, optimize: 'O3' },
  variants: [{ name: 'single' }],
});
