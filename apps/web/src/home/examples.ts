/**
 * The example library (P6-06 S3): designs that show what Extrudo can do,
 * opened as copies from the home screen's More examples… and from a
 * `#/example/<id>` link (a later slice builds the site's gallery page from the
 * same registry, `fixtures/examples/examples.json`). The files are the
 * benchmark fixtures under `fixtures/benchmarks/`, bundled by the glob below
 * and fetched over the network when one opens — they are not precached
 * (P6-06 S3, `pwa/precache-plugin.ts`).
 */
import type { ExtrudoDocument } from '@extrudo/core';
import data from '../../../../fixtures/examples/examples.json';
import { templateFromBytes } from './gallery';

const files = import.meta.glob('../../../../fixtures/benchmarks/*.extrudo', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export type ExampleLevel = 'beginner' | 'intermediate' | 'advanced';

export interface Example {
  id: string;
  title: string;
  description: string;
  /** The fixture file, relative to `fixtures/`. */
  file: string;
  /** The features the example shows, lower case. */
  tags: readonly string[];
  level: ExampleLevel;
  /** The bundled `.extrudo` file's URL. */
  url: string;
}

export const EXAMPLES: readonly Example[] = data.map((e) => {
  const url = files[`../../../../fixtures/${e.file}`];
  if (url === undefined) throw new Error(`Example ${e.id}: no file ${e.file}`);
  return { ...e, level: e.level as ExampleLevel, tags: e.tags, url };
});

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

/** The example's design as a fresh copy named like its title. */
export async function createFromExample(e: Example): Promise<ExtrudoDocument> {
  const response = await fetch(e.url);
  if (!response.ok) throw new Error(`Couldn't load the ${e.title} example.`);
  return templateFromBytes(new Uint8Array(await response.arrayBuffer()), e.title);
}
