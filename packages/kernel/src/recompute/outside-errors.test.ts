// An import that failed for a cause outside the document (ADR-0024's amendment on errors from
// outside the document). The import answers `add`, so its key holds no bodies and an edit before it
// no longer moves it; an error result is cached like any other. Main's engine (the import a
// `write`) tried again when its key moved: its own inputs, a feature it refers to, or any body
// before it. Here: the bytes not there yet, OpenSCAD not loaded, not downloaded (offline) and a
// compile stopped. Each case under main's engine (`allWrite`) and this one, and a deterministic
// import error, which stays cached. Real OCCT and manifold; the compiler is a stand-in that answers
// what OpenSCAD's own compiler answers (its words), so no OpenSCAD WASM runs.
import {
  type AttachmentId,
  createDocument,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  importInputs,
} from '@extrudo/core';
import type { ScadCompiler, ScadRequest, ScadResult } from '@extrudo/openscad';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import cubeStl from '../../../../fixtures/imports/cube.stl?url&inline';
import twoParts3mf from '../../../../fixtures/imports/two-parts.3mf?url&inline';
import { kernelFeatures } from '../features/index';
import { Kernel } from '../kernel';
import { loadManifold } from '../manifold';
import { loadOcct } from '../occt/load';
import {
  allWrite,
  bytesOf,
  type Done,
  faultyEngine,
  length,
  plateFeatures,
  setInputs,
} from './add-access-test-support';
import { RecomputeEngine } from './engine';
import type { ImportedFile } from './types';

let kernel: Kernel;
beforeAll(async () => {
  kernel = new Kernel(await loadOcct());
  kernel.enableMeshes(await loadManifold());
}, 120_000);
afterAll(() => {
  expect(kernel.stats().liveShapes).toBe(0);
});

const STL = 'att-stl' as AttachmentId;
const SCAD = 'att-scad' as AttachmentId;
const BAD = 'att-bad' as AttachmentId;

const FILES: Record<string, ImportedFile> = {
  [STL]: { bytes: bytesOf(cubeStl), mediaType: 'model/stl', fileName: 'cube.stl' },
  [SCAD]: {
    bytes: new TextEncoder().encode('cube([10, 10, 10]);\n'),
    mediaType: 'application/x-openscad',
    fileName: 'blocks.scad',
  },
  // Not an STL: the file's own error, the same every time.
  [BAD]: {
    bytes: new TextEncoder().encode('not a mesh'),
    mediaType: 'model/stl',
    fileName: 'bad.stl',
  },
};

/** A plate (sk0, ex0) and an import of `file` after it. */
function design(file: AttachmentId): ExtrudoDocument {
  const features: Feature[] = [
    ...plateFeatures(0, -200, '4 mm', false),
    {
      id: 'imp' as FeatureId,
      type: 'import',
      name: 'Import1',
      suppressed: false,
      inputs: importInputs({ file }),
    },
  ];
  const record = FILES[file] as ImportedFile;
  return {
    ...createDocument({ name: 'import' }),
    attachments: {
      [file]: {
        name: 'file',
        fileName: record.fileName,
        mediaType: record.mediaType,
        sha256: '0'.repeat(64),
        size: record.bytes.length,
      },
    },
    features,
    timelineMarker: features.length,
  } as ExtrudoDocument;
}

/** The design with the plate a little thicker: an edit before the import. */
const editedBefore = (d: ExtrudoDocument) => setInputs(d, 'ex0', { distance: length('5 mm') });

/**
 * A stand-in for OpenSCAD's compiler: `fail` answers each compile while it is set (in the words of
 * `@extrudo/openscad`'s compiler), else a 3MF of two closed parts. Counts the compiles asked.
 */
function compiler() {
  const state = { fail: undefined as string | undefined, compiles: 0 };
  const model = bytesOf(twoParts3mf);
  const c: ScadCompiler = {
    compile(_request: ScadRequest): Promise<ScadResult> {
      state.compiles++;
      return Promise.resolve(
        state.fail === undefined
          ? { ok: true, model, warnings: [], ms: 1 }
          : { ok: false, error: state.fail, warnings: [], ms: 1 },
      );
    },
    parameters: () => Promise.resolve({ ok: true, parameters: [] }),
    dispose: () => undefined,
  };
  return { compiler: c, state };
}

/**
 * Whose engine: `main` (before `add` existed: every `add` a `write`, and no rule for errors from
 * outside the document), `before` (this branch's `add` answers without the rule) and `this`. The
 * first two are the engine's own source with the rule's two lines taken out (`faultyEngine`).
 */
type Mode = 'main' | 'before' | 'this';
const MODES: Mode[] = ['main', 'before', 'this'];

const WITHOUT_RULE = [
  ["if (retry !== 'next') this.#entries.set(key, entry);", 'this.#entries.set(key, entry);'],
  ["(seen.read || entry.retry === 'bodies')", 'seen.read'],
] as const;

/** An engine of `mode`, reading `files` and compiling with `scad`. */
async function engine(
  mode: Mode,
  files: Map<AttachmentId, ImportedFile>,
  scad: () => ScadCompiler | undefined = () => undefined,
) {
  const made = mode === 'this' ? undefined : await faultyEngine(...WITHOUT_RULE);
  const Make = made?.engine ?? RecomputeEngine;
  const features = mode === 'main' ? allWrite()() : kernelFeatures();
  const e = new Make(kernel, features, {
    strictLeaks: true,
    files: (id) => files.get(id),
    openscad: scad,
  });
  return {
    async run(doc: ExtrudoDocument) {
      const result = await e.recompute({ doc });
      if (result.status !== 'done') throw new Error(result.status);
      const r = result as Done;
      return { status: r.features['imp' as FeatureId], evaluated: r.stats.evaluated };
    },
    close() {
      e.clear();
      made?.remove();
    },
  };
}

