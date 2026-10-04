// Native harness for the P4-10 filletVariable (ADR-0064 §2). Built and run
// inside the pinned OCCT image by run.sh; prints one line per check and exits
// non-zero if any fails.
//
// The radius along a chain is OCCT's own law through the two radii
// (ChFiDS_FilSpine's mklaw interpolates them with a zero slope at each end), so
// on a straight edge of length L a taper from r1 to r2 takes away a little more
// than the (1 - pi/4) L (r1² + r1 r2 + r2²) / 3 of a radius linear in length:
// the checks below compare the built volumes with the constant fillets of the
// same edges at r1 and r2, measure the radius at each end of the result, and
// put `fillet`'s own volume beside the two equal radii'.
//
// The fillet face's own box is what shows that the taper runs the whole way
// along the edge: a round of radius r at a corner of the box cuts the two
// faces back r mm from it, so the face generated from the edge reaches from
// 20 - max(r) to 20 on both axes, where a constant fillet of the smaller radius
// reaches no further than that.
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepBuilderAPI_MakePolygon.hxx>
#include <chrono>
#include <cstdio>
#include <cstring>

static int failures = 0;
static ExtrudoFacade f;

static void check(bool ok, const char* what, double got = 0, double want = 0) {
  std::printf("%s %-58s got %.4f want %.4f\n", ok ? "ok  " : "FAIL", what, got, want);
  if (!ok) ++failures;
}

static bool near(double a, double b, double rel) { return std::abs(a - b) <= rel * std::max(1.0, std::abs(b)); }

/** The volume, with the integrator's tolerance given. */
static double volume(int h) {
  if (h <= 0) return 0;
  GProp_GProps props;
  BRepGProp::VolumeProperties(*f.find(h), props, 1e-12);
  return props.Mass();
}

static bool valid(int h) { return h > 0 && BRepCheck_Analyzer(*f.find(h)).IsValid(); }

/** The "is it a sound solid" check: lastError() when the build failed, a note when it wasn't. */
static void checkSolid(int h, const char* what) {
  check(valid(h), h > 0 || f.lastError_.empty() ? what : f.lastError_.c_str());
}

static int faces(int h) { return h > 0 ? f.count(h, 0) : -1; }

/** The index of the straight edge from `a` to `b` (either way round), or -1. */
static int edgeBetween(int h, const gp_Pnt& a, const gp_Pnt& b) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
  TopExp::MapShapes(*f.find(h), TopAbs_EDGE, edges);
  for (int i = 1; i <= edges.Extent(); ++i) {
    const BRepAdaptor_Curve curve(TopoDS::Edge(edges(i)));
    if (curve.GetType() != GeomAbs_Line) continue;
    const gp_Pnt p0 = curve.Value(curve.FirstParameter());
    const gp_Pnt p1 = curve.Value(curve.LastParameter());
    if (p0.Distance(a) < 1e-7 && p1.Distance(b) < 1e-7) return i - 1;
    if (p0.Distance(b) < 1e-7 && p1.Distance(a) < 1e-7) return i - 1;
  }
  return -1;
}

/** The tangent chain of tangent-continuous edges around `edge`, as the builder sees it. */
static std::vector<int> chain(int h, int edge) {
  std::vector<int> out;
  const int n = f.tangentChain(h, edge);
  const int32_t* lookup = reinterpret_cast<const int32_t*>(f.lookupPtr());
  for (int i = 0; i < n; ++i) out.push_back(lookup[i]);
  return out;
}

/** A handle on the face the result generated from input 0's `kind` `index`, or 0. */
static int generated(int h, int kind, int index) {
  if (h <= 0) return 0;
  const std::vector<int32_t> hist = f.history_;
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> map;
  TopExp::MapShapes(*f.find(h), TopAbs_FACE, map);
  size_t i = 0;
  while (i < hist.size()) {
    const int input = hist[i], at = hist[i + 2], relation = hist[i + 3], n = hist[i + 4];
    if (input == 0 && at == index && hist[i + 1] == kind && relation == 1) {
      for (int k = 0; k < n; ++k) {
        // Pairs are the kind and the index in the result's map of that kind.
        if (hist[i + 5 + 2 * k] == 0) return f.store(map(hist[i + 6 + 2 * k] + 1));
      }
    }
    i += 5 + 2 * n;
  }
  return 0;
}

