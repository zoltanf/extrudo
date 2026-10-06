// Native harness for extrude "to object" on curved faces and bodies (P4-12,
// ADR-0028's amendment): a long prism split by a face's extended surface
// (boolean op 3, `extendFace`) or cut by a body (op 1), keeping the pieces
// that touch the profile. Built and run inside the pinned OCCT image by
// run.sh; prints a volume table and exits non-zero if a check fails.
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <ElSLib.hxx>
#include <GeomConvert.hxx>
#include <chrono>
#include <cstdio>

static int failures = 0;
static ExtrudoFacade f;

static bool near(double a, double b, double rel) {
  return std::abs(a - b) <= rel * std::max(1.0, std::abs(b));
}

static int rectangle(double x0, double y0, double x1, double y1, double z) {
  BRepBuilderAPI_MakePolygon poly(gp_Pnt(x0, y0, z), gp_Pnt(x1, y0, z), gp_Pnt(x1, y1, z),
                                  gp_Pnt(x0, y1, z), true);
  return f.store(BRepBuilderAPI_MakeFace(poly.Wire(), true).Face());
}


/** The index of the first face of `shape` whose surface has this type. */
static int faceOfType(int shape, GeomAbs_SurfaceType type) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(*f.find(shape), TopAbs_FACE, faces);
  for (int i = 1; i <= faces.Extent(); ++i) {
    if (BRepAdaptor_Surface(TopoDS::Face(faces(i))).GetType() == type) return i - 1;
  }
  return -1;
}

struct Trim {
  double volume = 0;
  int pieces = 0;
  bool reachedEnd = false;
  bool ok = false;
};

/**
 * The prism of `profile` along (0, 0, dir·length), cut back by `target`:
 * a face's extended surface (split) or a body (cut), moved by `offset`
 * along the sweep first.
 */
static Trim trim(int profile, double dir, double length, int target, int faceIndex, double offset) {
  const bool face = faceIndex >= 0;
  Trim out;
  const int sweep = f.prism(profile, 0, 0, 0, 0, 0, dir * length, 0);
  if (sweep == 0) return out;
  int tool = target;
  if (face) tool = f.extendFace(target, faceIndex, 200);
  if (tool == 0) {
    std::printf("  extendFace: %s\n", f.lastError_.c_str());
    return out;
  }
  if (offset != 0) {
    f.clearNumbers();
    for (double v : {1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, dir * offset}) f.pushNumber(v);
    tool = f.transform(tool);
  }
  const int split = f.boolean(face ? 3 : 1, sweep, tool, false);
  if (split == 0) {
    std::printf("  boolean: %s\n", f.lastError_.c_str());
    return out;
  }
  {
    // History of input 1 (the tool): faces of the result it modified or generated.
    int modified = 0, generated = 0;
    const std::vector<int32_t>& h = f.history_;
    for (size_t i = 0; i + 4 < h.size();) {
      const int input = h[i], kind = h[i + 1], relation = h[i + 3];
      const int count = h[i + 4];
      for (int k = 0; k < count; ++k) {
        if (input == 1 && kind == 0 && h[i + 5 + 2 * k] == 0) (relation == 0 ? modified : generated) += 1;
      }
      i += 5 + 2 * count;
    }
    std::printf("  tool face images: %d modified, %d generated\n", modified, generated);
  }
  const TopoDS_Shape& start = *f.find(profile);
  // The far cap: the profile moved to the sweep's end.
  const TopoDS_Shape end = ExtrudoFacade::shifted(start, 0, 0, dir * length);
  for (TopExp_Explorer it(*f.find(split), TopAbs_SOLID); it.More(); it.Next()) {
    BRepExtrema_DistShapeShape touch(it.Current(), start);
    if (!touch.IsDone() || touch.Value() > 1e-6) continue;
    out.volume += ExtrudoFacade::exactVolume(it.Current());
    ++out.pieces;
    BRepExtrema_DistShapeShape far(it.Current(), end);
    if (far.IsDone() && far.Value() <= 1e-6) out.reachedEnd = true;
  }
  out.ok = true;
  return out;
}

