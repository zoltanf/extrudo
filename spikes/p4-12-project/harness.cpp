// Native harness for Project's new sources (P4-12, ADR-0031's amendment):
// faceSilhouettes on every surface (Contap_Contour), sectionWithPlane
// (Intersect) and edgeVisibility (a body's HLR visibility). Built and run
// inside the pinned OCCT image by run.sh.
//
//   node harness.cjs          the checks (exits 1 on a failure)
//   node harness.cjs leaks N  heap top after N and 5N rounds of every call
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <gp_Elips.hxx>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

static int failures = 0;
static ExtrudoFacade f;

static void check(bool ok, const std::string& what) {
  std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
  if (!ok) ++failures;
}

struct Piece {
  int kind = 0;
  std::vector<gp_Pnt> points;  // line ends or polyline
  gp_Pnt center;
  gp_Dir axis, x;
  double major = 0, minor = 0, first = 0, last = 0;
};

static std::vector<Piece> decode(int n) {
  std::vector<Piece> out;
  const std::vector<double>& v = f.geometry_;
  size_t o = 0;
  auto pnt = [&]() {
    gp_Pnt p(v[o], v[o + 1], v[o + 2]);
    o += 3;
    return p;
  };
  for (int i = 0; i < n; ++i) {
    Piece p;
    p.kind = static_cast<int>(v[o++]);
    if (p.kind == 0) {
      p.points.push_back(pnt());
      p.points.push_back(pnt());
    } else if (p.kind == 2) {
      const int m = static_cast<int>(v[o++]);
      for (int k = 0; k < m; ++k) p.points.push_back(pnt());
    } else {
      p.center = pnt();
      p.axis = gp_Dir(gp_Vec(pnt().XYZ()));
      p.x = gp_Dir(gp_Vec(pnt().XYZ()));
      p.major = v[o++];
      p.minor = p.kind == 3 ? v[o++] : p.major;
      p.first = v[o++];
      p.last = v[o++];
    }
    out.push_back(p);
  }
  return out;
}

/** The turn the arcs of one circle cover together, about `axis` (duplicates counted once). */
static double coverage(const std::vector<Piece>& pieces, const gp_Dir& axis, double radius) {
  std::vector<std::pair<double, double>> spans;
  gp_Dir ref;
  bool haveRef = false;
  for (const Piece& p : pieces) {
    if (p.kind != 1 || std::abs(p.major - radius) > 1e-9) continue;
    if (!haveRef) {
      ref = p.x;
      haveRef = true;
    }
    const bool flip = p.axis.Dot(axis) < 0;
    const gp_Dir y = gp_Dir(axis).Crossed(ref);
    const double offset = std::atan2(gp_Vec(p.x).Dot(gp_Vec(y)), gp_Vec(p.x).Dot(gp_Vec(ref)));
    double a = flip ? offset - p.last : offset + p.first;
    double b = flip ? offset - p.first : offset + p.last;
    a = std::fmod(a, 2 * M_PI);
    if (a < 0) a += 2 * M_PI;
    b = a + (p.last - p.first);
    spans.push_back({a, b});
    if (b > 2 * M_PI) spans.push_back({a - 2 * M_PI, b - 2 * M_PI});
  }
  std::sort(spans.begin(), spans.end());
  double covered = 0, end = 0;
  for (auto [a, b] : spans) {
    a = std::max(a, 0.0);
    b = std::min(b, 2 * M_PI);
    if (b <= end) continue;
    covered += b - std::max(a, end);
    end = b;
  }
  return covered;
}

static const char* KIND[] = {"line", "arc", "polyline", "ellipse"};

static void describe(const std::vector<Piece>& pieces) {
  for (const Piece& p : pieces) {
    if (p.kind == 1 || p.kind == 3) {
      std::printf("      %s centre (%.6f %.6f %.6f) axis (%.4f %.4f %.4f) r %.9f/%.9f sweep %.6f\n",
                  KIND[p.kind], p.center.X(), p.center.Y(), p.center.Z(), p.axis.X(), p.axis.Y(),
                  p.axis.Z(), p.major, p.minor, p.last - p.first);
    } else {
      std::printf("      %s %zu points\n", KIND[p.kind], p.points.size());
    }
  }
}

static int faceCount(int shape) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(*f.find(shape), TopAbs_FACE, faces);
  return faces.Extent();
}

static TopoDS_Face faceOf(int shape, int i) {
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(*f.find(shape), TopAbs_FACE, faces);
  return TopoDS::Face(faces(i + 1));
}

