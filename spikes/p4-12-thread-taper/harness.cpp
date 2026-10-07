// Native harness for tapered threads (P4-12, ADR-0056's third amendment):
// the facade's helixWire on a cone, threadFace on a cone, threadSweep with a
// taper, an NPT 1/2 thread cut into a cone, and a leak loop. Builds in the
// pinned opencascade.js image; see run.sh next to it.
#define private public
#ifdef OLD
#include "build/old_facade.cpp"
#define SWEEP(f, profile, pitch, turns, left, taper) (f).threadSweep(profile, 0, 0, 0, 0, 0, 1, pitch, turns, left)
#else
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#define SWEEP(f, profile, pitch, turns, left, taper) \
  (f).threadSweep(profile, 0, 0, 0, 0, 0, 1, pitch, turns, left, taper)
#endif
#undef private

#include <BRepBuilderAPI_MakePolygon.hxx>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>

static double now() {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

// A polygon face in the XZ half-plane (x = radius, z = height).
static int polygon(ExtrudoFacade& f, const std::vector<std::pair<double, double>>& pts) {
  BRepBuilderAPI_MakePolygon poly;
  for (auto& p : pts) poly.Add(gp_Pnt(p.first, 0, p.second));
  poly.Close();
  BRepBuilderAPI_MakeFace face(poly.Wire(), true);
  return f.store(face.Face());
}

static double volume(ExtrudoFacade& f, int h) {
  GProp_GProps p;
  BRepGProp::VolumeProperties(*f.find(h), p);
  return p.Mass();
}

static int faces(ExtrudoFacade& f, int h) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> m;
  TopExp::MapShapes(*f.find(h), TopAbs_FACE, m);
  return m.Extent();
}

static bool valid(ExtrudoFacade& f, int h) { return BRepCheck_Analyzer(*f.find(h)).IsValid(); }

// The ISO 68-1 tooth of an external thread whose crest radius at height z is
// crest0 + z·tan(taper), one tooth centred at z0 (the kernel's toothSection).
static std::vector<std::pair<double, double>> tooth(double crest0, double P, double taper, double z0) {
  const double depth = 5 * std::sqrt(3.0) * P / 16;
  const double crest = crest0 + z0 * std::tan(taper);
  const double crestHalf = P / 16, kink = depth + 0.05 * P, foot = depth + 0.25 * P;
  const double half = crestHalf + kink * std::tan(M_PI / 6);
  return {{crest - kink, z0 - half}, {crest, z0 - crestHalf}, {crest, z0 + crestHalf},
          {crest - kink, z0 + half}, {crest - foot, z0 + half}, {crest - foot, z0 - half}};
}

struct Cut {
  int result = 0;
  double removed = 0;
  bool ok = false;
};

// An external thread of pitch P over [0, length] on a shaft whose radius at
// z = 0 is r0, growing by tan(taper) per mm: ring − tooth, then body − tool.
static Cut thread(ExtrudoFacade& f, double r0, double P, double taper, double length, double tolerance) {
  const double t = std::tan(taper);
  const double depth = 5 * std::sqrt(3.0) * P / 16;
  const double crest0 = r0 - tolerance, root0 = r0 - depth - tolerance;
  const double reach = 0.1 * P + 0.05;
  int body = f.revolve(polygon(f, {{0, 0}, {r0, 0}, {r0 + t * length, length}, {0, length}}), 0, 0, 0, 0, 0, 1,
                       2 * M_PI);
  int ring = f.revolve(polygon(f, {{root0, 0},
                                   {r0 + reach, 0},
                                   {r0 + reach + t * length, length},
                                   {root0 + t * length, length}}),
                       0, 0, 0, 0, 0, 1, 2 * M_PI);
  int th = SWEEP(f, polygon(f, tooth(crest0, P, taper, -P)), P, length / P + 2, false, taper);
  Cut out;
  if (th == 0 || ring == 0 || body == 0) {
    std::printf("  FAILED %s\n", f.lastError_.c_str());
    return out;
  }
  int tool = f.boolean(1, ring, th, true);
  if (tool == 0) {
    std::printf("  tool FAILED %s\n", f.lastError_.c_str());
    return out;
  }
  out.result = f.boolean(1, body, tool, true);
  if (out.result == 0) {
    std::printf("  cut FAILED %s\n", f.lastError_.c_str());
    return out;
  }
  out.removed = volume(f, body) - volume(f, out.result);
  out.ok = valid(f, out.result);
  return out;
}

