import { gzipSync } from 'node:zlib';
import { Design } from '@extrudo/api';
import { type AttachmentId, addAttachment, type BodyId, createDocument } from '@extrudo/core';
import type { BodyPlan, BodyStep, ImportResult } from '@extrudo/f3d';
import type { HistoryStop, TreeReason } from '@extrudo/fcstd';
import { memoryProjectStore, sha256Hex, writeArchive } from '@extrudo/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appNotifications } from '../design-system/notifications';
import { takeModelImport } from '../features/import';
import { memoryPreferences, type Platform } from '../platform';
import {
  CHECKING_TEXT,
  createBlankProject,
  FCSTD_READING_TEXT,
  fcstdNotices,
  importAnyFile,
  importF3dFile,
  importFcstdFile,
  importNotices,
  isFcstd,
  MAX_F3D_BYTES,
  MAX_FCSTD_BYTES,
  NEW_DESIGN_UNITS_KEY,
  newDesignUnits,
  openExternalFile,
  parameterNotices,
  READING_TEXT,
  saveF3dImport,
  takeOpenNotices,
} from './actions';

const fakePlatform = (projects: ReturnType<typeof memoryProjectStore>): Platform =>
  ({ projects }) as unknown as Platform;

const openedFile = (path: string, doc = createDocument({ name: 'From disk' })) => ({
  path,
  name: path.split('/').pop() ?? path,
  bytes: writeArchive(doc),
  modified: 123,
});

describe('openExternalFile (P6-01 slice 2, finding 3)', () => {
  const globals = globalThis as { window?: { location: { hash: string } } };
  beforeEach(() => {
    globals.window = { location: { hash: '' } };
  });
  afterEach(() => {
    delete globals.window;
  });

  it('imports the file, links it external and navigates', async () => {
    const projects = memoryProjectStore();
    const file = openedFile('/models/A.extrudo');
    const summary = await openExternalFile(fakePlatform(projects), file);
    const stored = await projects.get(summary.id);
    // The bytes' hash too: a time a sync client moves later isn't a change (#155).
    expect(stored?.linked).toEqual({
      file: '/models/A.extrudo',
      modified: 123,
      sha256: sha256Hex(file.bytes),
      external: true,
    });
    expect((await projects.list()).map((p) => p.id)).toEqual([summary.id]);
    expect(globals.window?.location.hash).toBe(`#/p/${encodeURIComponent(summary.id)}`);
  });

  it('a second open of the same path reuses the existing project (no copy)', async () => {
    const projects = memoryProjectStore();
    const platform = fakePlatform(projects);
    const first = await openExternalFile(platform, openedFile('/models/A.extrudo'));
    const second = await openExternalFile(platform, openedFile('/models/A.extrudo'));
    expect(second.id).toBe(first.id);
    expect(await projects.list()).toHaveLength(1);
  });

  it('opens an .extrudo.gz as a copy, not linked to the file', async () => {
    const projects = memoryProjectStore();
    const platform = fakePlatform(projects);
    const file = openedFile('/models/A.extrudo.gz');
    const gz = { ...file, bytes: new Uint8Array(gzipSync(file.bytes)) };
    const first = await openExternalFile(platform, gz);
    expect((await projects.get(first.id))?.linked).toBeUndefined();
    expect(globals.window?.location.hash).toBe(`#/p/${encodeURIComponent(first.id)}`);
    // Not linked, so a second open is another copy, as a second Import… is.
    const second = await openExternalFile(platform, gz);
    expect(second.id).not.toBe(first.id);
  });

  it('a different path still imports a new project', async () => {
    const projects = memoryProjectStore();
    const platform = fakePlatform(projects);
    await openExternalFile(platform, openedFile('/models/A.extrudo'));
    const other = await openExternalFile(platform, openedFile('/models/B.extrudo'));
    expect(await projects.list()).toHaveLength(2);
    const stored = await projects.get(other.id);
    expect(stored?.linked?.external).toBe(true);
    expect(stored?.linked?.file).toBe('/models/B.extrudo');
  });
});

describe('importF3dFile (M1)', () => {
  it('refuses a file over 100 MB before reading it', async () => {
    const projects = memoryProjectStore();
    let read = false;
    const file = {
      name: 'huge.f3d',
      size: MAX_F3D_BYTES + 1,
      arrayBuffer: () => {
        read = true;
        return Promise.resolve(new ArrayBuffer(0));
      },
    } as unknown as File;
    await expect(importF3dFile(fakePlatform(projects), file)).rejects.toThrow(
      /too large to import/,
    );
    expect(read).toBe(false);
  });
});