static void row(const char* name, const Trim& got, double want, double ms, bool expectMiss = false) {
  const bool ok = got.ok && (expectMiss ? got.reachedEnd : (!got.reachedEnd && near(got.volume, want, 1e-6)));
  std::printf("%s %-44s %12.4f %12.4f %9.2e %3d %5s %7.1f ms\n", ok ? "ok  " : "FAIL", name, got.volume,
              want, want ? std::abs(got.volume - want) / want : 0.0, got.pieces,
              got.reachedEnd ? "end" : "-", ms);
  if (!ok) ++failures;
}

template <typename Fn>
static void timed(const char* name, double want, Fn run, bool miss = false) {
  const auto t0 = std::chrono::steady_clock::now();
  const Trim got = run();
  const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count();
  row(name, got, want, ms, miss);
}

/** ∫ from -a to a of √(R² − y²) dy. */
static double chordIntegral(double a, double r) { return a * std::sqrt(r * r - a * a) + r * r * std::asin(a / r); }

int main() {
  ExtrudoFacade::quietMessages();
  std::printf("     %-44s %12s %12s %9s %3s %5s\n", "case", "volume", "exact", "rel", "pcs", "end");
  const int square = rectangle(-5, -5, 5, 5, 0);
  // A Ø40 cylinder lying along X, its axis at z = 30, above the profile.
  const int above = f.makeCylinder(-50, 0, 30, 1, 0, 0, 20, 100);
  const int aboveWall = faceOfType(above, GeomAbs_Cylinder);
  const double underCylinder = 10 * (10 * 30 - chordIntegral(5, 20));
  timed("cylinder wall from outside (face)", underCylinder, [&] {
    return trim(square, 1, 100, above, aboveWall, 0);
  });
  timed("cylinder from outside (body)", underCylinder, [&] { return trim(square, 1, 100, above, -1, 0); });
  timed("cylinder wall, offset +2 (face)", underCylinder + 200, [&] {
    return trim(square, 1, 100, above, aboveWall, 2);
  });
  timed("cylinder, offset -2 (body)", underCylinder - 200, [&] { return trim(square, 1, 100, above, -1, -2); });
  // The same cylinder about z = 0: the profile is inside it.
  const int around = f.makeCylinder(-50, 0, 0, 1, 0, 0, 20, 100);
  timed("cylinder wall from inside (face)", 10 * chordIntegral(5, 20), [&] {
    return trim(square, 1, 100, around, faceOfType(around, GeomAbs_Cylinder), 0);
  });

  // A Ø40 sphere at (0, 0, 40): numeric integral of 40 − √(400 − x² − y²).
  const int sphere = f.store(BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 40), 20).Shape());
  double underSphere = 0;
  {
    const int n = 2000;
    const double h = 10.0 / n;
    for (int i = 0; i < n; ++i) {
      for (int j = 0; j < n; ++j) {
        const double x = -5 + (i + 0.5) * h, y = -5 + (j + 0.5) * h;
        underSphere += (40 - std::sqrt(400 - x * x - y * y)) * h * h;
      }
    }
  }
  timed("sphere (face)", underSphere, [&] {
    return trim(square, 1, 100, sphere, faceOfType(sphere, GeomAbs_Sphere), 0);
  });
  timed("sphere (body)", underSphere, [&] { return trim(square, 1, 100, sphere, -1, 0); });

  // A 40 mm cube with its edge at x = 40, z = 40 rounded by 10 mm; a 6 × 10
  // profile above the round at z = 60, swept down.
  const int cube = f.makeBox(0, 0, 0, 40, 40, 40);
  int rounded = 0;
  {
    BRepFilletAPI_MakeFillet fillet(*f.find(cube));
    for (TopExp_Explorer it(*f.find(cube), TopAbs_EDGE); it.More(); it.Next()) {
      BRepAdaptor_Curve c(TopoDS::Edge(it.Current()));
      const gp_Pnt m = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
      if (std::abs(m.X() - 40) < 1e-6 && std::abs(m.Z() - 40) < 1e-6) fillet.Add(10, TopoDS::Edge(it.Current()));
    }
    rounded = f.store(fillet.Shape());
  }
  const int high = rectangle(32, 10, 38, 20, 60);
  const auto arc = [](double t) { return t / 2 * std::sqrt(100 - t * t) + 50 * std::asin(t / 10); };
  const double onRound = 10 * (6 * 30 - (arc(8) - arc(2)));
  timed("fillet round (face)", onRound, [&] {
    return trim(high, -1, 100, rounded, faceOfType(rounded, GeomAbs_Cylinder), 0);
  });
  timed("fillet round (body)", onRound, [&] { return trim(high, -1, 100, rounded, -1, 0); });

  // A box body 30 mm above the profile, with offsets.
  const int box = f.makeBox(-20, -20, 30, 40, 40, 20);
  timed("box body", 3000, [&] { return trim(square, 1, 100, box, -1, 0); });
  timed("box body, offset +2", 3200, [&] { return trim(square, 1, 100, box, -1, 2); });
  timed("box body, offset -2", 2800, [&] { return trim(square, 1, 100, box, -1, -2); });

  // Free-form: a B-spline patch of the cylinder above, wide enough (exact)
  // and narrower than the profile (the extension, tangent and C1, decides).
  const auto patch = [&](double halfWidth) {
    const gp_Cylinder cyl = BRepAdaptor_Surface(TopoDS::Face(*f.find(f.subShape(above, 0, aboveWall)))).Cylinder();
    double ua, ub, va, vb;
    const double z = 30 - std::sqrt(400 - halfWidth * halfWidth);
    ElSLib::Parameters(cyl, gp_Pnt(-20, -halfWidth, z), ua, va);
    ElSLib::Parameters(cyl, gp_Pnt(20, halfWidth, z), ub, vb);
    if (ub < ua) std::swap(ua, ub);
    if (ub - ua > M_PI) { const double t = ua; ua = ub; ub = t + 2 * M_PI; }
    Handle(Geom_CylindricalSurface) surface = new Geom_CylindricalSurface(cyl);
    Handle(Geom_RectangularTrimmedSurface) trimmed =
        new Geom_RectangularTrimmedSurface(surface, ua, ub, std::min(va, vb), std::max(va, vb));
    Handle(Geom_BSplineSurface) spline = GeomConvert::SurfaceToBSplineSurface(trimmed);
    return f.store(BRepBuilderAPI_MakeFace(spline, Precision::Confusion()).Face());
  };
  timed("B-spline patch covering the profile (face)", underCylinder, [&] { return trim(square, 1, 100, patch(8), 0, 0); });
  timed("B-spline patch narrower, extended (face)", 0, [&] {
    Trim t = trim(square, 1, 100, patch(3), 0, 0);
    std::printf("  extended: volume %.4f vs the cylinder's %.4f (%.2f %%)\n", t.volume, underCylinder,
                100 * (t.volume - underCylinder) / underCylinder);
    t.volume = 0;
    return t;
  });

  // A cylinder far to the side: the sweep never meets it.
  const int aside = f.makeCylinder(-50, 100, 30, 1, 0, 0, 20, 100);
  timed("miss (body)", 0, [&] { return trim(square, 1, 100, aside, -1, 0); }, true);
  timed("miss (face)", 0, [&] {
    return trim(square, 1, 100, aside, faceOfType(aside, GeomAbs_Cylinder), 0);
  }, true);
  std::printf("%d failure(s), %d live shapes\n", failures, f.liveShapes());
  return failures == 0 ? 0 : 1;
}
