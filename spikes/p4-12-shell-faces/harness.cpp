// Native harness for a shell with a thickness per face, and for removing a
// face next to a fillet (P4-12, ADR-0046's amendment). Built and run inside
// the pinned OCCT image by run.sh.
//
//   node harness.cjs                    the volume table of shellFaces()
//   node harness.cjs trap B F T [raw]   one shell of body B with face F
//                                       removed at thickness T: through the
//                                       facade (refusals on), or `raw`
//                                       (MakeThickSolidByJoin, no refusal)
//   node harness.cjs faces B            the faces of body B, numbered
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepPrimAPI_MakeBox.hxx>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

static int failures = 0;
static ExtrudoFacade f;
static const double PI = 3.14159265358979323846;

using FaceMap = NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>;

static FaceMap facesOf(int shape) {
  FaceMap faces;
  TopExp::MapShapes(*f.find(shape), TopAbs_FACE, faces);
  return faces;
}

/** The centre of a face (its surface's centre of mass). */
static gp_Pnt centreOf(const TopoDS_Shape& face) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  return props.CentreOfMass();
}

/** The index of the planar face whose centre is nearest (x, y, z), or -1. */
static int faceAt(int shape, double x, double y, double z) {
  FaceMap faces = facesOf(shape);
  int best = -1;
  double bestDistance = 1e9;
  for (int i = 1; i <= faces.Extent(); ++i) {
    const double d = centreOf(faces(i)).Distance(gp_Pnt(x, y, z));
    if (d < bestDistance) {
      bestDistance = d;
      best = i - 1;
    }
  }
  return best;
}

/** Fillets the edges of `shape` whose middle passes `keep`, radius r. */
template <typename Keep>
static int filleted(int shape, double r, Keep keep) {
  BRepFilletAPI_MakeFillet fillet(*f.find(shape));
  int added = 0;
  for (TopExp_Explorer it(*f.find(shape), TopAbs_EDGE); it.More(); it.Next()) {
    BRepAdaptor_Curve c(TopoDS::Edge(it.Current()));
    const gp_Pnt m = c.Value(0.5 * (c.FirstParameter() + c.LastParameter()));
    if (keep(m)) {
      fillet.Add(r, TopoDS::Edge(it.Current()));
      ++added;
    }
  }
  fillet.Build();
  if (!fillet.IsDone() || added == 0) return 0;
  return f.store(fillet.Shape());
}

static bool onEdge(double v) { return std::abs(v) < 1e-6 || std::abs(v - 20) < 1e-6; }

/** The bodies the trap sweep and the table use, by name. */
static int body(const std::string& name) {
  const int cube = f.makeBox(0, 0, 0, 20, 20, 20);
  if (name == "box") return cube;
  if (name == "cyl") return f.makeCylinder(0, 0, 0, 0, 0, 1, 10, 20);
  if (name.rfind("round", 0) == 0) {
    // round<r>: all 12 edges of the cube rounded.
    const double r = std::atof(name.c_str() + 5);
    return filleted(cube, r, [](const gp_Pnt&) { return true; });
  }
  if (name.rfind("vert", 0) == 0) {
    // vert<r>: the 4 vertical edges rounded.
    const double r = std::atof(name.c_str() + 4);
    return filleted(cube, r, [](const gp_Pnt& m) { return onEdge(m.X()) && onEdge(m.Y()); });
  }
  if (name.rfind("top", 0) == 0) {
    // top<r>: the 4 top edges rounded (a sharp edge inside a smooth chain).
    const double r = std::atof(name.c_str() + 3);
    return filleted(cube, r, [](const gp_Pnt& m) { return std::abs(m.Z() - 20) < 1e-6; });
  }
  if (name.rfind("one", 0) == 0) {
    // one<r>: one top edge rounded (y = 0).
    const double r = std::atof(name.c_str() + 3);
    return filleted(cube, r, [](const gp_Pnt& m) { return std::abs(m.Z() - 20) < 1e-6 && std::abs(m.Y()) < 1e-6; });
  }
  if (name.rfind("cylr", 0) == 0) {
    // cylr<r>: the cylinder with its top edge rounded.
    const int cyl = f.makeCylinder(0, 0, 0, 0, 0, 1, 10, 20);
    const double r = std::atof(name.c_str() + 4);
    return filleted(cyl, r, [](const gp_Pnt& m) { return std::abs(m.Z() - 20) < 1e-6; });
  }
  return 0;
}

