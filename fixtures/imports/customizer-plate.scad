// A plate with a row of holes (P5-04, ADR-0071): the Import dialog's
// fixture, whose customizer variables become the dialog's rows.

/* [Size] */
// Plate width
width = 40; // [10:100]
// Plate depth
depth = 30; // [10:100]

/* [Holes] */
// Number of holes
holes = 2; // [0:6]
// The holes' diameter
hole = 4; // [2:0.5:10]
label = "plate";
rounded = false;

/* [Hidden] */
thickness = 4;

difference() {
  cube([width, depth, thickness]);
  if (holes > 0)
    for (i = [1 : holes])
      translate([i * width / (holes + 1), depth / 2, -1])
        cylinder(d = hole, h = thickness + 2, $fn = 32);
}
