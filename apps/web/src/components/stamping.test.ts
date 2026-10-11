import { describe, expect, it } from 'vitest';

// Every file of the app that inserts a feature, read as text (P6-05 S4, ADR-0081 §6): a later
// insert site can't forget to stamp the active component.
const sources = import.meta.glob<string>('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const INSERTERS = [
  '../features/dialog.ts',
  '../sketch/mode.ts',
  '../plugins/runCommand.ts',
  '../macro/macro.ts',
  '../shell/bodies.ts',
];
const INSERT = /\binsertFeature\(|\bcreateSketch\(/;
const STAMP = /withActiveComponent|activeComponentOf/;

describe('app inserts stamp the active component', () => {
  it('lists every file that inserts a feature', () => {
    const files = Object.entries(sources)
      .filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.endsWith('/testing.ts'))
      .filter(([, text]) => INSERT.test(text))
      .map(([path]) => path)
      .sort();
    expect(files).toEqual([...INSERTERS].sort());
  });

  it.each(INSERTERS)('%s stamps', (path) => {
    expect(sources[path]).toMatch(STAMP);
  });
});
