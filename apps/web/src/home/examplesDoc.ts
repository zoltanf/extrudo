/**
 * The examples gallery page, `docs/guide/examples.md` (P6-06 S4, ADR-0080 §3).
 * Pure: `scripts/generate-docs.mjs` writes it from the registry
 * `fixtures/examples/examples.json`, and `examplesDoc.test.ts` fails when the
 * checked-in page is stale ("run pnpm docs:generate").
 *
 * The pictures are `docs/guide/images/examples/<id>.png`, recorded from the app
 * by `e2e/record-assets.spec.ts`; the site's build emits them as hashed assets.
 * The app's own More examples… dialog reads the same pictures.
 */

/** One example as the registry lists it (the JSON's shape). */
export interface ExampleEntry {
  id: string;
  title: string;
  description: string;
  tags: readonly string[];
  level: 'beginner' | 'intermediate' | 'advanced';
}

/** The levels, in the order the page lists them. */
const LEVELS = [
  ['beginner', 'Beginner'],
  ['intermediate', 'Intermediate'],
  ['advanced', 'Advanced'],
] as const;

const COUNT_WORDS = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
  'Twenty',
];

/** The page for these examples, ending in one newline. Within a level, the registry's order. */
export function examplesPage(examples: readonly ExampleEntry[]): string {
  const count = examples.length;
  const countWord = COUNT_WORDS[count] ?? String(count);
  const sections = LEVELS.map(([level, heading]) => {
    const entries = examples
      .filter((e) => e.level === level)
      .map((e) =>
        [
          `### ${e.title}`,
          `![${e.title}](./images/examples/${e.id}.png)`,
          '',
          e.description,
          '',
          `Shows: ${e.tags.join(', ')}.`,
          '',
          `[Open in Extrudo]({{APP_URL}}/#/example/${e.id})`,
        ].join('\n'),
      );
    return [`## ${heading}`, ...entries.flatMap((entry) => [entry, ''])].join('\n');
  });
  return [
    '---',
    'title: Examples',
    'section: Examples',
    'order: 0',
    '---',
    '',
    '# Examples',
    '',
    `${countWord} designs to open, take apart and change. Each opens as your own copy`,
    'in the app: nothing you change touches the original. They are the models',
    "Extrudo's own tests build, so they always work with the current version.",
    '',
    ...sections,
  ].join('\n');
}
