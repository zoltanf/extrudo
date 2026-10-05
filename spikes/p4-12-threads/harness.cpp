// Native harness for the P4-12 thread bisect (ADR-0067 §H2): where the
// modelled thread of benchmark B9's shape stops being safe. Built in the
// pinned opencascade.js image against the facade; see README.md.
//
// One turn count per process, so a WASM trap costs one run:
//   node build/h.cjs <turns> <internal> [D=] [P=] [TOL=] [LEAD=]
// Every step prints before it runs, so a trap names the call that caused it.
#include <cstdlib>
#include <cstring>
#include <map>
#include <string>

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

static double now_ms() {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

static double t_start = now_ms();

static void step(const char* what) {
  std::printf("[%9.0f ms] %s\n", now_ms() - t_start, what);
  std::fflush(stdout);
}

/** A polygon face in the XZ half-plane (x = radius, z = height). */
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

static double major(const Iso& s) { return s.D / 2; }
static double minor(const Iso& s) { return s.D / 2 - 5 * (std::sqrt(3.0) / 2 * s.P) / 8; }

// The evaluator's tooth (thread.ts `toothSection`, the ISO 68-1 radii of core's
// `threadRadii`): a tooth of the material side centred at height z0.
static std::vector<std::pair<double, double>> tooth(const Iso& s, double z0) {
  const double tan30 = 1 / std::sqrt(3.0);
  std::vector<std::pair<double, double>> pts;
  if (!s.internal) {
    const double crest = major(s) - s.t, root = minor(s) - s.t;
    const double wc = s.P / 16;  // crestHalf
    auto w = [&](double r) { return wc + (crest - r) * tan30; };
    const double kink = root - 0.05 * s.P, base = root - 0.25 * s.P;
    pts = {{base, z0 - w(kink)}, {kink, z0 - w(kink)}, {crest, z0 - wc}, {crest, z0 + wc},
           {kink, z0 + w(kink)}, {base, z0 + w(kink)}};
  } else {
    const double crest = minor(s) + s.t, root = major(s) + s.t;
    const double wc = s.P / 8;  // crestHalf
    auto w = [&](double r) { return wc + (r - crest) * tan30; };
    const double kink = root + 0.05 * s.P, base = root + 0.25 * s.P;
    pts = {{base, z0 - w(kink)}, {kink, z0 - w(kink)}, {crest, z0 - wc}, {crest, z0 + wc},
           {kink, z0 + w(kink)}, {base, z0 + w(kink)}};
  }
  return pts;
}

/** `reach(plan)`: how far past the face and the crest the ring reaches. */
static double reach(const Iso& s) { return 0.1 * s.P + 0.05; }

/** `ringSection(plan)`, for a face of radius `radius` over z0..z1. */
static std::vector<std::pair<double, double>> ring(const Iso& s, double radius, double z0, double z1) {
  const double root = s.internal ? major(s) + s.t : minor(s) - s.t;
  const double crest = s.internal ? minor(s) + s.t : major(s) - s.t;
  const double far = s.internal ? std::max(0.0, std::min(radius, crest) - reach(s))
                                : std::max(radius, crest) + reach(s);
  return {{root, z0}, {far, z0}, {far, z1}, {root, z1}};
}

/** `leadSection(plan, end)`: the 45 degree cone region that cuts a tooth back. */
static std::vector<std::pair<double, double>> lead(const Iso& s, double radius, double z0, double z1, int end) {
  const double root = s.internal ? major(s) + s.t : minor(s) - s.t;
  const double crest = s.internal ? minor(s) + s.t : major(s) - s.t;
  const double sg = s.internal ? 1.0 : -1.0;
  const double start = root + sg * 0.1 * s.P;
  const double crestSide = s.internal ? std::max(0.0, crest - reach(s))
                                      : crest + reach(s) + std::max(0.0, radius - crest);
  const double rise = std::abs(start - crestSide);
  const double at = end == 0 ? z0 : z1;
  const double into = end == 0 ? 1.0 : -1.0;
  const double beyond = at - into * 2 * s.P;
  return {{start, beyond}, {start, at}, {crestSide, at + into * rise}, {crestSide, beyond}};
}

static void report(ExtrudoFacade& f, const char* what, int h, double t0) {
  const double t1 = now_ms();
  if (h == 0) {
    std::printf("%-24s FAILED %s (%.0f ms)\n", what, f.lastError_.c_str(), t1 - t0);
    std::fflush(stdout);
    return;
  }
  f.properties(h);
  std::printf("%-24s ok %.0f ms  vol %.3f faces %d valid %d  heap %.0f MB\n", what, t1 - t0, f.measured(0),
              f.count(h, 0), f.isValid(h), f.heapTop() / 1048576.0);
  std::fflush(stdout);
}

static int revolve(ExtrudoFacade& f, const std::vector<std::pair<double, double>>& pts) {
  const int face = polygon(f, pts);
  return f.revolve(face, 0, 0, 0, 0, 0, 1, 2 * M_PI);
}

/**
 * B9's thread at `turns` turns (B9's Thread1 is M30 in the cap's Ø28 wall,
 * Thread2 an M20 shaft on the adapter; D = 20 is the M20 here). Built as the
 * evaluator does: the tooth swept along the helix, cut back by the lead-ins,
 * the ring turned a whole turn, tool = ring - tooth, result = body - tool.
 */
static void run(const Iso& s, double turns, bool withLead) {
  const double t0 = now_ms();
  const double span = turns * s.P;  // the thread's length along the axis
  const double z0 = 0, z1 = span;
  const double faceR = s.internal ? minor(s) : major(s);
  std::printf("== %s M%.1f x %.2f t=%.2f  %.0f turns  %.0f mm  lead %d\n",
              s.internal ? "internal" : "external", s.D, s.P, s.t, turns, span, withLead ? 1 : 0);
  std::fflush(stdout);
  ExtrudoFacade f;

  // The body: a shaft of the major diameter, or a block with a hole of the
  // minor diameter (as spikes/p4-02-harness does).
  double t = now_ms();
  step("body ...");
  int body;
  if (!s.internal) {
    body = f.makeCylinder(0, 0, -5, 0, 0, 1, major(s), span + 10);
  } else {
    const double big = std::max(3 * s.D, 40.0);
    const int block = f.makeBox(-big, -big, -5, big, big, span + 10);
    const int hole = f.makeCylinder(0, 0, -6, 0, 0, 1, minor(s), span + 12);
    body = f.boolean(1, block, hole, true);
  }
  report(f, "body", body, t);

  // The ring the thread is cut in, turned a whole turn.
  t = now_ms();
  const int ringShape = revolve(f, ring(s, faceR, z0, z1));
  report(f, "ring", ringShape, t);

  // The tooth: from a pitch before the thread to a pitch after it, swept in
  // chunks of `chunk` turns and cut out one chunk at a time (CHUNK=0 sweeps
  // the whole thread in one go, as the evaluator used to).
  const double toothTurns = turns + 2;
  const double start = z0 - (s.internal ? 0.5 : 1.0) * s.P;
  const double chunk = knob("CHUNK") ? std::atof(knob("CHUNK")) : 0;
  const double each = chunk > 0 ? chunk : toothTurns;
  int tool = ringShape;
  for (double done = 0; done < toothTurns - 1e-9;) {
    const double n = std::min(each, toothTurns - done);
    const bool first = done < 1e-9;
    const bool last = done + n >= toothTurns - 1e-9;
    t = now_ms();
    step(first ? "threadSweep (first chunk) ..." : "threadSweep (chunk) ...");
    int part = f.threadSweep(polygon(f, tooth(s, start + done * s.P)), 0, 0, 0, 0, 0, 1, s.P, n, false);
    report(f, "threadSweep", part, t);
    if (part == 0) return;
    if (withLead && (first || last)) {
      const int lead0 = first ? revolve(f, lead(s, faceR, z0, z1, 0)) : 0;
      const int lead1 = last ? revolve(f, lead(s, faceR, z0, z1, 1)) : 0;
      const int both = lead1 == 0 ? lead0 : (lead0 == 0 ? lead1 : f.boolean(0, lead0, lead1, true));
      t = now_ms();
      step("chunk - leads ...");
      const int cut = f.boolean(1, part, both, true);
      report(f, "chunk - leads", cut, t);
      if (cut == 0) return;
      f.release(part);
      f.release(both);
      part = cut;
    }
    t = now_ms();
    step("tool = tool - chunk ...");
    std::printf("  heap before the cut %.0f MB\n", f.heapTop() / 1048576.0);
    std::fflush(stdout);
    const int cut = f.boolean(1, tool, part, true);
    report(f, "tool = tool - chunk", cut, t);
    if (cut == 0) return;
    f.release(part);
    tool = cut;
    done += n;
  }
  std::printf("  history records %zu ints\n", f.history_.size());
  t = now_ms();
  step("body - tool ...");
  const int result = f.boolean(1, body, tool, true);
  report(f, "body - tool", result, t);
  if (result == 0) return;
  t = now_ms();
  step("mesh ...");
  f.mesh(result, 0.05, 0.3);
  std::printf("%-24s %.0f ms, %d triangles\n", "mesh", now_ms() - t, f.indicesSize() / 3);
  std::printf("done in %.0f ms\n", now_ms() - t0);
  std::fflush(stdout);
}

int main(int argc, char** argv) {
  for (int i = 2; i < argc; ++i) {
    const char* eq = std::strchr(argv[i], '=');
    if (eq) knobs[std::string(argv[i], eq - argv[i])] = eq + 1;
  }
  const double turns = argc > 1 ? std::atof(argv[1]) : 150;
  const bool internal = argc > 2 ? std::atoi(argv[2]) != 0 : true;
  const Iso s{knob("D") ? std::atof(knob("D")) : 20, knob("P") ? std::atof(knob("P")) : 2.5,
               knob("TOL") ? std::atof(knob("TOL")) : 0.1, internal};
  run(s, turns, knob("LEAD") ? std::atoi(knob("LEAD")) != 0 : true);
  return 0;
}