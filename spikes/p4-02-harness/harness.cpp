// Native harness for the thread facade method (P4-02, ADR-0056). Builds in the
// pinned opencascade.js image; see README.md next to it.
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>
// Tuning knobs from the command line (NAME=value), read by experimental code through getenv.
static std::map<std::string, std::string> knobs;
static const char* knob(const char* name) {
  auto it = knobs.find(name);
  return it == knobs.end() ? nullptr : it->second.c_str();
}
#define getenv knob
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepBuilderAPI_MakePolygon.hxx>
#include <chrono>
#include <cstdio>

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

struct Iso {
  double D, P, t;
  bool internal;
};

// Tooth profile of the material side, one tooth centred at height z0 (see ADR-0056).
static std::vector<std::pair<double, double>> tooth(const Iso& s, double z0) {
  const double H = std::sqrt(3.0) / 2 * s.P;
  const double rMaj = s.D / 2, rMin = s.D / 2 - 5 * H / 8;
  const double tan30 = 1 / std::sqrt(3.0);
  std::vector<std::pair<double, double>> pts;
  if (!s.internal) {
    const double crest = rMaj - s.t, root = rMin - s.t;
    const double wc = s.P / 16;               // half crest
    auto w = [&](double r) { return wc + (crest - r) * tan30; };
    const double kink = root - 0.05 * s.P, base = root - 0.25 * s.P;
    pts = {{base, z0 - w(kink)}, {kink, z0 - w(kink)}, {crest, z0 - wc}, {crest, z0 + wc}, {kink, z0 + w(kink)}, {base, z0 + w(kink)}};
  } else {
    const double crest = rMin + s.t, root = rMaj + s.t;
    const double wc = s.P / 8;  // half of the nut's P/4 crest
    auto w = [&](double r) { return wc + (r - crest) * tan30; };
    const double kink = root + 0.05 * s.P, base = root + 0.25 * s.P;
    pts = {{base, z0 - w(kink)}, {kink, z0 - w(kink)}, {crest, z0 - wc}, {crest, z0 + wc}, {kink, z0 + w(kink)}, {base, z0 + w(kink)}};
  }
  return pts;
}

static void report(ExtrudoFacade& f, const char* what, int h, double t0) {
  double t1 = now();
  if (h == 0) {
    std::printf("%-28s FAILED %s (%.0f ms)\n", what, f.lastError_.c_str(), t1 - t0);
    return;
  }
  f.properties(h);
  std::printf("%-28s ok %.0f ms  vol %.3f faces %d valid %d\n", what, t1 - t0, f.measured(0), f.count(h, 0),
              f.isValid(h));
}

static void run(const Iso& s, double length, bool left) {
  ExtrudoFacade f;
  const double H = std::sqrt(3.0) / 2 * s.P;
  const double rMaj = s.D / 2, rMin = s.D / 2 - 5 * H / 8;
  std::printf("== %s M%.1f x %.2f t=%.2f length %.0f %s\n", s.internal ? "internal" : "external", s.D, s.P, s.t,
              length, left ? "left" : "right");
  double t0 = now();
  // The body: a shaft of the major diameter, or a block with a hole of the minor diameter.
  int body;
  if (!s.internal) {
    body = f.makeCylinder(0, 0, -5, 0, 0, 1, rMaj, length + 10);
  } else {
    int block = f.makeBox(-s.D, -s.D, 0, 2 * s.D, 2 * s.D, length);
    int hole = f.makeCylinder(0, 0, -1, 0, 0, 1, rMin, length + 2);
    body = f.boolean(1, block, hole, true);
  }
  double z0 = 0, z1 = length;
  // The ring the thread is cut in.
  int ringFace = !s.internal ? polygon(f, {{rMin - s.t, z0}, {rMaj + 1, z0}, {rMaj + 1, z1}, {rMin - s.t, z1}})
                             : polygon(f, {{rMin - 0.5, z0}, {rMaj + s.t, z0}, {rMaj + s.t, z1}, {rMin - 0.5, z1}});
  int ring = f.revolve(ringFace, 0, 0, 0, 0, 0, 1, 2 * M_PI);
  report(f, "ring", ring, t0);
  t0 = now();
  int profile = polygon(f, tooth(s, z0 - s.P));
  const double turns = (z1 - z0) / s.P + 2;
  int th = f.threadSweep(profile, 0, 0, 0, 0, 0, 1, s.P, turns, left);
  report(f, "sweep", th, t0);
  if (th == 0) return;
  std::printf("  history records %zu ints\n", f.history_.size());
  t0 = now();
  int tool = f.boolean(1, ring, th, true);
  report(f, "tool = ring - tooth", tool, t0);
  if (tool == 0) return;
  t0 = now();
  int result = f.boolean(1, body, tool, true);
  report(f, "body - tool", result, t0);
  if (result == 0) return;
  t0 = now();
  f.mesh(result, 0.05, 0.3);
  std::printf("%-28s %.0f ms, %d triangles\n", "mesh", now() - t0, f.indicesSize() / 3);
}


