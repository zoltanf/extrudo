/**
 * The recent-actions log (ADR-0127): a ring buffer of the last 500 things the
 * person and the app did — document commands and the undo step each made or
 * joined, undo and redo, tool switches, what each sketch-tool click picked,
 * silent no-ops as warnings, errors — for bugs where nothing throws. Report a
 * Bug carries it when "Include recent actions" is ticked; on edge and dev
 * builds it is also kept in browser storage (`persist`), so it survives a
 * reload or a crash.
 *
 * **Privacy (ADR-0092's rules):** command types, undo labels (`redactLabel`),
 * step and feature ids, tool ids and pick kinds only. Never parameter values,
 * expressions, feature or design names, file paths, coordinates or document
 * content. Pure: no React, no DOM; tested in `actionLog.test.ts`.
 */
import type { DocumentStore, HistoryEvent, SessionStore } from '@extrudo/core';
import type { BuildChannel } from '../../pwa/build-info';

export const ACTION_LIMIT = 500;
/** An entry's text is cut to this many characters. */
export const ACTION_TEXT_LIMIT = 200;
/** How long after a change `persist` writes (one write per burst). */
export const ACTION_WRITE_DELAY_MS = 500;

export type ActionLevel = 'info' | 'warn' | 'error';
/**
 * `app`: the app started, a design opened; `history`: a document command,
 * undo, redo, a transaction; `tool`: the mode or tool changed; `pick`: what a
 * sketch tool's click picked; `sketch`: a sketch tool's silent no-op; `error`:
 * an error the person saw (its text is in the report's error list).
 */
export type ActionKind = 'app' | 'history' | 'tool' | 'pick' | 'sketch' | 'error';

export interface ActionEntry {
  /** When, ms since the epoch (the newest time for a repeated entry). */
  t: number;
  level: ActionLevel;
  kind: ActionKind;
  text: string;
  /** How many times in a row the same entry happened; absent for once. */
  repeat?: number;
  /**
   * What makes a repeat the same entry, when not its text: a drag's moves are
   * one entry though each makes its own step.
   */
  key?: string;
}

/** Where `persist` keeps the entries (`platform/actionLogStorage.ts`). */
export interface ActionLogStorage {
  /** The stored value, or undefined when none or unreadable. */
  read(): unknown;
  write(entries: readonly ActionEntry[]): void;
}

export interface ActionLog {
  /** Adds an entry; the same `key` (or text) as the newest entry counts it as a repeat instead. */
  record(level: ActionLevel, kind: ActionKind, text: string, key?: string): void;
  info(kind: ActionKind, text: string, key?: string): void;
  warn(kind: ActionKind, text: string, key?: string): void;
  error(kind: ActionKind, text: string, key?: string): void;
  /** The newest `limit` entries, oldest first (copies). */
  entries(): readonly ActionEntry[];
  /**
   * Keeps the entries in `storage` from now on: what it holds goes before
   * this session's entries (the newest `limit` kept), and each change is
   * written `ACTION_WRITE_DELAY_MS` later. Call once, at boot.
   */
  persist(storage: ActionLogStorage): void;
  /** Writes a pending change now (the page is going away). */
  flush(): void;
  clear(): void;
}

export interface ActionLogOptions {
  limit?: number;
  now?: () => number;
  /** Runs `write` later (`setTimeout` in the app; tests run it at once or by hand). */
  schedule?: (write: () => void, ms: number) => void;
}

const LEVELS: readonly ActionLevel[] = ['info', 'warn', 'error'];
const KINDS: readonly ActionKind[] = ['app', 'history', 'tool', 'pick', 'sketch', 'error'];

/** Reads stored entries back, dropping anything that isn't one. */
export function storedEntries(value: unknown): ActionEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ActionEntry[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const { t, level, kind, text, repeat, key } = item as Record<string, unknown>;
    if (typeof t !== 'number' || !Number.isFinite(t) || typeof text !== 'string') continue;
    if (!LEVELS.includes(level as ActionLevel) || !KINDS.includes(kind as ActionKind)) continue;
    out.push({
      t,
      level: level as ActionLevel,
      kind: kind as ActionKind,
      text: text.slice(0, ACTION_TEXT_LIMIT),
      ...(typeof repeat === 'number' && repeat > 1 && { repeat: Math.floor(repeat) }),
      ...(typeof key === 'string' && { key }),
    });
  }
  return out;
}