static double volume(int shape) { return ExtrudoFacade::exactVolume(*f.find(shape)); }

struct Wall {
  int face;
  double thickness;
};

static int shellFaces(int shape, const std::vector<int>& removed, const std::vector<Wall>& walls, double t,
                      bool outside) {
  f.clearArgs();
  for (int r : removed) f.pushArg(r);
  f.clearWalls();
  for (const Wall& w : walls) f.pushWall(w.face, w.thickness);
  return f.shellFaces(shape, t, outside);
}

static void row(const char* name, int shape, const std::vector<int>& removed, const std::vector<Wall>& walls,
                double t, bool outside, double expected) {
  const auto start = std::chrono::steady_clock::now();
  const int result = shellFaces(shape, removed, walls, t, outside);
  const double ms =
      std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
  if (result == 0) {
    std::printf("| %-44s | failed: %s [%g, %g] | %.0f ms |\n", name, f.lastError_.c_str(),
                f.geometry_.size() > 0 ? f.geometry_[0] : -1, f.geometry_.size() > 1 ? f.geometry_[1] : -1, ms);
    if (expected > 0) ++failures;
    return;
  }
  const double v = volume(result);
  const double error = expected > 0 ? std::abs(v - expected) / expected : 0;
  const bool ok = expected > 0 && error < 1e-6;
  std::printf("| %-44s | %10.3f | %10.3f | %.1e | %4d faces | %.0f ms | %s\n", name, v, expected, error,
              facesOf(result).Extent(), ms, ok ? "ok" : "FAIL");
  if (!ok) ++failures;
  f.release(result);
}

static void refusal(const char* name, int shape, const std::vector<int>& removed, const std::vector<Wall>& walls,
                    double t, int status) {
  const int result = shellFaces(shape, removed, walls, t, false);
  const int got = f.geometry_.empty() ? -1 : static_cast<int>(f.geometry_[0]);
  const bool ok = result == 0 && got == status;
  std::printf("| %-44s | refused: %s [%g, %g] | %s\n", name, f.lastError_.c_str(), f.geometry_.empty() ? -1 : f.geometry_[0],
              f.geometry_.size() > 1 ? f.geometry_[1] : -1, ok ? "ok" : "FAIL");
  if (!ok) ++failures;
}


/** buildShellFaces with a chosen join, checked by shellFacesGood: the volume, or -1 (not built) / -2 (built, refused). */
static double joined(int shape, const std::vector<int>& removed, const std::vector<Wall>& walls, double t, bool outside,
                     GeomAbs_JoinType join, int* faceCount) {
  const TopoDS_Shape copy = BRepBuilderAPI_Copy(*f.find(shape), true, false).Shape();
  FaceMap faces;
  TopExp::MapShapes(copy, TopAbs_FACE, faces);
  std::vector<double> perFace(faces.Extent(), t);
  for (const Wall& w : walls) perFace[w.face] = w.thickness;
  for (int r : removed) perFace[r] = 0;
  BRepOffset_MakeOffset builder;
  const double sign = outside ? 1 : -1;
  try {
    builder.Initialize(copy, sign * t, 1e-3, BRepOffset_Skin, join == GeomAbs_Intersection, false, join, false, false);
    for (int r : removed) builder.AddFace(TopoDS::Face(faces(r + 1)));
    for (const Wall& w : walls) builder.SetOffsetOnFace(TopoDS::Face(faces(w.face + 1)), sign * w.thickness);
    builder.MakeThickSolid();
  } catch (...) {
    return -1;
  }
  if (!builder.IsDone()) return -1;
  TopoDS_Shape result = builder.Shape();
  if (removed.empty()) result = ExtrudoFacade::hollowSolid(copy, result, outside);
  *faceCount = 0;
  for (TopExp_Explorer it(result, TopAbs_FACE); it.More(); it.Next()) ++*faceCount;
  if (!ExtrudoFacade::shellFacesGood(builder, copy, faces, removed, perFace, 1.0, result, outside)) return -2;
  return ExtrudoFacade::exactVolume(result);
}

