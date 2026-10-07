// The plugin manifest (P6-03, ADR-0077 §1): checked strictly before anything
// else of a plugin file is read, and refused with the place and the reason.
import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  type PluginManifest,
  PluginManifestError,
  parsePluginManifest,
  pluginCommandId,
  pluginFileName,
} from './plugin';

// biome-ignore lint/suspicious/noExplicitAny: a test pokes at manifest JSON by path
type Loose = any;

/** The example plugin's manifest, as `examples/plugins/name-plate/plugin.json` has it. */
function manifest(): Record<string, unknown> {
  return {
    id: 'name-plate',
    name: 'Name plate',
    version: '1.0.0',
    description: 'A rounded plate on a plane, and three holes.',
    author: 'Extrudo',
    license: 'MIT',
    main: 'main.ts',
    commands: [{ id: 'three-holes', label: 'Three holes' }],
    features: [
      {
        type: 'name-plate',
        label: 'Name plate',
        icon: 'box',
        inputs: [
          { name: 'width', label: 'Width', kind: 'expr', unit: 'length', default: '60 mm' },
          { name: 'rounded', label: 'Rounded', kind: 'bool', default: true },
          { name: 'style', label: 'Style', kind: 'enum', options: ['flat', 'raised'] },
          { name: 'plane', label: 'Plane', kind: 'ref', accepts: ['plane', 'face'] },
        ],
      },
    ],
  };
}

/** The message `parsePluginManifest` throws for this value. */
function refusal(value: unknown): string {
  try {
    parsePluginManifest(value);
  } catch (error) {
    expect(error).toBeInstanceOf(PluginManifestError);
    return (error as Error).message;
  }
  throw new Error('The manifest was accepted.');
}