export function createActionLog(options: ActionLogOptions = {}): ActionLog {
  const limit = options.limit ?? ACTION_LIMIT;
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((write, ms) => void setTimeout(write, ms));
  const entries: ActionEntry[] = [];
  let storage: ActionLogStorage | undefined;
  let pending = false;

  const write = () => {
    pending = false;
    storage?.write(entries);
  };
  const changed = () => {
    if (!storage || pending) return;
    pending = true;
    schedule(write, ACTION_WRITE_DELAY_MS);
  };
  const trim = () => {
    if (entries.length > limit) entries.splice(0, entries.length - limit);
  };

  const record: ActionLog['record'] = (level, kind, raw, key) => {
    const text = raw.slice(0, ACTION_TEXT_LIMIT);
    const last = entries.at(-1);
    if (
      last &&
      last.level === level &&
      last.kind === kind &&
      (key === undefined ? last.key === undefined && last.text === text : last.key === key)
    ) {
      last.repeat = (last.repeat ?? 1) + 1;
      last.text = text;
      last.t = now();
    } else {
      entries.push({ t: now(), level, kind, text, ...(key !== undefined && { key }) });
      trim();
    }
    changed();
  };

  return {
    record,
    info: (kind, text, key) => record('info', kind, text, key),
    warn: (kind, text, key) => record('warn', kind, text, key),
    error: (kind, text, key) => record('error', kind, text, key),
    entries: () => entries.map((e) => ({ ...e })),
    persist(next) {
      storage = next;
      let stored: ActionEntry[] = [];
      try {
        stored = storedEntries(next.read());
      } catch {
        // Unreadable storage: start empty.
      }
      entries.unshift(...stored);
      trim();
      changed();
    },
    flush() {
      if (pending) write();
    },
    clear() {
      entries.length = 0;
      changed();
    },
  };
}

/**
 * Whether a build keeps the log in browser storage (ADR-0127): edge and local
 * dev builds do; a release (`stable`) keeps it in memory only.
 */
export function persistsActions(channel: BuildChannel): boolean {
  return channel !== 'stable';
}

/** The app's one log: the shell, the sketch host and the boot write it, Report a Bug reads it. */
export const actionLog: ActionLog = createActionLog();

/**
 * Undo labels that carry a name the person chose, cut at the name (ADR-0127):
 * Customizer's `Change <parameter>`, a macro's `Replace with <macro>` and
 * Import Drawing's `Import <file name>`. A new label with a design's or a
 * file's name in it gets its prefix here.
 */
const NAMED_LABELS = ['Change ', 'Replace with ', 'Import '] as const;

/** An undo label as the log keeps it: a named one cut (`Change …`), at most 60 characters. */
export function redactLabel(label: string): string {
  const prefix = NAMED_LABELS.find((p) => label.startsWith(p));
  const kept = prefix ? `${prefix}…` : label;
  return kept.length > 60 ? `${kept.slice(0, 59)}…` : kept;
}

const quoted = (label: string | undefined) => `"${redactLabel(label ?? '')}"`;

/**
 * A history event as a log entry (`DocumentState.subscribeHistory`). The
 * warnings are the silent no-ops: a command that changed nothing, a change
 * whose step is gone, a refused revert.
 */
