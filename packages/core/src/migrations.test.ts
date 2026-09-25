import { describe, expect, it } from 'vitest';
import v0Bracket from '../fixtures/v0-bracket.json' with { type: 'json' };
import { FORMAT_VERSION } from './format';
import { DocumentLoadError, loadDocument, MIGRATIONS } from './migrations';
import { sampleDocument } from './testing';

/** Deterministic IDs for migrations: id-1, id-2, … */
function counterIds() {
  let n = 0;
  return () => `id-${++n}`;
}

function loadError(raw: unknown): DocumentLoadError {
  try {
    loadDocument(raw);
  } catch (error) {
    if (error instanceof DocumentLoadError) return error;
    throw error;
  }
  throw new Error('expected loadDocument to fail');
}

describe('migrations', () => {
  it('cover every version from 0 up to the current one, one step each', () => {
    expect(MIGRATIONS.map((m) => m.from)).toEqual(
      Array.from({ length: FORMAT_VERSION }, (_, i) => i),
    );
  });

  it('migrate the v0 fixture to a valid v1 document', () => {
    const { doc, loadedVersion, migrated } = loadDocument(v0Bracket, {
      newId: counterIds(),
      now: '2026-09-25T12:00:00.000Z',
    });
    expect(loadedVersion).toBe(0);
    expect(migrated).toBe(true);
    expect(doc).toMatchObject({
      format: 'extrudo',
      formatVersion: 1,
      id: 'id-1',
      name: 'Wall bracket',
      settings: { units: 'mm', precision: 2 },
      timelineMarker: 3,
      bodies: {},
      views: [],
      meta: {
        created: '2026-09-01T09:30:00.000Z',
        modified: '2026-09-01T09:30:00.000Z',
        appVersion: '0.0.0-dev',
      },
    });
    expect(doc.parameters).toEqual([
      {
        id: 'id-2',
        name: 'width',
        expression: '40 mm',
        unit: 'length',
        comment: 'Along the wall',
      },
      { id: 'id-3', name: 'wall', expression: '3 mm', unit: 'length' },
      { id: 'id-4', name: 'tilt', expression: '15 deg', unit: 'angle' },
      { id: 'id-5', name: 'holes', expression: '2', unit: 'unitless' },
    ]);
    expect(doc.features.map((f) => [f.name, f.suppressed])).toEqual([
      ['Sketch1', false],
      ['Extrude1', false],
      ['Fillet1', true],
    ]);
    // Inputs are carried over untouched.
    expect(doc.features[1]?.inputs).toEqual(v0Bracket.features[1]?.inputs);
  });

  it('do not modify the input', () => {
    const before = JSON.stringify(v0Bracket);
    loadDocument(v0Bracket);
    expect(JSON.stringify(v0Bracket)).toBe(before);
  });

  it('leave a current document as it is', () => {
    const doc = sampleDocument();
    expect(loadDocument(JSON.parse(JSON.stringify(doc)))).toEqual({
      doc,
      loadedVersion: FORMAT_VERSION,
      migrated: false,
    });
  });
});

describe('loadDocument errors', () => {
  it('reject things that are not Extrudo documents', () => {
    for (const raw of [
      null,
      [],
      'extrudo',
      { format: 'other', formatVersion: 1 },
      { format: 'extrudo' },
    ]) {
      expect(loadError(raw).code).toBe('not-a-document');
    }
  });

  it('refuse documents from a newer version with a readable message', () => {
    const error = loadError({ ...sampleDocument(), formatVersion: FORMAT_VERSION + 1 });
    expect(error.code).toBe('too-new');
    expect(error.message).toMatch(/newer Extrudo.*Update Extrudo/);
  });

  it('report where a damaged document is invalid', () => {
    const error = loadError({ ...sampleDocument(), timelineMarker: -1, name: '' });
    expect(error.code).toBe('invalid');
    expect(error.issues.map((i) => i.path.join('.'))).toEqual(['name', 'timelineMarker']);
    expect(error.message).toMatch(/^The document is damaged: name .*; timelineMarker .*\.$/);
  });
});
