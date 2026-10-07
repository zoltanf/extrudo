/**
 * A plugin's command, run in the kernel worker (P6-03 slice 2, ADR-0077 §5).
 * The app sends the installed plugin's file like any resource (`addFile`,
 * under `plugin:<id>@<version>`) and asks for one command: the handler
 * `exports.commands[id]` runs in the script sandbox on the document as it is
 * at the timeline marker, with the model selection as references, and the
 * features it added come back for the app to insert in one transaction. The
 * features are a Script's — IDs `<PLUGIN_COMMAND_OWNER>.f1`…, names
 * "<command label> › Sketch1" — and the app re-mints both. Nothing of a
 * command is stored or cached here: it runs once, when asked.
 */
import {
  type ExtrudoDocument,
  evaluateParameters,
  type FeatureId,
  type GeomRef,
} from '@extrudo/core';
import { readPluginFile } from '@extrudo/storage/plugin';
import { checkedGenerated } from './features/script';
import type { ImportedFile } from './recompute/types';
import { type ScriptHost, ScriptRunError, type ScriptRunResult } from './script-host';

/** What the app asks for. */
export interface PluginCommandRequest {
  /** The file the app sent with `addFile`: `plugin:<plugin id>@<version>`. */
  fileId: string;
  /** The manifest's command `id`. */
  commandId: string;
  /** The document the command reads: the features up to the timeline marker. */
  doc: ExtrudoDocument;
  /** The model selection, as references (`ctx.selection` in the handler). */
  selection: readonly GeomRef[];
  /** Parameter values by name; computed from `doc` when absent. */
  params?: Readonly<Record<string, number>>;
}

/**
 * What a command gives back: a Script's result, the failure's message already
 * naming the plugin and the line in `main.ts` ("Tiny 1.0.0, main.ts line 3: …").
 */
export type PluginCommandResult = ScriptRunResult;

/** The owner of a command's generated IDs: `cmd.f1`, `cmd.f2`… */
export const PLUGIN_COMMAND_OWNER = 'cmd' as FeatureId;

/** The file ID the app sends an installed plugin under. */
export const pluginCommandFileId = (id: string, version: string) => `plugin:${id}@${version}`;

export function runPluginCommand(
  host: ScriptHost,
  file: ImportedFile | undefined,
  request: PluginCommandRequest,
): PluginCommandResult {
  const fail = (message: string): PluginCommandResult => ({
    ok: false,
    error: { message },
    log: [],
  });
  if (!file) return fail("The plugin's file didn't reach the kernel: try the command again.");
  let plugin: ReturnType<typeof readPluginFile>;
  try {
    plugin = readPluginFile(file.bytes);
  } catch (error) {
    return fail(`The plugin can't be read: ${error instanceof Error ? error.message : error}`);
  }
  const { manifest } = plugin;
  const what = `${manifest.name} ${manifest.version}`;
  const command = manifest.commands.find((c) => c.id === request.commandId);
  if (!command) return fail(`The plugin ${what} has no command "${request.commandId}".`);
  const params = request.params ?? parameterValues(request.doc);
  let result: ScriptRunResult;
  try {
    result = host.runPlugin({
      code: plugin.code,
      language: plugin.language,
      handler: { kind: 'command', name: command.id },
      doc: request.doc,
      featureId: PLUGIN_COMMAND_OWNER,
      featureName: command.label,
      params,
      selection: request.selection,
    });
  } catch (error) {
    return fail(`${what}, ${manifest.main}: ${error instanceof Error ? error.message : error}`);
  }
  if (!result.ok) {
    const error = new ScriptRunError(result.error, result.log, `${what}, ${manifest.main}`);
    return { ok: false, error: { ...result.error, message: error.message }, log: result.log };
  }
  try {
    return {
      ok: true,
      features: [...checkedGenerated(PLUGIN_COMMAND_OWNER, result.features, 'plugin')],
      log: result.log,
    };
  } catch (error) {
    return {
      ok: false,
      error: { message: `${what}: ${(error as Error).message}` },
      log: result.log,
    };
  }
}

function parameterValues(doc: ExtrudoDocument): Record<string, number> {
  const params: Record<string, number> = {};
  for (const [name, parameter] of evaluateParameters(doc).parameters) {
    if (parameter.result.ok) params[name] = parameter.result.value;
  }
  return params;
}
