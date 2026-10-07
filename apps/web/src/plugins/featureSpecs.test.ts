// A plugin's custom features as dialogs (P6-03 slice 3, ADR-0077 §6): the fields a manifest
// asks for, the round trip between the dialog's values and the stored `in:<name>` inputs,
// the plugin file going into the design with the first feature, and a stored feature's
// dialog coming from the design's own copy of the file.
import {
  type AttachmentId,
  addAttachment,
  createDocument,
  type Feature,
  type FeatureId,
  insertFeature,
  newId,
  PLUGIN_MEDIA_TYPE,
  PluginInputsSchema,
  parsePluginManifest,
} from '@extrudo/core';
import type { PluginFile } from '@extrudo/storage';
import { afterEach, describe, expect, it } from 'vitest';
import { commandId } from '../features/spec';
import { settle, setupDialogs } from '../features/testing';
import { defaultValues, shownFields } from '../features/values';
import {
  pluginDialogs,
  pluginFeatureCommand,
  pluginFeatureSpec,
  preparePluginAttachment,
  specForPluginFeature,
} from './featureSpecs';
import { clearPendingPlugin, pendingFor, pendingPluginById } from './pending';

const manifest = parsePluginManifest({
  id: 'kit',
  name: 'Kit',
  version: '1.2.0',
  description: 'Every kind.',
  author: 'Someone',
  license: 'MIT',
  main: 'main.ts',
  features: [
    {
      type: 'widget',
      label: 'Widget',
      hint: 'A widget.',
      icon: 'box',
      inputs: [
        {
          name: 'width',
          label: 'Width',
          kind: 'expr',
          unit: 'length',
          default: '40 mm',
          min: 1,
          max: 99,
        },
        { name: 'turn', label: 'Turn', kind: 'expr', unit: 'angle', default: 15 },
        { name: 'count', label: 'Count', kind: 'expr', unit: 'none', default: '3' },
        { name: 'round', label: 'Round', kind: 'bool', default: true },
        {
          name: 'style',
          label: 'Style',
          kind: 'enum',
          options: ['plain', 'ribbed'],
          default: 'ribbed',
        },
        { name: 'plane', label: 'Plane', kind: 'ref', accepts: ['plane'] },
        { name: 'edges', label: 'Edges', kind: 'ref', accepts: ['edge'], multiple: true },
      ],
    },
  ],
});
const file: PluginFile = { manifest, code: '', language: 'ts' };
const plugin = { id: 'kit', name: 'Kit', version: '1.2.0' };
const spec = pluginFeatureSpec(
  plugin,
  file,
  manifest.features[0] as (typeof manifest.features)[number],
);

const attachmentId = newId<AttachmentId>();
const attachment = {
  name: 'Kit 1.2.0',
  fileName: 'kit.extrudo-plugin',
  mediaType: PLUGIN_MEDIA_TYPE as typeof PLUGIN_MEDIA_TYPE,
  sha256: 'c'.repeat(64),
  size: 100,
};

afterEach(() => clearPendingPlugin('kit'));

