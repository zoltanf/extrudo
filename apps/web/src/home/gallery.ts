/**
 * The template gallery on the home screen (P3-12, FR-UX-05, ADR-0052): the
 * Wall bracket, built in code, and three designs the app itself made and
 * exported, kept as `.extrudo` files under `fixtures/benchmarks/` (B2, B4 and
 * B5, the same files the benchmark tests recompute). A file template goes
 * through storage's `readArchive`, so core's migrations apply to it like to any
 * file the user opens. Every card has a thumbnail checked in under
 * `home/templates/`; `RECORD_ASSETS=1 pnpm e2e e2e/record-assets.spec.ts`
 * remakes them from the app's own render.
 *
 * Each template also says which of its parameters it **exposes** for changing
 * (`exposed`, P4-07, ADR-0059 §1) and which configurations it comes with
 * (`configurations`, ADR-0059 §2), so opening one gives a design whose
 * Customizer panel already does something. The list lives here and not in the
 * fixtures, since the benchmark e2e specs rewrite those; a parameter the
 * template doesn't have is skipped, and the gallery's test fails if a listed
 * name is missing, so the two stay in sync.
 */
import {
  addConfiguration,
  applyCommand,
  type ConfigurationId,
  type DocumentId,
  type ExtrudoDocument,
  newId,
  type ParameterId,
  setParameterCustomizer,
} from '@extrudo/core';
import { readArchive } from '@extrudo/storage';
import b2 from '../../../../fixtures/benchmarks/b2-storage-box.extrudo?url';
import b4 from '../../../../fixtures/benchmarks/b4-box-with-lid.extrudo?url';
import b5 from '../../../../fixtures/benchmarks/b5-pcb-enclosure.extrudo?url';
import { wallBracket } from '../project/templates';
import boxWithLidThumbnail from './templates/box-with-lid.png?url';
import pcbEnclosureThumbnail from './templates/pcb-enclosure.png?url';
import storageBoxThumbnail from './templates/storage-box.png?url';
import wallBracketThumbnail from './templates/wall-bracket.png?url';

/** A parameter the template exposes for changing, and the slider it gets. */
export interface Exposed {
  /** The parameter's name in the template's document; skipped when it has none. */
  name: string;
  /** The slider's range in the parameter's base unit (a range, not a limit). */
  min: number;
  max: number;
  /** The slider's step in the same unit; a hundredth of the range by default. */
  step?: number;
  /** The panel heading the row sits under. */
  group?: string;
}

/** A configuration a template comes with, as expressions by parameter name. */
export interface TemplateConfiguration {
  name: string;
  values: Readonly<Record<string, string>>;
}

export interface Template {
  id: string;
  name: string;
  /** One line for its card. */
  summary: string;
  /** A small picture of the model, a transparent PNG (URL). */
  thumbnail: string;
  /** The `.extrudo` file a template comes from (URL); absent for one built in code. */
  file?: string;
  /** The parameters it exposes for changing, by name (P4-07, ADR-0059 §1). */
  exposed?: readonly Exposed[];
  /** Configurations it comes with (ADR-0059 §2); neither is the current size. */
  configurations?: readonly TemplateConfiguration[];
  /** The design to start from: a document with an ID of its own, named like the template. */
  create(): Promise<ExtrudoDocument>;
}

/** A template's document: the same design under a new ID, named and dated as a new one. */
export function fromTemplate(doc: ExtrudoDocument, name: string): ExtrudoDocument {
  return {
    ...doc,
    id: newId<DocumentId>(),
    name,
    meta: { ...doc.meta, created: new Date().toISOString() },
  };
}

/** A template's design from the bytes of its `.extrudo` file. */
export function templateFromBytes(bytes: Uint8Array, name: string): ExtrudoDocument {
  return fromTemplate(readArchive(bytes).doc, name);
}

/**
 * A template's copy with its exposed parameters and its configurations (P4-07).
 *
 * Both go through core's commands, so the schema has the last word, but on the
 * copy of a design that isn't stored yet: opening a template is not something
 * the user undoes (ADR-0059 §4). A parameter the template doesn't have is
 * skipped rather than refused, so a template still opens after a parameter is
 * renamed in the fixture.
 */
export function withTemplateCustomizer(
  doc: ExtrudoDocument,
  template: Pick<Template, 'exposed' | 'configurations'>,
): ExtrudoDocument {
  let copy = doc;
  for (const row of template.exposed ?? []) {
    const parameter = copy.parameters.find((p) => p.name === row.name);
    if (!parameter) continue;
    copy = applyCommand(
      copy,
      setParameterCustomizer({
        id: parameter.id,
        customizer: {
          min: row.min,
          max: row.max,
          ...(row.step === undefined ? {} : { step: row.step }),
          ...(row.group ? { group: row.group } : {}),
        },
      }),
    ).doc;
  }
  for (const configuration of template.configurations ?? []) {
    const values: Record<ParameterId, string> = {};
    for (const [name, expression] of Object.entries(configuration.values)) {
      const parameter = copy.parameters.find((p) => p.name === name);
      if (parameter) values[parameter.id] = expression;
    }
    // A configuration of parameters that are all gone would apply to nothing.
    if (Object.keys(values).length === 0) continue;
    copy = applyCommand(
      copy,
      addConfiguration({
        configuration: { id: newId<ConfigurationId>(), name: configuration.name, values },
      }),
    ).doc;
  }
  return copy;
}