static void joins(const char* name, int shape, const std::vector<int>& removed, const std::vector<Wall>& walls, double t,
                  bool outside, double exact) {
  int na = 0, ni = 0;
  const double a = joined(shape, removed, walls, t, outside, GeomAbs_Arc, &na);
  const double i = joined(shape, removed, walls, t, outside, GeomAbs_Intersection, &ni);
  std::printf("| %-48s | arc %10.3f (%2d) | intersection %10.3f (%2d) | exact %10.3f\n", name, a, na, i, ni, exact);
}

static bool probe = false;

static int table() {
  const int box = body("box");
  const int top = faceAt(box, 10, 10, 20);
  const int floor = faceAt(box, 10, 10, 0);
  const int front = faceAt(box, 10, 0, 10);
  std::printf("| case | volume | exact | rel. error | faces | time |\n|---|---|---|---|---|---|\n");
  row("box, top removed, 2 mm (no walls)", box, {top}, {}, 2, false, 8000 - 16 * 16 * 18);
  row("box, top removed, 2 mm, floor 4 mm", box, {top}, {{floor, 4}}, 2, false, 8000 - 16 * 16 * 16);
  row("box, top removed, outside 2 mm, floor 4 mm", box, {top}, {{floor, 4}}, 2, true, 24 * 24 * 24 - 8000);
  row("box, top removed, outside 2 mm, floor 2 mm (sharp)", box, {top}, {{floor, 2}}, 2, true, 24 * 24 * 22 - 8000);
  row("box, top removed, floor 4, front 3", box, {top}, {{floor, 4}, {front, 3}}, 2, false, 8000 - 16 * 15 * 16);
  row("box, top removed, 2 mm, floor 1 mm", box, {top}, {{floor, 1}}, 2, false, 8000 - 16 * 16 * 19);
  row("box, closed, 2 mm, top 4 mm", box, {}, {{top, 4}}, 2, false, 8000 - 16 * 16 * 14);
  row("box, closed, outside 2 mm, top 4 mm", box, {}, {{top, 4}}, 2, true, 24 * 24 * 26 - 8000);
  const int cyl = body("cyl");
  const int cylTop = faceAt(cyl, 0, 0, 20);
  const int cylFloor = faceAt(cyl, 0, 0, 0);
  row("cylinder r10, top removed, 2 mm, floor 5 mm", cyl, {cylTop}, {{cylFloor, 5}}, 2, false, PI * (2000 - 64 * 15));
  row("cylinder r10, closed, 2 mm, both ends 4 mm", cyl, {}, {{cylTop, 4}, {cylFloor, 4}}, 2, false,
      PI * (2000 - 64 * 12));
  const int cylWall = faceAt(cyl, 0, 0, 10) == cylTop ? -1 : -1;
  (void)cylWall;
  {
    // The wall is the face that isn't top or floor.
    int wall = -1;
    for (int i = 0; i < 3; ++i) {
      if (i != cylTop && i != cylFloor) wall = i;
    }
    row("cylinder r10, top removed, wall 3, floor 2", cyl, {cylTop}, {{wall, 3}}, 2, false, PI * (2000 - 49 * 18));
    row("cylinder r10, top removed, outside 2, floor 5", cyl, {cylTop}, {{cylFloor, 5}}, 2, true, PI * (144 * 25 - 2000));
  }
  const int vert = body("vert3");
  const double outer = (400 - 36 + 9 * PI) * 20;
  {
    const int vTop = faceAt(vert, 10, 10, 20);
    const int vFloor = faceAt(vert, 10, 10, 0);
    const int vFront = faceAt(vert, 10, 0, 10);
    row("vertical edges r3, top removed, 2, floor 4", vert, {vTop}, {{vFloor, 4}}, 2, false,
        outer - (256 - 4 + PI) * 16);
    row("vertical edges r3, top removed, 2, sides 2.5", vert, {vTop}, {{vFront, 2.5}}, 2, false,
        outer - (225 - 4 * 0.25 * (1 - PI / 4)) * 18);
    row("vertical edges r3, top removed, outside 2, floor 4", vert, {vTop}, {{vFloor, 4}}, 2, true,
        (576 - 25 * (4 - PI)) * 24 - outer);
    refusal("vertical edges r3, two sides 2.5 and 3", vert, {vTop}, {{vFront, 2.5}, {faceAt(vert, 0, 10, 10), 3}}, 2, 10);
  }
  {
    const auto rounded = [](double a, double r) {
      return std::pow(a - 2 * r, 3) + 6 * (a - 2 * r) * (a - 2 * r) * r + 3 * PI * r * r * (a - 2 * r) + 4.0 / 3 * PI * r * r * r;
    };
    const int round = body("round3");
    row("all edges r3, closed, 2, top 2.5 (its chain: all)", round, {}, {{faceAt(round, 10, 10, 20), 2.5}}, 2, false,
        rounded(20, 3) - rounded(15, 0.5));
  }
  {
    const int a = f.makeBox(0, 0, 0, 40, 20, 10);
    const int b = f.makeBox(0, 0, 0, 10, 20, 40);
    const int l = f.boolean(0, a, b, true);
    row("L, end removed, 2, step 4", l, {faceAt(l, 5, 10, 40)}, {{faceAt(l, 25, 10, 10), 4}}, 2, false,
        40 * 20 * 10 + 10 * 20 * 30 - (6 * 38 + 30 * 4) * 16);
    row("L, end removed, 2 (sharp inner corner)", l, {faceAt(l, 5, 10, 40)}, {{faceAt(l, 25, 10, 10), 2}}, 2, false,
        40 * 20 * 10 + 10 * 20 * 30 - (6 * 38 + 30 * 6) * 16);
  }
  // Openings at faces that run smoothly into their neighbours: plugs (shell() and shellFaces()).
  {
    const auto rounded = [](double a, double r) {
      return std::pow(a - 2 * r, 3) + 6 * (a - 2 * r) * (a - 2 * r) * r + 3 * PI * r * r * (a - 2 * r) + 4.0 / 3 * PI * r * r * r;
    };
    const int round = body("round3");
    const int rTop = faceAt(round, 10, 10, 20);
    for (double t : {0.5, 2.0, 2.9}) {
      char name[64];
      std::snprintf(name, sizeof name, "all edges r3, top removed, %g (plug)", t);
      row(name, round, {rTop}, {}, t, false, rounded(20, 3) - rounded(20 - 2 * t, 3 - t) - 14 * 14 * t);
    }
    row("all edges r3, top removed, outside 2 (plug)", round, {rTop}, {}, 2, true,
        rounded(24, 5) - rounded(20, 3) - 14 * 14 * 2);
    {
      // Plain shell() through the plug route.
      f.clearArgs();
      f.pushArg(rTop);
      const int r = f.shell(round, 2, false);
      const double exact = rounded(20, 3) - rounded(16, 1) - 14 * 14 * 2;
      std::printf("| %-44s | %10.3f | %10.3f | %s\n", "shell(): all edges r3, top removed, 2", r ? volume(r) : -1.0, exact,
                  r && std::abs(volume(r) - exact) < 1e-6 * exact ? "ok" : "FAIL");
      if (!(r && std::abs(volume(r) - exact) < 1e-6 * exact)) ++failures;
    }
    const int one = body("one3");
    const int oTop = faceAt(one, 10, 11.5, 20);
    const int oFloor = faceAt(one, 10, 10, 0);
    const double outerOne = 8000 - 20 * 9 * (1 - PI / 4);
    {
      const int v = body("vert3");
      row("vertical edges r3, side x = 0 removed, 2 (plug)", v, {faceAt(v, 0, 10, 10)}, {}, 2, false,
          (400 - 36 + 9 * PI) * 20 - (256 - 4 + PI) * 16 - 14 * 16 * 2);
    }
    row("one top edge r3, top removed, 1 (plug)", one, {oTop}, {}, 1, false,
        outerOne - (18 * 18 * 18 - 18 * 4 * (1 - PI / 4)) - 18 * 16 * 1);
    row("one top edge r3, top removed, 1, floor 4 (plug)", one, {oTop}, {{oFloor, 4}}, 1, false,
        outerOne - (18 * 18 * 15 - 18 * 4 * (1 - PI / 4)) - 18 * 16 * 1);
    refusal("one top edge r3, top and back removed (they touch)", one, {oTop, faceAt(one, 10, 20, 10)}, {}, 1, 6);
    const int cylr = body("cylr2");
    int cylrTop = -1;
    {
      FaceMap fs = facesOf(cylr);
      for (int i = 1; i <= fs.Extent(); ++i) {
        if (BRepAdaptor_Surface(TopoDS::Face(fs(i))).GetType() == GeomAbs_Plane && centreOf(fs(i)).Z() > 19) cylrTop = i - 1;
      }
    }
    // A cylinder r10 h20 with its top edge rounded r2, the top (r8) removed, 1 mm walls.
    // Pappus: the rounded corner's cross-section r²(1 − π/4) at r(10 − 3π)/(3(4 − π)) from the corner.
    const auto ring = [](double radius, double r) {
      const double c = r * (10 - 3 * PI) / (3 * (4 - PI));
      return 2 * PI * (radius - c) * r * r * (1 - PI / 4);
    };
    row("cylinder, top edge r2, top removed, 1 (plug)", cylr, {cylrTop}, {}, 1, false,
        (PI * 100 * 20 - ring(10, 2)) - (PI * 81 * 18 - ring(9, 1)) - PI * 64 * 1);
  }
  // A thickness too large: the floor deeper than the box.
  row("box, top removed, 2 mm, floor 25 mm (too thick)", box, {top}, {{floor, 25}}, 2, false, 0);
  refusal("a wall that is the removed face", box, {top}, {{top, 4}}, 2, 8);
  refusal("a face with two thicknesses", box, {top}, {{floor, 4}, {floor, 3}}, 2, 9);
  refusal("top edges rounded (sharp edge in a chain)", body("top3"), {faceAt(body("top3"), 10, 10, 0)},
          {{faceAt(body("top3"), 10, 0, 10), 3}}, 2, 7);
  {
    // A curved face that runs into its neighbours still can't be opened.
    const int round = body("round3");
    refusal("all edges r3, a rounded edge's face removed", round, {1}, {}, 2, 6);
  }
  if (probe) {
    {
      const int round = body("round3");
      const TopoDS_Shape copy = BRepBuilderAPI_Copy(*f.find(round), true, false).Shape();
      FaceMap fs;
      TopExp::MapShapes(copy, TopAbs_FACE, fs);
      {
        BRepOffset_MakeOffset thick;
        thick.Initialize(copy, 2, 1e-3, BRepOffset_Skin, false, false, GeomAbs_Arc, false, false);
        thick.MakeOffsetShape();
        const TopoDS_Shape skin = thick.Shape();
        const TopoDS_Shape hollow = ExtrudoFacade::hollowSolid(copy, skin, true);
        std::printf("dbg outside: skin type %d, hollow valid %d vol %.3f\n", skin.ShapeType(), BRepCheck_Analyzer(hollow).IsValid(), ExtrudoFacade::exactVolume(hollow));
        const TopoDS_Face face = TopoDS::Face(fs(11));
        gp_Dir n = BRepAdaptor_Surface(face).Plane().Axis().Direction();
        if (face.Orientation() == TopAbs_REVERSED) n.Reverse();
        std::printf("dbg n %.2f %.2f %.2f\n", n.X(), n.Y(), n.Z());
        const TopoDS_Shape base = ExtrudoFacade::shifted(face, 0, 0, -1);
        BRepPrimAPI_MakePrism prism(base, gp_Vec(n) * 4, false, true);
        std::printf("dbg prism done %d vol %.3f\n", prism.IsDone(), ExtrudoFacade::exactVolume(prism.Shape()));
        BRepAlgoAPI_Common plug(prism.Shape(), ExtrudoFacade::shifted(copy, 0, 0, 4));
        std::printf("dbg plug done %d solid %d vol %.3f errors %d\n", plug.IsDone(), TopExp_Explorer(plug.Shape(), TopAbs_SOLID).More() ? 1 : 0, ExtrudoFacade::exactVolume(plug.Shape()), plug.HasErrors());
        BRepAlgoAPI_Cut cut(hollow, plug.Shape());
        std::printf("dbg cut done %d errors %d type %d vol %.3f\n", cut.IsDone(), cut.HasErrors(), cut.Shape().ShapeType(), ExtrudoFacade::exactVolume(cut.Shape()));
        int solids = 0;
        for (TopExp_Explorer it(cut.Shape(), TopAbs_SOLID); it.More(); it.Next()) ++solids;
        std::printf("dbg solids %d\n", solids);
      }
      for (bool sharp : {false, true}) {
        for (bool outside : {false, true}) {
          BRepOffset_MakeOffset thick;
          BRepAlgoAPI_Cut cut;
          TopoDS_Shape result;
          std::vector<TopoDS_Shape> plugs;
          std::vector<double> perFace(fs.Extent(), 2.0);
          const bool built = ExtrudoFacade::buildPlugged(thick, cut, copy, fs, {10}, perFace, 2, 1, outside, sharp, result, plugs);
          const bool good = built && ExtrudoFacade::shellFacesGood(thick, copy, fs, {10}, perFace, 1, result, outside);
          std::printf("plug sharp %d outside %d: built %d (offset done %d, error %d), good %d, valid %d, volume %.3f\n", sharp, outside, built,
                      thick.IsDone(), static_cast<int>(thick.Error()), good, built ? BRepCheck_Analyzer(result).IsValid() : 0,
                      built ? ExtrudoFacade::exactVolume(result) : 0.0);
        }
      }
    }
    joins("box top removed in 2, floor 4", box, {top}, {{floor, 4}}, 2, false, 3904);
    joins("box top removed out 2, floor 4", box, {top}, {{floor, 4}}, 2, true, 24 * 24 * 24 - 8000);
    joins("box top removed out 2 (no walls)", box, {top}, {}, 2, true, 24 * 24 * 22 - 8000);
    joins("box closed out 2, top 4", box, {}, {{top, 4}}, 2, true, 24 * 24 * 26 - 8000);
    joins("cylinder top removed in 2, floor 5", cyl, {cylTop}, {{cylFloor, 5}}, 2, false, PI * (2000 - 64 * 15));
    joins("cylinder top removed out 2, floor 5", cyl, {cylTop}, {{cylFloor, 5}}, 2, true, PI * (144 * 25 - 2000));
    {
      const int v = body("vert3");
      joins("vert3 top removed in 2, floor 4", v, {faceAt(v, 10, 10, 20)}, {{faceAt(v, 10, 10, 0), 4}}, 2, false, 3763.221);
      joins("vert3 top removed out 2, floor 4", v, {faceAt(v, 10, 10, 20)}, {{faceAt(v, 10, 10, 0), 4}}, 2, true, 0);
    }
    {
      const int a = f.makeBox(0, 0, 0, 40, 20, 10);
      const int b = f.makeBox(0, 0, 0, 10, 20, 40);
      const int l = f.boolean(0, a, b, true);
      const int lTop = faceAt(l, 5, 10, 40);
      const int lStep = faceAt(l, 25, 10, 10);
      // Inside 2, the step 4: cavity = tall leg x[2,8] z[2,40] + foot x[8,38] z[2,6], y [2,18].
      joins("L end removed in 2, step 4", l, {lTop}, {{lStep, 4}}, 2, false, 40 * 20 * 10 + 10 * 20 * 30 - (6 * 38 + 30 * 4) * 16);
      joins("L end removed in 2 (no walls)", l, {lTop}, {}, 2, false, 40 * 20 * 10 + 10 * 20 * 30 - (6 * 38 + 30 * 6) * 16);
    }
    f.clearArgs();
    f.pushArg(top);
    const int plain = f.shell(box, 2, true);
    std::printf("shell() outside 2: %.3f, %d faces\n", plain ? volume(plain) : -1.0, plain ? facesOf(plain).Extent() : 0);
    for (double fl : {2.0, 2.5, 3.0, 4.0}) {
      const int r = shellFaces(box, {top}, {{floor, fl}}, 2, true);
      std::printf("shellFaces outside 2, floor %g: %.3f, %d faces\n", fl, r ? volume(r) : -1.0, r ? facesOf(r).Extent() : 0);
      Bnd_Box b;
      if (r) BRepBndLib::Add(*f.find(r), b);
      double x0, y0, z0, x1, y1, z1;
      if (r) { b.Get(x0, y0, z0, x1, y1, z1); std::printf("   box %.2f %.2f %.2f .. %.2f %.2f %.2f\n", x0, y0, z0, x1, y1, z1); }
    }
  }
  std::printf("live shapes: %d, failures: %d\n", f.liveShapes(), failures);
  return failures == 0 ? 0 : 1;
}