describe('a new design takes the remembered unit (FR-PRJ-07, ADR-0113 §1)', () => {
  const platformWith = (projects: ReturnType<typeof memoryProjectStore>, stored?: unknown) =>
    ({
      projects,
      preferences: memoryPreferences(
        stored === undefined ? {} : { [NEW_DESIGN_UNITS_KEY]: stored },
      ),
      storage: { requestPersistence: async () => true },
    }) as unknown as Platform;

  it("the Home tab's New Design is in the unit last picked on the home screen", async () => {
    const projects = memoryProjectStore();
    const id = await createBlankProject(platformWith(projects, 'in'));
    expect((await projects.load(id)).settings.units).toBe('in');
  });

  it('is millimetres with nothing stored, or something that is not a unit', () => {
    expect(newDesignUnits(memoryPreferences())).toBe('mm');
    expect(newDesignUnits(memoryPreferences({ [NEW_DESIGN_UNITS_KEY]: 'furlong' }))).toBe('mm');
    expect(newDesignUnits(memoryPreferences({ [NEW_DESIGN_UNITS_KEY]: 'cm' }))).toBe('cm');
  });
});

describe("the home screen's Import… (ADR-0083 §4)", () => {
  const platformPicking = (projects: ReturnType<typeof memoryProjectStore>, file: File) =>
    ({
      projects,
      files: { pick: async () => file },
      storage: { requestPersistence: async () => true },
    }) as unknown as Platform;

  it('makes a new design for a model file and asks it to open the Import dialog', async () => {
    const projects = memoryProjectStore();
    const file = new File([new Uint8Array([1])], 'Bracket.stl');
    const summary = await importAnyFile(platformPicking(projects, file));
    expect(summary).toBeDefined();
    const id = summary?.id ?? '';
    expect((await projects.load(id as never)).name).toBe('Bracket');
    expect(takeModelImport(id)).toBe(file);
    expect(takeModelImport(id)).toBeUndefined();
  });

  it('makes a new design for another CAD file on the desktop only (ADR-0115 §1)', async () => {
    const projects = memoryProjectStore();
    const file = new File([new Uint8Array([1])], 'Bracket.SLDPRT');
    const accepts: string[] = [];
    const desktop = {
      ...platformPicking(projects, file),
      files: {
        pick: async (accept: string) => {
          accepts.push(accept);
          return file;
        },
      },
      convertCad: async () => ({ ok: false as const, message: 'unused' }),
    } as unknown as Platform;
    const summary = await importAnyFile(desktop);
    expect(accepts[0]).toContain('.sldprt');
    const id = summary?.id ?? '';
    expect((await projects.load(id as never)).name).toBe('Bracket');
    expect(takeModelImport(id)).toBe(file);
  });

  it('imports an .extrudo file as itself, with no Import dialog', async () => {
    const projects = memoryProjectStore();
    const bytes = writeArchive(createDocument({ name: 'Saved' }));
    const file = new File([bytes as Uint8Array<ArrayBuffer>], 'Saved.extrudo');
    const summary = await importAnyFile(platformPicking(projects, file));
    const id = summary?.id ?? '';
    expect((await projects.load(id as never)).name).toBe('Saved');
    expect(takeModelImport(id)).toBeUndefined();
  });
});