export function historyEntry(event: HistoryEvent): {
  level: ActionLevel;
  text: string;
  key?: string;
} {
  switch (event.type) {
    case 'dispatch': {
      const head = `${event.command} ${quoted(event.label)}`;
      return event.step === undefined
        ? { level: 'warn', text: `${head}: changed nothing` }
        : { level: 'info', text: `${head}: new step ${event.step}`, key: `dispatch ${head}` };
    }
    case 'amend': {
      const head = `${event.command} ${quoted(event.label)}`;
      if (!event.changed) return { level: 'info', text: `${head}: amend changed nothing` };
      if (event.step === undefined) {
        return event.into === undefined
          ? { level: 'info', text: `${head}: applied without a step (none to join)` }
          : { level: 'warn', text: `${head}: dropped, step ${event.into} is gone` };
      }
      const which = event.into === undefined ? 'the latest step' : 'step';
      const relabel = event.relabel ? ' (relabelled)' : '';
      return {
        level: 'info',
        text: `${head}: joined ${which} ${event.step} ${quoted(event.stepLabel)}${relabel}`,
      };
    }
    case 'undo':
    case 'redo': {
      const verb = event.type === 'undo' ? 'Undo' : 'Redo';
      return event.step === undefined
        ? { level: 'info', text: `${verb}: nothing to ${event.type}` }
        : { level: 'info', text: `${verb} step ${event.step} ${quoted(event.label)}` };
    }
    case 'revert': {
      const to = event.target === undefined ? 'before any step' : `step ${event.target}`;
      return event.changed
        ? { level: 'info', text: `Revert to ${to}` }
        : { level: 'warn', text: `Revert to ${to}: refused` };
    }
    case 'begin':
      return { level: 'info', text: `Begin ${quoted(event.label)} (depth ${event.depth})` };
    case 'commit':
      return {
        level: 'info',
        text:
          event.step === undefined
            ? `Commit ${quoted(event.label)}: no steps`
            : `Commit ${quoted(event.label)}: step ${event.step}`,
      };
    case 'cancel':
      return { level: 'info', text: `Cancel ${quoted(event.label)}` };
    case 'reopen':
      return {
        level: 'info',
        text: `Reopen ${quoted(event.label)}: step ${event.step} (depth ${event.depth})`,
      };
    case 'replace':
      return { level: 'info', text: 'Document replaced: history cleared' };
  }
}

/** Records a history event in `log` (the shell subscribes this to the open design's store). */
export function logHistory(log: ActionLog, event: HistoryEvent): void {
  const { level, text, key } = historyEntry(event);
  log.record(level, 'history', text, key);
}

/**
 * Logs an open design's history events and its mode and tool changes (the
 * shell calls this while the design is open). Ids only: the sketch's feature
 * id, the tool's command id. Returns the unsubscribe.
 */
export function watchActions(
  { store, session }: { store: DocumentStore; session: SessionStore },
  log: ActionLog = actionLog,
): () => void {
  log.info('app', `Design opened: ${store.getState().doc.features.length} features`);
  const stopHistory = store.getState().subscribeHistory((event) => logHistory(log, event));
  const stopSession = session.subscribe((s, prev) => {
    if (
      s.mode !== prev.mode ||
      s.activeSketchId !== prev.activeSketchId ||
      s.activeSheetId !== prev.activeSheetId
    ) {
      log.info(
        'tool',
        s.mode === 'sketch'
          ? `Sketch mode: ${s.activeSketchId ?? 'no sketch'}`
          : s.mode === 'sheet'
            ? `Drawing mode: ${s.activeSheetId ?? 'no sheet'}`
            : 'Model mode',
      );
    }
    if (s.activeTool !== prev.activeTool) log.info('tool', `Tool: ${s.activeTool ?? 'none'}`);
  });
  return () => {
    stopHistory();
    stopSession();
    log.info('app', 'Design closed');
  };
}

/**
 * The report's lines, oldest first: seconds since the first entry listed (no
 * clock time), the level for a warning or an error, the kind and the text,
 * `(×n)` for a repeat. Each line is one entry, so the URL cut drops whole
 * lines.
 */
export function actionLines(entries: readonly ActionEntry[]): string[] {
  const start = entries[0]?.t ?? 0;
  return entries.map((e) => {
    const seconds = ((e.t - start) / 1000).toFixed(3).padStart(8);
    const level = e.level === 'info' ? '' : `${e.level.toUpperCase()} `;
    const repeat = e.repeat ? ` (×${e.repeat})` : '';
    return `${seconds} ${level}${e.kind}: ${e.text}${repeat}`;
  });
}