/** One shell of `name` with face `face` removed at thickness t; prints the outcome. */
static int trap(const std::string& name, int face, double t, bool raw) {
  const int shape = body(name);
  if (shape == 0) {
    std::printf("%s: no body\n", name.c_str());
    return 2;
  }
  if (!raw) {
    f.clearArgs();
    f.pushArg(face);
    const int result = f.shell(shape, t, false);
    std::printf("%s face %d t %g facade: %s [%g, %g] volume %.3f\n", name.c_str(), face, t,
                result ? "ok" : f.lastError_.c_str(), f.geometry_.size() ? f.geometry_[0] : -1,
                f.geometry_.size() > 1 ? f.geometry_[1] : -1, result ? volume(result) : 0.0);
    return 0;
  }
  const TopoDS_Shape copy = BRepBuilderAPI_Copy(*f.find(shape), true, false).Shape();
  FaceMap faces;
  TopExp::MapShapes(copy, TopAbs_FACE, faces);
  NCollection_List<TopoDS_Shape> closing;
  closing.Append(faces(face + 1));
  BRepOffsetAPI_MakeThickSolid builder;
  std::fflush(stdout);
  try {
    builder.MakeThickSolidByJoin(copy, closing, -t, 1e-3);
  } catch (const Standard_Failure& e) {
    std::printf("%s face %d t %g raw: exception %s\n", name.c_str(), face, t, e.what());
    return 0;
  }
  if (!builder.IsDone()) {
    std::printf("%s face %d t %g raw: not done (error %d)\n", name.c_str(), face, t,
                static_cast<int>(builder.MakeOffset().Error()));
    return 0;
  }
  const TopoDS_Shape& result = builder.Shape();
  const bool valid = BRepCheck_Analyzer(result).IsValid();
  std::printf("%s face %d t %g raw: done, valid %d, volume %.3f\n", name.c_str(), face, t, valid,
              ExtrudoFacade::exactVolume(result));
  return 0;
}