/** The vertices of a shape. */
static std::vector<gp_Pnt> vertices(int h) {
  std::vector<gp_Pnt> out;
  if (h <= 0) return out;
  for (TopExp_Explorer v(*f.find(h), TopAbs_VERTEX); v.More(); v.Next()) {
    out.push_back(BRep_Tool::Pnt(TopoDS::Vertex(v.Current())));
  }
  return out;
}

/** The distinct points of a list of vertices. */
static std::vector<gp_Pnt> distinct(const std::vector<gp_Pnt>& points) {
  std::vector<gp_Pnt> out;
  for (const gp_Pnt& p : points) {
    bool seen = false;
    for (const gp_Pnt& q : out) seen = seen || p.Distance(q) < 1e-7;
    if (!seen) out.push_back(p);
  }
  return out;
}

/** Whether one of `points` sits at (x, y, z), each within `tol`. */
static bool vertexAt(const std::vector<gp_Pnt>& points, double x, double y, double z, double tol) {
  for (const gp_Pnt& p : points) {
    if (std::abs(p.X() - x) < tol && std::abs(p.Y() - y) < tol && std::abs(p.Z() - z) < tol) return true;
  }
  return false;
}

/** The status the diagnosis reports and the value of its last record (a factor for 4). */
static void diagnosis(int h, int& status, double& factor) {
  status = 0;
  factor = -1;
  if (h > 0) return;
  const std::vector<double> g = f.geometry_;
  if (g.size() < 2) return;
  status = static_cast<int>(g[0]);
  size_t i = 2;
  for (int record = 0; record < static_cast<int>(g[1]); ++record) {
    const int m = static_cast<int>(g[i]);
    i += 1 + static_cast<size_t>(m);
    factor = g[i];
    ++i;
  }
}

/** Stages `edges` with one radius each and calls fillet(). */
static int flat(int h, const std::vector<int>& edges, double radius) {
  f.clearArgs();
  f.clearNumbers();
  for (int edge : edges) {
    f.pushArg(edge);
    f.pushNumber(radius);
  }
  return f.fillet(h);
}

/** Stages `edges` with a start and an end radius each and calls filletVariable(). */
static int taper(int h, const std::vector<int>& edges, double r1, double r2) {
  f.clearArgs();
  f.clearNumbers();
  for (size_t i = 0; i < edges.size(); ++i) {
    f.pushArg(edges[i]);
    f.pushNumber(r1);
    f.pushNumber(r2);
  }
  return f.filletVariable(h);
}

/** Stages `edges` with one radius pair each, in `pairs`' order. */
static int pairs(int h, const std::vector<int>& edges, const std::vector<double>& radii) {
  f.clearArgs();
  f.clearNumbers();
  for (size_t i = 0; i < edges.size(); ++i) {
    f.pushArg(edges[i]);
    f.pushNumber(radii[2 * i]);
    f.pushNumber(radii[2 * i + 1]);
  }
  return f.filletVariable(h);
}

/** What a round of radius r takes off a right-angled edge of length L. */
static double taken(double r, double length) { return (1 - M_PI / 4) * r * r * length; }

/** One round of each case, for the leak check. */
static void round() {
  const int box20 = f.makeBox(0, 0, 0, 20, 20, 20);
  const int top = edgeBetween(box20, gp_Pnt(20, 0, 20), gp_Pnt(20, 20, 20));
  taper(box20, {top}, 2, 5);
  const int rounded = flat(box20, {edgeBetween(box20, gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 20))}, 2);
  if (rounded > 0) {
    const std::vector<int> three = chain(rounded, edgeBetween(rounded, gp_Pnt(0, 2, 20), gp_Pnt(0, 20, 20)));
    taper(rounded, three, 1, 3);
    // Refusals build and diagnose too, so they belong in the leak check.
    taper(rounded, three, 2, 30);
  }
  f.releaseAll();
}

