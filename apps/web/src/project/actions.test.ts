import { Design } from '@extrudo/api';
import { type BodyId, createDocument } from '@extrudo/core';
import type { BodyPlan, BodyStep, ImportResult } from '@extrudo/f3d';
import { memoryProjectStore, writeArchive } from '@extrudo/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { takeModelImport } from '../features/import';
import type { Platform } from '../platform';
import {
  importAnyFile,
  importF3dFile,
  importNotices,
  MAX_F3D_BYTES,
  openExternalFile,
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
    const summary = await openExternalFile(fakePlatform(projects), openedFile('/models/A.extrudo'));
    const stored = await projects.get(summary.id);
    expect(stored?.linked).toEqual({ file: '/models/A.extrudo', modified: 123, external: true });
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
      report: { imported: ['Box1'], skipped: [], notes: [] },
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
  const base = { imported: [], skipped: [] };
  const body = (
    name: string,
    outcome: 'editable' | 'frozen' | 'unchecked' | 'missing',
    extra = {},
  ) => ({
    name,
    outcome,
    ...extra,
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