/**
 * shell() without its refusal of tangent faces: a build, its check and, when
 * it fails, the bisection's seven probes, as a preview would run them.
 */
static void unguarded(const std::string& name, int face, double t) {
  const int shape = body(name);
  const TopoDS_Shape& input = *f.find(shape);
  const std::vector<int> removed{face};
  const TopoDS_Shape copy = BRepBuilderAPI_Copy(input, true, false).Shape();
  FaceMap faces;
  TopExp::MapShapes(copy, TopAbs_FACE, faces);
  bool good = false;
  {
    BRepOffsetAPI_MakeThickSolid builder;
    TopoDS_Shape result;
    good = ExtrudoFacade::buildShell(builder, copy, faces, removed, t, false, result) &&
           ExtrudoFacade::shellIsGood(builder, copy, faces, removed, result, t, false);
  }
  double largest = -1;
  if (!good) {
    largest = ExtrudoFacade::largestThatWorks(
        [&](double x) { return ExtrudoFacade::shellWorks(input, removed, x, false); }, t);
  }
  std::printf("%s face %d t %g unguarded: %s (largest %g)\n", name.c_str(), face, t, good ? "good" : "refused", largest);
  f.release(shape);
}

/**
 * The other route for a face that runs smoothly into its neighbours: hollow
 * the body closed (no face removed, which OCCT builds on rounded bodies),
 * then cut the opening as the flat face swept into the wall. Prints the
 * volume against `exact` (0: not known).
 */