/** Largest distance of the pieces' points from the face, and largest |n·d| there. */
static void onSurface(int shape, int face, const std::vector<Piece>& pieces, const gp_Dir& d,
                      double& distance, double& square, int& count) {
  const TopoDS_Face fc = faceOf(shape, face);
  occ::handle<Geom_Surface> surface = BRep_Tool::Surface(fc);
  BRepGProp_Face props(fc);
  distance = 0;
  square = 0;
  count = 0;
  for (const Piece& p : pieces) {
    std::vector<gp_Pnt> pts = p.points;
    if (p.kind == 1 || p.kind == 3) {
      const gp_Dir y = p.axis.Crossed(p.x);
      for (int k = 0; k <= 16; ++k) {
        const double t = p.first + (p.last - p.first) * k / 16;
        pts.push_back(p.center.Translated(gp_Vec(p.x) * (p.major * std::cos(t)) +
                                          gp_Vec(y) * (p.minor * std::sin(t))));
      }
    }
    for (const gp_Pnt& q : pts) {
      GeomAPI_ProjectPointOnSurf proj(q, surface);
      if (proj.NbPoints() == 0) continue;
      distance = std::max(distance, proj.LowerDistance());
      double u = 0, v = 0;
      proj.LowerDistanceParameters(u, v);
      gp_Pnt at;
      gp_Vec n;
      props.Normal(u, v, at, n);
      if (n.Magnitude() > 1e-12) square = std::max(square, std::abs(n.Normalized().Dot(gp_Vec(d))));
      ++count;
    }
  }
}

static std::vector<Piece> silhouettes(int shape, int face, const gp_Dir& d) {
  const int n = f.faceSilhouettes(shape, face, d.X(), d.Y(), d.Z(), 0.01);
  if (n < 0) std::printf("      error: %s\n", f.lastError());
  return n < 0 ? std::vector<Piece>{} : decode(n);
}

/** The outline HLRBRep_Algo draws for a shape (visible and hidden), 2D in its projector. */
static std::vector<gp_Pnt> hlrOutline(const TopoDS_Shape& shape, const gp_Dir& d) {
  occ::handle<HLRBRep_Algo> algo = new HLRBRep_Algo();
  algo->Add(shape, 0);
  algo->Projector(HLRAlgo_Projector(gp_Ax2(gp_Pnt(0, 0, 0), d.Reversed())));
  algo->Update();
  algo->Hide();
  HLRBRep_HLRToShape toShape(algo);
  std::vector<gp_Pnt> out;
  for (const TopoDS_Shape& c : {toShape.OutLineVCompound(), toShape.OutLineHCompound()}) {
    if (c.IsNull()) continue;
    for (TopExp_Explorer it(c, TopAbs_EDGE); it.More(); it.Next()) {
      BRepAdaptor_Curve curve(TopoDS::Edge(it.Current()));
      for (int k = 0; k <= 32; ++k) {
        out.push_back(curve.Value(curve.FirstParameter() +
                                  (curve.LastParameter() - curve.FirstParameter()) * k / 32));
      }
    }
  }
  return out;
}

static int sphereBody() { return f.store(BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 10).Shape()); }
static int torusBody() {
  return f.store(BRepPrimAPI_MakeTorus(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 20, 5).Shape());
}
static int loftBody() {
  BRepOffsetAPI_ThruSections loft(true, false);
  const gp_Circ c0(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), 10);
  const gp_Elips c1(gp_Ax2(gp_Pnt(3, 0, 15), gp_Dir(0, 0.2, 1)), 14, 6);
  const gp_Circ c2(gp_Ax2(gp_Pnt(0, 2, 30), gp_Dir(0, 0, 1)), 8);
  loft.AddWire(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(c0)).Wire());
  loft.AddWire(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(c1)).Wire());
  loft.AddWire(BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(c2)).Wire());
  loft.Build();
  return f.store(loft.Shape());
}
static int filletBox() {
  const int box = f.makeBox(-10, -10, 0, 20, 20, 20);
  BRepFilletAPI_MakeFillet fillet(*f.find(box));
  for (TopExp_Explorer it(*f.find(box), TopAbs_EDGE); it.More(); it.Next()) {
    fillet.Add(4, TopoDS::Edge(it.Current()));
  }
  fillet.Build();
  return f.store(fillet.Shape());
}

