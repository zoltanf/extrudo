// Times the facade's pose proximity against transform + distance on the
// hinge shapes the dump test wrote (P6-05 J3). Built by run.sh.
static bool gVerbose = false, gPairs = false;
#include <chrono>
static int proximityDebugCount = 0;
static long proximityTriCount = 0;
static double proximityDebugNow() { return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count(); }
#include "../../packages/kernel/occt/facade/extrudo_facade.cpp"
#include <chrono>
#include <fstream>
#include <iostream>
#include <random>

static std::string slurp(const std::string& p) {
  std::ifstream in(p);
  std::stringstream ss;
  ss << in.rdbuf();
  return ss.str();
}
static double now() {
  return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

int main(int argc, char** argv) {
  const std::string which = argc > 1 ? argv[1] : "busy";
  const int leakRounds = argc > 2 ? std::atoi(argv[2]) : 0;
  gVerbose = argc > 3 && std::string(argv[3]).find("v") != std::string::npos;
  gPairs = argc > 3 && std::string(argv[3]).find("p") != std::string::npos;
  ExtrudoFacade f;
  const std::string a = which == "busy" ? "busyLeaf" : "leaf";
  const std::string b = which == "busy" ? "busyBase" : "base";
  int leaf = f.readStep(slurp("data/" + a + ".step").c_str());
  int base = f.readStep(slurp("data/" + b + ".step").c_str());
  std::vector<std::vector<double>> poses;
  std::ifstream in("data/poses.txt");
  std::string line;
  while (std::getline(in, line)) {
    std::stringstream ss(line);
    std::vector<double> m(12);
    for (double& v : m) ss >> v;
    poses.push_back(m);
  }
  const double search = 5;
  const auto stage = [&](const std::vector<double>& m) {
    f.clearNumbers();
    for (double v : m) f.pushNumber(v);
  };
  if (leakRounds > 0) {
    const auto top0 = reinterpret_cast<uintptr_t>(sbrk(0));
    for (int r = 0; r < leakRounds; ++r) {
      int s = f.proximityOpen(leaf, base, search);
      for (int i = 0; i < 20; ++i) {
        stage(poses[i % poses.size()]);
        f.proximityPose(s);
      }
      if (argc <= 3 || std::string(argv[3]) != "leak") f.proximityClose(s);
      if (r == 9 || r == leakRounds - 1)
        std::cout << "round " << r << " heap " << (reinterpret_cast<uintptr_t>(sbrk(0)) - top0) << "\n";
    }
    return 0;
  }
  double tOld = 0, tNew = 0, worst = 0;
  const double t0 = now();
  const int s = f.proximityOpen(leaf, base, search);
  const double tOpen = now() - t0;
  int mismatch = 0;
  for (size_t i = 0; i < poses.size(); ++i) {
    stage(poses[i]);
    double t1 = now();
    const int moved = f.transform(leaf);
    const double old = f.distance(moved, base);
    std::vector<double> og(f.geometry_);
    f.release(moved);
    double t2 = now();
    stage(poses[i]);
    const double d = f.proximityPose(s);
    std::vector<double> ng(f.geometry_);
    double t3 = now();
    tOld += t2 - t1;
    tNew += t3 - t2;
    const double want = std::min(old, search);
    const double err = std::abs(want - d);
    worst = std::max(worst, err);
    if (err > 1e-6) {
      ++mismatch;
      std::cout << "pose " << i << " old " << old << " new " << d << "\n";
    }
    if (gVerbose) {
      std::cout << i << " old " << old << " (" << (t2 - t1) << " ms) new " << d << " (" << (t3 - t2) << " ms)";
      if (og.size() >= 6 && ng.size() >= 6) {
        double pd = 0;
        for (int k = 0; k < 6; ++k) pd = std::max(pd, std::abs(og[k] - ng[k]));
        std::cout << " points " << pd << " faces " << ng[6] << "," << ng[7];
      }
      std::cout << "\n";
    }
  }
  f.proximityClose(s);
  std::cout << which << ": " << poses.size() << " poses, open " << tOpen << " ms, old " << tOld << " ms, new "
            << tNew << " ms, worst diff " << worst << ", mismatches " << mismatch << ", sessions "
            << f.proximitySessions() << ", live " << f.liveShapes() << "\n";
}
