// A STEP file's hidden solids (ADR-0066's amendment of 2026-11-10): the
// facade's `readStepHidden` (which solids an `INVISIBILITY` entity hides) and
// the `import` feature's `ImportReport.hidden` (the bodies they become). The
// files are our own `writeStep`'s three boxes with the hiding entities added
// by hand. Real OCCT, `strictLeaks` on.
import {
  type AttachmentId,
  type BodyId,
  type ExtrudoDocument,
  type FeatureId,
  type ImportReport,
  importInputs,
  isImportReport,
} from '@extrudo/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Kernel, type ShapeHandle } from '../kernel';
import { loadOcct } from '../occt/load';
import { RecomputeEngine } from '../recompute/engine';
import { testDocument, testFeature } from '../recompute/testing';
import type { ImportedFile } from '../recompute/types';
import { kernelFeatures } from '.';

let kernel: Kernel;

beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
});

afterEach(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

/** Three boxes of 1000, 2000 and 3000 mm³ as a STEP file, coloured or not. */
function threeBoxes(colors: (string | undefined)[] = []): string {
  const boxes = [
    kernel.box([10, 10, 10], [0, 0, 0]),
    kernel.box([20, 10, 10], [30, 0, 0]),
    kernel.box([10, 10, 30], [60, 0, 0]),
  ];
  try {
    return kernel.writeStep(
      boxes.map((shape, i) => {
        const color = colors[i];
        return { shape, name: `Part${i + 1}`, ...(color && { color }) };
      }),
    );
  } finally {
    kernel.release(...boxes);
  }
}

/** The entity numbers of the file's solids, in file order (which is the parts'). */
function solidIds(text: string): number[] {
  return [...text.matchAll(/#(\d+)\s*=\s*MANIFOLD_SOLID_BREP/g)].map((m) => Number(m[1]));
}

/** The text with more entities at the end of its DATA section. */
function withEntities(text: string, entities: string[]): string {
  const end = text.lastIndexOf('ENDSEC;');
  return `${text.slice(0, end)}${entities.join('\n')}\n${text.slice(end)}`;
}

/** A `STYLED_ITEM` #9008 of the entity, with the style entities it needs. */
function styledItem(of: number): string[] {
  return [
    "#9001 = COLOUR_RGB('',1.,0.,0.);",
    "#9002 = FILL_AREA_STYLE_COLOUR('',#9001);",
    "#9003 = FILL_AREA_STYLE('',(#9002));",
    '#9004 = SURFACE_STYLE_FILL_AREA(#9003);',
    "#9005 = SURFACE_SIDE_STYLE('',(#9004));",
    '#9006 = SURFACE_STYLE_USAGE(.BOTH.,#9005);',
    '#9007 = PRESENTATION_STYLE_ASSIGNMENT((#9006));',
    `#9008 = STYLED_ITEM('',(#9007),#${of});`,
  ];
}

/** Volumes of `readStep(text)`'s solids, in `solids()` order. */
function solidVolumes(text: string): number[] {
  const read = kernel.readStep(text);
  const solids = kernel.solids(read);
  try {
    return solids.map((s) => Math.round(kernel.measure(s).volume));
  } finally {
    kernel.release(...solids, read);
  }
}

/** The volumes of the solids `readStepHidden` says the file hides. */
function hiddenVolumes(text: string): number[] {
  const hidden = kernel.readStepHidden(text);
  const volumes = solidVolumes(text);
  expect(hidden).toHaveLength(volumes.length);
  return volumes.filter((_, i) => hidden[i]).sort((a, b) => a - b);
}

describe("a STEP file's hidden solids in the kernel", () => {
  it('a file without INVISIBILITY hides nothing', () => {
    const text = threeBoxes();
    expect(text).not.toContain('INVISIBILITY');
    expect(kernel.readStepHidden(text)).toEqual([false, false, false]);
  });

  it('a solid listed in INVISIBILITY itself is hidden', () => {
    const text = threeBoxes();
    const [, second, third] = solidIds(text);
    expect(hiddenVolumes(withEntities(text, [`#9100 = INVISIBILITY((#${second}));`]))).toEqual([
      2000,
    ]);
    // Several items, spaces and line breaks between them, and a comment.
    const both = withEntities(text, [
      `#9100 = INVISIBILITY ( ( #${second} ,\n  /* the tall one */ #${third} ) ) ;`,
    ]);
    expect(hiddenVolumes(both)).toEqual([2000, 3000]);
  });

  it('a solid whose styled item is listed is hidden; a face of it hides nothing', () => {
    const text = threeBoxes();
    const [first] = solidIds(text);
    const styled = withEntities(text, [
      ...styledItem(first as number),
      '#9100 = INVISIBILITY((#9008));',
    ]);
    expect(hiddenVolumes(styled)).toEqual([1000]);
    const face = Number(/#(\d+)\s*=\s*ADVANCED_FACE/.exec(text)?.[1]);
    const styledFace = withEntities(text, [...styledItem(face), '#9100 = INVISIBILITY((#9008));']);
    expect(hiddenVolumes(styledFace)).toEqual([]);
  });

  it('a solid on a hidden layer is hidden', () => {
    const text = threeBoxes();
    const [first, , third] = solidIds(text);
    const layered = withEntities(text, [
      `#9010 = PRESENTATION_LAYER_ASSIGNMENT('construction','',(#${first},#${third}));`,
      '#9100 = INVISIBILITY((#9010));',
    ]);
    expect(hiddenVolumes(layered)).toEqual([1000, 3000]);
  });

  it('the keyword inside a string or a comment lists nothing', () => {
    const text = threeBoxes();
    const [first, second] = solidIds(text);
    const named = withEntities(text, [
      `#9010 = DESCRIPTIVE_REPRESENTATION_ITEM('INVISIBILITY((#${first}))','');`,
      `/* INVISIBILITY((#${second})); */`,
    ]);
    expect(hiddenVolumes(named)).toEqual([]);
  });
});

describe('the import feature reports the bodies a file hides', () => {
  const IMPORT_ID = 'Import1' as FeatureId;
  let engine: RecomputeEngine | undefined;
  const held = new Map<AttachmentId, ImportedFile>();
  // Every text is a file of its own: the engine keeps an import whose inputs didn't change.
  let files = 0;

  afterEach(() => {
    engine?.clear();
    engine = undefined;
    held.clear();
    vi.restoreAllMocks();
  });

  function design(text: string, up?: 'y'): ExtrudoDocument {
    const bytes = new TextEncoder().encode(text);
    const file = `file-${++files}` as AttachmentId;
    held.set(file, { bytes, mediaType: 'model/step' });
    return {
      ...testDocument([
        { ...testFeature('Import1', 'import'), inputs: importInputs({ file, ...(up && { up }) }) },
      ]),
      attachments: {
        [file]: {
          name: 'parts',
          fileName: 'parts.step',
          mediaType: 'model/step',
          sha256: 'c'.repeat(64),
          size: bytes.length,
        },
      },
    };
  }

  /** The import's report and its bodies' volumes; `hidden` is the hidden bodies' volumes. */
  async function imported(doc: ExtrudoDocument) {
    engine ??= new RecomputeEngine(kernel, kernelFeatures(), {
      strictLeaks: true,
      files: (id) => held.get(id),
    });
    const result = await engine.recompute({ doc });
    if (result.status !== 'done') throw new Error('cancelled');
    expect(result.features[IMPORT_ID]?.status).toBe('ok');
    const own = result.reports[IMPORT_ID];
    const report = isImportReport(own) ? (own as ImportReport) : undefined;
    const volume = Object.fromEntries(
      result.bodies.map(({ id }) => [
        id,
        Math.round(kernel.measure(engine?.latestBody(id as BodyId) as ShapeHandle).volume),
      ]),
    ) as Record<BodyId, number>;
    const ids = result.bodies.map(({ id }) => id as BodyId);
    return {
      report,
      ids,
      volume,
      volumes: Object.values(volume).sort((a, b) => a - b),
      hidden: report?.hidden.map((id) => volume[id]).sort((a, b) => (a ?? 0) - (b ?? 0)),
    };
  }

  it('every solid is a body, and the hidden ones are reported', { timeout: 60_000 }, async () => {
    const text = threeBoxes();
    const plain = await imported(design(text));
    expect(plain.volumes).toEqual([1000, 2000, 3000]);
    // Nothing hidden: the report (it has the parts' names) lists no body.
    expect(plain.report?.hidden ?? []).toEqual([]);

    const [, second, third] = solidIds(text);
    const one = await imported(design(withEntities(text, [`#9100 = INVISIBILITY((#${second}));`])));
    // The same bodies with the same IDs: a hidden solid changes nothing but the report.
    expect(one.ids).toEqual(plain.ids);
    expect(one.volume).toEqual(plain.volume);
    expect(one.hidden).toEqual([2000]);

    // The largest solid keeps the feature's own body ID, hidden or not.
    const two = await imported(
      design(withEntities(text, [`#9100 = INVISIBILITY((#${second},#${third}));`])),
    );
    expect(two.ids).toEqual(plain.ids);
    expect(two.hidden).toEqual([2000, 3000]);
    // Turned with Up: the same bodies are hidden.
    const turned = await imported(
      design(withEntities(text, [`#9100 = INVISIBILITY((#${second},#${third}));`]), 'y'),
    );
    expect(turned.report?.hidden).toEqual(two.report?.hidden);
  });

  it('colours and part names are reported beside the hidden bodies', {
    timeout: 60_000,
  }, async () => {
    const text = threeBoxes(['#c81e28', undefined, '#1080ff']);
    const [first] = solidIds(text);
    const { report, volume, hidden } = await imported(
      design(withEntities(text, [`#9100 = INVISIBILITY((#${first}));`])),
    );
    if (!report) throw new Error('no import report');
    expect(hidden).toEqual([1000]);
    const by = (of: Record<BodyId, string>) =>
      Object.fromEntries(Object.entries(of).map(([id, value]) => [volume[id as BodyId], value]));
    expect(by(report.colors)).toEqual({ 1000: '#c81e28', 3000: '#1080ff' });
    expect(by(report.names)).toEqual({ 1000: 'Part1', 2000: 'Part2', 3000: 'Part3' });
  });

  it('a file that hides every solid hides none', { timeout: 60_000 }, async () => {
    const text = threeBoxes();
    const all = withEntities(text, [
      `#9100 = INVISIBILITY((${solidIds(text)
        .map((id) => `#${id}`)
        .join(',')}));`,
    ]);
    const { volumes, report } = await imported(design(all));
    expect(volumes).toEqual([1000, 2000, 3000]);
    expect(report?.hidden ?? []).toEqual([]);
  });

  it('a file without INVISIBILITY is not read for hidden solids', {
    timeout: 60_000,
  }, async () => {
    const read = vi.spyOn(kernel, 'readStepHidden');
    const { volumes, report } = await imported(design(threeBoxes()));
    expect(volumes).toEqual([1000, 2000, 3000]);
    expect(report?.hidden ?? []).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