function fileTemplate(t: Omit<Template, 'create'> & { file: string }): Template {
  return {
    ...t,
    async create() {
      const response = await fetch(t.file);
      if (!response.ok) throw new Error(`Couldn't load the ${t.name} template.`);
      return withTemplateCustomizer(
        templateFromBytes(new Uint8Array(await response.arrayBuffer()), t.name),
        t,
      );
    },
  };
}

/** A template the app builds itself: a fresh document, then the same as a file one. */
function codeTemplate(t: Omit<Template, 'create'> & { build(): ExtrudoDocument }): Template {
  return {
    ...t,
    async create() {
      return withTemplateCustomizer(fromTemplate(t.build(), t.name), t);
    },
  };
}

export const TEMPLATES: readonly Template[] = [
  codeTemplate({
    id: 'wall-bracket',
    name: 'Wall bracket',
    summary: 'Parameters, fillets and a timeline to explore.',
    thumbnail: wallBracketThumbnail,
    build: wallBracket,
    exposed: [
      { name: 'width', min: 40, max: 200, step: 1, group: 'Size' },
      { name: 'wall', min: 1.2, max: 4, step: 0.2, group: 'Walls' },
      { name: 'tilt', min: 0, max: 30, step: 1, group: 'Holes' },
    ],
    configurations: [
      { name: 'Wide', values: { width: '160 mm', wall: '3 mm', tilt: '10 deg' } },
      { name: 'Narrow', values: { width: '40 mm', wall: '2 mm', tilt: '20 deg' } },
    ],
  }),
  fileTemplate({
    id: 'storage-box',
    name: 'Storage box',
    summary: 'An open box cut from a solid. Change its width, depth and walls.',
    thumbnail: storageBoxThumbnail,
    file: b2,
    exposed: [
      { name: 'width', min: 40, max: 200, step: 1, group: 'Size' },
      { name: 'depth', min: 30, max: 200, step: 1, group: 'Size' },
      { name: 'height', min: 20, max: 150, step: 1, group: 'Size' },
      { name: 'wall', min: 1.2, max: 4, step: 0.2, group: 'Walls' },
    ],
    configurations: [
      { name: 'Small', values: { width: '50 mm', depth: '35 mm', height: '25 mm', wall: '2 mm' } },
      {
        name: 'Large',
        values: { width: '140 mm', depth: '100 mm', height: '70 mm', wall: '3.2 mm' },
      },
    ],
  }),
  fileTemplate({
    id: 'box-with-lid',
    name: 'Box with a lid',
    summary: 'Two bodies that fit, with a clearance parameter.',
    thumbnail: boxWithLidThumbnail,
    file: b4,
    exposed: [
      { name: 'length', min: 40, max: 200, step: 1, group: 'Size' },
      { name: 'width', min: 30, max: 200, step: 1, group: 'Size' },
      { name: 'height', min: 20, max: 150, step: 1, group: 'Size' },
      { name: 'wall', min: 1.2, max: 4, step: 0.2, group: 'Walls' },
    ],
    configurations: [
      {
        name: 'Small',
        values: { length: '50 mm', width: '35 mm', height: '25 mm', wall: '1.6 mm' },
      },
      {
        name: 'Large',
        values: { length: '130 mm', width: '90 mm', height: '60 mm', wall: '3 mm' },
      },
    ],
  }),
  fileTemplate({
    id: 'pcb-enclosure',
    name: 'PCB enclosure',
    summary: 'Screw posts, holes and a lid, patterned and mirrored.',
    thumbnail: pcbEnclosureThumbnail,
    file: b5,
    exposed: [
      { name: 'length', min: 40, max: 200, step: 1, group: 'Size' },
      { name: 'width', min: 30, max: 200, step: 1, group: 'Size' },
      { name: 'height', min: 15, max: 100, step: 1, group: 'Size' },
      { name: 'wall', min: 1.2, max: 4, step: 0.2, group: 'Walls' },
    ],
    configurations: [
      {
        name: 'Small',
        values: { length: '60 mm', width: '45 mm', height: '18 mm', wall: '1.6 mm' },
      },
      {
        name: 'Large',
        values: { length: '130 mm', width: '90 mm', height: '40 mm', wall: '3 mm' },
      },
    ],
  }),
];