describe('saveF3dImport: the body check (ADR-0084)', () => {
  const steps: BodyStep[] = [{ record: 1, name: 'Body1', step: 'ISO-10303-21;\nA;' }];

  /** A replayed design with one box, as the importer returns it. */
  function imported(withSteps = steps): ImportResult & { box: BodyId } {
    const design = Design.create({ name: 'Bracket' });
    const box = `${design.box({ length: '10 mm' }).id}:0` as BodyId;
    return {
      design,
      report: { imported: ['Box1'], skipped: [], notes: [], problems: [] },
      steps: withSteps,
      bodies: [{ record: 1, name: 'Body1', hint: box }],
      box,
    };
  }

  /** The memory store, with every write it is asked for in order. */
  function recording() {
    const projects = memoryProjectStore();
    const calls: string[] = [];
    const platform = {
      projects: {
        ...projects,
        save: (doc: Parameters<typeof projects.save>[0]) => {
          calls.push(`save:${doc.features.length}`);
          return projects.save(doc);
        },
        writeAttachment: (...args: Parameters<typeof projects.writeAttachment>) => {
          calls.push('attachment');
          return projects.writeAttachment(...args);
        },
      },
      storage: { requestPersistence: async () => true },
    } as unknown as Platform;
    return { projects, platform, calls };
  }

  const frozenPlan = (box: BodyId): BodyPlan => ({
    matched: [],
    frozen: [{ record: 1, name: 'Body1', counterpart: box }],
    remove: [box],
    outcomes: [
      {
        record: 1,
        name: 'Body1',
        outcome: 'frozen',
        reason: 'the timeline made it differently',
      },
    ],
  });

  it('saves the replay first, writes the STEP, then saves the design with the plan applied', async () => {
    const result = imported();
    const { projects, platform, calls } = recording();
    const id = await saveF3dImport(platform, result, async () => frozenPlan(result.box));
    expect(calls).toEqual(['save:1', 'attachment', 'save:3']);
    const doc = await projects.load(id);
    expect(doc.features.map((f) => [f.type, f.name])).toEqual([
      ['box', expect.any(String)],
      ['remove', 'Remove rebuilt bodies'],
      ['import', 'Import Body1'],
    ]);
    const [attachment] = Object.values(doc.attachments ?? {});
    expect(await projects.readAttachment(id, attachment?.sha256 ?? '')).toBeDefined();
    expect(takeOpenNotices(id)).toContain(
      'Taken from the file\'s own shapes, without history: Body1 (the timeline made it differently). Suppress "Remove rebuilt bodies" to see what the timeline made.',
    );
  });

  it('keeps the replay and says why when the check fails', async () => {
    const { projects, platform, calls } = recording();
    const id = await saveF3dImport(platform, imported(), async () => ({
      error: 'it took longer than 60 s',
    }));
    expect(calls).toEqual(['save:1']);
    expect((await projects.load(id)).features).toHaveLength(1);
    expect(takeOpenNotices(id)).toContain(
      "The bodies couldn't be checked against the file (it took longer than 60 s); the design is as the timeline rebuilt it.",
    );
  });

  it('keeps the replay when the STEP cannot be stored', async () => {
    const result = imported();
    const { platform, calls } = recording();
    platform.projects.writeAttachment = async () => {
      throw new Error('This file is too large to keep with the design.');
    };
    const id = await saveF3dImport(platform, result, async () => frozenPlan(result.box));
    expect(calls).toEqual(['save:1']);
    expect(takeOpenNotices(id).at(-1)).toMatch(/couldn't be checked .*too large/);
  });

  it('runs the import through `run`, saying it is reading, then checking', async () => {
    const result = imported();
    const { platform, calls } = recording();
    const toasts = () => appNotifications.getState().toasts.map((t) => t.text);
    const seen: string[][] = [];
    const file = new File([new Uint8Array([1, 2])], 'Bracket.f3d');
    const id = await importF3dFile(
      platform,
      file,
      async () => {
        seen.push(toasts());
        return frozenPlan(result.box);
      },
      async (bytes, name, options) => {
        seen.push(toasts());
        expect([...bytes]).toEqual([1, 2]);
        expect(name).toBe('Bracket');
        expect(options.id).toEqual(expect.any(String));
        return result;
      },
    );
    expect(seen[0]).toContain(READING_TEXT);
    expect(seen[1]).toContain(CHECKING_TEXT);
    expect(seen[1]).not.toContain(READING_TEXT);
    expect(toasts()).not.toContain(CHECKING_TEXT);
    expect(calls).toEqual(['save:1', 'attachment', 'save:3']);
    expect(id && takeOpenNotices(id)[0]).toMatch(/^Imported from the .f3d file/);
  });

  it('takes the reading toast down when the import fails', async () => {
    const { platform } = recording();
    const file = new File([new Uint8Array([1])], 'Bad.f3d');
    await expect(
      importF3dFile(platform, file, undefined, async () => {
        throw new Error('Not a ZIP archive (no end of central directory).');
      }),
    ).rejects.toThrow('Not a ZIP archive');
    expect(appNotifications.getState().toasts.map((t) => t.text)).not.toContain(READING_TEXT);
  });

  it('does not run the check when the writer wrote no body', async () => {
    const { platform } = recording();
    let ran = false;
    const id = await saveF3dImport(
      platform,
      imported([{ record: 1, name: 'Body1', reason: 'spline surfaces' }]),
      async () => {
        ran = true;
        return undefined;
      },
    );
    expect(ran).toBe(false);
    expect(takeOpenNotices(id)).toEqual(['Imported from the .f3d file: 1 of 1 timeline features.']);
  });
});

describe('importNotices: the bodies', () => {
  const base = { imported: [], skipped: [], problems: [] };
  const body = (
    name: string,
    outcome: 'editable' | 'frozen' | 'unchecked' | 'missing',
    extra = {},
  ) => ({
    name,
    outcome,
    ...extra,
  });

  it('says how many records could not be read', () => {
    expect(importNotices({ ...base, problems: ['a', 'b'] })).toContain(
      "2 records in the file could not be read (a format Extrudo doesn't know yet); features that depend on them may be wrong. Please report it with the file: Help › Report a Bug…",
    );
    expect(importNotices(base).some((n) => n.includes('could not be read'))).toBe(false);
  });

  it('says every body matches only when every body was checked', () => {
    expect(
      importNotices({ ...base, bodies: [body('Body1', 'editable'), body('Body2', 'editable')] }),
    ).toContain("All 2 bodies match the file's own shapes.");
    expect(importNotices({ ...base, bodies: [body('Body1', 'editable')] })).toContain(
      "The body matches the file's own shape.",
    );
    expect(
      importNotices({ ...base, bodies: [body('Body1', 'editable'), body('Body2', 'unchecked')] }),
    ).toContain("1 of 2 bodies match the file's own shapes; the rest couldn't be checked.");
  });

  it('counts missing bodies without naming them, and names a repeated body by its component', () => {
    const notices = importNotices({
      ...base,
      bodies: [
        body('Body1', 'frozen', { component: 'Lid', reason: "the timeline didn't make it" }),
        body('Body1', 'editable', { component: 'Base' }),
        body('Body2', 'missing'),
        body('Body3', 'missing'),
      ],
    });
    expect(notices).toContain(
      "Taken from the file's own shapes, without history: Body1 in Lid (the timeline didn't make it).",
    );
    expect(notices).toContain(
      "2 of the file's bodies are missing: the timeline didn't make them, and their shapes can't be read from the file yet.",
    );
    expect(notices.some((n) => n.includes('match'))).toBe(false);
  });
});

describe('importFcstdFile (ADR-0144 decision 9)', () => {
  const platformFor = (projects: ReturnType<typeof memoryProjectStore>) =>
    ({ projects, storage: { requestPersistence: async () => true } }) as unknown as Platform;

  it('tells a FreeCAD file by its extension, in any case', () => {
    expect(isFcstd('Bracket.FCStd')).toBe(true);
    expect(isFcstd('bracket.fcstd')).toBe(true);
    expect(isFcstd('bracket.FCSTD')).toBe(true);
    expect(isFcstd('bracket.fcstd.zip')).toBe(false);
  });

  it('refuses a file over 100 MB before reading it', async () => {
    let read = false;
    const file = {
      name: 'huge.FCStd',
      size: MAX_FCSTD_BYTES + 1,
      arrayBuffer: () => {
        read = true;
        return Promise.resolve(new ArrayBuffer(0));
      },
    } as unknown as File;
    await expect(importFcstdFile(platformFor(memoryProjectStore()), file)).rejects.toThrow(
      /FreeCAD file is too large to import/,
    );
    expect(read).toBe(false);
  });

  it('saves the STEP files, then the design named after the file, with the report for its page', async () => {
    const projects = memoryProjectStore();
    const toasts: string[] = [];
    const stop = appNotifications.subscribe((s) => {
      for (const t of s.toasts ?? []) if (!toasts.includes(t.text)) toasts.push(t.text);
    });
    const step = new TextEncoder().encode('ISO-10303-21;\nEND-ISO-10303-21;\n');
    const sha256 = sha256Hex(step);
    let named = '';
    const id = await importFcstdFile(
      platformFor(projects),
      new File([new Uint8Array([1])], 'Bracket.FCStd'),
      async (_bytes, name, options) => {
        named = name;
        const design = Design.create({ name, id: options.id as never });
        design.state.dispatch(
          addAttachment({
            id: 'att-1' as AttachmentId,
            attachment: {
              name: 'Plate',
              fileName: 'Plate.step',
              mediaType: 'model/step',
              sha256,
              size: step.length,
            },
          }),
        );
        return {
          design,
          files: new Map([['att-1' as never, step]]),
          report: {
            shapes: [
              { object: 'Body', name: 'Plate', feature: 'f1', solids: 1, drift: 0, stepBytes: 30 },
            ],
            leftOut: [{ object: 'Mesh', name: 'Scan', reason: 'mesh' }],
            finalShapes: 2,
            problems: [],
            linkArrays: [],
            restarts: 0,
            bodies: [],
            parameters: { parameters: [], leftOut: [], expressions: [], renames: [], rounds: 0 },
            trees: [],
          },
        };
      },
    );
    stop();
    expect(named).toBe('Bracket');
    expect(toasts).toContain(FCSTD_READING_TEXT);
    const doc = await projects.load(id as never);
    expect(doc.name).toBe('Bracket');
    expect(await projects.readAttachment?.(id as never, sha256)).toEqual(step);
    expect(takeOpenNotices(id as never)).toEqual([
      'Imported from the FreeCAD file: 1 of 2 shapes, as a body without history.',
      "Not imported: Scan (a mesh, which Extrudo doesn't import from FreeCAD files yet).",
    ]);
  });
});

describe('fcstdNotices', () => {
  const base = { shapes: [], leftOut: [], finalShapes: 0, problems: [], linkArrays: [] };
  const shape = (name: string) => ({
    object: name,
    name,
    feature: 'f',
    solids: 1,
    drift: 0,
    stepBytes: 1,
  });

  it('says when a file has no shapes at all', () => {
    expect(fcstdNotices(base)).toEqual([
      'The FreeCAD file has no shapes to import, so the design is empty.',
    ]);
  });

  it('groups what was left out by why, and names link arrays and unread parts', () => {
    const notices = fcstdNotices({
      ...base,
      finalShapes: 5,
      shapes: [shape('A')],
      leftOut: [
        { object: 'm1', name: 'Scan', reason: 'mesh' },
        { object: 'm2', name: 'Scan 2', reason: 'mesh' },
        { object: 'c', name: 'Fillet', reason: 'check', detail: 'the volume differs by 2 %' },
        { object: 'k', name: 'Broken', reason: 'kernel', detail: 'refused' },
      ],
      linkArrays: ['Bolts'],
      problems: ['x: bad'],
    });
    expect(notices).toEqual([
      'Imported from the FreeCAD file: 1 of 5 shapes, as a body without history.',
      "Not imported: Scan; Scan 2 (a mesh, which Extrudo doesn't import from FreeCAD files yet); Fillet (its shape didn't come through unchanged); Broken (the geometry kernel couldn't read it).",
      'Of each link array only one copy came in: Bolts.',
      '1 thing in the file could not be read; shapes that depend on them may be missing. Please report it with the file: Help › Report a Bug…',
    ]);
  });

  const body = (
    name: string,
    outcome: 'history' | 'shape' | 'left-out',
    stop?: HistoryStop,
    bodies: string[] = [],
  ) => ({
    object: name,
    name,
    features: 2,
    mapped: [],
    bodies,
    sketches: [],
    secondAttempts: 0,
    steps: [],
    heldAfterLastStep: 0,
    upToTries: 0,
    outcome,
    ...(stop ? { stop: { object: 'F', type: 'PartDesign::Fillet', reason: stop } } : {}),
  });

  it('counts the bodies with their history and gives the commonest reasons for the rest', () => {
    expect(
      fcstdNotices({
        ...base,
        finalShapes: 2,
        bodies: [body('Bracket', 'history'), body('Lid', 'history')],
      }),
    ).toEqual([
      'Imported from the FreeCAD file: 2 of 2 shapes, with their history (sketches and features).',
    ]);
    expect(fcstdNotices({ ...base, finalShapes: 1, bodies: [body('Bracket', 'history')] })).toEqual(
      ['Imported from the FreeCAD file: 1 of 1 shape, with its history (sketches and features).'],
    );
    const notices = fcstdNotices({
      ...base,
      finalShapes: 5,
      shapes: [shape('Housing'), shape('Clip'), shape('Knob'), shape('Box')],
      bodies: [
        body('Bracket', 'history'),
        body('Housing', 'shape', 'type', ['b:0']),
        body('Clip', 'shape', 'type'),
        body('Knob', 'shape', 'differs', ['k:0']),
      ],
    });
    expect(notices).toEqual([
      'Imported from the FreeCAD file: 5 of 5 shapes, 1 with its history and 4 as bodies without history.',
      "Taken from the file's own shapes, without their whole history: Housing; Clip; Knob. Most often because it has a feature Extrudo doesn't rebuild from FreeCAD files yet, or a rebuilt feature didn't match the file's shape. The features rebuilt before that stay in the timeline, ahead of a Remove that takes out what they made.",
    ]);
  });

  it('counts Part trees as shapes with their history, and words their stored parts (S11)', () => {
    const node = (object: string, outcome: 'feature' | 'leaf', reason?: TreeReason) => ({
      object,
      name: object,
      type: 'Part::Box',
      outcome,
      features: ['f'],
      moves: 0,
      copies: 0,
      ...(reason ? { reason } : {}),
    });
    const tree = (
      name: string,
      outcome: 'history' | 'leaves' | 'shape',
      nodes: ReturnType<typeof node>[] = [],
      reason?: TreeReason,
    ) => ({
      object: name,
      name,
      type: 'Part::Cut',
      outcome,
      nodes,
      bodies: outcome === 'shape' ? [] : ['b:0'],
      passes: 1,
      ...(reason ? { reason } : {}),
    });
    // box_cyl_cut: one tree, every object a feature.
    expect(
      fcstdNotices({
        ...base,
        finalShapes: 1,
        trees: [tree('Cut', 'history', [node('Box', 'feature')])],
      }),
    ).toEqual([
      'Imported from the FreeCAD file: 1 of 1 shape, with its history (primitives and booleans).',
    ]);
    // stored_leaf: two trees, each on a stored shape.
    expect(
      fcstdNotices({
        ...base,
        finalShapes: 2,
        trees: [
          tree('Cut', 'leaves', [node('Imported', 'leaf', 'type'), node('Cut', 'feature')]),
          tree('Cut001', 'leaves', [node('Tool', 'leaf', 'type'), node('Cut001', 'feature')]),
        ],
      }),
    ).toEqual([
      'Imported from the FreeCAD file: 2 of 2 shapes, with part of their history (primitives and booleans).',
      "Built on the file's own shapes for parts of them: Cut; Cut001. Most often because part of it is a shape Extrudo doesn't rebuild from FreeCAD files yet. What uses those parts comes in with its history.",
    ]);
    // extrusion_leaf: one.
    expect(
      fcstdNotices({
        ...base,
        finalShapes: 1,
        trees: [tree('Cut', 'leaves', [node('Extrude', 'leaf', 'type')])],
      })[1],
    ).toBe(
      "Built on the file's own shape for a part of it: Cut, because part of it is a shape Extrudo doesn't rebuild from FreeCAD files yet. What uses that part comes in with its history.",
    );
    // body_operand beside a body of its own; other_primitives: part primitives as today.
    expect(
      fcstdNotices({
        ...base,
        finalShapes: 4,
        shapes: [shape('CylQuarter'), shape('SphereCap')],
        bodies: [body('Bracket', 'history')],
        trees: [
          tree('Fusion', 'history'),
          tree('CylQuarter', 'shape', [], 'partial'),
          tree('SphereCap', 'shape', [], 'partial'),
        ],
      }),
    ).toEqual([
      'Imported from the FreeCAD file: 4 of 4 shapes, 2 with their history and 2 as bodies without history.',
      "Taken from the file's own shapes, without their whole history: CylQuarter; SphereCap. Most often because it is only part of a cylinder, sphere or torus.",
    ]);
    expect(
      fcstdNotices({
        ...base,
        finalShapes: 2,
        bodies: [body('Bracket', 'history')],
        trees: [tree('Fusion', 'history')],
      })[0],
    ).toBe(
      'Imported from the FreeCAD file: 2 of 2 shapes, with their history (sketches, features, primitives and booleans).',
    );
  });

  it('gives one body its one reason, and says when a body is only partly rebuilt', () => {
    const notices = fcstdNotices({
      ...base,
      finalShapes: 2,
      shapes: [shape('Clip')],
      leftOut: [{ object: 'h', name: 'Housing', reason: 'check' }],
      bodies: [body('Clip', 'shape', 'up-to'), body('Housing', 'left-out', 'type', ['b:0'])],
    });
    expect(notices).toEqual([
      'Imported from the FreeCAD file: 1 of 2 shapes, as a body without history.',
      "Taken from the file's own shapes, without their whole history: Clip, because a feature goes up to a face or a shape Extrudo can't find or use.",
      "Not imported: Housing (its shape didn't come through unchanged).",
      'Only partly rebuilt, up to the feature where the history stopped: Housing. It is not the whole shape from the file.',
    ]);
  });

  it('gives bodies that carry on from a stored shape their own line, and the counts still add up (S8)', () => {
    const step = (reason: HistoryStop, after: number) => ({
      features: [{ object: 'Draft', name: 'Draft', type: 'PartDesign::Draft' }],
      reason,
      shape: 'Draft',
      feature: 'i',
      after,
    });
    const stepped = (name: string, steps: ReturnType<typeof step>[]) => ({
      ...body(name, 'history', undefined, ['i:0']),
      steps,
    });
    expect(
      fcstdNotices({
        ...base,
        finalShapes: 1,
        bodies: [stepped('Bracket', [step('type', 2)])],
      }),
    ).toEqual([
      'Imported from the FreeCAD file: 1 of 1 shape, with part of its history (sketches and features).',
      "Rebuilt on the file's own shape part way through: Bracket, because it has a feature Extrudo doesn't rebuild from FreeCAD files yet. The features after that point come in with their history; the ones before it stay in the timeline but no longer shape the body.",
    ]);
    // Every step first in its body (a primitive first): the body starts from the file's shape.
    expect(
      fcstdNotices({ ...base, finalShapes: 1, bodies: [stepped('Box', [step('type', 0)])] })[1],
    ).toBe(
      "Starts from the file's own shape: Box, because it has a feature Extrudo doesn't rebuild from FreeCAD files yet. The features after it come in with their history.",
    );
    expect(
      fcstdNotices({
        ...base,
        finalShapes: 2,
        bodies: [stepped('Box', [step('type', 0)]), stepped('Ball', [step('option', 0)])],
      })[1],
    ).toBe(
      "Start from the file's own shapes: Box; Ball. Most often because it has a feature Extrudo doesn't rebuild from FreeCAD files yet, or a feature has a setting Extrudo can't rebuild. The features after them come in with their history.",
    );
    // Mixed: one first in its body, one part way through: today's sentence.
    expect(
      fcstdNotices({
        ...base,
        finalShapes: 2,
        bodies: [stepped('Box', [step('type', 0)]), stepped('Lid', [step('type', 2)])],
      })[1],
    ).toBe(
      "Rebuilt on the file's own shapes part way through: Box; Lid. Most often because it has a feature Extrudo doesn't rebuild from FreeCAD files yet. The features after that point come in with their history; the ones before it stay in the timeline but no longer shape the bodies.",
    );
    const notices = fcstdNotices({
      ...base,
      finalShapes: 5,
      shapes: [shape('Clip'), shape('Box')],
      bodies: [
        body('Plate', 'history'),
        stepped('Bracket', [step('type', 2), step('option', 3)]),
        stepped('Lid', [step('type', 1)]),
        body('Clip', 'shape', 'type'),
      ],
    });
    expect(notices).toEqual([
      'Imported from the FreeCAD file: 5 of 5 shapes, 1 with its history, 2 with part of their history and 2 as bodies without history.',
      "Rebuilt on the file's own shapes part way through: Bracket; Lid. Most often because it has a feature Extrudo doesn't rebuild from FreeCAD files yet, or a feature has a setting Extrudo can't rebuild. The features after that point come in with their history; the ones before it stay in the timeline but no longer shape the bodies.",
      "Taken from the file's own shapes, without their whole history: Clip, because it has a feature Extrudo doesn't rebuild from FreeCAD files yet.",
    ]);
  });

  it("words S7's stops and says how many threaded holes came in plain", () => {
    const hole = (threadLost: boolean) => ({
      object: 'Hole',
      kind: 'hole' as const,
      feature: 'h',
      sources: {},
      expressions: [],
      drift: { volume: 0, area: 0, corner: 0, diagonal: 1, centre: 0 },
      ...(threadLost ? { threadLost: true as const } : {}),
    });
    const notices = fcstdNotices({
      ...base,
      finalShapes: 3,
      shapes: [shape('Lid'), shape('Base')],
      bodies: [
        { ...body('Plate', 'history'), mapped: [hole(true), hole(true), hole(false)] },
        body('Lid', 'shape', 'multi-transform', ['l:0']),
        body('Base', 'shape', 'original'),
      ],
    });
    expect(notices).toEqual([
      'Imported from the FreeCAD file: 3 of 3 shapes, 1 with its history and 2 as bodies without history.',
      "Taken from the file's own shapes, without their whole history: Lid; Base. Most often because a pattern of patterns combines steps Extrudo can't rebuild yet, or a pattern or mirror repeats a feature Extrudo can't repeat. The features rebuilt before that stay in the timeline, ahead of a Remove that takes out what they made.",
      '2 threaded holes came in as plain holes of the size the file stores: the thread itself is not modelled.',
    ]);
  });

  it('says which datums and sketch planes came in fixed (S9)', () => {
    const feature = (how: 'fixed' | 'offset' | 'edge') => ({
      object: 'Groove',
      kind: 'groove' as const,
      feature: 'g',
      sources: {},
      expressions: [],
      drift: { volume: 0, area: 0, corner: 0, diagonal: 1, centre: 0 },
      datums: [{ object: 'DatumLine', mode: 'TwoPointLine', how }],
    });
    const sketch = (plane: 'points' | 'datum') =>
      ({ sketch: 'S', label: 'S', plane }) as unknown as ReturnType<
        typeof body
      >['sketches'][number];
    const one = fcstdNotices({
      ...base,
      finalShapes: 1,
      shapes: [],
      bodies: [{ ...body('Plate', 'history'), mapped: [feature('fixed'), feature('offset')] }],
    });
    expect(one.at(-1)).toBe(
      "A datum line or plane came in fixed where the file has it: it doesn't follow what it was attached to in FreeCAD when the model changes.",
    );
    const more = fcstdNotices({
      ...base,
      finalShapes: 1,
      shapes: [],
      bodies: [
        {
          ...body('Plate', 'history'),
          mapped: [feature('fixed'), feature('fixed')],
          sketches: [sketch('points'), sketch('datum')],
        },
      ],
    });
    expect(more.at(-1)).toBe(
      "2 datum lines and planes and the plane of a tilted sketch came in fixed where the file has them: they don't follow what they were attached to in FreeCAD when the model changes.",
    );
    const none = fcstdNotices({
      ...base,
      finalShapes: 1,
      shapes: [],
      bodies: [{ ...body('Plate', 'history'), mapped: [feature('edge')] }],
    });
    expect(none.some((n) => n.includes('came in fixed'))).toBe(false);
  });
});

describe('parameterNotices (ADR-0144 S10)', () => {
  type Report = NonNullable<Parameters<typeof parameterNotices>[0]>;
  const param = (source: 'sheet' | 'variable-set', object: string) => ({
    name: 'x',
    source,
    object,
    at: 'A1',
    kind: 'length' as const,
    expression: '1 mm',
    from: 'value' as const,
  });
  /** An expression of the file; `number`: what it sets came in holding the file's number. */
  const expr = (
    outcome: Report['expressions'][number]['outcome'],
    number = outcome !== 'kept' && outcome !== 'unmapped',
  ) => ({
    object: 'Pad',
    path: 'Length',
    expression: 'x',
    target: 'input' as const,
    outcome,
    ...(number ? { number: true as const } : {}),
  });
  /** One on something that came in as a shape only, or on a property Extrudo has none of. */
  const other = () => ({
    object: 'Window',
    path: 'OverallHeight',
    expression: '.Height.Value',
    target: 'other' as const,
    outcome: 'target' as const,
  });
  const report = (r: Partial<Report>): Report => ({
    parameters: [],
    leftOut: [],
    expressions: [],
    renames: [],
    rounds: 0,
    ...r,
  });

  it('says nothing for a file without parameters or expressions', () => {
    expect(parameterNotices(undefined)).toEqual([]);
    expect(parameterNotices(report({ expressions: [expr('unmapped')] }))).toEqual([]);
  });

  it('counts the parameters by where they came from and the expressions by how', () => {
    expect(
      parameterNotices(
        report({
          parameters: [param('sheet', 'S'), param('sheet', 'S'), param('sheet', 'T')],
          expressions: [expr('kept'), expr('kept'), expr('differs'), expr('unmapped')],
        }),
      ),
    ).toEqual([
      "3 parameters came in from the file's spreadsheets; 2 of its 3 expressions came in live and 1 as a plain number.",
    ]);
    expect(
      parameterNotices(
        report({
          parameters: [param('variable-set', 'V')],
          expressions: [expr('kept')],
        }),
      ),
    ).toEqual([
      "1 parameter came in from the file's variable set; its one expression came in live.",
    ]);
    expect(
      parameterNotices(
        report({
          parameters: [param('sheet', 'S'), param('variable-set', 'V')],
          expressions: [expr('kept'), expr('kept')],
        }),
      ),
    ).toEqual([
      "2 parameters came in from the file's spreadsheet and variable set; both of its expressions came in live.",
    ]);
    expect(
      parameterNotices(report({ expressions: [expr('function'), expr('reference')] })),
    ).toEqual(["The file's 2 expressions came in as plain numbers."]);
    expect(parameterNotices(report({ parameters: [param('sheet', 'S')] }))).toEqual([
      "1 parameter came in from the file's spreadsheet.",
    ]);
  });

  it('counts as plain numbers only what came in as a number of the design', () => {
    const others = Array.from({ length: 85 }, other);
    expect(parameterNotices(report({ expressions: others }))).toEqual([]);
    expect(
      parameterNotices(report({ parameters: [param('sheet', 'S')], expressions: others })),
    ).toEqual(["1 parameter came in from the file's spreadsheet."]);
    expect(
      parameterNotices(
        report({
          parameters: [param('sheet', 'S'), param('sheet', 'S')],
          expressions: [...others, expr('kept'), expr('differs'), expr('target', false)],
        }),
      ),
    ).toEqual([
      "2 parameters came in from the file's spreadsheet; 1 of its 2 expressions came in live and 1 as a plain number.",
    ]);
  });

  it('shows a long name cut', () => {
    const long = 'w'.repeat(5_000);
    const out = parameterNotices(
      report({
        parameters: [param('sheet', 'S')],
        renames: [{ from: long, to: `${'w'.repeat(64)}`, what: 'alias', why: 'long' }],
      }),
    );
    expect(out[1]).toBe(
      `One name changed to fit Extrudo's rules: ${'w'.repeat(40)}… to ${'w'.repeat(40)}….`,
    );
    expect((out[1] as string).length).toBeLessThan(200);
  });

  it('says which names changed, three of them at most', () => {
    const renames = [
      { from: 'cos', to: 'cos_1', what: 'alias' as const, why: 'reserved' as const },
      { from: 'max', to: 'max_1', what: 'alias' as const, why: 'reserved' as const },
      { from: 'round', to: 'round_1', what: 'alias' as const, why: 'reserved' as const },
      { from: 'width', to: 'width_1', what: 'constraint' as const, why: 'taken' as const },
    ];
    const out = parameterNotices(report({ parameters: [param('sheet', 'S')], renames }));
    expect(out[1]).toBe(
      "4 names changed to fit Extrudo's rules: cos to cos_1, max to max_1 and round to round_1, and 1 more.",
    );
    expect(
      parameterNotices(
        report({ parameters: [param('sheet', 'S')], renames: [renames[0] as (typeof renames)[0]] }),
      )[1],
    ).toBe("One name changed to fit Extrudo's rules: cos to cos_1.");
  });
});
