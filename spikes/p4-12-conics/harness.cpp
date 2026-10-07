// Native harness for P4-12's exact conics in the kernel (ADR-0063's
// amendment). Built and run inside the pinned OCCT image by run.sh; prints one
// line per check and exits non-zero if any fails. `run.sh leaks [rounds]`
// stages, profiles, extrudes and releases conics `rounds` times and compares
// the heap top after a third of them with the end.
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

static int failures = 0;
static ExtrudoFacade f;

static void check(bool ok, const char* what, double got = 0, double want = 0) {
  std::printf("%s %-46s got %.12f want %.12f rel %.2e\n", ok ? "ok  " : "FAIL", what, got, want,
              want != 0 ? std::abs(got - want) / std::abs(want) : std::abs(got));
  if (!ok) ++failures;
}
static bool near(double a, double b, double rel) { return std::abs(a - b) <= rel * std::abs(b); }

// The facade's own integrals (integrateVolume/Area: hasRationalCurve picks the form).
static double volumeOf(const TopoDS_Shape& s) {
  GProp_GProps props;
  ExtrudoFacade::integrateVolume(s, props);
  return props.Mass();
}
static double areaOf(const TopoDS_Shape& s) {
  GProp_GProps props;
  ExtrudoFacade::integrateArea(s, props);
  return props.Mass();
}

struct Conic { double x0, y0, xs, ys, x1, y1, rho; };

/** The area between the exact conic and its chord: Gauss–Legendre on 1/2 ∮ x dy − y dx. */
static long double exactArea(const Conic& c) {
  const long double w = c.rho / (1 - c.rho);
  auto point = [&](long double t, long double& x, long double& y, long double& dx, long double& dy) {
    const long double a = (1 - t) * (1 - t), b = 2 * t * (1 - t) * w, cc = t * t;
    const long double da = -2 * (1 - t), db = 2 * (1 - 2 * t) * w, dc = 2 * t;
    const long double d = a + b + cc, dd = da + db + dc;
    const long double nx = a * c.x0 + b * c.xs + cc * c.x1, ny = a * c.y0 + b * c.ys + cc * c.y1;
    const long double dnx = da * c.x0 + db * c.xs + dc * c.x1, dny = da * c.y0 + db * c.ys + dc * c.y1;
    x = nx / d;
    y = ny / d;
    dx = (dnx * d - nx * dd) / (d * d);
    dy = (dny * d - ny * dd) / (d * d);
  };
  // Five-point Gauss–Legendre on 400 panels: the integrand is a smooth rational.
  const long double g[5] = {0, -0.5384693101056831L, 0.5384693101056831L, -0.9061798459386640L, 0.9061798459386640L};
  const long double gw[5] = {0.5688888888888889L, 0.4786286704993665L, 0.4786286704993665L, 0.2369268850561891L,
                             0.2369268850561891L};
  const int panels = 400;
  long double sum = 0;
  for (int p = 0; p < panels; ++p) {
    const long double lo = (long double)p / panels, hi = (long double)(p + 1) / panels;
    for (int k = 0; k < 5; ++k) {
      const long double t = (lo + hi) / 2 + (hi - lo) / 2 * g[k];
      long double x, y, dx, dy;
      point(t, x, y, dx, dy);
      sum += gw[k] * (hi - lo) / 2 * (x * dy - y * dx);
    }
  }
  // The chord back from end to start.
  sum += (long double)c.x1 * c.y0 - (long double)c.y1 * c.x0;
  return std::abs(sum / 2);
}

/** The exact conic's length: the same Gauss–Legendre panels on |c'(t)|. */
static long double exactLength(const Conic& c) {
  const long double w = c.rho / (1 - c.rho);
  const long double g[5] = {0, -0.5384693101056831L, 0.5384693101056831L, -0.9061798459386640L, 0.9061798459386640L};
  const long double gw[5] = {0.5688888888888889L, 0.4786286704993665L, 0.4786286704993665L, 0.2369268850561891L,
                             0.2369268850561891L};
  const int panels = 400;
  long double sum = 0;
  for (int p = 0; p < panels; ++p) {
    const long double lo = (long double)p / panels, hi = (long double)(p + 1) / panels;
    for (int k = 0; k < 5; ++k) {
      const long double t = (lo + hi) / 2 + (hi - lo) / 2 * g[k];
      const long double a = (1 - t) * (1 - t), b = 2 * t * (1 - t) * w, cc = t * t;
      const long double da = -2 * (1 - t), db = 2 * (1 - 2 * t) * w, dc = 2 * t;
      const long double d = a + b + cc, dd = da + db + dc;
      const long double nx = a * c.x0 + b * c.xs + cc * c.x1, ny = a * c.y0 + b * c.ys + cc * c.y1;
      const long double dnx = da * c.x0 + db * c.xs + dc * c.x1, dny = da * c.y0 + db * c.ys + dc * c.y1;
      const long double dx = (dnx * d - nx * dd) / (d * d), dy = (dny * d - ny * dd) / (d * d);
      sum += gw[k] * (hi - lo) / 2 * std::sqrt(dx * dx + dy * dy);
    }
  }
  return sum;
}

