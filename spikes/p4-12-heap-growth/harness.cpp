// Native harness for the P4-12 heap-growth item (ADR-0050 §6): the warm-cache
// heap top of ADR-0029's revolve document, reproduced on plain OCCT calls with
// the facade's heapTop() (sbrk(0)) as the probe.
//
// It builds the document's bodies per round the way the evaluator does (a
// block, a revolved groove cut, a revolved ring joined) at the round's angle,
// meshes them as the engine does, and keeps a rolling cache of the last CACHE
// rounds' shapes alive, exactly the memory test's picture. MODE=same meshes one
// built document over and over instead.
//
// Knobs (key=value after the round count):
//   ROUNDS=1200  MODE=fresh|same  CACHE=256  CLEAN=0|1  COPY=0|1  MINIMAL=0|1
//   NOMESH=0|1   (fresh mode: build and evict without meshing)
//   MESHONLY=0|1 (fresh mode: mesh the shapes, but don't build new ones per round)
// Build/run with run.sh; the allocator is chosen by run.sh's MALLOC.
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

#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepTools.hxx>
#include <chrono>
#include <cstdio>
#include <deque>
#include <utility>
#include <vector>

#ifdef MI_ALLOC
#include <mimalloc.h>
#endif

static void miSetup(const char* mode) {
#ifdef MI_ALLOC
  if (mode == nullptr) return;
  const std::string m(mode);
  if (m.find("purge0") != std::string::npos) mi_option_set(mi_option_purge_delay, 0);
  if (m.find("eager") != std::string::npos) mi_option_set(mi_option_arena_eager_commit, 0);
  if (m.find("retain0") != std::string::npos) mi_option_set(mi_option_page_full_retain, 0);
  if (m.find("generic0") != std::string::npos) mi_option_set(mi_option_generic_collect, 0);
#else
  (void)mode;
#endif
}

static void miAfterRound(const char* mode) {
#ifdef MI_ALLOC
  if (mode == nullptr) return;
  const std::string m(mode);
  if (m.find("collect") != std::string::npos) mi_collect(true);
#else
  (void)mode;
#endif
}

