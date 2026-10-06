/**
 * The generated reference pages (ADR-0068 §6): one Markdown page per feature
 * type under `docs/api/features/`, and the index that lists them by category.
 *
 * Everything here comes from the registry through `generate.ts` — the label, the
 * category, each input's type, whether it is required, what its description says
 * (defaults included), the face roles and the example call — so a feature added
 * in core reaches the reference by running `pnpm api:generate`, and the pages
 * cannot drift from the methods they document.
 *
 * The pages are Markdown so they read in the repository as well as on the docs
 * site (`apps/site` renders them to `/docs/api/…` at build time). The front
 * matter is what the site reads for its sidebar; a Markdown reader shows it as
 * what it is, metadata.
 */

import { exampleBlock, methodName, SKETCH_TYPE } from './example-calls';
import type { FeatureDoc, InputDoc } from './generate';

/** The categories in the order the app's tools are grouped, for the index. */
const CATEGORIES: readonly [string, string][] = [
  ['sketch', 'Sketch'],
  ['create', 'Create'],
  ['modify', 'Modify'],
  ['construct', 'Construct'],
  ['inspect', 'Inspect'],
];

/** What each category is for, one line, in the index's own words. */
const CATEGORY_NOTES: Readonly<Record<string, string>> = {
  sketch: 'The sketches a solid is drawn on.',
  create: 'The solids, sweeps and cuts that make bodies.',
  modify: 'What changes the bodies a design already has.',
  construct: 'The planes, axes and points other features build on.',
  inspect: 'What measures or arranges a design for printing.',
};

/**
 * A feature page: the method, its inputs, its faces and one example call.
 * `order` is the type's place in the registry, which is what the docs site's
 * sidebar lists the feature pages in.
 */
export function featurePage(feature: FeatureDoc, order: number): string {
  if (feature.type === SKETCH_TYPE) return sketchPage(feature, order);
  return [
    frontMatter({
      title: feature.label,
      type: feature.type,
      section: 'Features',
      category: feature.category,
      order: String(order),
    }),
    `# ${feature.label}`,
    '',
    signature(feature),
    '',
    ...lead(feature),
    '',
    '## Inputs',
    '',
    inputTable(feature.inputs),
    '',
    '## Faces',
    '',
    ...faceSection(feature),
    '',
    '## Example',
    '',
    '```ts',
    exampleBlock(feature),
    '```',
    '',
    '## See also',
    '',
    '- [Features by category](README.md)',
    '- [Sketches](../sketch.md) — `d.sketch(plane, build)` and its builder',
    '- [References](../references.md) — every helper that builds a reference',
  ].join('\n');
}

/**
 * The sketch's own page: it is the one type made with a builder rather than an
 * inputs object, so it has no method to document — `sketch.md` has the builder,
 * and this page has the call, its one input and the profile references it
 * returns.
 */
function sketchPage(feature: FeatureDoc, order: number): string {
  return [
    frontMatter({
      title: feature.label,
      type: feature.type,
      section: 'Features',
      category: feature.category,
      order: String(order),
    }),
    `# ${feature.label}`,
    '',
    signature(feature),
    '',
    'A sketch is the one feature type with no inputs object: `build` is a function the',
    'API calls with a `SketchBuilder`, and everything it draws — points, curves,',
    'constraints, dimensions — is what the feature stores. [Sketches](../sketch.md) walks',
    'through the builder; the sketch handle it returns gives the profiles a solid feature',
    'sweeps.',
    '',
    '## Inputs',
    '',
    inputTable(feature.inputs.filter((input) => input.name !== 'sketch')),
    '',
    '## Example',
    '',
    '```ts',
    exampleBlock(feature),
    '```',
    '',
    '## See also',
    '',
    '- [Sketches](../sketch.md) — every entity, constraint and dimension',
    '- [Features by category](README.md)',
    '- [References](../references.md) — every helper that builds a reference',
  ].join('\n');
}

/** The index: every feature type, grouped by category, with its method. */
export function featuresIndex(features: FeatureDoc[]): string {
  const lines = [
    frontMatter({ title: 'Features', section: 'Features', order: 1 }),
    '# Features',
    '',
    'Every feature type Extrudo has, with its inputs, the faces it names and an',
    'example call. The pages are generated from the same registry the API methods',
    'are, so they cannot drift: `pnpm api:generate` rewrites both.',
    '',
  ];
  for (const [category, label] of CATEGORIES) {
    const inCategory = features.filter((feature) => feature.category === category);
    if (inCategory.length === 0) continue;
    lines.push(`## ${label}`, '', CATEGORY_NOTES[category] ?? '', '');
    for (const feature of inCategory) {
      lines.push(`- [${feature.label}](${feature.type}.md) — \`${methodCall(feature)}\``);
    }
    lines.push('');
  }
  lines.push(
    '## See also',
    '',
    '- [The API in one page](../README.md)',
    '- [Sketches](../sketch.md)',
    '- [References](../references.md)',
  );
  return `${lines.join('\n')}\n`;
}