/** Stages the conic and its chord, builds the face on XY; returns its handle or -1. */
static int conicFace(const Conic& c) {
  f.sketchClear();
  if (f.sketchConic(c.x0, c.y0, c.xs, c.ys, c.x1, c.y1, c.rho) < 0) return -1;
  if (f.sketchLine(c.x1, c.y1, c.x0, c.y0) < 0) return -1;
  const int n = f.sketchProfiles(0, 0, 0, 1, 0, 0, 0, 0, 1, 1e-4);
  f.sketchClear();
  if (n != 1) return -1;
  return f.profileRecords_[0];
}

int main(int argc, char** argv) {
  const Conic conics[3] = {
      {-20, 0, 0, 15, 20, 0, 0.5},  // parabola: sagitta 7.5, area 2/3 · 40 · 7.5 = 200
      {-20, 0, 0, 15, 20, 0, 0.3},  // ellipse arc
      {-20, 0, 0, 15, 20, 0, 0.8},  // hyperbola arc
  };
  const char* names[3] = {"parabola (rho 0.5)", "ellipse arc (rho 0.3)", "hyperbola arc (rho 0.8)"};
  if (argc > 1 && std::strcmp(argv[1], "probe") == 0) {
    // Which BRepGProp form integrates a face and a prism with a rational edge.
    for (int i = 0; i < 3; ++i) {
      const double exact = (double)exactArea(conics[i]);
      const int face = conicFace(conics[i]);
      const int solid = f.prism(face, 0, 0, 0, 0, 0, 5, 0);
      const TopoDS_Shape& F = *f.find(face);
      const TopoDS_Shape& S = *f.find(solid);
      auto row = [&](const char* how, double a, double v) {
        std::printf("%-24s %-28s area rel %.2e volume rel %.2e\n", names[i], how, std::abs(a - exact) / exact,
                    std::abs(v - 5 * exact) / (5 * exact));
      };
      GProp_GProps a, v;
      BRepGProp::SurfaceProperties(F, a);
      BRepGProp::VolumeProperties(S, v);
      row("fixed", a.Mass(), v.Mass());
      for (double eps : {1e-7, 1e-12}) {
        GProp_GProps a2, v2;
        BRepGProp::SurfaceProperties(F, a2, eps, false);
        BRepGProp::VolumeProperties(S, v2, eps, false);
        char how[40];
        std::snprintf(how, sizeof how, "eps %.0e", eps);
        row(how, a2.Mass(), v2.Mass());
      }
      {
        // The conic edge's length and its wall's area, every form.
        TopoDS_Edge conicEdge;
        for (TopExp_Explorer e(F, TopAbs_EDGE); e.More(); e.Next()) {
          BRepAdaptor_Curve c(TopoDS::Edge(e.Current()));
          if (c.GetType() == GeomAbs_BSplineCurve) conicEdge = TopoDS::Edge(e.Current());
        }
        TopoDS_Face wall;
        for (TopExp_Explorer e(S, TopAbs_FACE); e.More(); e.Next()) {
          BRepAdaptor_Surface su(TopoDS::Face(e.Current()));
          if (su.GetType() == GeomAbs_SurfaceOfExtrusion) wall = TopoDS::Face(e.Current());
        }
        const double L = (double)exactLength(conics[i]);
        GProp_GProps l0, l1, l2, w0, w1, w2;
        BRepGProp::LinearProperties(conicEdge, l0);
        BRepGProp::LinearProperties(conicEdge, l1, true);
        l2 = l1;
        std::printf("%-24s length fixed %.2e eps7 %.2e eps12 %.2e (L %.9f)\n", names[i], std::abs(l0.Mass() - L) / L,
                    std::abs(l1.Mass() - L) / L, std::abs(l2.Mass() - L) / L, L);
        if (!wall.IsNull()) {
          BRepGProp::SurfaceProperties(wall, w0);
          BRepGProp::SurfaceProperties(wall, w1, 1e-7, false);
          BRepGProp::SurfaceProperties(wall, w2, 1e-12, false);
          std::printf("%-24s wall fixed %.2e eps7 %.2e eps12 %.2e\n", names[i], std::abs(w0.Mass() - 5 * L) / (5 * L),
                      std::abs(w1.Mass() - 5 * L) / (5 * L), std::abs(w2.Mass() - 5 * L) / (5 * L));
        } else std::printf("no extrusion wall\n");
      }
      for (bool span : {false, true}) {
        GProp_GProps a3, v3;
        BRepGProp::SurfaceProperties(F, a3, 1e-7, false);
        BRepGProp::VolumePropertiesGK(S, v3, 1e-7, false, span);
        row(span ? "GK 1e-7 span" : "GK 1e-7", a3.Mass(), v3.Mass());
      }
    }
    return 0;
  }
  if (argc > 1 && std::strcmp(argv[1], "leaks") == 0) {
    const int rounds = argc > 2 ? std::atoi(argv[2]) : 300;
    double third = 0;
    for (int r = 0; r < rounds; ++r) {
      for (const Conic& c : conics) {
        const int face = conicFace(c);
        const int solid = f.prism(face, 0, 0, 0, 0, 0, 5, 0);
        if (face < 0 || solid < 0) {
          std::printf("FAIL round %d: %s\n", r, f.lastError_.c_str());
          return 1;
        }
        volumeOf(*f.find(solid));
        f.release(solid);
        f.release(face);
      }
      if (r == rounds / 3) third = f.heapTop();
    }
    const double end = f.heapTop();
    std::printf("leaks: %d rounds, heap top %.0f after a third, %.0f at the end (%+.0f bytes)\n", rounds, third, end,
                end - third);
    check(end - third <= 64 * 1024, "heap top flat over the last two thirds", end - third, 0);
    return failures ? 1 : 0;
  }
  for (int i = 0; i < 3; ++i) {
    const long double exact = i == 0 ? 200.0L : exactArea(conics[i]);
    if (i == 0) check(near((double)exactArea(conics[0]), 200, 1e-14), "Gauss-Legendre gives the parabola's 200",
                      (double)exactArea(conics[0]), 200);
    const int face = conicFace(conics[i]);
    if (face < 0) {
      std::printf("FAIL %s: %s\n", names[i], f.lastError_.c_str());
      ++failures;
      continue;
    }
    char what[96];
    std::snprintf(what, sizeof what, "%s area", names[i]);
    check(near(areaOf(*f.find(face)), (double)exact, 1e-9), what, areaOf(*f.find(face)), (double)exact);
    std::snprintf(what, sizeof what, "%s profile area", names[i]);
    check(near(f.profileNumbers_[0], (double)exact, 1e-9), what, f.profileNumbers_[0], (double)exact);
    const int solid = f.prism(face, 0, 0, 0, 0, 0, 5, 0);
    std::snprintf(what, sizeof what, "%s extruded 5 mm volume", names[i]);
    check(solid > 0 && near(volumeOf(*f.find(solid)), 5 * (double)exact, 1e-9), what,
          solid > 0 ? volumeOf(*f.find(solid)) : 0, 5 * (double)exact);
    const double skin = 2 * (double)exact + 5 * ((double)exactLength(conics[i]) +
                                                 std::hypot(conics[i].x1 - conics[i].x0, conics[i].y1 - conics[i].y0));
    std::snprintf(what, sizeof what, "%s prism surface area", names[i]);
    check(solid > 0 && near(areaOf(*f.find(solid)), skin, 1e-9), what, solid > 0 ? areaOf(*f.find(solid)) : 0, skin);
    {
      TopoDS_Edge conicEdge;
      for (TopExp_Explorer e(*f.find(face), TopAbs_EDGE); e.More(); e.Next()) {
        if (BRepAdaptor_Curve(TopoDS::Edge(e.Current())).GetType() == GeomAbs_BSplineCurve) {
          conicEdge = TopoDS::Edge(e.Current());
        }
      }
      const int edge = f.store(conicEdge);
      f.properties(edge);
      std::snprintf(what, sizeof what, "%s edge length (properties)", names[i]);
      // rho 0.5 has equal weights, so OCCT's curve is polynomial and keeps the
      // fixed order every fit or control spline gets (7.8e-7 here).
      check(near(f.measured_[8], (double)exactLength(conics[i]), i == 0 ? 1e-6 : 1e-9), what, f.measured_[8],
            (double)exactLength(conics[i]));
      f.release(edge);
    }
    std::snprintf(what, sizeof what, "%s: 4 faces", names[i]);
    check(solid > 0 && f.count(solid, 0) == 4, what, solid > 0 ? f.count(solid, 0) : 0, 4);
  }
  // A rho outside (0, 1) is refused with a message.
  f.sketchClear();
  check(f.sketchConic(-20, 0, 0, 15, 20, 0, 1) < 0 && !f.lastError_.empty(), "rho 1 refused");
  f.sketchClear();
  std::printf("%s\n", failures ? "FAILED" : "all ok");
  return failures ? 1 : 0;
}
