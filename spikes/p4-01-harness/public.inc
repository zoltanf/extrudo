  // ------------------------------------------- paths, sweeps and lofts (P4-01) --
  //
  // A path (ADR-0055) is staged piece by piece: pathClear(), then
  // pathSketch() for the curves staged with sketchClear()/sketch*() (placed in
  // a sketch's frame) and pathEdge() for an edge of a shape, then pathWire()
  // chains them into one wire. helix() makes a coil's path. sweep() moves a
  // profile along a wire, loft() goes through profiles in order. Both record
  // history like prism (first, last, generated).

  void pathClear() { pathEdges_.clear(); }

  /**
   * The curves staged with sketchClear()/sketch*() (exact lines, arcs,
   * ellipses and splines), placed in the frame (origin, X direction,
   * normal) like sketchProfiles() places faces, as pieces of the path.
   * Returns the number of pieces staged so far (0 on failure).
   */
  int pathSketch(double ox, double oy, double oz, double xx, double xy, double xz, double nx, double ny,
                 double nz) {
    beginOp();
    if (sketchEdges_.empty()) return fail("The path has no curves.");
    try {
      gp_Trsf placement;
      placement.SetDisplacement(gp_Ax3(), gp_Ax3(gp_Pnt(ox, oy, oz), gp_Dir(nx, ny, nz), gp_Dir(xx, xy, xz)));
      for (const TopoDS_Edge& edge : sketchEdges_) {
        BRepBuilderAPI_Transform moved(edge, placement, true);
        if (!moved.IsDone()) return fail("Couldn't place a curve of the path.");
        pathEdges_.push_back(TopoDS::Edge(moved.Shape()));
      }
      return static_cast<int>(pathEdges_.size());
    } catch (...) {
      return failFromException("Path failed");
    }
  }

  /** An edge (0-based index) of `shape` as a piece of the path. Returns the number of pieces (0 on failure). */
  int pathEdge(int shape, int edge) {
    beginOp();
    const TopoDS_Shape* input = find(shape);
    if (input == nullptr) return fail("Path failed: unknown input shape.");
    NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
    TopExp::MapShapes(*input, TopAbs_EDGE, edges);
    if (edge < 0 || edge >= edges.Extent()) return fail("Path failed: edge index out of range.");
    const TopoDS_Edge piece = TopoDS::Edge(edges(edge + 1));
    if (BRep_Tool::Degenerated(piece)) return fail("An edge of the path has no length.");
    pathEdges_.push_back(TopoDS::Edge(piece.Oriented(TopAbs_FORWARD)));
    return static_cast<int>(pathEdges_.size());
  }

  /**
   * The staged pieces chained end to end into one wire; ends within
   * `tolerance` (mm) are one point. The wire starts with the first piece in
   * its own direction (pieces before it are added at the front, reversed
   * where they must be). Fails when the pieces don't make one chain (a
   * gap, or a branch): geometryNumbers is then [n], n the number of pieces
   * that couldn't be joined.
   */
  int pathWire(double tolerance) {
    beginOp();
    geometry_.clear();
    if (pathEdges_.empty()) return fail("The path has no pieces.");
    try {
      const size_t n = pathEdges_.size();
      std::vector<gp_Pnt> starts(n);
      std::vector<gp_Pnt> ends(n);
      for (size_t i = 0; i < n; ++i) {
        TopoDS_Vertex a;
        TopoDS_Vertex b;
        TopExp::Vertices(pathEdges_[i], a, b, true);
        starts[i] = BRep_Tool::Pnt(a);
        ends[i] = BRep_Tool::Pnt(b);
      }
      std::vector<bool> used(n, false);
      std::vector<std::pair<size_t, bool>> chain;  // piece, reversed
      chain.emplace_back(0, false);
      used[0] = true;
      gp_Pnt head = starts[0];
      gp_Pnt tail = ends[0];
      const bool loop = head.Distance(tail) <= tolerance;
      bool grew = !loop;
      while (grew) {
        grew = false;
        for (size_t i = 0; i < n && !grew; ++i) {
          if (used[i]) continue;
          if (starts[i].Distance(tail) <= tolerance) {
            chain.emplace_back(i, false);
            tail = ends[i];
          } else if (ends[i].Distance(tail) <= tolerance) {
            chain.emplace_back(i, true);
            tail = starts[i];
          } else if (ends[i].Distance(head) <= tolerance) {
            chain.insert(chain.begin(), {i, false});
            head = starts[i];
          } else if (starts[i].Distance(head) <= tolerance) {
            chain.insert(chain.begin(), {i, true});
            head = ends[i];
          } else {
            continue;
          }
          used[i] = true;
          // A chain that closed on itself takes nothing more.
          grew = head.Distance(tail) > tolerance;
        }
      }
      if (chain.size() != n) {
        geometry_.push_back(static_cast<double>(n - chain.size()));
        return fail("The pieces of the path don't make one chain: some don't meet the others.");
      }
      BRepBuilderAPI_MakeWire maker;
      for (const auto& [piece, reversed] : chain) {
        maker.Add(reversed ? TopoDS::Edge(pathEdges_[piece].Reversed()) : pathEdges_[piece]);
        if (!maker.IsDone()) break;
      }
      TopoDS_Wire wire;
      if (maker.IsDone()) wire = maker.Wire();
      if (wire.IsNull() || !pathWireIsGood(wire, n)) {
        // Ends that meet only within the tolerance: copies whose vertices are loose enough to join.
        BRepBuilderAPI_MakeWire loose;
        BRep_Builder vertices;
        for (const auto& [piece, reversed] : chain) {
          const TopoDS_Shape copy = BRepBuilderAPI_Copy(pathEdges_[piece], true, false).Shape();
          for (TopExp_Explorer e(copy, TopAbs_VERTEX); e.More(); e.Next()) {
            vertices.UpdateVertex(TopoDS::Vertex(e.Current()), tolerance);
          }
          loose.Add(reversed ? TopoDS::Edge(copy.Reversed()) : TopoDS::Edge(copy));
          if (!loose.IsDone()) break;
        }
        if (!loose.IsDone()) return fail("Couldn't join the pieces of the path into a wire.");
        wire = loose.Wire();
        if (!pathWireIsGood(wire, n)) return fail("Couldn't join the pieces of the path into a wire.");
      }
      return store(wire);
    } catch (...) {
      return failFromException("Path failed");
    }
  }

  /**
   * A helix on a cylinder (or a cone) as a one-edge wire: a coil's path
   * (P4-01), which P4-02's modeled threads reuse. It starts at
   * `origin + radius·x`, turns about the axis through `origin` along `z` for
   * `turns` turns (fractions allowed), rising `pitch` mm along the axis per
   * turn, counter-clockwise seen from the axis's tip, or clockwise with
   * `left`. A non-zero `taper` (radians, |taper| < π/2) is the cone's half
   * angle: the radius grows by tan(taper) per mm of height (negative
   * shrinks; it must stay above 0). `x` need not be perpendicular to `z`:
   * it is made so. The edge is the exact helix on the surface, with a 3D
   * B-spline within 0.1 µm of it.
   */
  int helix(double ox, double oy, double oz, double zx, double zy, double zz, double xx, double xy, double xz,
            double radius, double pitch, double turns, double taper, bool left) {
    beginOp();
    try {
      if (!(radius > Precision::Confusion())) return fail("The coil's radius must be greater than 0.");
      if (!(pitch > Precision::Confusion())) return fail("The coil's pitch must be greater than 0.");
      if (!(turns > 1e-6)) return fail("The coil needs more than 0 turns.");
      if (turns > 1000) return fail("The coil can have at most 1000 turns.");
      if (std::abs(taper) >= M_PI / 2 - 1e-3) return fail("The coil's taper angle must be between -90° and 90°.");
      if (radius + std::tan(taper) * pitch * turns <= Precision::Confusion()) {
        return fail("The coil's taper makes it narrow to nothing before its end.");
      }
      const gp_Dir axis(zx, zy, zz);
      const gp_Dir toward(xx, xy, xz);
      if (axis.IsParallel(toward, 1e-9)) return fail("The coil's start direction runs along its axis.");
      const gp_Ax3 frame(gp_Pnt(ox, oy, oz), axis, toward);
      Handle(Geom_Surface) surface;
      double rise = pitch;
      if (std::abs(taper) > 1e-12) {
        // v runs along the cone's generator: a pitch along the axis is `pitch / cos(taper)` of it.
        surface = new Geom_ConicalSurface(frame, taper, radius);
        rise = pitch / std::cos(taper);
      } else {
        surface = new Geom_CylindricalSurface(frame, radius);
      }
      const double turnSign = left ? -1.0 : 1.0;
      const gp_Dir2d direction(turnSign * 2 * M_PI, rise);
      Handle(Geom2d_Line) line = new Geom2d_Line(gp_Pnt2d(0, 0), direction);
      const double length = turns * std::sqrt(4 * M_PI * M_PI + rise * rise);
      BRepBuilderAPI_MakeEdge edge(line, surface, 0, length);
      if (!edge.IsDone()) return fail("Couldn't make the coil's helix.");
      TopoDS_Edge helixEdge = edge.Edge();
      if (!BRepLib::BuildCurves3d(helixEdge, 1e-7, GeomAbs_C2, 14, 2000)) {
        return fail("Couldn't build the coil's helix as a 3D curve.");
      }
      BRepBuilderAPI_MakeWire wire(helixEdge);
      if (!wire.IsDone()) return fail("Couldn't make a wire of the coil's helix.");
      return store(wire.Wire());
    } catch (...) {
      return failFromException("Coil failed");
    }
  }

  /**
   * Sweeps a profile (a face, or a compound of faces, holes and all) along
   * `spine` (a wire) into a solid (a compound of solids for several faces).
   * The profile stays where it is and goes along with the path's frame from
   * the path's end nearer to it (the wire is turned round when the far end
   * is nearer).
   *
   * `mode` is how the profile turns with the path: 0 it keeps its angle to
   * the path (a corrected Frenet frame), 1 not at all (it stays parallel to
   * itself), 2 it keeps its angle to the fixed direction (dx, dy, dz) (a
   * coil's axis). `twist` (radians, mode 0 only) turns it about the path by
   * that much from start to end, evenly by length (the path must be smooth).
   * `scale` (> 0) scales it about the path from 1 at the start to `scale` at
   * the end, evenly (not on a closed path). Sharp corners of the path are
   * mitred. With `verify`, a sweep that might cross itself (a tight bend
   * for the profile's reach, a path coming back near itself, a corner) is
   * checked for it: slow on long curved paths (a coil), so a caller that
   * knows better leaves it off.
   *
   * History for input 0 (the profile as passed in): first (4) and last (5)
   * for faces (the caps), generated (1) for edges (the side faces). On
   * failure geometryNumbers holds [status]: 1 OCCT couldn't sweep it (a
   * section too large for a tight turn, a corner it can't mitre), 2 the
   * result crosses itself or isn't a sound solid, 3 a twist on a path with a
   * sharp corner, 4 a scale on a closed path.
   */
  int sweep(int profile, int spine, int mode, double twist, double scale, bool verify, double dx, double dy,
            double dz) {
    beginOp();
    geometry_.clear();
    const TopoDS_Shape* base = find(profile);
    const TopoDS_Shape* path = find(spine);
    if (base == nullptr || path == nullptr) return fail("Sweep failed: unknown input shape.");
    if (path->ShapeType() != TopAbs_WIRE) return fail("Sweep failed: the path isn't a wire.");
    if (!(scale > 1e-6)) return fail("Sweep failed: the end scale must be greater than 0.");
    if (mode < 0 || mode > 2) return fail("Sweep failed: unknown orientation mode.");
    if (mode == 2 && gp_Vec(dx, dy, dz).Magnitude() <= 1e-12) {
      return fail("Sweep failed: the fixed direction has no length.");
    }
    const bool twists = std::abs(twist) > 1e-12;
    if (twists && mode != 0) return fail("Sweep failed: only a sweep that follows the path can twist.");
    try {
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> baseFaces;
      TopExp::MapShapes(*base, TopAbs_FACE, baseFaces);
      std::vector<TopoDS_Face> faces;
      for (int i = 1; i <= baseFaces.Extent(); ++i) faces.push_back(TopoDS::Face(baseFaces(i)));
      if (faces.empty()) return fail("Sweep failed: nothing to sweep.");
      const bool scales = std::abs(scale - 1) > 1e-9;

      // The path runs from the end nearer the profile.
      TopoDS_Wire wire = TopoDS::Wire(*path);
      gp_Pnt first;
      gp_Pnt last;
      wireEnds(wire, first, last);
      const bool closed = first.Distance(last) <= 1e-6;
      if (closed && scales) return sweepStatus(4, "Sweep failed: a closed path can't scale.");
      GProp_GProps props;
      BRepGProp::SurfaceProperties(*base, props);
      const gp_Pnt centre = props.CentreOfMass();
      if (!closed && centre.Distance(last) < centre.Distance(first)) {
        wire = reversedWire(wire);
        if (wire.IsNull()) return sweepStatus(1, "Sweep failed: couldn't turn the path round.");
        std::swap(first, last);
      }
      // How far the profile reaches from the path's start.
      double reach = 0;
      for (const TopoDS_Face& face : faces) {
        Bnd_Box box;
        BRepBndLib::Add(face, box);
        double x0, y0, z0, x1, y1, z1;
        box.Get(x0, y0, z0, x1, y1, z1);
        for (double x : {x0, x1})
          for (double y : {y0, y1})
            for (double z : {z0, z1}) reach = std::max(reach, first.Distance(gp_Pnt(x, y, z)));
      }
      const gp_Dir fixed = mode == 2 ? gp_Dir(dx, dy, dz) : gp_Dir(0, 0, 1);
      gp_Ax2 parallel(first, gp_Dir(0, 0, 1));
      if (mode == 1) {
        // Parallel to itself: any fixed frame does; the first face's normal is a natural one.
        const BRepAdaptor_Surface surface(faces[0]);
        if (surface.GetType() == GeomAbs_Plane) parallel = gp_Ax2(first, surface.Plane().Axis().Direction());
      }
      TopoDS_Wire auxiliary;
      if (twists) {
        if (!smoothWire(wire)) {
          return sweepStatus(3, "Sweep failed: a twisted sweep needs a smooth path, without sharp corners.");
        }
        auxiliary = twistSpine(wire, twist, std::max(1.0, reach));
        if (auxiliary.IsNull()) return sweepStatus(1, "Sweep failed: couldn't twist along this path.");
      }
      const double endScale = scales ? scale : 1.0;

      BRep_Builder builder;
      TopoDS_Compound solids;
      builder.MakeCompound(solids);
      SideList sides;  // profile edge -> its side faces
      std::vector<std::vector<TopoDS_Shape>> firsts(faces.size());
      std::vector<std::vector<TopoDS_Shape>> lasts(faces.size());
      for (size_t f = 0; f < faces.size(); ++f) {
        const TopoDS_Face& face = faces[f];
        const TopoDS_Wire outer = BRepTools::OuterWire(face);
        std::vector<TopoDS_Wire> inner;
        for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) {
          if (!w.Current().IsSame(outer)) inner.push_back(TopoDS::Wire(w.Current()));
        }
        TopoDS_Shape whole;
        TopoDS_Shape firstCap;
        TopoDS_Shape lastCap;
        SideList made;
        int status = pipeOne(wire, outer, mode, fixed, parallel, auxiliary, endScale, whole, firstCap, lastCap, made);
        std::vector<TopoDS_Shape> holes;
        for (size_t i = 0; status == 0 && i < inner.size(); ++i) {
          TopoDS_Shape hole;
          TopoDS_Shape holeFirst;
          TopoDS_Shape holeLast;
          status = pipeOne(wire, inner[i], mode, fixed, parallel, auxiliary, endScale, hole, holeFirst, holeLast, made);
          holes.push_back(hole);
        }
        if (status != 0) {
          return sweepStatus(status, status == 2 ? "Sweep failed: the sweep crosses itself or isn't a sound solid."
                                                 : "Sweep failed: OCCT couldn't sweep this profile along the path.");
        }
        TopoDS_Shape solid = whole;
        // Each face's images through the cut of the holes (itself without holes).
        std::map<const TopoDS_TShape*, std::vector<TopoDS_Shape>> kept;
        if (!holes.empty()) {
          BRepAlgoAPI_Cut cut;
          NCollection_List<TopoDS_Shape> targets;
          NCollection_List<TopoDS_Shape> tools;
          targets.Append(whole);
          for (const TopoDS_Shape& h : holes) tools.Append(h);
          cut.SetArguments(targets);
          cut.SetTools(tools);
          cut.SetRunParallel(false);
          cut.Build();
          if (!cut.IsDone() || cut.HasErrors()) {
            return sweepStatus(1, "Sweep failed: OCCT couldn't cut the profile's holes out of the sweep.");
          }
          solid = cut.Shape();
          auto remember = [&](const TopoDS_Shape& from) {
            for (TopExp_Explorer e(from, TopAbs_FACE); e.More(); e.Next()) {
              std::vector<TopoDS_Shape> list;
              if (!cut.IsDeleted(e.Current())) {
                for (const TopoDS_Shape& m : cut.Modified(e.Current())) list.push_back(m);
                if (list.empty()) list.push_back(e.Current());
              }
              kept[e.Current().TShape().get()] = list;
            }
          };
          remember(whole);
          for (const TopoDS_Shape& h : holes) remember(h);
        }
        auto images = [&kept](const TopoDS_Shape& s) {
          const auto it = kept.find(s.TShape().get());
          return it == kept.end() ? std::vector<TopoDS_Shape>{s} : it->second;
        };
        builder.Add(solids, solid);
        // The holes' caps go with the cut: the outer caps, cut, are the profile face's caps.
        for (TopExp_Explorer e(firstCap, TopAbs_FACE); e.More(); e.Next()) {
          for (const TopoDS_Shape& s : images(e.Current())) firsts[f].push_back(s);
        }
        for (TopExp_Explorer e(lastCap, TopAbs_FACE); e.More(); e.Next()) {
          for (const TopoDS_Shape& s : images(e.Current())) lasts[f].push_back(s);
        }
        for (const auto& [edge, list] : made) {
          std::vector<TopoDS_Shape> mapped;
          for (const TopoDS_Shape& m : list) {
            for (const TopoDS_Shape& s : images(m)) mapped.push_back(s);
          }
          sides.emplace_back(edge, std::move(mapped));
        }
      }

      // One solid is the result itself, several a compound.
      TopoDS_Shape result = solids;
      int count = 0;
      TopoDS_Shape only;
      for (TopoDS_Iterator it(solids); it.More(); it.Next()) {
        ++count;
        only = it.Value();
      }
      if (count == 1) result = only;
      if (!BRepCheck_Analyzer(result).IsValid() || (verify && sweepMayCross(wire, reach) && crossesItself(result))) {
        return sweepStatus(2, "Sweep failed: the sweep crosses itself or isn't a sound solid.");
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
      TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> baseEdges;
      TopExp::MapShapes(*base, TopAbs_EDGE, baseEdges);
      // Caps: each face of the profile maps to its own caps.
      for (size_t f = 0; f < faces.size(); ++f) {
        recordFaces(0, 0, static_cast<int>(f), 4, firsts[f], resultFaces);
        recordFaces(0, 0, static_cast<int>(f), 5, lasts[f], resultFaces);
      }
      for (const auto& [edge, made] : sides) {
        const int index = baseEdges.FindIndex(edge);
        if (index > 0) recordFaces(0, 1, index - 1, 1, made, resultFaces);
      }
      return store(result);
    } catch (...) {
      geometry_.assign(1, 1.0);
      return failFromException("Sweep failed");
    }
  }

  /**
   * Lofts through the staged sections in order (clearArgs/pushArg): a handle
   * of a shape holding one face without holes, or 0 for a point, read as
   * three numbers (clearNumbers/pushNumber, x y z, in the order the points
   * come); a point may only be the first or the last section. A smooth solid
   * through them all, or with `ruled` flat or ruled between neighbours. With
   * `closed` the last section joins the first again: a ring, no caps (at
   * least three sections, no points).
   *
   * History, input i for section i (indices of its shape as passed in):
   * first (4) for the first section's face and last (5) for the last's (the
   * caps), generated (1) from every section's edges (the side faces each
   * edge bounds). On failure geometryNumbers are [status, section]: 1 OCCT
   * couldn't loft them, 2 the loft crosses itself or isn't a sound solid, 3 a
   * section has holes, 5 a section isn't one face, 6 a point in the middle.
   */
  int loft(bool ruled, bool closed) {
    beginOp();
    geometry_.clear();
    try {
      const size_t n = args_.size();
      if (n < 2) return fail("Loft failed: it needs at least two sections.");
      if (closed && n < 3) return fail("Loft failed: a closed loft needs at least three sections.");
      std::vector<TopoDS_Face> faces(n);
      std::vector<TopoDS_Vertex> points(n);
      size_t numbered = 0;
      for (size_t i = 0; i < n; ++i) {
        if (args_[i] == 0) {
          if (closed || (i != 0 && i != n - 1)) return loftStatus(6, i, "Loft failed: a point can only start or end a loft.");
          if (numbers_.size() < 3 * (numbered + 1)) return fail("Loft failed: a point section has no coordinates.");
          const gp_Pnt p(numbers_[3 * numbered], numbers_[3 * numbered + 1], numbers_[3 * numbered + 2]);
          ++numbered;
          points[i] = BRepBuilderAPI_MakeVertex(p).Vertex();
          continue;
        }
        const TopoDS_Shape* shape = find(args_[i]);
        if (shape == nullptr) return fail("Loft failed: unknown input shape.");
        int count = 0;
        TopoDS_Face face;
        for (TopExp_Explorer e(*shape, TopAbs_FACE); e.More(); e.Next()) {
          face = TopoDS::Face(e.Current());
          ++count;
        }
        if (count != 1) return loftStatus(5, i, "Loft failed: a section isn't a single face.");
        int wires = 0;
        for (TopExp_Explorer w(face, TopAbs_WIRE); w.More(); w.Next()) ++wires;
        if (wires != 1) return loftStatus(3, i, "Loft failed: a section has holes.");
        faces[i] = face;
      }
      if (faces.front().IsNull() && faces.back().IsNull() && n == 2) {
        return fail("Loft failed: it needs at least one profile.");
      }
      TopoDS_Shape result;
      std::vector<TopoDS_Shape> firstCap;
      std::vector<TopoDS_Shape> lastCap;
      // Per section, each edge's generated faces.
      std::vector<SideList> made(n);
      {
        BRepOffsetAPI_ThruSections builder(true, ruled, 1e-6);
        builder.SetMutableInput(false);
        // An edge's pieces in the sections OCCT lofts (a closed loft's, made compatible here).
        NCollection_DataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher> pieces;
        if (closed) {
          // OCCT lofts a ring only when the last section is the first itself, and its own
          // compatibility pass copies them apart: line the sections up first, then repeat the first.
          NCollection_Sequence<TopoDS_Shape> sections;
          for (size_t i = 0; i < n; ++i) sections.Append(BRepTools::OuterWire(faces[i]));
          BRepFill_CompatibleWires compatible(sections);
          compatible.Perform();
          if (!compatible.IsDone()) return loftStatus(1, 0, "Loft failed: OCCT couldn't line these sections up.");
          const NCollection_Sequence<TopoDS_Shape>& lined = compatible.Shape();
          for (int i = 1; i <= lined.Length(); ++i) builder.AddWire(TopoDS::Wire(lined(i)));
          builder.AddWire(TopoDS::Wire(lined(1)));
          builder.CheckCompatibility(false);
          pieces = compatible.Generated();
        } else {
          builder.CheckCompatibility(true);
          for (size_t i = 0; i < n; ++i) {
            if (!points[i].IsNull()) builder.AddVertex(points[i]);
            else builder.AddWire(BRepTools::OuterWire(faces[i]));
          }
        }
        builder.Build();
        if (!builder.IsDone()) return loftStatus(1, 0, "Loft failed: OCCT couldn't loft through these sections.");
        result = builder.Shape();
        if (!closed) {
          for (TopExp_Explorer e(builder.FirstShape(), TopAbs_FACE); e.More(); e.Next()) firstCap.push_back(e.Current());
          for (TopExp_Explorer e(builder.LastShape(), TopAbs_FACE); e.More(); e.Next()) lastCap.push_back(e.Current());
        }
        for (size_t i = 0; i < n; ++i) {
          if (faces[i].IsNull()) continue;
          for (TopExp_Explorer e(faces[i], TopAbs_EDGE); e.More(); e.Next()) {
            NCollection_List<TopoDS_Shape> own;
            if (pieces.IsBound(e.Current())) own = pieces.Find(e.Current());
            if (own.IsEmpty()) own.Append(e.Current());
            std::vector<TopoDS_Shape> list;
            for (const TopoDS_Shape& piece : own) {
              for (const TopoDS_Shape& s : builder.Generated(piece)) {
                if (s.ShapeType() == TopAbs_FACE) list.push_back(s);
              }
            }
            made[i].emplace_back(e.Current(), std::move(list));
          }
        }
      }
      if (result.ShapeType() != TopAbs_SOLID) {
        TopoDS_Shape solid;
        for (TopExp_Explorer e(result, TopAbs_SOLID); e.More(); e.Next()) {
          if (!solid.IsNull()) return loftStatus(2, 0, "Loft failed: the loft isn't one solid.");
          solid = e.Current();
        }
        if (solid.IsNull()) return loftStatus(1, 0, "Loft failed: OCCT couldn't make a solid of the loft.");
        result = solid;
      }
      if (volumeOf(result) < 0) result.Reverse();
      // (A ring's faces close on themselves along a seam that isn't periodic, which the
      // self-intersection check takes for a crossing: a ring is checked for soundness only.)
      if (!BRepCheck_Analyzer(result).IsValid() || !(volumeOf(result) > 0) || (!closed && crossesItself(result))) {
        return loftStatus(2, 0, "Loft failed: the loft crosses itself or isn't a sound solid.");
      }
      NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> resultFaces;
      TopExp::MapShapes(result, TopAbs_FACE, resultFaces);
      if (!faces.front().IsNull()) recordFaces(0, 0, 0, 4, firstCap, resultFaces);
      if (!faces.back().IsNull()) recordFaces(static_cast<int>(n - 1), 0, 0, 5, lastCap, resultFaces);
      for (size_t i = 0; i < n; ++i) {
        if (faces[i].IsNull()) continue;
        NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> edges;
        TopExp::MapShapes(faces[i], TopAbs_EDGE, edges);
        for (const auto& [edge, list] : made[i]) {
          const int index = edges.FindIndex(edge);
          if (index > 0) recordFaces(static_cast<int>(i), 1, index - 1, 1, list, resultFaces);
        }
      }
      return store(result);
    } catch (...) {
      geometry_.assign({1.0, 0.0});
      return failFromException("Loft failed");
    }
  }