/**
 * The front matter of a page: what the docs site reads for its title and its
 * sidebar (apps/site/docs.ts), stripped before the Markdown is rendered.
 */
function frontMatter(fields: Readonly<Record<string, string | number>>): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return ['---', ...lines, '---', ''].join('\n');
}

/**
 * The signature of the method: `d.extrude(inputs?, options?)` and what it
 * returns. The sketch is the one type with a builder instead of an inputs
 * object, so its page says that.
 */
function signature(feature: FeatureDoc): string {
  const signature =
    feature.type === SKETCH_TYPE
      ? `d.sketch(plane, build, options?): SketchHandle`
      : `d.${methodName(feature.type)}(inputs${requiredOf(feature) ? '' : '?'}, options?): FeatureHandle<'${feature.type}'>`;
  return `\`${signature}\``;
}

/** The one-liner the index lists a feature by. */
function methodCall(feature: FeatureDoc): string {
  return feature.type === SKETCH_TYPE
    ? `d.sketch(plane, build)`
    : `d.${methodName(feature.type)}(inputs${requiredOf(feature) ? '' : '?'}, options?)`;
}

/**
 * The lead paragraph: what a call adds, how the name follows, and what
 * `options` holds. Short on purpose — the inputs are the reference, and the
 * README says the rest.
 */
function lead(feature: FeatureDoc): string[] {
  return [
    `One feature of the timeline, in the **${feature.category}** category. Its name follows`,
    `the app's (\`${feature.label}1\`, then \`${feature.label}2\`, …); \`options.name\` gives it`,
    'another, `options.id` its ID and `options.index` its place in the timeline. Inputs the',
    'table calls optional keep the default it names, so a call with none of them still makes',
    'a valid feature.',
  ];
}

/** The inputs table: name, type, whether it is required, what it does. */
function inputTable(inputs: readonly InputDoc[]): string {
  if (inputs.length === 0) return 'This feature takes no inputs.';
  return [
    '| Input | Type | Required or default | What it does |',
    '| --- | --- | --- | --- |',
    ...inputs.map(
      (input) =>
        `| \`${input.name}\` | ${typeCell(input)} | ${requiredCell(input)} | ${cell(withoutDefault(input.description))} |`,
    ),
  ].join('\n');
}

/** The faces section: the roles, then how to build a reference from one. */
function faceSection(feature: FeatureDoc): string[] {
  // A script's faces are its generated features' (P5-02, ADR-0070 §1).
  if (feature.type === 'script') {
    return [
      'A script names no face itself: each feature its code makes names its own, under',
      "its own ID — the script's ID, a dot and the API's (`extrude:<script>.f1:cap:end`) —",
      'and the roles its own page lists. The IDs are the same every run, so a feature after',
      "the script can refer to the script's faces like any other's.",
    ];
  }
  if (feature.faceRoles.length === 0) {
    return [
      'This feature makes no face of its own, so `handle.face(role)` has no role to take.',
      'Its result keeps the names of the bodies it worked on, so a reference to one of those',
      'still resolves.',
    ];
  }
  const varies = feature.faceRoles.some((role) => role.name.includes('<'));
  return [
    '| Role | What it is |',
    '| --- | --- |',
    ...feature.faceRoles.map((role) => `| \`${role.name}\` | ${cell(role.description)} |`),
    '',
    '`handle.face(role)` builds a reference to one of them and `handle.faceName(role)` its',
    'persistent name.',
    ...(varies
      ? [
          'A `<…>` is what varies: a `side:<sketch curve>` is the wall of the curve you pass,',
          'and a role of a face that no face carries takes that part out.',
        ]
      : []),
    'A role this feature never names is a lost reference — a visible error, never a silent',
    'guess.',
  ];
}

/** Whether the feature has a required input, which the signature shows. */
function requiredOf(feature: FeatureDoc): boolean {
  return feature.inputs.some((input) => input.required);
}

/** A table cell: a `|` inside a cell would break the row. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

/**
 * A description without the default it ends with: the column beside it already
 * says what the default is, so saying it twice reads like a stutter.
 */
function withoutDefault(description: string): string {
  return description.replace(/\s+(?:Default [^.]+|Required)\.?\s*$/, '').trim();
}

/** The type cell: the plain value a call passes, and the kinds a ref takes. */
function typeCell(input: InputDoc): string {
  const kinds = input.kinds?.length
    ? ` (${input.kinds.map((kind) => `\`${kind}\``).join(', ')})`
    : '';
  return `\`${input.type}\`${kinds}`.replace(/\|/g, '\\|');
}

/** The required-or-default cell. */
function requiredCell(input: InputDoc): string {
  if (input.required) return '**required**';
  return input.fallback ? `default \`${input.fallback}\`` : 'optional';
}
