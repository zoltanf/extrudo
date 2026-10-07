// A plugin's command in the worker (P6-03 slice 2, ADR-0077 §5): the service's
// `runPluginCommand` with a fake script host — what the handler is given, how
// a failure is worded, and the checks on what comes back. The real sandbox and
// the example plugin run in `packages/cli/src/plugin-command.test.ts`.
import type { Feature, FeatureId, GeomRef } from '@extrudo/core';
import { writePluginFile } from '@extrudo/storage/plugin';
import { describe, expect, it } from 'vitest';
import { loadOcct } from './occt/load';
import { PLUGIN_COMMAND_OWNER, runPluginCommand } from './plugin-command';
import { testDocument, testFeature } from './recompute/testing';
import type { PluginRunRequest, ScriptHost, ScriptRunResult } from './script-host';
import { NO_SCRIPT_HOST } from './script-host';
import { KernelService } from './service';

const bytes = writePluginFile({
  manifest: {
    id: 'tiny',
    name: 'Tiny',
    version: '1.2.0',
    description: 'A box.',
    author: 'Someone',
    license: 'MIT',
    main: 'main.ts',
    commands: [{ id: 'box', label: 'Small box' }],
  },
  code: 'export const commands = {};\n',
});
const file = { bytes, mediaType: 'application/x-extrudo-plugin' };

function fakeHost(answer: (request: PluginRunRequest) => ScriptRunResult) {
  const requests: PluginRunRequest[] = [];
  const host: ScriptHost = {
    run: () => {
      throw new Error('not a script');
    },
    runPlugin(request) {
      requests.push(request);
      return answer(request);
    },
  };
  return { host, requests };
}

const generated = (id: string, type = 'test-box'): Feature => ({
  ...testFeature(id, type, { size: '1 mm' }),
  id: id as FeatureId,
});

const doc = testDocument([testFeature('a', 'test-box', { size: '10 mm' })], { w: '4 mm' });
const selection: GeomRef[] = [{ kind: 'body', id: 'a:0' }];
const request = { fileId: 'plugin:tiny@1.2.0', commandId: 'box', doc, selection };

describe('runPluginCommand', () => {
  it("runs the manifest's command with the document, the selection and the parameters", () => {
    const { host, requests } = fakeHost(() => ({
      ok: true,
      features: [generated('cmd.f1'), generated('cmd.f2')],
      log: ['hi'],
    }));
    const result = runPluginCommand(host, file, request);
    expect(result).toMatchObject({ ok: true, log: ['hi'] });
    expect(result.ok && result.features.map((f) => f.id)).toEqual(['cmd.f1', 'cmd.f2']);
    expect(requests).toEqual([
      expect.objectContaining({
        handler: { kind: 'command', name: 'box' },
        featureId: PLUGIN_COMMAND_OWNER,
        featureName: 'Small box',
        language: 'ts',
        doc,
        selection,
        params: expect.objectContaining({ w: 4 }),
      }),
    ]);
  });

  it('names the plugin and the line of main.ts when the handler fails', () => {
    const { host } = fakeHost(() => ({
      ok: false,
      error: { message: 'boom', line: 3, column: 5 },
      log: [],
    }));
    expect(runPluginCommand(host, file, request)).toEqual({
      ok: false,
      error: { message: 'Tiny 1.2.0, main.ts line 3: boom', line: 3, column: 5 },
      log: [],
    });
  });

  it('refuses a missing file, an unreadable one, an unknown command and a stray ID', () => {
    const { host } = fakeHost(() => ({ ok: true, features: [generated('x.f1')], log: [] }));
    expect(runPluginCommand(host, undefined, request)).toMatchObject({
      ok: false,
      error: { message: "The plugin's file didn't reach the kernel: try the command again." },
    });
    expect(runPluginCommand(host, { ...file, bytes: new Uint8Array([1]) }, request)).toMatchObject({
      error: {
        message: "The plugin can't be read: This isn't a plugin file: it isn't a zip archive.",
      },
    });
    expect(runPluginCommand(host, file, { ...request, commandId: 'nope' })).toMatchObject({
      error: { message: 'The plugin Tiny 1.2.0 has no command "nope".' },
    });
    expect(runPluginCommand(host, file, request)).toMatchObject({
      error: { message: 'Tiny 1.2.0: The plugin made a feature with the ID x.f1.' },
    });
  });
});

describe('KernelService.runPluginCommand', () => {
  it('says so, as data, when the kernel was started without a runner', async () => {
    const service = new KernelService(() => loadOcct());
    await service.addFile(request.fileId as never, bytes.slice().buffer, file.mediaType);
    expect(await service.runPluginCommand(request)).toEqual({
      ok: false,
      error: { message: NO_SCRIPT_HOST },
      log: [],
    });
  });

  it('runs the injected host on the file sent with addFile', async () => {
    const { host, requests } = fakeHost(() => ({ ok: true, features: [], log: [] }));
    const service = new KernelService(() => loadOcct(), { scripts: async () => host });
    await service.addFile(request.fileId as never, bytes.slice().buffer, file.mediaType);
    expect(await service.runPluginCommand(request)).toEqual({ ok: true, features: [], log: [] });
    expect(requests).toHaveLength(1);
    expect(
      await service.runPluginCommand({ ...request, fileId: 'plugin:other@1.0.0' }),
    ).toMatchObject({ ok: false });
  });
});
