// Native harness for STEP assemblies (P6-05, ADR-0081 §7): writeStep's
// grouped path (pushStepGroup, pushStepGroupName, writeStepAssembly), read
// back through STEPCAFControl_Reader with the label tree printed. Built and
// run inside the pinned OCCT image by run.sh.
//
//   node harness.cjs          the checks (exits 1 on a failure)
//   node harness.cjs leaks N  heap top after N and 5N rounds
#define private public
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#undef private

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

static TopoDS_Shape boxAt(double x, double size) {
  return BRepPrimAPI_MakeBox(gp_Pnt(x, 0, 0), size, size, size).Shape();
}

static size_t occurrences(const std::string& text, const std::string& what) {
  size_t n = 0;
  for (size_t at = text.find(what); at != std::string::npos; at = text.find(what, at + 1)) ++n;
  return n;
}

/** Three boxes: the first two in group 0 ("Lid" or a non-ASCII name), the third loose. */
static std::string ourFile(bool grouped, bool coloured, const char* group = "Lid") {
  const int a = f.store(boxAt(0, 10));
  const int b = f.store(boxAt(20, 10));
  const int c = f.store(boxAt(40, 10));
  f.clearArgs();
  f.clearStepNames();
  f.clearStepColors();
  f.clearStepGroups();
  for (int h : {a, b, c}) f.pushArg(h);
  f.pushStepName("Alpha");
  f.pushStepName("Beta");
  f.pushStepName("G\\X2\\00E4\\X0\\mma");
  if (coloured) {
    f.stageStepColor(200 / 255.0, 30 / 255.0, 40 / 255.0);
    f.stageStepColor(-1, -1, -1);
    f.stageStepColor(16 / 255.0, 128 / 255.0, 1);
  }
  if (grouped) {
    f.pushStepGroup(0);
    f.pushStepGroup(0);
    f.pushStepGroup(-1);
    f.pushStepGroupName(group);
  }
  const int size = f.writeStep();
  std::string text = size > 0 ? f.exportText_ : "";
  if (size <= 0) std::printf("  writeStep failed: %s\n", f.lastError());
  f.clearExport();
  f.clearStepColors();
  f.clearStepNames();
  f.clearStepGroups();
  f.release(a);
  f.release(b);
  f.release(c);
  return text;
}

static void printTree(const Handle(XCAFDoc_ShapeTool)& shapes, const TDF_Label& label, int depth) {
  Handle(TDataStd_Name) name;
  std::string text = "?";
  if (label.FindAttribute(TDataStd_Name::GetID(), name)) {
    const TCollection_AsciiString ascii(name->Get());
    text = ascii.ToCString();
  }
  const char* kind = XCAFDoc_ShapeTool::IsAssembly(label)    ? "assembly"
                     : XCAFDoc_ShapeTool::IsReference(label) ? "reference"
                                                             : "part";
  std::printf("  %*s%s '%s'\n", depth * 2, "", kind, text.c_str());
  TDF_Label referred;
  if (XCAFDoc_ShapeTool::IsReference(label) && XCAFDoc_ShapeTool::GetReferredShape(label, referred)) {
    printTree(shapes, referred, depth + 1);
    return;
  }
  NCollection_Sequence<TDF_Label> components;
  XCAFDoc_ShapeTool::GetComponents(label, components);
  for (NCollection_Sequence<TDF_Label>::Iterator c(components); c.More(); c.Next()) {
    printTree(shapes, c.Value(), depth + 1);
  }
}

/** Reads the file into an XCAF document, prints the tree, returns the free shapes' count. */
static int readTree(const std::string& text, int& assemblies) {
  Handle(TDocStd_Document) doc = new TDocStd_Document("BinXCAF");
  XCAFDoc_DocumentTool::Set(doc->Main(), false);
  int roots = -1;
  assemblies = 0;
  {
    STEPCAFControl_Reader reader;
    reader.SetNameMode(true);
    std::istringstream in(text);
    if (reader.ReadStream("x.step", in) == IFSelect_RetDone && reader.Transfer(doc)) {
      const Handle(XCAFDoc_ShapeTool) shapes = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
      NCollection_Sequence<TDF_Label> free;
      shapes->GetFreeShapes(free);
      roots = free.Length();
      for (NCollection_Sequence<TDF_Label>::Iterator r(free); r.More(); r.Next()) {
        if (XCAFDoc_ShapeTool::IsAssembly(r.Value())) ++assemblies;
        printTree(shapes, r.Value(), 0);
      }
    }
  }
  doc->Main().Root().ForgetAllAttributes(true);
  return roots;
}