describe('pluginFeatureSpec', () => {
  it("is a 'plugin' feature with a command of its own and the manifest's label and icon", () => {
    expect(spec.type).toBe('plugin');
    expect(spec.label).toBe('Widget');
    expect(spec.icon).toBe('box');
    expect(commandId(spec)).toBe(pluginFeatureCommand('kit', 'widget'));
    expect(commandId(spec)).toBe('plugin:kit:feature:widget');
    expect(spec.command).toMatchObject({ group: 'Plugins › Kit', category: 'create' });
  });

  it('makes a field per input of the kind the manifest says', () => {
    expect(spec.fields.map((f) => [f.name, f.kind])).toEqual([
      ['width', 'expression'],
      ['turn', 'expression'],
      ['count', 'expression'],
      ['round', 'toggle'],
      ['style', 'choice'],
      ['plane', 'selection'],
      ['edges', 'selection'],
      ['_plugin', 'info'],
    ]);
    const [width, turn, count, , style, plane, edges, info] = spec.fields;
    expect(width).toMatchObject({ unit: 'length', default: '40 mm', hint: 'Between 1 and 99.' });
    expect(turn).toMatchObject({ unit: 'angle', default: '15' });
    expect(count).toMatchObject({ unit: 'unitless', default: '3' });
    expect(style).toMatchObject({
      default: 'ribbed',
      options: [
        { value: 'plain', label: 'plain' },
        { value: 'ribbed', label: 'ribbed' },
      ],
    });
    expect(plane).toMatchObject({ accepts: ['plane'], min: 1, max: 1 });
    expect(edges).toMatchObject({ accepts: ['edge'], min: 1 });
    expect(edges).not.toHaveProperty('max');
    expect(info).toMatchObject({ kind: 'info' });
    if (info?.kind === 'info') {
      expect(info.text(defaultValues(spec), { doc: createDocument(), bodies: {} })).toBe(
        'Plugin: Kit 1.2.0',
      );
    }
  });

  it('starts from the manifest defaults', () => {
    const values = defaultValues(spec);
    expect(values.exprs).toEqual({ width: '40 mm', turn: '15', count: '3' });
    expect(values.toggles).toEqual({ round: true });
    expect(values.choices).toEqual({ style: 'ribbed' });
  });

  it('stores the fields as in:<name> inputs beside plugin and handler, and reads them back', () => {
    const ctx = { doc: createDocument(), bodies: {} };
    clearPendingPlugin('kit');
    const values = {
      ...defaultValues(spec),
      refs: { plane: [{ kind: 'plane' as const, id: 'origin:xy' }], edges: [] },
    };
    const inputs = spec.toInputs?.(values, ctx) ?? {};
    expect(Object.keys(inputs).sort()).toEqual(
      [
        'handler',
        'in:count',
        'in:edges',
        'in:plane',
        'in:round',
        'in:style',
        'in:turn',
        'in:width',
        'plugin',
      ].sort(),
    );
    expect(inputs.handler).toEqual({ kind: 'enum', value: 'widget' });
    expect(inputs['in:width']).toEqual({ kind: 'expr', expr: '40 mm', unit: 'length' });
    expect(inputs['in:round']).toEqual({ kind: 'bool', value: true });
    expect(inputs['in:style']).toEqual({ kind: 'enum', value: 'ribbed' });
    expect(inputs['in:plane']).toMatchObject({ kind: 'ref' });
    const back = spec.fromInputs?.(inputs, ctx);
    expect(back?.exprs).toMatchObject({ width: '40 mm', count: '3' });
    expect(back?.toggles).toEqual({ round: true });
    expect(back?.choices).toEqual({ style: 'ribbed' });
    expect(back?.refs?.plane).toEqual([{ kind: 'plane', id: 'origin:xy' }]);
  });

  it('refuses an empty required reference in its own words', () => {
    const issue = spec.validate?.(defaultValues(spec), { doc: createDocument(), bodies: {} });
    expect(issue).toEqual({ message: 'Pick the plane.', field: 'plane' });
  });

  it('shows every field and turns a plane pick into a committed feature', () => {
    expect(shownFields(spec, defaultValues(spec)).length).toBe(8);
  });
});