static void plug(const std::string& name, int face, double t, double exact) {
  const int shape = body(name);
  f.clearArgs();
  const int closed = f.shell(shape, t, false);
  if (closed == 0) {
    std::printf("%s face %d t %g plug: closed shell failed: %s\n", name.c_str(), face, t, f.lastError_.c_str());
    return;
  }
  FaceMap faces = facesOf(shape);
  const TopoDS_Face picked = TopoDS::Face(faces(face + 1));
  BRepAdaptor_Surface surface(picked);
  if (surface.GetType() != GeomAbs_Plane) {
    std::printf("%s face %d plug: not flat\n", name.c_str(), face);
    return;
  }
  gp_Dir n = surface.Plane().Axis().Direction();
  if (picked.Orientation() == TopAbs_REVERSED) n.Reverse();
  const int cutter = f.store(picked);
  // From 0.5 mm outside the face to 0.5 mm past the wall's inner side.
  const double over = 0.5;
  const int prism = f.prism(cutter, n.X() * over, n.Y() * over, n.Z() * over, -n.X() * (t + 2 * over),
                            -n.Y() * (t + 2 * over), -n.Z() * (t + 2 * over), 0);
  const auto start = std::chrono::steady_clock::now();
  const int cut = prism ? f.boolean(1, closed, prism, true) : 0;
  const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
  if (cut == 0) {
    std::printf("%s face %d t %g plug: cut failed: %s\n", name.c_str(), face, t, f.lastError_.c_str());
    return;
  }
  const double v = volume(cut);
  std::printf("%s face %d t %g plug: valid %d, volume %.3f (exact %.3f, %.1e), %d faces, %.0f ms\n", name.c_str(),
              face, t, BRepCheck_Analyzer(*f.find(cut)).IsValid(), v, exact,
              exact > 0 ? std::abs(v - exact) / exact : 0.0, facesOf(cut).Extent(), ms);
}

