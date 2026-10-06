/**
 * A ring of holes from a loop (P5-02, ADR-0070 §4): a Script feature that makes
 * a round flange and drills `holes` holes on a circle in it. The count is a
 * parameter, so the design changes how many holes it has, which no single
 * feature of the timeline can do from one parameter. `packages/cli/src/scripts.test.ts`
 * runs this file through the script runner and recomputes it with the kernel.
 *
 * ```ts
 * import { holeRing } from './script-hole-ring.ts';
 *
 * const d = holeRing();
 * d.setParameter('holes', 12);   // the script makes twelve holes next time
 * ```
 *
 * The code is a string: it runs inside the sandbox (QuickJS), where `design` is
 * the API restricted to adds and `params` holds every parameter's value as a
 * plain number (mm, degrees or as it is).
 */
import { Design } from '@extrudo/api';

/** The script's source: a flange and a ring of through holes. */
export const HOLE_RING = `
const flange = design.cylinder({ diameter: params.diameter, height: params.thickness });
const top = flange.face('cap:end');
const r = params.diameter / 2 - params.margin;
for (let i = 0; i < params.holes; i++) {
  const a = (2 * Math.PI * i) / params.holes;
  design.hole({
    plane: top,
    x: r * Math.cos(a),
    y: r * Math.sin(a),
    diameter: params.hole,
    extent: 'through',
  });
}
console.log(\`\${params.holes} holes on a \${2 * r} mm circle\`);
`;

export function holeRing(): Design {
  const d = Design.create({ name: 'Hole ring', units: 'mm' });
  d.parameter('holes', '8', { comment: 'How many holes the ring has' });
  d.parameter('diameter', '60 mm', { comment: "The flange's diameter" });
  d.parameter('thickness', '5 mm');
  d.parameter('hole', '5 mm', { comment: "Each hole's diameter" });
  d.parameter('margin', '8 mm', { comment: "From the flange's edge to the holes' centres" });
  d.script({ code: HOLE_RING }, { name: 'Ring' });
  return d;
}