int main(int argc, char** argv) {
  const bool leaks = argc > 1 && std::strcmp(argv[1], "leaks") == 0;
  if (leaks) {
    // Leak check: the cases n/5 and n times (default n = 500); the heap top must
    // not keep growing, and must grow when the handles are kept.
    const int n = argc > 2 ? std::atoi(argv[2]) : 500;
    const auto t0 = std::chrono::steady_clock::now();
    round();
    std::printf("     one round: %.0f ms\n",
                std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - t0).count());
    for (int i = 1; i < n / 10; ++i) round();
    const double warm = f.heapTop();
    for (int i = n / 10; i < n / 5; ++i) round();
    const double early = f.heapTop();
    for (int i = n / 5; i < n; ++i) round();
    const double late = f.heapTop();
    std::printf("heap: warm %.1f MB, %d rounds %.1f MB, %d rounds %.1f MB\n", warm / 1e6, n / 5, early / 1e6, n,
                late / 1e6);
    check(late - early < 4e6, "leaks: heap flat from n/5 to n rounds", (late - early) / 1e6, 0);
    // The control: n boxes kept in the arena must take heap the measure can see.
    const double before = f.heapTop();
    for (int i = 0; i < 2000; ++i) f.makeBox(i, 0, 0, 1, 1, 1);
    check(f.heapTop() - before > 1e6, "leaks: control grows", (f.heapTop() - before) / 1e6, 1);
  } else {
    // 1. One top edge of a 20 mm box, tapered 2 → 5 mm.
    {
      const int box20 = f.makeBox(0, 0, 0, 20, 20, 20);
      check(box20 > 0, "box: made", box20, 1);
      const int top = edgeBetween(box20, gp_Pnt(20, 0, 20), gp_Pnt(20, 20, 20));
      check(top >= 0, "box: the top edge is found", top, 0);
      const double flat2 = volume(flat(box20, {top}, 2));
      const double flat5 = volume(flat(box20, {top}, 5));
      check(near(flat2, 8000 - taken(2, 20), 1e-9), "box: constant 2 mm volume", flat2, 8000 - taken(2, 20));
      check(near(flat5, 8000 - taken(5, 20), 1e-9), "box: constant 5 mm volume", flat5, 8000 - taken(5, 20));
      const int tapered = taper(box20, {top}, 2, 5);
      check(tapered > 0, f.lastError_.empty() ? "taper 2 → 5: built" : f.lastError_.c_str());
      checkSolid(tapered, "taper 2 → 5: valid solid");
      check(faces(tapered) == 7, "taper 2 → 5: 7 faces", faces(tapered), 7);
      const double got = volume(tapered);
      check(got < flat2 && got > flat5, "taper 2 → 5: volume between the two flat ones", got, 0);
      // OCCT's law is not quite linear in length: it eases off at both ends,
      // so it takes a per cent more off than a radius linear along the edge.
      const double linear = 8000 - (1 - M_PI / 4) * 20 * (2 * 2 + 2 * 5 + 5 * 5) / 3;
      check(near(got, linear, 0.02), "taper 2 → 5: volume near the linear taper's", got, linear);
      // The round takes 2 mm off at one end of the edge and 5 mm at the other,
      // which its own vertices say: a round of radius r at that corner cuts both
      // faces back r mm from it.
      const int face = generated(tapered, 1, top);
      check(face > 0, "taper 2 → 5: the fillet face is in the history", face, 1);
      const std::vector<gp_Pnt> corners = distinct(vertices(face));
      check(corners.size() == 4, "taper 2 → 5: the fillet face has 4 corners", corners.size(), 4);
      check(vertexAt(corners, 18, 0, 20, 0.01) && vertexAt(corners, 20, 0, 18, 0.01),
            "taper 2 → 5: 2 mm off at the first end");
      check(vertexAt(corners, 15, 20, 20, 0.01) && vertexAt(corners, 20, 20, 15, 0.01),
            "taper 2 → 5: 5 mm off at the second end");
      // Two equal radii are the constant fillet, down to the volume.
      const int equal = taper(box20, {top}, 2, 2);
      check(equal > 0, f.lastError_.empty() ? "taper 2 → 2: built" : f.lastError_.c_str());
      check(near(volume(equal), flat2, 1e-9), "taper 2 → 2: the constant 2 mm volume", volume(equal), flat2);
      // Swapping the ends moves the round, not the material: the two ends of a
      // straight edge are the same corner, so the volume is the same either way.
      const int swapped = taper(box20, {top}, 5, 2);
      check(swapped > 0, f.lastError_.empty() ? "taper 5 → 2: built" : f.lastError_.c_str());
      check(near(volume(swapped), got, 1e-9), "taper 5 → 2: the same volume", volume(swapped), got);
      const std::vector<gp_Pnt> swappedCorners = distinct(vertices(generated(swapped, 1, top)));
      check(vertexAt(swappedCorners, 15, 0, 20, 0.01) && vertexAt(swappedCorners, 20, 0, 15, 0.01),
            "taper 5 → 2: 5 mm off at the first end");
      check(vertexAt(swappedCorners, 18, 20, 20, 0.01) && vertexAt(swappedCorners, 20, 20, 18, 0.01),
            "taper 5 → 2: 2 mm off at the second end");
    }
    // 2. A chain of three tangent edges (two lines and the arc between them: the
    //    outline of the top face of a box with one upright edge rounded).
    {
      const int box20 = f.makeBox(0, 0, 0, 20, 20, 20);
      const int rounded = flat(box20, {edgeBetween(box20, gp_Pnt(0, 0, 0), gp_Pnt(0, 0, 20))}, 2);
      check(rounded > 0, f.lastError_.empty() ? "chain: the upright rounds" : f.lastError_.c_str());
      const int alongY = edgeBetween(rounded, gp_Pnt(0, 2, 20), gp_Pnt(0, 20, 20));
      const int alongX = edgeBetween(rounded, gp_Pnt(2, 0, 20), gp_Pnt(20, 0, 20));
      const std::vector<int> three = chain(rounded, alongY);
      check(three.size() == 3, "chain: three tangent edges", three.size(), 3);
      std::printf("     chain: along y %d, along x %d, chain %d %d %d\n", alongY, alongX, three[0], three[1],
                  three[2]);
      const double flat1 = volume(flat(rounded, three, 1));
      const double flat3 = volume(flat(rounded, three, 3));
      check(near(flat1, volume(flat(rounded, {alongY}, 1)), 1e-9), "chain: 1 mm on one edge is 1 mm on the three",
            flat1, 0);
      check(flat1 > flat3, "chain: 1 mm leaves more than 3 mm", flat1 - flat3, 0);
      const int tapered = taper(rounded, three, 1, 3);
      check(tapered > 0, f.lastError_.empty() ? "chain 1 → 3: built" : f.lastError_.c_str());
      checkSolid(tapered, "chain 1 → 3: valid solid");
      const double got = volume(tapered);
      check(got < flat1 && got > flat3, "chain 1 → 3: volume between the two flat ones", got, 0);
      check(near(got, volume(taper(rounded, {alongY}, 1, 3)), 1e-9),
            "chain 1 → 3: staging one edge of it is the same", got, 0);
      check(faces(tapered) == faces(flat(rounded, three, 1)), "chain 1 → 3: as many faces as a flat one",
            faces(tapered), 10);
      // The chain's last edge ends at the box's corner (20, 0, 20), where a round
      // of radius r puts its face r mm back on both of the faces it joins, so
      // that corner's vertices say how big the round is there.
      const std::vector<gp_Pnt> threeToOne = distinct(vertices(tapered));
      check(vertexAt(threeToOne, 20, 0, 17, 0.01) && vertexAt(threeToOne, 20, 3, 20, 0.01),
            "chain 1 → 3: 3 mm at the last corner of the chain");
      const int oneToThree = taper(rounded, three, 3, 1);
      check(oneToThree > 0, "chain 3 → 1: built");
      // The two volumes differ a little: the chain's ends are different corners
      // (one between two planes, one between a plane and the rounded upright), so
      // the same two radii along the chain take off a different amount. Which end
      // gets which radius is what swap() changes, and the corner above says it.
      const std::vector<gp_Pnt> oneToThreeCorners = distinct(vertices(oneToThree));
      check(vertexAt(oneToThreeCorners, 20, 0, 19, 0.01) && vertexAt(oneToThreeCorners, 20, 1, 20, 0.01),
            "chain 3 → 1: 1 mm at the last corner of the chain");
      const int equal = taper(rounded, three, 2, 2);
      check(equal > 0, "chain 2 → 2: built");
      check(near(volume(equal), volume(flat(rounded, three, 2)), 1e-9), "chain 2 → 2: the constant volume",
            volume(equal), 0);
      // Two pairs on one chain can't both hold.
      int status = 0;
      double factor = -1;
      diagnosis(pairs(rounded, three, {1, 3, 2, 4, 1, 3}), status, factor);
      check(status == 3, "chain: two pairs are refused (status 3)", status, 3);
      std::printf("     chain: two pairs: %s\n", f.lastError_.c_str());
      // 3. Too large: status 4 with a factor every radius scales by that works.
      int tooBig = taper(rounded, three, 2, 30);
      diagnosis(tooBig, status, factor);
      check(tooBig == 0 && status == 4, "chain 2 → 30: refused with status 4", status, 4);
      check(factor > 0 && factor < 1, "chain 2 → 30: a factor under 1", factor, 0);
      std::printf("     chain 2 → 30: %s (factor %.4f)\n", f.lastError_.c_str(), factor);
      const int scaled = taper(rounded, three, 2 * factor, 30 * factor);
      check(scaled > 0, "chain 2 → 30: the factor works when applied", scaled, 1);
      checkSolid(scaled, "chain 2 → 30: the scaled one is a valid solid");
      check(volume(scaled) < volume(flat(rounded, three, 3)), "chain 2 → 30: it takes off less than 3 mm",
            volume(scaled), 0);
    }
    // 4. Refusals and the argument checks.
    {
      const int box20 = f.makeBox(0, 0, 0, 20, 20, 20);
      const int top = edgeBetween(box20, gp_Pnt(20, 0, 20), gp_Pnt(20, 20, 20));
      check(taper(box20, {top}, 2, 5) > 0, "a normal taper works");
      check(pairs(box20, {top, top}, {2, 5, 1}) == 0, "three radii for two edges: refused");
      check(pairs(box20, {top, top}, {2, 5, 1, 1, 1, 1}) == 0, "six radii for two edges: refused");
      check(pairs(box20, {top}, {0, 5}) == 0, "radius 0: refused");
      check(pairs(box20, {top}, {2, -1}) == 0, "radius below 0: refused");
      check(taper(999, {top}, 2, 5) == 0, "unknown shape: refused");
      check(taper(box20, {999}, 2, 5) == 0, "edge index out of range: refused");
      // A lone face has edges between one face only, so no fillet can be made.
      BRepBuilderAPI_MakePolygon poly;
      poly.Add(gp_Pnt(0, 0, 0));
      poly.Add(gp_Pnt(20, 0, 0));
      poly.Add(gp_Pnt(20, 20, 0));
      poly.Close();
      const int lone = f.store(BRepBuilderAPI_MakeFace(poly.Wire(), true).Face());
      int status = 0;
      double factor = -1;
      diagnosis(taper(lone, {edgeBetween(lone, gp_Pnt(0, 0, 0), gp_Pnt(20, 0, 0))}, 2, 5), status, factor);
      check(status == 2, "a lone face: status 2", status, 2);
      std::printf("     lone face: %s\n", f.lastError_.c_str());
    }
  }
  std::printf("%d failure(s)\n", failures);
  return failures == 0 ? 0 : 1;
}