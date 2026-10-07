// The `plugin` feature (P6-03, ADR-0077 §3): fixed inputs, the plugin's own
// under `in:<name>` in one of four stored kinds, and the plugin file an
// attachment the design must carry.
import { describe, expect, it } from 'vitest';
import { createDocument } from './document';
import type { AttachmentId, FeatureId } from './ids';
import {
  makesFeatures,
  PluginInputsSchema,
  pluginFeatureOf,
  pluginOwnInputs,
  pluginSettings,
} from './plugin-feature';
import { documentFeatures } from './registry';
import { DocumentSchema } from './schema';
import { scriptOfGenerated } from './script';
import { referencedFeatures } from './timeline';

const plugin = 'p1' as AttachmentId;
const feature = pluginFeatureOf(
  'f1' as FeatureId,
  'Name plate1',
  { plugin, handler: 'name-plate' },
  {
    width: { kind: 'expr', expr: '60 mm', unit: 'length' },
    rounded: { kind: 'bool', value: true },
    style: { kind: 'enum', value: 'raised' },
    plane: { kind: 'ref', refs: [{ kind: 'face', id: 'box:f0:side:top' }] },
  },
);

describe('the plugin feature', () => {
  it('stores the plugin, the handler and the own inputs under in:', () => {
    expect(Object.keys(feature.inputs).sort()).toEqual([
      'handler',
      'in:plane',
      'in:rounded',
      'in:style',
      'in:width',
      'plugin',
    ]);
    expect(PluginInputsSchema.safeParse(feature.inputs).success).toBe(true);
    expect(pluginSettings(feature.inputs)).toEqual({ plugin, handler: 'name-plate' });
    expect([...pluginOwnInputs(feature.inputs).keys()].sort()).toEqual([
      'plane',
      'rounded',
      'style',
      'width',
    ]);
    expect(documentFeatures().get('plugin')?.openInputs?.prefix).toBe('in:');
    expect(makesFeatures('plugin') && makesFeatures('script') && !makesFeatures('box')).toBe(true);
  });

  it('reports a key outside in: as unknown, and refuses a kind a dialog has no field for', () => {
    const unknown = PluginInputsSchema.safeParse({
      ...feature.inputs,
      height: feature.inputs['in:width'],
    });
    expect(unknown.error?.issues.map((i) => [i.code, i.path])).toEqual([['unrecognized_keys', []]]);
    const code = PluginInputsSchema.safeParse({
      ...feature.inputs,
      'in:source': { kind: 'code', value: 'x' },
    });
    expect(code.error?.issues[0]?.message).toBe("has a kind this plugin can't take");
    const badName = PluginInputsSchema.safeParse({
      ...feature.inputs,
      'in:2x': feature.inputs['in:rounded'],
    });
    expect(badName.error?.issues[0]?.code).toBe('unrecognized_keys');
    const noHandler = PluginInputsSchema.safeParse({ plugin: feature.inputs.plugin });
    expect(noHandler.success).toBe(false);
  });

  it('needs the plugin file among the attachments, as a plugin file', () => {
    const doc = { ...createDocument(), features: [feature], timelineMarker: 1 };
    expect(DocumentSchema.safeParse(doc).error?.issues[0]?.message).toBe(
      `is attachment "p1", which this design doesn't carry`,
    );
    const attachment = {
      name: 'Name plate 1.0.0',
      fileName: 'name-plate.extrudo-plugin',
      mediaType: 'application/x-extrudo-plugin' as const,
      sha256: 'a'.repeat(64),
      size: 100,
    };
    expect(DocumentSchema.safeParse({ ...doc, attachments: { p1: attachment } }).success).toBe(
      true,
    );
    const font = { ...attachment, mediaType: 'font/ttf' as const };
    expect(DocumentSchema.safeParse({ ...doc, attachments: { p1: font } }).success).toBe(false);
  });

  it("makes a reference into what it generated a dependency on it, as a script's", () => {
    const ids = new Set(['f1', 'f2']);
    expect(scriptOfGenerated('f1.f3', ids)).toBe('f1');
    const fillet = {
      id: 'f2' as FeatureId,
      inputs: {
        edges: {
          kind: 'ref' as const,
          refs: [{ kind: 'edge' as const, id: 'e[extrude:f1.f2:cap:end|extrude:f1.f2:side:l]' }],
        },
      },
    };
    expect(referencedFeatures(fillet, ids)).toEqual(['f1']);
  });
});