static const double NPT_TAPER = std::atan(1.0 / 32);
static const double NPT_HALF_P = 25.4 / 14;
// NPT 1/2 (ASME B1.20.1): E0 = 0.75843 in at the small end, h = 0.8 p.
static const double NPT_HALF_MAJOR = (0.75843 + 0.8 / 14) * 25.4;

#ifndef OLD
static void helixRadii() {
  std::printf("== helixWire on a cone: r0 10, NPT 1/2 pitch %.4f, taper %.4f deg, 11 turns\n", NPT_HALF_P,
              NPT_TAPER * 180 / M_PI);
  const double r0 = 10;
  TopoDS_Wire wire;
  const int status = ExtrudoFacade::helixWire(gp_Ax3(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1), gp_Dir(1, 0, 0)), r0,
                                              NPT_HALF_P, 11, NPT_TAPER, false, 1e-5, false, wire);
  if (status != 0) {
    std::printf("  helixWire failed: %d\n", status);
    return;
  }
  double vertexErr = 0, heightErr = 0, curveErr = 0;
  int n = 0;
  for (BRepTools_WireExplorer e(wire); e.More(); e.Next(), ++n) {
    const TopoDS_Edge edge = e.Current();
    const gp_Pnt end = BRep_Tool::Pnt(TopExp::LastVertex(edge, true));
    const double expected = r0 + (n + 1) * NPT_HALF_P * std::tan(NPT_TAPER);
    vertexErr = std::max(vertexErr, std::abs(std::hypot(end.X(), end.Y()) - expected));
    heightErr = std::max(heightErr, std::abs(end.Z() - (n + 1) * NPT_HALF_P));
    // The 3D curve against the cone: radius r0 + z·tan(taper) wherever it is.
    double a = 0, b = 0;
    Handle(Geom_Curve) curve = BRep_Tool::Curve(edge, a, b);
    for (int i = 0; i <= 64; ++i) {
      const gp_Pnt p = curve->Value(a + (b - a) * i / 64);
      curveErr = std::max(curveErr, std::abs(std::hypot(p.X(), p.Y()) - (r0 + p.Z() * std::tan(NPT_TAPER))));
    }
  }
  std::printf("  %d edges; turn ends: max |r - (r0 + n·P·tan)| %.3g mm, max |z - n·P| %.3g mm\n", n, vertexErr,
              heightErr);
  std::printf("  3D curves: max |r - (r0 + z·tan)| %.3g mm (the B-spline's tolerance is 1e-5)\n", curveErr);
}

static void coneFaceNumbers() {
  ExtrudoFacade f;
  const double r0 = NPT_HALF_MAJOR / 2, L = 20, t = std::tan(NPT_TAPER);
  std::printf("== threadFace on cones (r0 %.4f, taper %.4f deg, 20 mm)\n", r0, NPT_TAPER * 180 / M_PI);
  auto show = [&](const char* what, int shape) {
    for (int i = 0; i < faces(f, shape); ++i) {
      if (f.threadFace(shape, i) < 0) continue;
      const auto& g = f.geometry_;
      std::printf("  %-22s face %d: axis (%g %g %g) radius %.6f inside %g h %.4f..%.4f whole %g open %g %g taper %.6f deg\n",
                  what, i, g[3], g[4], g[5], g[6], g[7], g[8], g[9], g[10], g[11], g[12], g[13] * 180 / M_PI);
    }
  };
  show("shaft, widening up", f.revolve(polygon(f, {{0, 0}, {r0, 0}, {r0 + t * L, L}, {0, L}}), 0, 0, 0, 0, 0, 1, 2 * M_PI));
  show("shaft, narrowing up", f.revolve(polygon(f, {{0, 0}, {r0 + t * L, 0}, {r0, L}, {0, L}}), 0, 0, 0, 0, 0, 1, 2 * M_PI));
  show("shaft, axis -z", f.revolve(polygon(f, {{0, 0}, {r0, 0}, {r0 + t * L, -L}, {0, -L}}), 0, 0, 0, 0, 0, 1, 2 * M_PI));
  int block = f.makeBox(-20, -20, 0, 40, 40, L);
  int hole = f.revolve(polygon(f, {{0, -1}, {r0 - t, -1}, {r0 + t * (L + 1), L + 1}, {0, L + 1}}), 0, 0, 0, 0, 0, 1, 2 * M_PI);
  show("tapped hole", f.boolean(1, block, hole, true));
  show("cylinder", f.makeCylinder(0, 0, 0, 0, 0, 1, 4, 10));
}