// Experiments on where the time goes (external M8 x 1.25 over 12 mm).
static void experiments(int which) {
  ExtrudoFacade f;
  Iso s{8, 1.25, 0.1, false};
  const double H = std::sqrt(3.0) / 2 * s.P;
  const double rMaj = s.D / 2, rMin = s.D / 2 - 5 * H / 8;
  const double length = 12;
  int body = f.makeCylinder(0, 0, -5, 0, 0, 1, rMaj, length + 10);
  double t0 = now();
  if (which == 1) {
    // Tooth wholly inside the ring's height: no end planes cross it.
    int ring = f.revolve(polygon(f, {{rMin - s.t, -5}, {rMaj + 1, -5}, {rMaj + 1, 20}, {rMin - s.t, 20}}), 0, 0, 0, 0, 0, 1, 2 * M_PI);
    int th = f.threadSweep(polygon(f, tooth(s, 0)), 0, 0, 0, 0, 0, 1, s.P, 12 / s.P, false);
    report(f, "E1 sweep", th, t0); t0 = now();
    int tool = f.boolean(1, ring, th, false);
    report(f, "E1 ring - tooth (inside)", tool, t0);
  } else if (which == 2) {
    // Only the end planes: a slab cut from the tooth.
    int th = f.threadSweep(polygon(f, tooth(s, -s.P)), 0, 0, 0, 0, 0, 1, s.P, 12 / s.P + 2, false);
    t0 = now();
    int slab = f.makeCylinder(0, 0, 0, 0, 0, 1, 10, length);
    int trimmed = f.boolean(2, th, slab, false);
    report(f, "E2 tooth common slab", trimmed, t0);
  } else if (which == 3) {
    // Only the root cylinder: tooth common a big cylinder minus the root core.
    int th = f.threadSweep(polygon(f, tooth(s, 0)), 0, 0, 0, 0, 0, 1, s.P, 12 / s.P, false);
    t0 = now();
    int core = f.makeCylinder(0, 0, -5, 0, 0, 1, rMin - s.t, 30);
    int r = f.boolean(1, th, core, false);
    report(f, "E3 tooth - root core", r, t0);
  } else if (which == 4) {
    // E3 with a fuzzy value.
    int th = f.threadSweep(polygon(f, tooth(s, 0)), 0, 0, 0, 0, 0, 1, s.P, 12 / s.P, false);
    t0 = now();
    int core = f.makeCylinder(0, 0, -5, 0, 0, 1, rMin - s.t, 30);
    BRepAlgoAPI_Cut b;
    NCollection_List<TopoDS_Shape> a1, a2;
    a1.Append(*f.find(th));
    a2.Append(*f.find(core));
    b.SetArguments(a1);
    b.SetTools(a2);
    b.SetFuzzyValue(std::atof(getenv("FUZZ") ? getenv("FUZZ") : "1e-5"));
    b.SetRunParallel(false);
    b.Build();
    int r = f.store(b.Shape());
    report(f, "E4 tooth - root core fuzzy", r, t0);
  } else if (which == 7) {
    // threadFace on a shaft, a through hole, a shaft on a flange, a blind hole.
    auto show = [&](const char* what, int shape) {
      const int n = f.count(shape, 0);
      for (int i = 0; i < n; ++i) {
        if (f.threadFace(shape, i) < 0) continue;
        std::printf("%s face %d:", what, i);
        for (double v : f.geometry_) std::printf(" %.3f", v);
        int sub = f.subShape(shape, 0, i);
        f.properties(sub);
        std::printf("  z %.3f..%.3f\n", f.measured(4), f.measured(7));
      }
    };
    show("shaft", f.makeCylinder(0, 0, 0, 0, 0, 1, 4, 10));
    int block = f.makeBox(-10, -10, 0, 20, 20, 10);
    show("through hole", f.boolean(1, block, f.makeCylinder(0, 0, -1, 0, 0, 1, 3, 12), true));
    show("blind hole", f.boolean(1, block, f.makeCylinder(0, 0, 4, 0, 0, 1, 3, 12), true));
    show("flange", f.boolean(0, f.makeCylinder(0, 0, 0, 0, 0, -1, 4, 10), f.makeCylinder(0, 0, 0, 0, 0, 1, 8, 3), true));
    int profile = polygon(f, tooth(s, 0));
    int th = f.threadSweep(profile, 0, 0, 0, 0, 0, 1, s.P, 2.5, false);
    std::printf("sweep history ints %zu:", f.history_.size());
    for (size_t i = 0; i < f.history_.size() && i < 60; ++i) std::printf(" %d", f.history_[i]);
    std::printf("\nfaces %d\n", f.count(th, 0));
  } else if (which == 5 || which == 6) {
    // Where the facade boolean's time goes: build, simplify, history.
    int th = f.threadSweep(polygon(f, tooth(s, which == 5 ? 0 : -s.P)), 0, 0, 0, 0, 0, 1, s.P, 12 / s.P + (which == 5 ? 0 : 2), false);
    int ring = f.revolve(polygon(f, {{rMin - s.t, which == 5 ? -5 : 0}, {rMaj + 1, which == 5 ? -5 : 0}, {rMaj + 1, which == 5 ? 20 : 12}, {rMin - s.t, which == 5 ? 20 : 12}}), 0, 0, 0, 0, 0, 1, 2 * M_PI);
    t0 = now();
    BRepAlgoAPI_Cut b(*f.find(ring), *f.find(th));
    std::printf("build %.0f ms\n", now() - t0); t0 = now();
    b.SimplifyResult();
    std::printf("simplify %.0f ms\n", now() - t0); t0 = now();
    f.history_.clear();
    f.recordHistory(b, *f.find(ring), 0, b.Shape());
    f.recordHistory(b, *f.find(th), 1, b.Shape());
    std::printf("history %.0f ms\n", now() - t0); t0 = now();
    BRepCheck_Analyzer an(b.Shape());
    std::printf("check %.0f ms valid %d\n", now() - t0, an.IsValid());
  }
}

int main(int argc, char** argv) {
  for (int i = 2; i < argc; ++i) {
    const char* eq = std::strchr(argv[i], '=');
    if (eq) knobs[std::string(argv[i], eq - argv[i])] = eq + 1;
  }
  if (argc > 1 && std::atoi(argv[1]) > 0) {
    experiments(std::atoi(argv[1]));
    return 0;
  }
  run({8, 1.25, 0.1, false}, 12, false);
  run({8, 1.25, 0.1, true}, 12, false);
  run({3, 0.5, 0.1, false}, 10, false);
  run({3, 0.5, 0.1, true}, 10, true);
  run({30, 3.5, 0.15, false}, 30, false);
  run({20, 1.5, 0.1, false}, 30, false);
  return 0;
}
