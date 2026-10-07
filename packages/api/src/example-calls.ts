/**
 * The example calls of the reference pages, and the two tables that name them
 * (ADR-0068 §6).
 *
 * These are the calls every generated page shows, in one place so the code on the
 * page, the checked function in `generated/features.ts` and the text a test runs
 * are the same lines: `featureExamples` below is the preamble and one call per
 * feature type, `tsc` checks it and `docs.test.ts` runs it against a real
 * `Design`.
 *
 * It lives apart from `generate.ts` so the pages (`pages.ts`) and the generator
 * can both read it without importing each other.
 */
import type { FeatureDoc } from './generate';

/**
 * The `sketch` type gets no generated method: a sketch is made with a builder
 * (`d.sketch(plane, k => …)`), not with a plain inputs object, so the name is
 * left for it (ADR-0068 §5).
 */
export const SKETCH_TYPE = 'sketch';

/**
 * A feature type whose name is already a `Design` member, and the method name
 * it gets instead: `d.remove(feature)` deletes a feature (ADR-0068 §2), so the
 * Remove feature's own method is `d.removeBodies({ bodies })`, the name core
 * gives it. Every other type's method is named after its type.
 */
export const METHOD_NAMES: Readonly<Record<string, string>> = {
  remove: 'removeBodies',
  move: 'moveBodies',
};

/** The method a feature type gets (see `METHOD_NAMES`). */
export function methodName(type: string): string {
  return METHOD_NAMES[type] ?? type;
}

/**
 * The code every example runs after, as the reference pages show it: a design, two
 * solids to point faces and bodies at, a sketch with two profiles and a guide
 * line, and the references the calls use. `featureExamples` (in the generated
 * file) is this preamble and one call per feature type, so every example on
 * every page is the same code `tsc` checks and a test runs (ADR-0068 §6).
 */
export const PREAMBLE: readonly string[] = [
  `const d = Design.create({ name: 'My part' });`,
  ``,
  `// Two solids to point faces, edges and bodies at.`,
  `const plate = d.box({ length: '40 mm', width: '20 mm', height: '10 mm' });`,
  `const shaft = d.cylinder({ diameter: '20 mm', height: '20 mm' });`,
  ``,
  `// A sketch with two closed profiles, a hole and a guide line beside them.`,
  `let guide!: LineHandle;`,
  `const s = d.sketch(d.origin.xy, (k) => {`,
  `  k.rectangle([0, 0], [40, 20]);`,
  `  k.circle([10, 10], '3 mm');`,
  `  k.rectangle([50, 0], [60, 10]);`,
  `  guide = k.line([-5, 30], [45, 30]);`,
  `});`,
  ``,
  `const profile = s.profileAt([1, 1]);`,
  `const sections = s.profiles();`,
  `const line = guide.ref();`,
  `const face = plate.face('side:front');`,
  `const edge = plate.edge([plate.faceName('side:front'), plate.faceName('side:right')]);`,
  `const vertex = plate.vertex([plate.faceName('side:front'), plate.faceName('side:right')]);`,
  `const corner = plate.vertex([plate.faceName('side:front'), plate.faceName('side:left')]);`,
  `const body = plate.body();`,
  `const step = 'att-part.step'; // an attachment of the design`,
  `const plan = 'att-plan.png';`,
];

/** The import the preamble and every example need. */
export const PREAMBLE_IMPORT = `import { Design, type LineHandle } from '@extrudo/api';`;

/**
 * One example call per feature type, as the source of its inputs object
 * (ADR-0068 §6). These are the values a reader can follow: a profile or a face
 * from the preamble, `'10 mm'` for a length, `'90 deg'` for an angle, the first
 * of an enum. Every required input is in one of them — the generator says so
 * when a new type arrives without one, and every call is checked twice: `tsc`
 * over `featureExamples`, and a test that runs them against a real `Design`.
 */