static void runChecks() {
  // --- Sphere: the outline is the great circle square to the view.
  {
    const int sphere = sphereBody();
    for (const gp_Dir d : {gp_Dir(0, 0, 1), gp_Dir(1, 1, 1), gp_Dir(0, 1, 0)}) {
      const std::vector<Piece> pieces = silhouettes(sphere, 0, d);
      std::printf("  sphere r 10 seen along (%.3f %.3f %.3f): %zu pieces\n", d.X(), d.Y(), d.Z(),
                  pieces.size());
      describe(pieces);
      double worst = 0;
      bool arcs = !pieces.empty();
      const double sweep = coverage(pieces, d, 10);
      for (const Piece& p : pieces) {
        if (p.kind != 1) {
          arcs = false;
          continue;
        }
        worst = std::max({worst, std::abs(p.major - 10), p.center.Distance(gp_Pnt(0, 0, 0)),
                          1 - std::abs(p.axis.Dot(d))});
      }
      check(arcs && std::abs(sweep - 2 * M_PI) < 1e-9 && worst < 1e-9,
            "sphere: exact arcs of the great circle, a whole turn in all");
      // HLRBRep_Algo's own outline against the exact circle.
      const std::vector<gp_Pnt> hlr = hlrOutline(*f.find(sphere), d);
      double off = 0;
      for (const gp_Pnt& p : hlr) off = std::max(off, std::abs(std::hypot(p.X(), p.Y()) - 10));
      std::printf("      HLRBRep_Algo outline: %zu samples, max |r - 10| = %.3g mm\n", hlr.size(),
                  off);
    }
    // A half sphere (a cap) seen from the side: half of the circle.
    const int cut = f.store(BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 10, 0, M_PI / 2).Shape());
    for (int i = 0; i < faceCount(cut); ++i) {
      if (BRepAdaptor_Surface(faceOf(cut, i)).GetType() != GeomAbs_Sphere) continue;
      const std::vector<Piece> pieces = silhouettes(cut, i, gp_Dir(0, 1, 0));
      const double sweep = coverage(pieces, gp_Dir(0, 1, 0), 10);
      std::printf("  upper half sphere from +Y: %zu pieces, sweep %.6f\n", pieces.size(), sweep);
      describe(pieces);
      check(std::abs(sweep - M_PI) < 1e-6, "half sphere: half a turn");
    }
  }
  // --- Torus.
  {
    const int torus = torusBody();
    const std::vector<Piece> along = silhouettes(torus, 0, gp_Dir(0, 0, 1));
    std::printf("  torus R 20 r 5 along its axis: %zu pieces\n", along.size());
    describe(along);
    const double sweepOut = coverage(along, gp_Dir(0, 0, 1), 25);
    double inner = 0;
    int innerPoints = 0;
    for (const Piece& p : along) {
      if (p.kind != 2) continue;
      for (const gp_Pnt& q : p.points) {
        inner = std::max(inner, std::abs(std::hypot(q.X(), q.Y()) - 15) + std::abs(q.Z()));
        ++innerPoints;
      }
    }
    std::printf("      outer arcs cover %.9f; the walked inner contour: %d points, max |r - 15| + |z| = %.3g\n",
                sweepOut, innerPoints, inner);
    check(std::abs(sweepOut - 2 * M_PI) < 1e-9 && innerPoints > 0 && inner < 1e-9,
          "torus along its axis: the outer circle exact, the inner one walked on r = 15");
    for (const gp_Dir d : {gp_Dir(0, 1, 0), gp_Dir(0, 1, 1), gp_Dir(0.3, 1, 2)}) {
      const std::vector<Piece> pieces = silhouettes(torus, 0, d);
      double distance = 0, square = 0;
      int count = 0;
      onSurface(torus, 0, pieces, d, distance, square, count);
      std::printf(
          "  torus seen along (%.3f %.3f %.3f): %zu pieces, %d points, max distance %.3g mm, "
          "max |n.d| %.3g\n",
          d.X(), d.Y(), d.Z(), pieces.size(), count, distance, square);
      describe(pieces);
      check(!pieces.empty() && distance < 1e-6 && square < 1e-3,
            "torus from the side: points on the surface, normal square to the view");
    }
  }
  // --- A free-form loft.
  {
    const int loft = loftBody();
    int loftFound = 0;
    for (int i = 0; i < faceCount(loft); ++i) {
      const BRepAdaptor_Surface s(faceOf(loft, i));
      {
        GProp_GProps props;
        BRepGProp::SurfaceProperties(faceOf(loft, i), props);
        std::printf("  loft face %d: type %d, area %.3f\n", i, static_cast<int>(s.GetType()), props.Mass());
        // Does n.d change sign on the face (so it has a contour)?
        const TopoDS_Face fc = faceOf(loft, i);
        double u0, u1, v0, v1;
        BRepTools::UVBounds(fc, u0, u1, v0, v1);
        BRepGProp_Face gp(fc);
        for (const gp_Dir d : {gp_Dir(0, 1, 0), gp_Dir(1, 0.5, 0.3)}) {
          int pos = 0, neg = 0;
          for (int a = 0; a <= 40; ++a)
            for (int b = 0; b <= 40; ++b) {
              gp_Pnt p;
              gp_Vec n;
              gp.Normal(u0 + (u1 - u0) * a / 40, v0 + (v1 - v0) * b / 40, p, n);
              (n.Dot(gp_Vec(d)) > 0 ? pos : neg)++;
            }
          std::printf("      n.d > 0 at %d, < 0 at %d of 1681 grid points\n", pos, neg);
        }
      }
      if (s.GetType() == GeomAbs_Plane) continue;
      for (const gp_Dir d : {gp_Dir(0, 1, 0), gp_Dir(1, 0.5, 0.3)}) {
        const std::vector<Piece> pieces = silhouettes(loft, i, d);
        double distance = 0, square = 0;
        int count = 0;
        onSurface(loft, i, pieces, d, distance, square, count);
        std::printf(
            "  loft face %d (type %d) along (%.3f %.3f %.3f): %zu pieces, %d points, max distance "
            "%.3g mm, max |n.d| %.3g\n",
            i, static_cast<int>(s.GetType()), d.X(), d.Y(), d.Z(), pieces.size(), count, distance,
            square);
        describe(pieces);
        if (!pieces.empty()) ++loftFound;
        check(distance < 1e-4, "loft: silhouette on the surface");
      }
    }
    check(loftFound >= 2, "loft: the lateral face has silhouettes from both views");
  }
  // --- A box with every edge filleted, seen obliquely.
  {
    const int box = filletBox();
    const gp_Dir d(1, -2, 1.5);
    int total = 0, failed = 0;
    double worst = 0;
    for (int i = 0; i < faceCount(box); ++i) {
      const std::vector<Piece> pieces = silhouettes(box, i, d);
      if (f.lastError()[0] != 0) ++failed;
      double distance = 0, square = 0;
      int count = 0;
      onSurface(box, i, pieces, d, distance, square, count);
      worst = std::max(worst, distance);
      total += static_cast<int>(pieces.size());
    }
    std::printf("  filleted box (%d faces) along (1 -2 1.5): %d pieces, max distance %.3g mm\n",
                faceCount(box), total, worst);
    check(failed == 0 && total > 0 && worst < 1e-4, "filleted box: silhouettes on the faces");
  }
  // --- A cylinder from the side: its two silhouette lines, in the pieces' encoding.
  {
    const int cylinder = f.makeCylinder(20, 0, 0, 0, 0, 1, 5, 12);
    int side = -1;
    for (int i = 0; i < faceCount(cylinder); ++i) {
      const BRepAdaptor_Surface surface(faceOf(cylinder, i));
      if (surface.GetType() == GeomAbs_Cylinder) side = i;
    }
    const std::vector<Piece> pieces = silhouettes(cylinder, side, gp_Dir(0, -1, 0));
    std::printf("  cylinder r 5 seen along -Y: %zu pieces\n", pieces.size());
    bool lines = pieces.size() == 2;
    for (const Piece& p : pieces) {
      const double x = p.points.empty() ? 0 : p.points[0].X();
      lines = lines && p.kind == 0 && (std::abs(x - 15) < 1e-9 || std::abs(x - 25) < 1e-9);
    }
    check(lines, "cylinder: two lines at x = 15 and 25");
  }
  // --- Intersect: a cylinder with an oblique plane.
  {
    const int cylinder = f.makeCylinder(0, 0, 0, 0, 0, 1, 10, 40);
    const double s = std::sqrt(0.5);
    const int n = f.sectionWithPlane(cylinder, 0, 0, 20, 0, s, s, 0.01);
    const std::vector<Piece> pieces = decode(std::max(n, 0));
    std::printf("  cylinder r 10 cut by a plane at 45 deg: %d pieces\n", n);
    describe(pieces);
    bool ellipse = false;
    double sweep = 0;
    for (const Piece& p : pieces) {
      if (p.kind != 3) continue;
      sweep += p.last - p.first;
      ellipse = std::abs(p.major - 10 * std::sqrt(2.0)) < 1e-9 && std::abs(p.minor - 10) < 1e-9;
    }
    check(ellipse && std::abs(sweep - 2 * M_PI) < 1e-9, "section: an exact ellipse 14.142 x 10");
    const int sphere = sphereBody();
    const int m = f.sectionWithPlane(sphere, 0, 0, 6, 0, 0, 1, 0.01);
    const std::vector<Piece> ring = decode(std::max(m, 0));
    std::printf("  sphere r 10 cut at z = 6: %d pieces\n", m);
    describe(ring);
    double r = 0;
    for (const Piece& p : ring) r = p.kind == 1 ? p.major : r;
    check(std::abs(r - 8) < 1e-9, "section of a sphere: a circle of 8");
    const int torus = torusBody();
    const int t = f.sectionWithPlane(torus, 0, 0, 0, 1, 0, 0.2, 0.01);
    const std::vector<Piece> curves = decode(std::max(t, 0));
    std::printf("  torus cut by a tilted plane through its centre: %d pieces\n", t);
    describe(curves);
    check(t > 0, "section of a torus: some curves");
  }
  // --- Visibility of a box's edges.
  {
    const int box = f.makeBox(0, 0, 0, 20, 10, 5);
    auto report = [&](const gp_Dir& d, const char* name) {
      const int n = f.edgeVisibility(box, d.X(), d.Y(), d.Z());
      int visible = 0, outline = 0, sharp = 0;
      for (int i = 0; i < n; ++i) {
        const int flag = static_cast<int>(f.geometry_[i]);
        visible += flag & 1;
        outline += (flag >> 1) & 1;
        sharp += (flag >> 2) & 1;
      }
      std::printf("  box edges seen along %s: %d edges, %d visible, %d outline, %d sharp\n", name,
                  n, visible, outline, sharp);
      return std::array<int, 3>{visible, outline, sharp};
    };
    const auto top = report(gp_Dir(0, 0, 1), "+Z");
    // Which ones from +Z: every edge on z = 5 should be, none on z = 0.
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(*f.find(box), TopAbs_EDGE, edges);
    f.edgeVisibility(box, 0, 0, 1);
    bool right = true;
    for (int i = 1; i <= edges.Extent(); ++i) {
      BRepAdaptor_Curve c(TopoDS::Edge(edges(i)));
      const gp_Pnt a = c.Value(c.FirstParameter()), b = c.Value(c.LastParameter());
      const bool flagged = static_cast<int>(f.geometry_[i - 1]) & 1;
      const bool bottom = a.Z() < 1e-9 && b.Z() < 1e-9;
      const bool topEdge = a.Z() > 5 - 1e-9 && b.Z() > 5 - 1e-9;
      if ((bottom && flagged) || (topEdge && !flagged)) right = false;
      std::printf("      edge %d (%.0f %.0f %.0f)-(%.0f %.0f %.0f) flag %d\n", i, a.X(), a.Y(), a.Z(), b.X(),
                  b.Y(), b.Z(), static_cast<int>(f.geometry_[i - 1]));
    }
    check(top[2] == 12 && right, "box from +Z: the top edges are seen, the bottom ones aren't");
    const auto oblique = report(gp_Dir(1, -2, 1.5), "(1 -2 1.5)");
    check(oblique[0] == 9 && oblique[1] == 6, "box seen obliquely: 9 edges seen, 6 on the outline");
    const auto tilted = report(gp_Dir(0, -0.5, std::sqrt(0.75)), "30 deg about X");
    check(tilted[1] == 2, "box seen at 30 deg about X: two outline edges");
    const auto under = report(gp_Dir(0, 0, -1), "-Z");
    (void)under;
  }
}