static void npt() {
  ExtrudoFacade f;
  const double r0 = NPT_HALF_MAJOR / 2, L = 20;
  std::printf("== NPT 1/2 on a cone: small-end major %.4f mm, pitch %.4f, 20 mm\n", NPT_HALF_MAJOR, NPT_HALF_P);
  double t0 = now();
  Cut tapered = thread(f, r0, NPT_HALF_P, NPT_TAPER, L, 0.1);
  if (!tapered.result) return;
  std::printf("  tapered: %.0f ms, valid %d, faces %d, removed %.3f mm3\n", now() - t0, tapered.ok,
              faces(f, tapered.result), tapered.removed);
  // Its extent at the two ends: a section's box.
  Bnd_Box box;
  BRepBndLib::AddOptimal(*f.find(tapered.result), box, false, false);
  double x0, y0, z0, x1, y1, z1;
  box.Get(x0, y0, z0, x1, y1, z1);
  std::printf("  box x %.4f..%.4f z %.4f..%.4f (cone: %.4f at z 0, %.4f at z 20)\n", x0, x1, z0, z1, r0,
              r0 + L * std::tan(NPT_TAPER));
  t0 = now();
  const double mean = r0 + L / 2 * std::tan(NPT_TAPER);
  Cut straight = thread(f, mean, NPT_HALF_P, 0, L, 0.1);
  if (!straight.result) return;
  std::printf("  straight at the mean radius %.4f: %.0f ms, valid %d, removed %.3f mm3 -> tapered/straight %.4f\n", mean,
              now() - t0, straight.ok, straight.removed, tapered.removed / straight.removed);
}

static void leaks(int rounds) {
  ExtrudoFacade f;
  const double r0 = NPT_HALF_MAJOR / 2;
  std::printf("== leaks: %d rounds of a tapered sweep and ring − tooth\n", rounds);
  double top50 = 0;
  for (int i = 0; i < rounds; ++i) {
    Cut c = thread(f, r0, NPT_HALF_P, NPT_TAPER, 6, 0.1);
    if (!c.result) return;
    f.releaseAll();
    if (i == 49) top50 = f.heapTop();
    if ((i + 1) % 50 == 0) std::printf("  round %d heap top %.1f MB\n", i + 1, f.heapTop() / 1048576);
  }
  std::printf("  growth after round 50: %.2f MB\n", (f.heapTop() - top50) / 1048576);
}
#endif

// Straight threads, to compare this facade's sweep with main's.
static void compare() {
  ExtrudoFacade f;
  const double cases[][3] = {{4, 1.25, 12}, {1.5, 0.5, 10}, {10, 2.5, 30}, {10, 1.5, 30.7}};
  for (const auto& c : cases) {
    Cut cut = thread(f, c[0], c[1], 0, c[2], 0.1);
    if (!cut.result) continue;
    GProp_GProps area;
    BRepGProp::SurfaceProperties(*f.find(cut.result), area);
    std::printf("  r %g P %g L %g: valid %d faces %d volume %.9f area %.9f\n", c[0], c[1], c[2], cut.ok,
                faces(f, cut.result), volume(f, cut.result), area.Mass());
  }
}

int main(int argc, char** argv) {
  const char* mode = argc > 1 ? argv[1] : "";
  if (std::strcmp(mode, "compare") == 0) {
    compare();
    return 0;
  }
#ifndef OLD
  if (std::strcmp(mode, "leaks") == 0) {
    leaks(argc > 2 ? std::atoi(argv[2]) : 300);
    return 0;
  }
  helixRadii();
  coneFaceNumbers();
  npt();
#endif
  return 0;
}