describe('adding a plugin feature', () => {
  it('writes the plugin file as an attachment in the same undo step, then names it', async () => {
    const t = setupDialogs([], {});
    pendingPluginStoreSet(attachmentId);
    const small = pluginFeatureSpec(plugin, file, {
      type: 'widget',
      label: 'Widget',
      inputs: [{ name: 'width', label: 'Width', kind: 'expr', unit: 'length', default: '40 mm' }],
    });
    t.controller.startSpec(small);
    await settle();
    expect(t.open()?.draft.inputs.plugin).toEqual({ kind: 'file', id: attachmentId });
    expect(PluginInputsSchema.safeParse(t.open()?.draft.inputs).success).toBe(true);
    expect(t.controller.ok()).toBe(true);
    const doc = t.store.getState().doc;
    const feature = doc.features.at(-1);
    expect(feature).toMatchObject({ type: 'plugin', name: 'Widget1' });
    expect(doc.attachments?.[attachmentId]).toEqual(attachment);
    // One step: the feature and the file's record go together.
    t.store.getState().undo();
    expect(t.store.getState().doc.features.some((f) => f.type === 'plugin')).toBe(false);
    expect(t.store.getState().doc.attachments).toBeUndefined();
    // Committed: the pending file is spent.
    expect(pendingFor('kit')).toBeUndefined();
  });

  it("opens a stored feature from the design's own copy of the file", async () => {
    const small = {
      type: 'widget',
      label: 'Widget',
      inputs: [
        {
          name: 'width',
          label: 'Width',
          kind: 'expr' as const,
          unit: 'length' as const,
          default: '40 mm',
        },
      ],
    };
    const stored: Feature = {
      id: 'w1' as FeatureId,
      type: 'plugin',
      name: 'Widget1',
      suppressed: false,
      inputs: {
        plugin: { kind: 'file', id: attachmentId },
        handler: { kind: 'enum', value: 'widget' },
        'in:width': { kind: 'expr', expr: '25 mm', unit: 'length', paramName: 'd1' },
      },
    };
    const smallFile: PluginFile = {
      ...file,
      manifest: { ...manifest, features: [{ ...small, inputs: small.inputs }] },
    };
    const files = new Map([[attachmentId, smallFile]]);
    expect(specForPluginFeature(stored, files)?.label).toBe('Widget');
    // Not read yet, or a handler the file lacks: no dialog (the feature's error says why).
    expect(specForPluginFeature(stored, new Map())).toBeUndefined();
    expect(
      specForPluginFeature(
        { ...stored, inputs: { ...stored.inputs, handler: { kind: 'enum', value: 'gone' } } },
        files,
      ),
    ).toBeUndefined();

    const t = setupDialogs([], { specFor: (f) => specForPluginFeature(f, files) });
    t.store.getState().dispatch(addAttachment({ id: attachmentId, attachment }));
    t.store.getState().dispatch(insertFeature({ feature: stored, index: 1 }));
    expect(t.controller.edit(stored.id)).toBe(true);
    expect(t.open()?.values.exprs.width).toBe('25 mm');
    t.controller.setExpr('width', '30 mm');
    expect(t.controller.ok()).toBe(true);
    const edited = t.store.getState().doc.features.find((f) => f.id === stored.id);
    expect(edited?.inputs['in:width']).toMatchObject({ expr: '30 mm' });
    expect(edited?.inputs.plugin).toEqual({ kind: 'file', id: attachmentId });
    // Editing adds no second record.
    expect(Object.keys(t.store.getState().doc.attachments ?? {})).toEqual([attachmentId]);
  });
});

describe('preparePluginAttachment', () => {
  it('stores the bytes first and offers a new record, reusing one with the same hash', async () => {
    const written: string[] = [];
    const projects = {
      writeAttachment: async (_doc: string, sha: string) => void written.push(sha),
    };
    const doc = createDocument();
    const bytes = new TextEncoder().encode('plugin bytes');
    const first = await preparePluginAttachment({
      plugin,
      bytes,
      doc,
      projects: projects as never,
    });
    expect(written).toHaveLength(1);
    expect(first.attachment).toMatchObject({
      name: 'Kit 1.2.0',
      fileName: 'kit.extrudo-plugin',
      mediaType: PLUGIN_MEDIA_TYPE,
      size: bytes.length,
    });
    expect(pendingFor('kit')).toEqual(first);
    expect(pendingPluginById(first.id)).toEqual(first);
    // The design already has it: the same attachment, nothing written.
    const have = { ...doc, attachments: { [first.id]: first.attachment } };
    const again = await preparePluginAttachment({
      plugin,
      bytes,
      doc: have,
      projects: projects as never,
    });
    expect(again.id).toBe(first.id);
    expect(written).toHaveLength(1);
  });
});

describe('pluginDialogs', () => {
  it('lists the specs of the enabled plugins that could be read, and no others', () => {
    const entry = (enabled: boolean, id = 'kit') => ({
      plugin: { id, name: 'Kit', version: '1.2.0', enabled, installedAt: '', sha256: '' },
      file,
    });
    expect(pluginDialogs(undefined)).toEqual([]);
    expect(pluginDialogs([entry(false)])).toEqual([]);
    expect(pluginDialogs([{ plugin: entry(true).plugin }])).toEqual([]);
    expect(pluginDialogs([entry(true)]).map(commandId)).toEqual(['plugin:kit:feature:widget']);
  });
});

import { pendingPluginStore } from './pending';

function pendingPluginStoreSet(id: AttachmentId) {
  pendingPluginStore.setState({ pending: { kit: { id, attachment } } });
}
