// The example plugin (P6-03, ADR-0077): a custom feature and a command. Both
// handlers get the restricted `design` a Script gets — they may only add
// features — and the feature gets its inputs as plain values: lengths in mm,
// the toggle as a boolean, the plane as a reference. A type-only import is
// stripped with the types, so the module still needs nothing at run time.
import type { Design, GeomRef, SketchBuilder } from '@extrudo/api';

/** The values the `name-plate` feature's dialog gives, by their manifest names. */
interface NamePlateInputs {
  width: number;
  height: number;
  thickness: number;
  rounded: boolean;
  /** A plane reference; the XY plane when none was picked. */
  plane?: GeomRef;
}

/** What every handler gets beside: the document's parameter values. */
interface PluginContext {
  params: Readonly<Record<string, number>>;
}

type Point = [number, number];

export const features = {
  'name-plate': (design: Design, inputs: NamePlateInputs, _ctx: PluginContext) => {
    const { width, height, thickness, rounded } = inputs;
    const w = width / 2;
    const h = height / 2;
    // A quarter of the shorter side, so the corners never meet.
    const r = rounded ? Math.min(width, height) / 4 : 0;
    const sketch = design.sketch(inputs.plane ?? design.origin.xy, (k: SketchBuilder) => {
      if (r === 0) {
        k.rectangle([-w, -h], [w, h]);
        return;
      }
      // A quarter circle about `centre` from `from` to `to`, through its middle.
      const corner = (centre: Point, from: Point, to: Point) => {
        const dx = from[0] + to[0] - 2 * centre[0];
        const dy = from[1] + to[1] - 2 * centre[1];
        const scale = r / Math.hypot(dx, dy);
        k.arc(from, to, [centre[0] + dx * scale, centre[1] + dy * scale]);
      };
      k.line([-w + r, -h], [w - r, -h]);
      corner([w - r, -h + r], [w - r, -h], [w, -h + r]);
      k.line([w, -h + r], [w, h - r]);
      corner([w - r, h - r], [w, h - r], [w - r, h]);
      k.line([w - r, h], [-w + r, h]);
      corner([-w + r, h - r], [-w + r, h], [-w, h - r]);
      k.line([-w, h - r], [-w, -h + r]);
      corner([-w + r, -h + r], [-w, -h + r], [-w + r, -h]);
    });
    design.extrude({ profiles: sketch.profileAt([0, 0]), distance: `${thickness} mm` });
  },
};

export const commands = {
  'three-holes': (design: Design, _ctx: PluginContext) => {
    const holes = design.sketch(design.origin.xy, (k: SketchBuilder) => {
      for (const x of [-20, 0, 20]) k.circle([x, 0], '2 mm');
    });
    design.extrude({
      profiles: holes.profiles(),
      direction: 'symmetric',
      extent: 'through-all',
      operation: 'cut',
    });
  },
};
