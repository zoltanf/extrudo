
  // ------------------------------------------- paths, sweeps and lofts (P4-01) --

  /** Each profile edge with the side faces it swept into. */
  using SideList = std::vector<std::pair<TopoDS_Shape, std::vector<TopoDS_Shape>>>;

  /** Whether a path wire has all `edges` pieces in one chain. */
  static bool pathWireIsGood(const TopoDS_Wire& wire, size_t edges) {
    size_t count = 0;
    for (BRepTools_WireExplorer e(wire); e.More(); e.Next()) ++count;
    return count == edges;
  }

  /** The edges of a wire in order, each oriented the way the wire runs. */
  static std::vector<TopoDS_Edge> wireEdges(const TopoDS_Wire& wire) {
    std::vector<TopoDS_Edge> out;
    for (BRepTools_WireExplorer e(wire); e.More(); e.Next()) out.push_back(e.Current());
    return out;
  }

  /** Where an oriented edge starts or ends, and which way it runs there. */
  static void edgeEnd(const TopoDS_Edge& edge, bool atEnd, gp_Pnt& point, gp_Vec& tangent) {
    BRepAdaptor_Curve curve(edge);
    const bool reversed = edge.Orientation() == TopAbs_REVERSED;
    const double u = (atEnd != reversed) ? curve.LastParameter() : curve.FirstParameter();
    curve.D1(u, point, tangent);
    if (reversed) tangent.Reverse();
  }

  /** The two ends of a wire, the way it runs. */
  static void wireEnds(const TopoDS_Wire& wire, gp_Pnt& first, gp_Pnt& last) {
    const std::vector<TopoDS_Edge> edges = wireEdges(wire);
    gp_Vec tangent;
    edgeEnd(edges.front(), false, first, tangent);
    edgeEnd(edges.back(), true, last, tangent);
  }

  /** The same path run the other way: its edges reversed, in reverse order. */
  static TopoDS_Wire reversedWire(const TopoDS_Wire& wire) {
    const std::vector<TopoDS_Edge> edges = wireEdges(wire);
    BRepBuilderAPI_MakeWire maker;
    for (auto it = edges.rbegin(); it != edges.rend(); ++it) maker.Add(TopoDS::Edge(it->Reversed()));
    return maker.IsDone() ? maker.Wire() : TopoDS_Wire();
  }

  /** Whether the path turns smoothly where its pieces meet (within about half a degree). */
  static bool smoothWire(const TopoDS_Wire& wire) {
    const std::vector<TopoDS_Edge> edges = wireEdges(wire);
    gp_Pnt first;
    gp_Pnt last;
    wireEnds(wire, first, last);
    const bool closed = first.Distance(last) <= 1e-6;
    for (size_t i = 0; i < edges.size(); ++i) {
      if (i + 1 == edges.size() && !closed) break;
      gp_Pnt p;
      gp_Vec out;
      gp_Vec in;
      edgeEnd(edges[i], true, p, out);
      edgeEnd(edges[(i + 1) % edges.size()], false, p, in);
      if (out.Magnitude() <= 1e-12 || in.Magnitude() <= 1e-12 || out.Angle(in) > 1e-2) return false;
    }
    return true;
  }

  /**
   * The auxiliary spine of a twisted sweep: a curve beside the path whose
   * direction from the path turns by `twist` radians from start to end,
   * evenly by length, on a rotation-minimising frame (the double-reflection
   * method), so a twist of 0 follows the path like the corrected Frenet
   * frame. It stays within `distance` of the path, or nearer where the path
   * bends tightly, so the plane square to the path at a point meets it
   * only there.
   */
  static TopoDS_Wire twistSpine(const TopoDS_Wire& wire, double twist, double distance) {
    BRepAdaptor_CompCurve curve(wire);
    const int n = 400;
    GCPnts_QuasiUniformAbscissa spacing(curve, n + 1);
    if (!spacing.IsDone() || spacing.NbPoints() != n + 1) return TopoDS_Wire();
    std::vector<gp_Pnt> p(n + 1);
    std::vector<gp_Vec> t(n + 1);
    double tightest = 0;
    for (int i = 0; i <= n; ++i) {
      gp_Vec d1;
      gp_Vec d2;
      curve.D2(spacing.Parameter(i + 1), p[i], d1, d2);
      const double speed = d1.Magnitude();
      if (speed <= 1e-12) return TopoDS_Wire();
      tightest = std::max(tightest, d1.Crossed(d2).Magnitude() / (speed * speed * speed));
      t[i] = d1 / speed;
    }
    if (tightest > 0) distance = std::min(distance, 0.2 / tightest);
    // A first normal: square to the tangent, away from the world axis it is least along.
    const gp_Vec t0 = t[0];
    gp_Vec axis(1, 0, 0);
    if (std::abs(t0.Y()) < std::abs(t0.X()) && std::abs(t0.Y()) <= std::abs(t0.Z())) axis = gp_Vec(0, 1, 0);
    else if (std::abs(t0.Z()) < std::abs(t0.X())) axis = gp_Vec(0, 0, 1);
    gp_Vec r = t0.Crossed(axis);
    r.Normalize();
    std::vector<double> along(n + 1, 0.0);
    for (int i = 1; i <= n; ++i) along[i] = along[i - 1] + p[i].Distance(p[i - 1]);
    const double total = along[n];
    if (!(total > 1e-9)) return TopoDS_Wire();
    NCollection_Array1<gp_Pnt> points(1, n + 1);
    NCollection_Array1<double> parameters(1, n + 1);
    for (int i = 0; i <= n; ++i) {
      if (i > 0) {
        // Double reflection (Wang et al. 2008): reflect across the chord, then across the tangents' bisector.
        const gp_Vec v1(p[i - 1], p[i]);
        const double c1 = v1.SquareMagnitude();
        if (c1 > 1e-24) {
          const gp_Vec rl = r - v1 * (2.0 / c1 * v1.Dot(r));
          const gp_Vec tl = t[i - 1] - v1 * (2.0 / c1 * v1.Dot(t[i - 1]));
          const gp_Vec v2 = t[i] - tl;
          const double c2 = v2.SquareMagnitude();
          r = c2 > 1e-24 ? rl - v2 * (2.0 / c2 * v2.Dot(rl)) : rl;
        }
        // Keep it square to the tangent and of unit length against drift.
        r = r - t[i] * r.Dot(t[i]);
        if (r.Magnitude() <= 1e-12) return TopoDS_Wire();
        r.Normalize();
      }
      const double angle = twist * along[i] / total;
      const gp_Vec b = t[i].Crossed(r);
      points(i + 1) = p[i].Translated((r * std::cos(angle) + b * std::sin(angle)) * distance);
      parameters(i + 1) = along[i] / total;
    }
    GeomAPI_PointsToBSpline fit(points, parameters, 3, 8, GeomAbs_C2, 1e-4 * distance);
    if (!fit.IsDone()) return TopoDS_Wire();
    BRepBuilderAPI_MakeEdge edge(fit.Curve());
    if (!edge.IsDone()) return TopoDS_Wire();
    BRepBuilderAPI_MakeWire maker(edge.Edge());
    return maker.IsDone() ? maker.Wire() : TopoDS_Wire();
  }

  /**
   * One closed section swept along `spine` into a solid: 0, or a sweep()
   * status. `sides` gets each section edge's side faces.
   */
  static int pipeOne(const TopoDS_Wire& spine, const TopoDS_Wire& section, int mode, const gp_Dir& fixed,
                     const gp_Ax2& parallel, const TopoDS_Wire& auxiliary, double scale, TopoDS_Shape& solid,
                     TopoDS_Shape& firstCap, TopoDS_Shape& lastCap, SideList& sides) {
    BRepOffsetAPI_MakePipeShell pipe(spine);
    if (!auxiliary.IsNull()) {
      pipe.SetMode(auxiliary, false, BRepFill_NoContact);
    } else if (mode == 1) {
      pipe.SetMode(parallel);
    } else if (mode == 2) {
      pipe.SetMode(fixed);
    } else {
      pipe.SetMode(false);
    }
    pipe.SetTransitionMode(BRepBuilderAPI_RightCorner);
    if (std::abs(scale - 1) > 1e-9) {
      double from = 0;
      double to = 1;
      lawRange(spine, from, to);
      Handle(Law_Linear) law = new Law_Linear();
      law->Set(from, 1.0, to, scale);
      pipe.SetLaw(section, law, false, false);
    } else {
      pipe.Add(section, false, false);
    }
    if (!pipe.IsReady()) return 1;
    pipe.Build();
    if (!pipe.IsDone()) return 1;
    if (!pipe.MakeSolid()) return 1;
    solid = pipe.Shape();
    if (solid.ShapeType() == TopAbs_SOLID) {
      TopoDS_Solid oriented = TopoDS::Solid(solid);
      BRepLib::OrientClosedSolid(oriented);
      solid = oriented;
    }
    if (!(volumeOf(solid) > 0)) return 2;
    firstCap = pipe.FirstShape();
    lastCap = pipe.LastShape();
    for (TopExp_Explorer e(section, TopAbs_EDGE); e.More(); e.Next()) {
      std::vector<TopoDS_Shape> list;
      for (const TopoDS_Shape& s : pipe.Generated(e.Current())) {
        if (s.ShapeType() == TopAbs_FACE) list.push_back(s);
      }
      sides.emplace_back(e.Current(), std::move(list));
    }
    return 0;
  }

  /** The parameter range a scale law runs over along `spine` (see the harness's law test). */
  static void lawRange(const TopoDS_Wire& spine, double& from, double& to) {
    BRepAdaptor_CompCurve curve(spine);
    from = curve.FirstParameter();
    to = curve.LastParameter();
  }

  /**
   * Whether a sweep along `wire` of a profile reaching `reach` from its start
   * could cross itself: a bend tighter than the reach, a corner, or the path
   * coming back within twice the reach of itself. Cheap and conservative:
   * only a "yes" is worth the slow `crossesItself`.
   */
  static bool sweepMayCross(const TopoDS_Wire& wire, double reach) {
    if (!smoothWire(wire)) return true;
    BRepAdaptor_CompCurve curve(wire);
    const int steps = 200;
    GCPnts_QuasiUniformAbscissa spacing(curve, steps + 1);
    if (!spacing.IsDone()) return true;
    std::vector<gp_Pnt> points;
    for (int i = 1; i <= spacing.NbPoints(); ++i) {
      gp_Pnt p;
      gp_Vec d1;
      gp_Vec d2;
      curve.D2(spacing.Parameter(i), p, d1, d2);
      const double speed = d1.Magnitude();
      if (speed > 1e-12 && d1.Crossed(d2).Magnitude() / (speed * speed * speed) * reach > 0.9) return true;
      points.push_back(p);
    }
    double total = 0;
    for (size_t i = 1; i < points.size(); ++i) total += points[i].Distance(points[i - 1]);
    const double step = total / std::max<size_t>(1, points.size() - 1);
    if (!(step > 0)) return false;
    // Parts of the path far apart along it (more than 4 reaches) and close in space.
    const size_t apart = static_cast<size_t>(std::ceil(4 * reach / step)) + 1;
    for (size_t i = 0; i < points.size(); ++i) {
      for (size_t j = i + apart; j < points.size(); ++j) {
        if (points[i].Distance(points[j]) < 2.1 * reach) return true;
      }
    }
    return false;
  }

  /** Whether a shape meets itself where it shouldn't (the argument analyser's self-intersection check). */
  static bool crossesItself(const TopoDS_Shape& shape) {
    size_t faces = 0;
    for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next()) ++faces;
    if (faces > 96) return false;
    BOPAlgo_ArgumentAnalyzer analyzer;
    analyzer.SetShape1(shape);
    analyzer.SelfInterMode() = true;
    analyzer.ArgumentTypeMode() = false;
    analyzer.SmallEdgeMode() = false;
    analyzer.RebuildFaceMode() = false;
    analyzer.TangentMode() = false;
    analyzer.MergeVertexMode() = false;
    analyzer.MergeEdgeMode() = false;
    analyzer.ContinuityMode() = false;
    analyzer.CurveOnSurfaceMode() = false;
    analyzer.SetRunParallel(false);
    analyzer.Perform();
    return analyzer.HasFaulty();
  }

  int sweepStatus(int status, const char* message) {
    geometry_.assign(1, static_cast<double>(status));
    return fail(message);
  }

  int loftStatus(int status, size_t section, const char* message) {
    geometry_.assign({static_cast<double>(status), static_cast<double>(section)});
    return fail(message);
  }

  /** A history record from one sub-shape to the result's faces among `shapes` (none: no record). */
  void recordFaces(int input, int kind, int index, int relation, const std::vector<TopoDS_Shape>& shapes,
                   const NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>& resultFaces) {
    std::vector<int32_t> pairs;
    for (const TopoDS_Shape& s : shapes) {
      const int found = resultFaces.FindIndex(s);
      if (found <= 0) continue;
      bool seen = false;
      for (size_t k = 1; k < pairs.size(); k += 2) seen = seen || pairs[k] == found - 1;
      if (seen) continue;
      pairs.push_back(0);
      pairs.push_back(found - 1);
    }
    if (pairs.empty()) return;
    pushRecord(input, kind, index, relation);
    history_.push_back(static_cast<int32_t>(pairs.size() / 2));
    history_.insert(history_.end(), pairs.begin(), pairs.end());
  }
