/**
 * The `render` section and its command (P6-15, ADR-0101 §4): what the schema
 * accepts, and that `render.set` validates, replaces and undoes cleanly.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand, CommandError } from './commands';
import { setRenderSettings } from './document-commands';
import { UndoHistory } from './history';
import type { BodyId } from './ids';
import { DEFAULT_RENDER_SETTINGS } from './render';
import { DocumentSchema, type RenderSettings, RenderSettingsSchema } from './schema';
import { sampleDocument } from './testing';

const example: RenderSettings = {
  preset: 'table',
  finishes: { ['extrude-1:0' as BodyId]: 'glossy' },
  camera: { kind: 'auto' },
  width: 1920,
  height: 1080,
  quality: 'standard',
};

describe('RenderSettingsSchema', () => {
  it("accepts the ADR's example and the defaults", () => {
    expect(RenderSettingsSchema.parse(example)).toEqual(example);
    expect(RenderSettingsSchema.parse(DEFAULT_RENDER_SETTINGS)).toEqual(DEFAULT_RENDER_SETTINGS);
    expect(
      RenderSettingsSchema.safeParse({ ...example, camera: { kind: 'current' } }).success,
    ).toBe(true);
    expect(
      RenderSettingsSchema.safeParse({ ...example, camera: { kind: 'view', id: 'view-1' } })
        .success,
    ).toBe(true);
  });

  it('rejects an unknown preset, a tiny width, an unknown key and a view camera without id', () => {
    expect(RenderSettingsSchema.safeParse({ ...example, preset: 'kitchen' }).success).toBe(false);
    expect(RenderSettingsSchema.safeParse({ ...example, width: 100 }).success).toBe(false);
    expect(RenderSettingsSchema.safeParse({ ...example, width: 1920.5 }).success).toBe(false);
    expect(RenderSettingsSchema.safeParse({ ...example, samples: 128 }).success).toBe(false);
    expect(RenderSettingsSchema.safeParse({ ...example, camera: { kind: 'view' } }).success).toBe(
      false,
    );
    expect(
      RenderSettingsSchema.safeParse({ ...example, finishes: { 'extrude-1:0': 'chrome' } }).success,
    ).toBe(false);
  });

  it('is optional on the document', () => {
    const doc = sampleDocument();
    expect('render' in doc).toBe(false);
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
    expect(DocumentSchema.safeParse({ ...doc, render: example }).success).toBe(true);
    expect(DocumentSchema.safeParse({ ...doc, render: { preset: 'table' } }).success).toBe(false);
  });
});

describe('render.set', () => {
  it('sets, replaces and undoes the section', () => {
    const original = sampleDocument();
    const history = new UndoHistory();
    const first = applyCommand(original, setRenderSettings({ render: example }));
    expect(first.doc.render).toEqual(example);
    history.record({
      label: 'Set render settings',
      patches: first.patches,
      inversePatches: first.inversePatches,
    });
    const next: RenderSettings = { ...DEFAULT_RENDER_SETTINGS, quality: 'high' };
    const second = applyCommand(first.doc, setRenderSettings({ render: next }));
    expect(second.doc.render).toEqual(next);
    history.record({
      label: 'Set render settings',
      patches: second.patches,
      inversePatches: second.inversePatches,
    });
    const undone = history.undo(second.doc);
    expect(undone.render).toEqual(example);
    expect(history.undo(undone)).toEqual(original);
  });

  it('refuses an invalid payload with one sentence', () => {
    const bad = { ...example, width: 10 } as unknown as RenderSettings;
    expect(() => applyCommand(sampleDocument(), setRenderSettings({ render: bad }))).toThrow(
      new CommandError('The render settings are invalid.'),
    );
  });
});