static std::vector<double> colours(const std::string& text) {
  std::vector<double> out;
  if (f.readStepColors(text.c_str()) < 0) return out;
  out.assign(f.geometry_.begin() + 1, f.geometry_.end());
  return out;
}

/** The file from DATA; on: the header holds the time it was written. */
static std::string body(const std::string& text) {
  const size_t at = text.find("DATA;");
  return at == std::string::npos ? text : text.substr(at);
}

static bool near(double a, double b) { return std::abs(a - b) < 0.5 / 255; }

static void checks() {
  const std::string plain = ourFile(false, false);
  const std::string plainColoured = ourFile(false, true);
  {
    const std::string text = ourFile(true, true);
    check(!text.empty(), "a grouped export is written");
    check(text.find("PRODUCT('Lid'") != std::string::npos, "the group is a product named Lid");
    check(text.find("PRODUCT('Alpha'") != std::string::npos && text.find("PRODUCT('Beta'") != std::string::npos,
          "its parts keep their names");
    check(text.find("PRODUCT('G\\X2\\00E4\\X0\\mma'") != std::string::npos,
          "the loose part's non-ASCII name stays \\X2\\ encoded, not doubled");
    check(occurrences(text, "NEXT_ASSEMBLY_USAGE_OCCURRENCE") == 2,
          "two assembly usages (got " + std::to_string(occurrences(text, "NEXT_ASSEMBLY_USAGE_OCCURRENCE")) + ")");
    check(text.find("Product") == std::string::npos, "no product is left as OCCT's 'Product <n>'");
    check(text.find("SI_UNIT(.MILLI.,.METRE.)") != std::string::npos, "millimetres");
    check(text.find("COLOUR_RGB") != std::string::npos, "colours are written");
    int assemblies = 0;
    const int roots = readTree(text, assemblies);
    check(roots == 2 && assemblies == 1, "read back: two free shapes, one an assembly");
    const std::vector<double> c = colours(text);
    check(c.size() == 9, "three solids read back (got " + std::to_string(c.size() / 3) + ")");
    check(c.size() == 9 && near(c[0], 200 / 255.0) && near(c[1], 30 / 255.0) && near(c[2], 40 / 255.0),
          "the first part's colour");
    check(c.size() == 9 && c[3] < 0, "the second has none");
    check(c.size() == 9 && near(c[6], 16 / 255.0) && near(c[8], 1), "the loose part's colour");
    const int h = f.readStep(text.c_str());
    check(h != 0 && f.count(h, 3) == 3, "readStep gives three solids");
    if (h != 0) f.release(h);
  }
  {
    const std::string text = ourFile(true, false, "Deckel \\X2\\00F6\\X0\\");
    check(text.find("PRODUCT('Deckel \\X2\\00F6\\X0\\'") != std::string::npos,
          "a non-ASCII group name round-trips as \\X2\\00F6\\X0\\");
    check(text.find("COLOUR_RGB") == std::string::npos, "no colours, none written");
  }
  check(body(ourFile(false, false)) == body(plain), "the plain export is unchanged after a grouped one");
  check(body(ourFile(false, true)) == body(plainColoured), "the coloured export is unchanged after a grouped one");
  {
    // Groups staged but every part at -1 (or a group without a name): the plain path.
    const int a = f.store(boxAt(0, 10));
    f.clearArgs();
    f.clearStepNames();
    f.clearStepColors();
    f.clearStepGroups();
    f.pushArg(a);
    f.pushStepName("Alone");
    f.pushStepGroup(-1);
    f.pushStepGroup(3);
    const int size = f.writeStep();
    check(size > 0 && f.exportText_.find("NEXT_ASSEMBLY_USAGE_OCCURRENCE") == std::string::npos,
          "no part in a named group: no assembly");
    f.clearExport();
    f.clearStepGroups();
    f.clearStepNames();
    f.release(a);
  }
}

static void leaks(int n) {
  auto round = [&]() {
    const std::string text = ourFile(true, true);
    colours(text);
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
