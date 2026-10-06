// Native harness for STEP colours (P4-12, ADR-0034's amendment): the
// facade's readStepColors (XDE reader) and writeStep's coloured path
// (stageStepColor, STEPCAFControl_Writer). Built and run inside the pinned
// OCCT image by run.sh.
//
//   node harness.cjs          the checks (exits 1 on a failure)
//   node harness.cjs leaks N  heap top after N and 5N rounds of every call
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

#include <BRepBndLib.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
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

static TopoDS_Shape boxAt(double x, double y, double z, double size) {
  return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), size, size, size).Shape();
}

/** Bounding-box centres of the solids of readStep()'s shape, in count()/subShape() order. */
static std::vector<gp_Pnt> plainCentres(const std::string& text) {
  std::vector<gp_Pnt> out;
  const int h = f.readStep(text.c_str());
  if (h == 0) return out;
  const int n = f.count(h, 3);
  for (int i = 0; i < n; ++i) {
    const int s = f.subShape(h, 3, i);
    Bnd_Box box;
    BRepBndLib::Add(*f.find(s), box);
    double x0, y0, z0, x1, y1, z1;
    box.Get(x0, y0, z0, x1, y1, z1);
    out.emplace_back((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    f.release(s);
  }
  f.release(h);
  return out;
}

static std::vector<double> colours(const std::string& text, int& faces) {
  const int n = f.readStepColors(text.c_str());
  std::vector<double> out;
  faces = -1;
  if (n < 0) return out;
  faces = static_cast<int>(f.geometry_[0]);
  out.assign(f.geometry_.begin() + 1, f.geometry_.end());
  return out;
}

static bool near(double a, double b) { return std::abs(a - b) < 0.5 / 255; }

/** A file another program might write: XDE with a solid coloured and two faces of another. */
static std::string xdeFile(bool assembly) {
  Handle(TDocStd_Document) doc = new TDocStd_Document("BinXCAF");
  XCAFDoc_DocumentTool::Set(doc->Main(), false);
  std::string text;
  {
    Handle(XCAFDoc_ShapeTool) shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
    Handle(XCAFDoc_ColorTool) colors = XCAFDoc_DocumentTool::ColorTool(doc->Main());
    if (!assembly) {
      const TDF_Label a = shapes->AddShape(boxAt(0, 0, 0, 10), false, false);
      colors->SetColor(a, Quantity_Color(1, 0, 0, Quantity_TOC_sRGB), XCAFDoc_ColorSurf);
      const TopoDS_Shape bShape = boxAt(20, 0, 0, 10);
      const TDF_Label b = shapes->AddShape(bShape, false, false);
      int k = 0;
      for (TopExp_Explorer e(bShape, TopAbs_FACE); e.More() && k < 2; e.Next(), ++k) {
        const TDF_Label face = shapes->AddSubShape(b, e.Current());
        colors->SetColor(face, Quantity_Color(0, 0, 1, Quantity_TOC_sRGB), XCAFDoc_ColorSurf);
      }
    } else {
      // One part placed twice and a third solid of its own: the second
      // instance coloured green, the first not, the loose solid yellow.
      const TDF_Label part = shapes->AddShape(boxAt(0, 0, 0, 5), false, false);
      const TDF_Label assy = shapes->NewShape();
      gp_Trsf t1, t2;
      t1.SetTranslation(gp_Vec(0, 30, 0));
      t2.SetTranslation(gp_Vec(0, 60, 0));
      shapes->AddComponent(assy, part, TopLoc_Location(t1));
      const TDF_Label second = shapes->AddComponent(assy, part, TopLoc_Location(t2));
      colors->SetColor(second, Quantity_Color(0, 1, 0, Quantity_TOC_sRGB), XCAFDoc_ColorSurf);
      shapes->UpdateAssemblies();
      const TDF_Label loose = shapes->AddShape(boxAt(40, 0, 0, 5), false, false);
      colors->SetColor(loose, Quantity_Color(1, 1, 0, Quantity_TOC_sRGB), XCAFDoc_ColorGen);
    }
    STEPCAFControl_Writer writer;
    writer.Transfer(doc, ExtrudoFacade::stepParameters());
    std::ostringstream out;
    writer.WriteStream(out);
    text = out.str();
  }
  doc->Main().Root().ForgetAllAttributes(true);
  return text;
}

static std::string ourFile(bool coloured) {
  const int a = f.store(boxAt(0, 0, 0, 10));
  const int b = f.store(boxAt(20, 0, 0, 10));
  const int c = f.store(boxAt(40, 0, 0, 10));
  f.clearArgs();
  f.clearStepNames();
  f.clearStepColors();
  for (int h : {a, b, c}) f.pushArg(h);
  f.pushStepName("Alpha");
  f.pushStepName("Beta");
  f.pushStepName("G\\X2\\00E4\\X0\\mma");
  if (coloured) {
    f.stageStepColor(200 / 255.0, 30 / 255.0, 40 / 255.0);
    f.stageStepColor(-1, -1, -1);
    f.stageStepColor(16 / 255.0, 128 / 255.0, 1);
  }
  const int size = f.writeStep();
  std::string text = size > 0 ? f.exportText_ : "";
  f.clearExport();
  f.clearStepColors();
  f.clearStepNames();
  f.release(a);
  f.release(b);
  f.release(c);
  return text;
}

static void checks() {
  int faces = 0;
  {
    const std::string text = xdeFile(false);
    const std::vector<double> c = colours(text, faces);
    check(c.size() == 6, "two solids read from an XDE file");
    check(c.size() == 6 && near(c[0], 1) && near(c[1], 0) && near(c[2], 0), "the coloured solid is red");
    check(c.size() == 6 && c[3] < 0 && c[4] < 0 && c[5] < 0, "the solid with coloured faces has none");
    check(faces == 2, "two faces with colours of their own (got " + std::to_string(faces) + ")");
    const std::vector<gp_Pnt> p = plainCentres(text);
    check(p.size() == 2 && p[0].X() < 10 && p[1].X() > 20, "readStep lists the red solid first too");
  }
  {
    const std::string text = xdeFile(true);
    const std::vector<double> c = colours(text, faces);
    const std::vector<gp_Pnt> p = plainCentres(text);
    std::printf("  assembly: %zu colours, %zu plain solids\n", c.size() / 3, p.size());
    for (size_t i = 0; i < p.size(); ++i) {
      std::printf("    solid %zu at (%.1f, %.1f, %.1f) colour %s\n", i, p[i].X(), p[i].Y(), p[i].Z(),
                  3 * i + 2 < c.size()
                      ? (std::to_string(c[3 * i]) + "," + std::to_string(c[3 * i + 1]) + "," +
                         std::to_string(c[3 * i + 2]))
                            .c_str()
                      : "?");
    }
    check(c.size() == 9 && p.size() == 3, "three solids either way");
    // Match each plain solid to its expected colour by position.
    bool ok = c.size() == 9 && p.size() == 3;
    for (size_t i = 0; ok && i < 3; ++i) {
      const double y = p[i].Y(), x = p[i].X();
      if (x > 30) ok = near(c[3 * i], 1) && near(c[3 * i + 1], 1) && near(c[3 * i + 2], 0);
      else if (y > 50) ok = near(c[3 * i], 0) && near(c[3 * i + 1], 1) && near(c[3 * i + 2], 0);
      else ok = c[3 * i] < 0;
    }
    check(ok, "instance colour on the second placement, generic colour on the loose solid, in readStep's order");
  }
  {
    const std::string plainBefore = ourFile(false);
    check(plainBefore.find("COLOUR_RGB") == std::string::npos, "an uncoloured export has no COLOUR_RGB");
    const std::string text = ourFile(true);
    check(!text.empty(), "a coloured export is written");
    check(text.find("COLOUR_RGB") != std::string::npos, "it has COLOUR_RGB");
    check(text.find("'Alpha'") != std::string::npos && text.find("'Beta'") != std::string::npos,
          "products keep their names");
    check(text.find("'G\\X2\\00E4\\X0\\mma'") != std::string::npos, "a non-ASCII name stays \\X2\\ encoded");
    check(text.find("Product") == std::string::npos, "no product is left as OCCT's 'Product <n>'");
    check(text.find("SI_UNIT(.MILLI.,.METRE.)") != std::string::npos, "millimetres");
    const std::vector<double> c = colours(text, faces);
    check(c.size() == 9, "three solids read back");
    check(c.size() == 9 && near(c[0], 200 / 255.0) && near(c[1], 30 / 255.0) && near(c[2], 40 / 255.0),
          "the first colour round-trips within 1/255");
    check(c.size() == 9 && c[3] < 0, "the second has none");
    check(c.size() == 9 && near(c[6], 16 / 255.0) && near(c[7], 128 / 255.0) && near(c[8], 1),
          "the third round-trips");
    check(faces == 0, "no face colours");
    const std::vector<gp_Pnt> p = plainCentres(text);
    check(p.size() == 3 && p[0].X() < 10 && p[1].X() > 20 && p[1].X() < 30 && p[2].X() > 40,
          "readStep's solids come in the written order");
    const std::string again = ourFile(false);
    check(again == plainBefore, "the plain export is unchanged after a coloured one");
    std::printf("  plain export %zu bytes, coloured %zu bytes\n", plainBefore.size(), text.size());
    const std::vector<double> none = colours(plainBefore, faces);
    check(none.size() == 9 && none[0] < 0 && none[3] < 0 && none[6] < 0, "a file without colours gives -1s");
  }
  check(f.readStepColors("not a step file") <= 0, "garbage gives no solids");
}

static void leaks(int n) {
  const std::string xde = xdeFile(true);
  auto round = [&]() {
    int faces = 0;
    const std::string text = ourFile(true);
    colours(text, faces);
    colours(xde, faces);
  };
  for (int i = 0; i < 20; ++i) round();
  for (int i = 0; i < n; ++i) round();
  const double a = f.heapTop();
  for (int i = 0; i < 4 * n; ++i) round();
  const double b = f.heapTop();
  std::printf("  heap top after %d rounds: %.0f, after %d: %.0f (growth %.0f bytes)\n", n + 20, a,
              5 * n + 20, b, b - a);
  check(b - a < 1, "no heap growth");
}

int main(int argc, char** argv) {
  if (argc > 1 && std::strcmp(argv[1], "leaks") == 0) {
    leaks(argc > 2 ? std::atoi(argv[2]) : 100);
  } else {
    checks();
  }
  std::printf("%s\n", failures == 0 ? "all checks passed" : "FAILURES");
  return failures == 0 ? 0 : 1;
}