describe('parsePluginManifest', () => {
  it('reads a manifest, from text or JSON, with the lists defaulted', () => {
    const read: PluginManifest = parsePluginManifest(JSON.stringify(manifest()));
    expect(read.features[0]?.inputs).toHaveLength(4);
    const bare = { ...manifest(), commands: undefined, features: undefined };
    expect(parsePluginManifest(bare)).toMatchObject({ commands: [], features: [] });
  });

  it('names the place and the kinds there are for an input kind it does not know', () => {
    const value = manifest();
    const inputs = (value.features as { inputs: Record<string, unknown>[] }[])[0]?.inputs ?? [];
    inputs[2] = { name: 'labels', label: 'Labels', kind: 'labels' };
    expect(refusal(value)).toBe(
      'plugin.json › features[0] › inputs[2] › kind: expected one of expr, bool, enum, ref',
    );
  });

  it('refuses a key the schema lacks, a key binding among them', () => {
    const value = { ...manifest(), commands: [{ id: 'x', label: 'X', keys: 'Ctrl+H' }] };
    expect(refusal(value)).toBe(
      'plugin.json › commands[0]: "keys" is not a key a plugin manifest has here',
    );
    expect(refusal({ ...manifest(), homepage: 'https://example.org' })).toMatch(
      /^plugin\.json: "homepage" is not a key/,
    );
  });

  it('refuses a bad ID, version, main or license, and text that is not JSON', () => {
    expect(refusal({ ...manifest(), id: 'Name Plate' })).toMatch(/^plugin\.json › id: must be/);
    expect(refusal({ ...manifest(), version: '1.0' })).toBe(
      'plugin.json › version: must be a version like 1.0.0',
    );
    expect(refusal({ ...manifest(), main: 'index.js' })).toBe(
      'plugin.json › main: expected one of main.ts, main.js',
    );
    expect(refusal({ ...manifest(), license: 'see LICENSE file' })).toMatch(
      /^plugin\.json › license/,
    );
    expect(refusal('{ "id": ')).toMatch(/^plugin\.json: isn't valid JSON/);
  });

  it('refuses repeated names, a default outside the options and a ref of features', () => {
    const value = manifest();
    const features = value.features as { inputs: Record<string, unknown>[] }[];
    const inputs = features[0]?.inputs ?? [];
    inputs[1] = { name: 'width', label: 'Again', kind: 'bool' };
    expect(refusal(value)).toBe(
      'plugin.json › features[0] › inputs[1] › name: "width" is used by an earlier input',
    );
    const options = manifest();
    const style = (options.features as { inputs: Record<string, unknown>[] }[])[0]?.inputs[2];
    if (style) style.default = 'round';
    expect(refusal(options)).toBe(
      'plugin.json › features[0] › inputs[2] › default: must be one of the options',
    );
    const refs = manifest();
    const plane = (refs.features as { inputs: Record<string, unknown>[] }[])[0]?.inputs[3];
    if (plane) plane.accepts = ['feature'];
    expect(refusal(refs)).toMatch(/^plugin\.json › features\[0\] › inputs\[3\] › accepts\[0\]: /);
    const twice = {
      ...manifest(),
      commands: [
        { id: 'a', label: 'A' },
        { id: 'a', label: 'B' },
      ],
    };
    expect(refusal(twice)).toBe(
      'plugin.json › commands[1] › id: "a" is used by an earlier command',
    );
  });

  it('refuses control characters and bidi overrides in every string the UI shows', () => {
    const bad = ['a\u0000b', 'a\u001b[31mb', 'a\u0085b', 'a\u202eb', 'a\u2066b', 'a\nb'];
    const places: [string, (m: Loose, v: string) => void, string][] = [
      [
        'name',
        (m, v) => {
          m.name = v;
        },
        'plugin.json › name',
      ],
      [
        'description',
        (m, v) => {
          m.description = v;
        },
        'plugin.json › description',
      ],
      [
        'author',
        (m, v) => {
          m.author = v;
        },
        'plugin.json › author',
      ],
      [
        'command label',
        (m, v) => {
          m.commands[0].label = v;
        },
        'plugin.json › commands[0] › label',
      ],
      [
        'command hint',
        (m, v) => {
          m.commands[0].hint = v;
        },
        'plugin.json › commands[0] › hint',
      ],
      [
        'feature label',
        (m, v) => {
          m.features[0].label = v;
        },
        'plugin.json › features[0] › label',
      ],
      [
        'feature hint',
        (m, v) => {
          m.features[0].hint = v;
        },
        'plugin.json › features[0] › hint',
      ],
      [
        'input label',
        (m, v) => {
          m.features[0].inputs[0].label = v;
        },
        'plugin.json › features[0] › inputs[0] › label',
      ],
    ];
    for (const [what, set, path] of places) {
      for (const value of bad) {
        const m = manifest() as Loose;
        set(m, value);
        expect(() => parsePluginManifest(m), `${what} ${JSON.stringify(value)}`).toThrow(path);
      }
    }
    const m = manifest() as Loose;
    m.features[0].inputs.push({ name: 'mode', label: 'Mode', kind: 'enum', options: ['a\u202eb'] });
    expect(() => parsePluginManifest(m)).toThrow('must not contain control or bidirectional');
    const ok = manifest() as Loose;
    ok.description = 'Tabs\tare fine, and so is ünïcödé ✓';
    expect(parsePluginManifest(ok).description).toContain('ünïcödé');
  });

  it('names a command and a plugin file the way the app does', () => {
    expect(pluginCommandId('name-plate', 'three-holes')).toBe('plugin:name-plate:three-holes');
    expect(pluginFileName({ id: 'name-plate' })).toBe('name-plate.extrudo-plugin');
  });
});

describe('compareSemver', () => {
  it('orders versions by SemVer precedence', () => {
    const ordered = [
      '0.9.0',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.0.1',
      '1.2.0',
      '1.10.0',
      '2.0.0',
    ];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        const a = ordered[i] as string;
        const b = ordered[j] as string;
        expect(Math.sign(compareSemver(a, b)), `${a} vs ${b}`).toBe(Math.sign(i - j));
      }
    }
    expect(compareSemver('1.0.0+build.1', '1.0.0+build.2')).toBe(0);
  });
});
