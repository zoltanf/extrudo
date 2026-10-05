// A plate with a hole (P5-04, ADR-0071): the OpenSCAD import's fixture.
// The kernel's tests and the CLI's override these variables.

/* [Plate] */
// The plate's side
size = 20; // [10:100]
// Its thickness
height = 10; // [2:1:40]
// The hole's diameter
hole = 8; // [2:0.5:20]

difference() {
  cube([size, size, height]);
  translate([size / 2, size / 2, -1]) cylinder(d = hole, h = height + 2, $fn = 64);
}