/**
 * The import's status (`ok` or `error`) on the same document once the cause is gone, then after an
 * edit before it, per engine. `main` tries again only on the edit (its key holds the bodies before
 * the import); `before` on neither (its key holds none, and the error is cached); `this` on the
 * next recompute, or, for a stopped compile, on the edit like `main`.
 */
const NEXT: Record<Mode, [string, string]> = {
  main: ['error', 'ok'],
  before: ['error', 'error'],
  this: ['ok', 'ok'],
};
const ON_EDIT: Record<Mode, [string, string]> = {
  main: ['error', 'ok'],
  before: ['error', 'error'],
  this: ['error', 'ok'],
};

describe('an import that failed for a cause outside the document tries again', () => {
  it.each(MODES)('the bytes not there yet (%s)', { timeout: 120_000 }, async (mode) => {
    const files = new Map<AttachmentId, ImportedFile>();
    const e = await engine(mode, files);
    try {
      const d = design(STL);
      expect((await e.run(d)).status).toEqual({
        status: 'error',
        message: 'The file cube.stl is missing from this design.',
      });
      files.set(STL, FILES[STL] as ImportedFile);
      const again = await e.run(d);
      const edited = await e.run(editedBefore(d));
      expect([again.status?.status, edited.status?.status]).toEqual(NEXT[mode]);
    } finally {
      e.close();
    }
  });

  it.each(MODES)('OpenSCAD not loaded yet (%s)', { timeout: 120_000 }, async (mode) => {
    const files = new Map([[SCAD, FILES[SCAD] as ImportedFile]]);
    const { compiler: c, state } = compiler();
    let loaded = false;
    const e = await engine(mode, files, () => (loaded ? c : undefined));
    try {
      const d = design(SCAD);
      expect((await e.run(d)).status).toEqual({
        status: 'error',
        message: "OpenSCAD isn't loaded in this kernel, so .scad files can't be compiled here.",
      });
      loaded = true;
      const again = await e.run(d);
      const edited = await e.run(editedBefore(d));
      expect([again.status?.status, edited.status?.status]).toEqual(NEXT[mode]);
      expect(state.compiles).toBe(mode === 'before' ? 0 : 1);
    } finally {
      e.close();
    }
  });

  it.each(MODES)(
    'OpenSCAD not downloaded yet: offline (%s)',
    { timeout: 120_000 },
    async (mode) => {
      const files = new Map([[SCAD, FILES[SCAD] as ImportedFile]]);
      const { compiler: c, state } = compiler();
      state.fail =
        "OpenSCAD isn't downloaded yet: connect to the internet once to compile blocks.scad.";
      const e = await engine(mode, files, () => c);
      try {
        const d = design(SCAD);
        expect((await e.run(d)).status).toEqual({ status: 'error', message: state.fail });
        state.fail = undefined;
        const again = await e.run(d);
        const edited = await e.run(editedBefore(d));
        expect([again.status?.status, edited.status?.status]).toEqual(NEXT[mode]);
        expect(state.compiles).toBe(mode === 'before' ? 1 : 2);
      } finally {
        e.close();
      }
    },
  );

  it.each(MODES)(
    'a compile stopped by its time: tried again after an edit before it, as main (%s)',
    { timeout: 120_000 },
    async (mode) => {
      // Each try may take a minute, so not on every recompute: once the bodies before it change.
      const files = new Map([[SCAD, FILES[SCAD] as ImportedFile]]);
      const { compiler: c, state } = compiler();
      state.fail =
        'blocks.scad took longer than 60 s to compile, so Extrudo stopped it: simplify the model (a lower $fn, fewer minkowski steps).';
      const e = await engine(mode, files, () => c);
      try {
        const d = design(SCAD);
        expect((await e.run(d)).status).toEqual({ status: 'error', message: state.fail });
        state.fail = undefined;
        const again = await e.run(d);
        expect(again.evaluated).toEqual([]);
        const edited = await e.run(editedBefore(d));
        expect([again.status?.status, edited.status?.status]).toEqual(ON_EDIT[mode]);
        expect(state.compiles).toBe(mode === 'before' ? 1 : 2);
      } finally {
        e.close();
      }
    },
  );
});

describe("an import's own error stays cached", () => {
  it('a file that is not an STL: evaluated once, not again on the same or an edit before it', {
    timeout: 120_000,
  }, async () => {
    const files = new Map([[BAD, FILES[BAD] as ImportedFile]]);
    const e = await engine('this', files);
    try {
      const d = design(BAD);
      const first = await e.run(d);
      expect(first.status?.status).toBe('error');
      expect(first.evaluated).toContain('imp');
      expect((await e.run(d)).evaluated).toEqual([]);
      const edited = await e.run(editedBefore(d));
      expect(edited.status).toEqual(first.status);
      expect(edited.evaluated).toEqual(['ex0']);
    } finally {
      e.close();
    }
  });

  it("an OpenSCAD file's own error (a syntax error): compiled once", {
    timeout: 120_000,
  }, async () => {
    const files = new Map([[SCAD, FILES[SCAD] as ImportedFile]]);
    const { compiler: c, state } = compiler();
    state.fail = 'blocks.scad, line 1: syntax error.';
    const e = await engine('this', files, () => c);
    try {
      const d = design(SCAD);
      expect((await e.run(d)).status?.status).toBe('error');
      await e.run(d);
      const edited = await e.run(editedBefore(d));
      expect(edited.status).toEqual({ status: 'error', message: state.fail });
      expect(edited.evaluated).toEqual(['ex0']);
      expect(state.compiles).toBe(1);
    } finally {
      e.close();
    }
  });
});
