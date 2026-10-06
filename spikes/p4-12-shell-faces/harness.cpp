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
  // A thickness too large: the floor deeper than the box.
  row("box, top removed, 2 mm, floor 25 mm (too thick)", box, {top}, {{floor, 25}}, 2, false, 0);
  refusal("a wall that is the removed face", box, {top}, {{top, 4}}, 2, 8);
  refusal("a face with two thicknesses", box, {top}, {{floor, 4}, {floor, 3}}, 2, 9);
  refusal("top edges rounded (sharp edge in a chain)", body("top3"), {faceAt(body("top3"), 10, 10, 0)},
          {{faceAt(body("top3"), 10, 0, 10), 3}}, 2, 7);
  {
    const int round = body("round3");
    refusal("all edges r3, top removed", round, {faceAt(round, 10, 10, 20)}, {}, 2, 6);
  }
  if (probe) {
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

int main(int argc, char** argv) {
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