static void leaks(int n) {
  const int torus = torusBody();
  const int sphere = sphereBody();
  const int box = filletBox();
  auto round = [&]() {
    f.faceSilhouettes(torus, 0, 0.3, 1, 2, 0.01);
    f.faceSilhouettes(sphere, 0, 1, 1, 1, 0.01);
    f.faceSilhouettes(box, 3, 1, -2, 1.5, 0.01);
    f.sectionWithPlane(torus, 0, 0, 0, 1, 0, 0.2, 0.01);
    f.edgeVisibility(box, 1, -2, 1.5);
  };
  for (int i = 0; i < 20; ++i) round();
  for (int i = 0; i < n; ++i) round();
  const double a = f.heapTop();
  for (int i = 0; i < 4 * n; ++i) round();
  const double b = f.heapTop();
  std::printf("  heap top after %d rounds: %.0f, after %d: %.0f (growth %.0f bytes)\n", n, a,
              5 * n, b, b - a);
  check(b - a < 1, "no heap growth");
}

int main(int argc, char** argv) {
  if (argc > 1 && std::strcmp(argv[1], "leaks") == 0) {
    leaks(argc > 2 ? std::atoi(argv[2]) : 300);
  } else {
    runChecks();
  }
  std::printf("%d failure(s)\n", failures);
  return failures == 0 ? 0 : 1;
}