static double now_ms() {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

static bool flag(const char* name) { return knob(name) != nullptr && std::atoi(knob(name)) != 0; }

/** A closed polygon face in the XZ half-plane (x = radius, z = height). */
static int polygon(ExtrudoFacade& f, const std::vector<std::pair<double, double>>& pts) {
  BRepBuilderAPI_MakePolygon poly;
  for (auto& p : pts) poly.Add(gp_Pnt(p.first, 0, p.second));
  poly.Close();
  BRepBuilderAPI_MakeFace face(poly.Wire(), true);
  return f.store(face.Face());
}

static int revolve(ExtrudoFacade& f, const std::vector<std::pair<double, double>>& pts, double ax,
                   double az, double angle) {
  const int face = polygon(f, pts);
  const int result = f.revolve(face, ax, 0, az, 0, 0, 1, angle);
  f.release(face);
  return result;
}

struct Phase {
  double build = 0, mesh = 0, release = 0;
  int builds = 0, meshes = 0, releases = 0;
};

/** Builds ADR-0029's bodies at angle `a` (degrees) and appends them to `out`. */
static void buildBodies(ExtrudoFacade& f, double a, std::deque<int>& out, Phase& phase) {
  const double rad = a * M_PI / 180.0;
  const double h0 = f.heapTop();
  // The block: the XY profile 0..40 x 0..30 extruded symmetric 20 mm.
  int body = f.makeBox(0, 0, -10, 40, 30, 20);
  // The groove: a rectangle on XZ revolved about Z, cut out.
  const int groove = revolve(f, {{10, 5}, {18, 5}, {18, 15}, {10, 15}}, 0, 0, rad);
  const int cut = f.boolean(1, body, groove, true);
  f.release(body);
  f.release(groove);
  body = cut;
  // The ring: a rectangle revolved about the line x = 50, joined.
  if (!flag("MINIMAL")) {
    const int ring = revolve(f, {{45, 0}, {48, 0}, {48, 4}, {45, 4}}, 50, -5, rad);
    const int joined = f.boolean(0, body, ring, true);
    f.release(body);
    f.release(ring);
    body = joined;
  }
  out.push_back(body);
  phase.build += f.heapTop() - h0;
  phase.builds++;
}

static void meshBody(ExtrudoFacade& f, int body, Phase& phase) {
  const double h0 = f.heapTop();
  if (flag("COPY")) {
    BRepBuilderAPI_Copy copier(*f.find(body), false, false);
    const int copy = f.store(copier.Shape());
    f.mesh(copy, 0.05, 0.3);
    phase.mesh += f.heapTop() - h0;
    f.release(copy);
  } else {
    f.mesh(body, 0.05, 0.3);
    phase.mesh += f.heapTop() - h0;
  }
  if (flag("CLEAN")) BRepTools::Clean(const_cast<TopoDS_Shape&>(*f.find(body)));
  phase.meshes++;
}

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    const char* eq = std::strchr(argv[i], '=');
    if (eq) knobs[std::string(argv[i], eq - argv[i])] = eq + 1;
  }
  const int rounds = knob("ROUNDS") ? std::atoi(knob("ROUNDS")) : 1200;
  const bool same = knob("MODE") && std::strcmp(knob("MODE"), "same") == 0;
  const bool noMesh = flag("NOMESH");
  const int cache = knob("CACHE") ? std::atoi(knob("CACHE")) : 256;
  ExtrudoFacade f;
  std::deque<int> keep;
  Phase phase;
  miSetup(knob("MI"));
  const double t0 = now_ms();
  double warmTop = 0;
  int warmRound = 0;

  auto report = [&](int i) {
    std::printf("%5d  top %7.2f MB  %5zu shapes  %8.0f ms  (build %+.1f MB/%d  mesh %+.1f MB/%d)\n", i,
                f.heapTop() / 1048576.0, keep.size(), now_ms() - t0, phase.build / 1048576.0,
                phase.builds, phase.mesh / 1048576.0, phase.meshes);
    std::fflush(stdout);
  };

  if (same) {
    buildBodies(f, 60, keep, phase);
    const int body = keep.back();
    report(0);
    for (int i = 1; i <= rounds; ++i) {
      meshBody(f, body, phase);
      if (i % 50 == 0) report(i);
    }
  } else {
    for (int i = 1; i <= rounds; ++i) {
      const size_t before = keep.size();
      buildBodies(f, 60 + (i % 100) * 0.3, keep, phase);
      if (!noMesh) {
        for (size_t k = before; k < keep.size(); ++k) meshBody(f, keep[k], phase);
      }
      if ((int)keep.size() > cache) {
        const int drop = keep.front();
        const double h0 = f.heapTop();
        f.release(drop);
        phase.release += f.heapTop() - h0;
        phase.releases++;
        keep.pop_front();
      }
      miAfterRound(knob("MI"));
      if (warmTop == 0 && (int)keep.size() >= cache) {
        warmTop = f.heapTop();
        warmRound = i;
      }
      if (i % 50 == 0) report(i);
    }
  }
  const double measured = (double)(rounds - warmRound);
  std::printf("done %d rounds in %.0f ms  release %+.1f MB/%d\n", rounds, now_ms() - t0,
              phase.release / 1048576.0, phase.releases);
  if (warmTop > 0) {
    std::printf("WARM round %d top %.2f MB -> round %d top %.2f MB: %+.2f MB over %d rounds (%+.2f MB/1000)\n",
                warmRound, warmTop / 1048576.0, rounds, f.heapTop() / 1048576.0,
                (f.heapTop() - warmTop) / 1048576.0, (int)measured,
                (f.heapTop() - warmTop) / 1048576.0 * 1000.0 / measured);
  }
  return 0;
}