const EXAMPLE_INPUTS: Readonly<Record<string, string>> = {
  axisAlongEdge: `{ edge }`,
  axisThroughCylinder: `{ face: shaft.face('side:wall') }`,
  axisThroughPoints: `{ points: [d.origin.point, vertex] }`,
  box: `{ length: '40 mm', width: '20 mm', height: '10 mm' }`,
  canvas: `{ image: plan, plane: d.origin.xy, width: '60 mm' }`,
  chamfer: `{ edges: edge, distance: '1 mm' }`,
  circularPattern: `{ objects: 'bodies', bodies: [body], axis: d.origin.z, count: 4 }`,
  coil: `{ diameter: '20 mm', revolutions: 3, height: '12 mm', section: 'square', size: '3 mm' }`,
  combine: `{ target: body, tools: [shaft.body()], operation: 'join' }`,
  constructionPoint: `{ x: '10 mm', y: '20 mm', z: '5 mm' }`,
  cylinder: `{ diameter: '20 mm', height: '20 mm' }`,
  draft: `{ faces: face, plane: d.origin.yz, angle: '3 deg' }`,
  emboss: `{ profiles: profile, face, depth: '2 mm' }`,
  extrude: `{ profiles: profile, distance: '10 mm' }`,
  fillet: `{ edges: edge, radius: '2 mm' }`,
  hole: `{ plane: d.origin.xy, x: '10 mm', y: '10 mm', diameter: '4 mm', extent: 'through' }`,
  import: `{ file: step }`,
  plugin: `{ plugin: 'att-name-plate', handler: 'name-plate', inputs: { width: '60 mm', rounded: true, plane: d.origin.xy } }`,
  loft: `{ sections }`,
  midplane: `{ planes: [d.origin.xy, d.origin.yz] }`,
  midplaneAngled: `{ planes: [d.origin.xy, d.origin.yz] }`,
  mirror: `{ plane: d.origin.yz, bodies: [body] }`,
  move: `{ bodies: [body], dx: '10 mm' }`,
  offsetFace: `{ faces: face, distance: '2 mm' }`,
  offsetPlane: `{ plane: d.origin.xy, distance: '12 mm' }`,
  placeOnBed: `{ face }`,
  planeAlongPath: `{ path: line }`,
  planeAtAngle: `{ plane: d.origin.xy, axis: d.origin.x, angle: '30 deg' }`,
  planeThroughPoints: `{ points: [d.origin.point, vertex, corner] }`,
  pointAtIntersection: `{ entities: [d.origin.xy, d.origin.yz, d.origin.xz] }`,
  pointOnPath: `{ path: line, position: 0.5 }`,
  pathPattern: `{ objects: 'bodies', bodies: [body], path: line, count: 3 }`,
  rectangularPattern: `{ objects: 'bodies', bodies: [body], direction1: d.origin.x, count1: 3, distance1: '20 mm' }`,
  remove: `{ bodies: [body] }`,
  revolve: `{ profiles: profile, axis: d.origin.y, angle: '90 deg' }`,
  rib: `{ curve: line, thickness: '3 mm' }`,
  scale: `{ bodies: [body], factor: 1.5 }`,
  script: `{ code: "for (let i = 0; i < 3; i++) design.cylinder({ diameter: '6 mm', height: '4 mm', x: i * 10 });" }`,
  shell: `{ faces: face, thickness: '2 mm' }`,
  splitBody: `{ bodies: [body], plane: d.origin.yz }`,
  sphere: `{ diameter: '30 mm' }`,
  sweep: `{ profiles: profile, path: line }`,
  tangentPlane: `{ face: shaft.face('cap:start') }`,
  thread: `{ faces: shaft.face('side:wall'), diameter: '20 mm' }`,
  torus: `{ diameter: '30 mm', tube: '6 mm' }`,
};

/**
 * The sketch's own example, for its page: the preamble already draws one, so
 * this is a second sketch, on another plane. It is checked and run like the rest
 * (`sketch.md` has the whole builder).
 */
const SKETCH_EXAMPLE = [
  `const other = d.sketch(d.origin.yz, (k) => {`,
  `  k.circle([0, 0], '5 mm');`,
  `});`,
].join('\n');

/**
 * The example for a feature type: one call. The sketch is the one type whose
 * example is a builder rather than an inputs object, so its call is its own.
 */
export function exampleCall(feature: FeatureDoc): string {
  if (feature.type === SKETCH_TYPE) return SKETCH_EXAMPLE;
  const inputs = EXAMPLE_INPUTS[feature.type];
  if (!inputs) {
    throw new Error(
      `Feature type "${feature.type}" has no example: add one to EXAMPLE_INPUTS in packages/api/src/generate.ts and run pnpm api:generate.`,
    );
  }
  const given = new Set(exampleKeys(feature));
  const missing = feature.inputs
    .filter((input) => input.required && !given.has(input.name))
    .map((input) => input.name);
  if (missing.length > 0) {
    throw new Error(
      `The example for "${feature.type}" leaves out required input(s) ${missing.join(', ')}: a call without them is not a valid feature.`,
    );
  }
  return `d.${methodName(feature.type)}(${inputs});`;
}

/**
 * The input names an example gives, so the generator can check that every
 * required input is in one: the keys of its `{ … }`, which are all plain names
 * here (the values are literals, identifiers from the preamble and the odd
 * reference). Nested braces and brackets are one value, so a comma inside them
 * does not split the list.
 */
function exampleKeys(feature: FeatureDoc): string[] {
  const inputs = (EXAMPLE_INPUTS[feature.type] ?? '').trim().replace(/^\{/, '').replace(/\}$/, '');
  const keys: string[] = [];
  let depth = 0;
  let part = '';
  for (const character of inputs.replace(/[{}[\]]/g, (bracket) => {
    if ('}]'.includes(bracket)) depth -= 1;
    else depth += 1;
    return ' ';
  })) {
    if (character === ',' && depth === 0) {
      keys.push(...(part.split(':')[0]?.split(/\s+/).filter(Boolean) ?? []));
      part = '';
    } else {
      part += character;
    }
  }
  keys.push(...(part.split(':')[0]?.split(/\s+/).filter(Boolean) ?? []));
  return keys.filter((key) => /^[A-Za-z][A-Za-z0-9]*$/.test(key));
}

/** The example page's code block: the preamble, a blank line and the call. */
export function exampleBlock(feature: FeatureDoc): string {
  return [PREAMBLE_IMPORT, '', ...PREAMBLE, '', `// ${feature.label}.`, exampleCall(feature)].join(
    '\n',
  );
}

/** The preamble's code block, for a page that needs the setup without a call. */
export function preambleBlock(): string {
  return [PREAMBLE_IMPORT, '', ...PREAMBLE].join('\n');
}
