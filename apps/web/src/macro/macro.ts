/**
 * Macro recording (P5-05 slice 2, ADR-0073 §4). The document already is the record: recording
 * remembers how many features there were at Record, and Stop writes the features after that
 * as code with the emitter (`emitScript`, loaded lazily: the document API stays out of the
 * main chunk). Everything here is session state or a command on the document; nothing is
 * stored with the design.
 */
import {
  CommandError,
  type DocumentStore,
  type ExtrudoDocument,
  type Feature,
  type FeatureId,
  insertFeature,
  newId,
  nextFeatureName,
  removeFeature,
  SCRIPT_LABEL,
  scriptFeatureOf,
} from '@extrudo/core';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface Recording {
  from: number;
  base: number;
}

export interface MacroState {
  /**
   * Present while recording. New features land at the timeline marker, so a run starts at the
   * marker's index when Record was pressed (`from`) and the features made since are the growth
   * of the timeline over its length then (`base`): at the end of the timeline, `from === base`.
   */
  recording: Recording | undefined;
  start(from: number, base: number): void;
  /** Ends the recording and returns what it was; undefined when none ran. */
  stop(): Recording | undefined;
}

export type MacroStore = StoreApi<MacroState>;

export function createMacroStore(): MacroStore {
  return createStore<MacroState>()((set, get) => ({
    recording: undefined,
    start: (from, base) => set({ recording: { from, base } }),
    stop() {
      const recording = get().recording;
      set({ recording: undefined });
      return recording;
    },
  }));
}

/** How many features the recording has made so far (0 when none runs). */
export function recordedCount(recording: MacroState['recording'], doc: ExtrudoDocument): number {
  return recording ? Math.max(0, doc.features.length - recording.base) : 0;
}

/** The recording ends when the document has fewer features than it started with (undo). */
export function endedByUndo(recording: MacroState['recording'], doc: ExtrudoDocument): boolean {
  return recording !== undefined && doc.features.length < recording.base;
}

export const MACRO_NOTHING = 'Nothing was recorded.';

/** What Stop saw: the features recorded, in order, and their code (empty when none). */
export interface Recorded {
  ids: FeatureId[];
  code: string;
}

export async function macroCode(doc: ExtrudoDocument, recording: Recording): Promise<Recorded> {
  const { from } = recording;
  const ids = doc.features
    .slice(from, from + recordedCount(recording, doc))
    .map((feature) => feature.id);
  if (ids.length === 0) return { ids, code: '' };
  const { emitScript } = await import('@extrudo/api');
  return { ids, code: emitScript(doc, { features: [from, from + ids.length - 1] }) };
}

/** The whole design as code, with its parameters ("Export Design as Script…"). */
export async function designCode(doc: ExtrudoDocument): Promise<string> {
  const { emitScript } = await import('@extrudo/api');
  return emitScript(doc);
}

/** `<design name>.ts`, with what a file name can't hold turned into dashes. */
export function scriptFileName(name: string): string {
  const printable = [...name].filter((c) => c.charCodeAt(0) >= 32).join('');
  const base = printable.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'design';
  return `${base}.ts`;
}

export type MacroOutcome = { ok: true; message: string } | { ok: false; message: string };

/**
 * "Can't delete Extrude3: Fillet2 uses it. Change or delete that first." as the dialog says it:
 * "Fillet2 still uses Extrude3: keep both, or move it."
 */
export function refusalMessage(error: CommandError): string {
  const match = /^Can't delete (.+?): (.+?) (?:uses|use) it\./.exec(error.message);
  return match
    ? `${match[2]} still ${match[2]?.includes(', ') || match[2]?.includes(' and ') ? 'use' : 'uses'} ${match[1]}: keep both, or move it.`
    : error.message;
}

/**
 * Replace: a Script feature with `code` takes the place of the `recorded` features (the run
 * Stop saw, the first at `from`), in one undo step. A recorded feature that a later one — one outside the
 * run — still uses makes `removeFeature` refuse, and then nothing has changed.
 */
export function replaceWithScript(
  store: DocumentStore,
  {
    recorded,
    code,
    id = newId<FeatureId>(),
  }: { recorded: readonly FeatureId[]; code: string; id?: FeatureId },
): MacroOutcome {
  const { doc } = store.getState();
  const from = doc.features.findIndex((feature) => feature.id === recorded[0]);
  if (recorded.length === 0 || from < 0) return { ok: false, message: MACRO_NOTHING };
  const name = nextFeatureName(doc, SCRIPT_LABEL);
  store.getState().beginTransaction(`Replace with ${name}`);
  try {
    store.getState().dispatch(
      insertFeature({
        feature: scriptFeatureOf(id, name, { code, language: 'ts' }) as Feature,
        index: from,
      }),
    );
    for (const recordedId of [...recorded].reverse()) {
      store.getState().dispatch(removeFeature({ id: recordedId }));
    }
    store.getState().commitTransaction();
    return { ok: true, message: `Replaced ${recorded.length} features with ${name}.` };
  } catch (error) {
    store.getState().cancelTransaction();
    if (error instanceof CommandError) return { ok: false, message: refusalMessage(error) };
    throw error;
  }
}

/**
 * Keep both: the Script goes at the end, suppressed (its bodies would duplicate the recorded
 * ones until the user chooses).
 */
export function keepScript(
  store: DocumentStore,
  { code, id = newId<FeatureId>() }: { code: string; id?: FeatureId },
): MacroOutcome {
  const { doc } = store.getState();
  const name = nextFeatureName(doc, SCRIPT_LABEL);
  const feature = {
    ...scriptFeatureOf(id, name, { code, language: 'ts' }),
    suppressed: true,
  } as Feature;
  try {
    store.getState().dispatch(insertFeature({ feature, index: doc.features.length }));
  } catch (error) {
    if (error instanceof CommandError) return { ok: false, message: error.message };
    throw error;
  }
  return {
    ok: true,
    message: `Added ${name}, suppressed: unsuppress it to run the macro.`,
  };
}