/** Many raw shells in one process (as a preview session would run them): body:face:t triples. */
static int sequence(int argc, char** argv) {
  for (int i = 2; i < argc; ++i) {
    std::string spec = argv[i];
    const size_t a = spec.find(':');
    const size_t b = spec.find(':', a + 1);
    std::printf("[%d] ", i - 1);
    const std::string name = spec.substr(0, a);
    const int face = std::atoi(spec.substr(a + 1, b - a - 1).c_str());
    const double t = std::atof(spec.substr(b + 1).c_str());
    if (std::strcmp(argv[1], "useq") == 0) unguarded(name, face, t);
    else trap(name, face, t, true);
    std::fflush(stdout);
  }
  return 0;
}

int main(int argc, char** argv) {
  if (argc >= 2 && std::strcmp(argv[1], "plug") == 0) {
    const auto rounded = [](double a, double r) {
      return std::pow(a - 2 * r, 3) + 6 * (a - 2 * r) * (a - 2 * r) * r + 3 * PI * r * r * (a - 2 * r) +
             4.0 / 3 * PI * r * r * r;
    };
    for (double t : {0.5, 1.0, 2.0, 2.9}) {
      // round3's top (face 10): the outer rounded box less the inner one less the plug.
      plug("round3", 10, t, rounded(20, 3) - rounded(20 - 2 * t, 3 - t) - (14 * 14 * t));
      plug("round3", 8, t, rounded(20, 3) - rounded(20 - 2 * t, 3 - t) - (14 * 14 * t));
      plug("round3", 0, t, rounded(20, 3) - rounded(20 - 2 * t, 3 - t) - (14 * 14 * t));
    }
    for (double t : {1.0, 2.0, 4.0}) plug("round5", 10, t, rounded(20, 5) - rounded(20 - 2 * t, 5 - t) - 100 * t);
    for (double t : {1.0, 2.0}) {
      plug("one3", 4, t, 0);
      plug("cylr2", 3, t, 0);
      plug("vert3", 0, t, 0);
    }
    return 0;
  }
  if (argc >= 2 && (std::strcmp(argv[1], "seq") == 0 || std::strcmp(argv[1], "useq") == 0)) return sequence(argc, argv);
  if (argc >= 5 && std::strcmp(argv[1], "trap") == 0) {
    return trap(argv[2], std::atoi(argv[3]), std::atof(argv[4]), argc >= 6 && std::strcmp(argv[5], "raw") == 0);
  }
  if (argc >= 3 && std::strcmp(argv[1], "faces") == 0) {
    const int shape = body(argv[2]);
    FaceMap faces = facesOf(shape);
    for (int i = 1; i <= faces.Extent(); ++i) {
      const gp_Pnt c = centreOf(faces(i));
      std::printf("%d %s %.2f %.2f %.2f tangent=%d\n", i - 1,
                  BRepAdaptor_Surface(TopoDS::Face(faces(i))).GetType() == GeomAbs_Plane ? "plane" : "curved", c.X(),
                  c.Y(), c.Z(), ExtrudoFacade::touchesTangentFace(*f.find(shape), TopoDS::Face(faces(i))));
    }
    return 0;
  }
  probe = argc >= 2 && std::strcmp(argv[1], "probe") == 0;
  return table();
}
