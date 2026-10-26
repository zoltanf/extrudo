// verify_step: checks a STEP file against the STL it was converted from, with
// desktop OCCT (not the facade), for comparing outside converters with Mesh to
// Solid (docs/plans/mesh-to-solid-bench-2026-10-22.md). Prints one JSON line:
// solids, shells, validity (BRepCheck_Analyzer), faces by surface type, the
// STEP's volume against the mesh's signed volume, and a class:
//   exact   = valid solid, volume within 1 %, fewer faces than triangles / 4
//   faceted = valid solid, volume within 1 %, more faces
//   failed  = anything else
// Build: see ../README.md ("Outside converters").
#include <STEPControl_Reader.hxx>
#include <TopoDS_Shape.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS.hxx>
#include <TopExp_Explorer.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <BRepGProp.hxx>

#include <cstdio>
#include <cmath>
#include <string>
#include <vector>
#include <fstream>
#include <sstream>

struct Vec3 { double x, y, z; };

static double meshSignedVolume(const std::string& path, long& triOut, bool& asciiOut)
{
    std::ifstream f(path, std::ios::binary);
    if (!f) { triOut = -1; asciiOut = false; return 0.0; }
    std::string head;
    std::getline(f, head);
    bool ascii = false;
    // "solid" prefix could still be binary; check by size
    {
        f.clear(); f.seekg(0, std::ios::end);
        std::streamoff sz = f.tellg();
        f.seekg(0, std::ios::beg);
        // binary STL: 84 + 50*n
        if (sz >= 84) {
            f.seekg(80);
            unsigned int n = 0; f.read(reinterpret_cast<char*>(&n), 4);
            if ((std::streamoff)(84 + 50LL * n) == sz) ascii = false;
            else ascii = true;
        } else ascii = true;
        f.seekg(0, std::ios::beg);
    }
    asciiOut = ascii;
    std::vector<Vec3> pts;
    if (!ascii) {
        f.seekg(80);
        unsigned int n = 0; f.read(reinterpret_cast<char*>(&n), 4);
        for (unsigned int i = 0; i < n; ++i) {
            float buf[12];
            f.read(reinterpret_cast<char*>(buf), 48);
            unsigned short attr; f.read(reinterpret_cast<char*>(&attr), 2);
            if (!f) break;
            for (int k = 0; k < 3; ++k)
                pts.push_back({buf[3 + k*3], buf[4 + k*3], buf[5 + k*3]});
        }
    } else {
        std::string line;
        while (std::getline(f, line)) {
            std::istringstream is(line);
            std::string tok; is >> tok;
            if (tok == "vertex") {
                double x,y,z; is >> x >> y >> z;
                pts.push_back({x,y,z});
            }
        }
    }
    double vol = 0.0;
    for (size_t i = 0; i + 2 < pts.size(); i += 3) {
        const Vec3 &a = pts[i], &b = pts[i+1], &c = pts[i+2];
        vol += (a.x*(b.y*c.z - b.z*c.y)
              - a.y*(b.x*c.z - b.z*c.x)
              + a.z*(b.x*c.y - b.y*c.x)) / 6.0;
    }
    triOut = (long)(pts.size() / 3);
    return vol;
}

int main(int argc, char** argv)
{
    if (argc < 3) { fprintf(stderr, "usage: verify_step file.step file.stl\n"); return 2; }
    std::string step = argv[1], stl = argv[2];
    long tris = 0; bool ascii = false;
    double meshVol = meshSignedVolume(stl, tris, ascii);
    double meshVolAbs = std::fabs(meshVol);

    STEPControl_Reader reader;
    int status = reader.ReadFile(step.c_str());
    int solids = 0, shells = 0, faces = 0;
    long byType[12] = {0};
    bool valid = false, closed = true;
    double stepVol = 0.0;
    std::string err;

    if (status != IFSelect_RetDone) {
        err = "STEP read failed";
    } else {
        reader.TransferRoots();
        TopoDS_Shape shape = reader.OneShape();
        if (shape.IsNull()) err = "empty shape";
        else {
            for (TopExp_Explorer e(shape, TopAbs_SOLID); e.More(); e.Next()) solids++;
            for (TopExp_Explorer e(shape, TopAbs_SHELL); e.More(); e.Next()) {
                shells++;
                if (!BRep_Tool::IsClosed(TopoDS::Shell(e.Current()))) closed = false;
            }
            for (TopExp_Explorer e(shape, TopAbs_FACE); e.More(); e.Next()) {
                faces++;
                TopoDS_Face face = TopoDS::Face(e.Current());
                BRepAdaptor_Surface surf(face, true);
                int t = (int)surf.GetType();
                if (t < 0 || t > 11) t = 11;
                byType[t]++;
            }
            BRepCheck_Analyzer ana(shape);
            valid = ana.IsValid();
            GProp_GProps props;
            BRepGProp::VolumeProperties(shape, props);
            stepVol = props.Mass();
        }
    }

    // type index: 0 plane,1 cyl,2 cone,3 sphere,4 torus, 5 bspline,6 bezier,
    // 7 revolution,8 extrusion,9 offset,10 other,11 unknown
    auto T = [&](int i){ return byType[i]; };
    double volPct = (meshVolAbs > 1e-9) ? (stepVol - meshVol) / meshVolAbs * 100.0 : 0.0;
    const char* cls = "failed";
    if (valid && solids >= 1 && std::fabs(volPct) <= 1.0) {
        cls = (faces > 0 && tris > 0 && (double)faces < (double)tris / 4.0) ? "exact" : "faceted";
    }
    printf("{\"step\":\"%s\",\"stl\":\"%s\",\"tris\":%ld,\"ascii\":%s,"
           "\"solids\":%d,\"shells\":%d,\"closed\":%s,\"valid\":%s,\"faces\":%d,"
           "\"types\":{\"plane\":%ld,\"cylinder\":%ld,\"cone\":%ld,\"sphere\":%ld,"
           "\"torus\":%ld,\"bspline\":%ld,\"bezier\":%ld,\"revolution\":%ld,"
           "\"extrusion\":%ld,\"offset\":%ld,\"other\":%ld},"
           "\"stepVolume\":%.6f,\"meshVolume\":%.6f,\"volPct\":%.4f,\"class\":\"%s\",\"error\":\"%s\"}\n",
           step.c_str(), stl.c_str(), tris, ascii?"true":"false",
           solids, shells, closed?"true":"false", valid?"true":"false", faces,
           T(0),T(1),T(2),T(3),T(4),T(5),T(6),T(7),T(8),T(9),T(10),
           stepVol, meshVol, volPct, cls, err.c_str());
    return 0;
}
