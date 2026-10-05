/**
 * OpenSCAD's log in the app's words (ADR-0071 §6). OpenSCAD prints errors,
 * warnings and echoes on stderr, each with "in file <path>, line <n>" when it
 * knows where, among localisation noise and a dozen lines of statistics. This
 * reads the lines that matter and turns a run into the feature's error or its
 * warnings: "gear.scad, line 12: syntax error.", a missing `include` named, a
 * 2D or empty result explained, at most five echoes and warnings.
 */
import type { ScadMessage, ScadParameter, ScadRequest, ScadResult } from './index';
import { type RawRun, scadPath } from './run';

/** A compile that runs longer is stopped (ADR-0071 §6). */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** The WASM heap a compile may grow to (ADR-0071 §6). */
export const DEFAULT_HEAP_MAX_BYTES = 1024 * 1024 * 1024;

/** Echoes and warnings past this many are counted, not listed. */
export const MAX_SCAD_WARNINGS = 5;

const LEVELS: Readonly<Record<string, ScadMessage['level']>> = {
  ERROR: 'error',
  WARNING: 'warning',
  'FONT-WARNING': 'warning',
  DEPRECATED: 'warning',
  ECHO: 'echo',
  TRACE: 'trace',
};

/** "… in file /work/gear.scad, line 12" (or "…, import() at line 3"), at a line's end. */
const LOCATION = /,?\s+in file ([^,]+), line (\d+)\.?\s*$|,\s*\w+\(\) at line (\d+)\.?\s*$/;

/** The messages among OpenSCAD's lines: errors, warnings, echoes and traces. */
export function parseLog(lines: readonly string[]): ScadMessage[] {
  const messages: ScadMessage[] = [];
  for (const line of lines) {
    const match = /^([A-Z-]+): (.*)$/.exec(line.trim());
    const level = match && LEVELS[match[1] as string];
    if (!match || !level) continue;
    let text = (match[2] as string).trim();
    const where = LOCATION.exec(text);
    const message: ScadMessage = { level, text };
    if (where) {
      text = text.slice(0, where.index).trim();
      const file = where[1]?.split('/').pop();
      if (file) message.file = file;
      message.line = Number(where[2] ?? where[3]);
    }
    message.text = text.replace(/^Parser error: /, '');
    messages.push(message);
  }
  return messages;
}

/** A file OpenSCAD looked for and didn't find (`include`, `use`, `import()`). */
const MISSING = [
  /^Can't find include file '([^']+)'\.?$/,
  /^Can't open library '([^']+)'\.?$/,
  /^Can't open import file '([^']+)'\.?$/,
];

/**
 * A run, worded: the model and its warnings, or what went wrong. `name` is
 * the file's name as the user knows it, which OpenSCAD's own (a path in its
 * memory) is replaced with.
 */
export function explainRun(
  raw: RawRun,
  request: ScadRequest,
  limits: { heapMaxBytes: number },
): ScadResult {
  const name = request.fileName;
  const messages = parseLog(raw.lines);
  const parameters = readParameters(raw.parameters);
  const extra = parameters ? { parameters } : {};
  const ms = raw.ms;
  const at = (message: ScadMessage) =>
    message.line === undefined
      ? name
      : `${message.file && message.file !== baseOf(scadPath(name)) ? `${name} (${message.file})` : name}, line ${message.line}`;

  const fail = (error: string): ScadResult => ({
    ok: false,
    error,
    warnings: worded(messages, at, name),
    ...extra,
    ms,
  });

  if (raw.trap !== undefined) {
    if (raw.heapBytes >= limits.heapMaxBytes * 0.9) {
      return fail(
        `${name} needed more than ${size(limits.heapMaxBytes)} of memory to compile, so Extrudo stopped it: simplify the model (a lower $fn, fewer minkowski steps).`,
      );
    }
    return fail(`OpenSCAD stopped while compiling ${name}: ${raw.trap}.`);
  }
  // A file OpenSCAD only warns about and goes on without: the model it makes
  // is not the file's, so it is an error here.
  for (const message of messages) {
    for (const pattern of MISSING) {
      const missing = pattern.exec(message.text)?.[1];
      if (missing) {
        return fail(
          `${at(message)}: can't find ${missing.replace(/^\/work\//, '')}. Extrudo compiles one .scad file on its own, without libraries or other files.`,
        );
      }
    }
  }
  const error = messages.find((message) => message.level === 'error');
  if (error) return fail(`${at(error)}: ${sentence(lowerFirst(error.text))}`);
  const said = (text: string) => raw.lines.some((line) => line.trim() === text);
  if (said('Current top level object is not a 3D object.')) {
    return fail(
      `${name} makes a 2D shape: Extrudo imports 3D solids (extrude it with linear_extrude or rotate_extrude).`,
    );
  }
  if (said('Current top level object is empty.')) {
    const fonts = messages.some((message) => /Can't get font/.test(message.text));
    return fail(
      fonts
        ? `${name} makes nothing: its text() has no fonts in Extrudo yet.`
        : `${name} makes nothing: its top level is empty.`,
    );
  }
  if (raw.code !== 0 || !raw.model) {
    const last = raw.lines.map((line) => line.trim()).filter(Boolean);
    return fail(`OpenSCAD couldn't compile ${name}${last.length ? `: ${last.at(-1)}` : '.'}`);
  }
  return { ok: true, model: raw.model, warnings: worded(messages, at, name), ...extra, ms };
}

/** Echoes and warnings as the feature's warnings: at most `MAX_SCAD_WARNINGS`, then a count. */
function worded(
  messages: readonly ScadMessage[],
  at: (message: ScadMessage) => string,
  name: string,
): string[] {
  const said = messages
    .filter((message) => message.level === 'echo' || message.level === 'warning')
    .map((message) => {
      if (message.level === 'echo') return `${name} echoes ${sentence(message.text)}`;
      if (/Can't get font/.test(message.text)) {
        return `${at(message)}: text() has no fonts in Extrudo yet, so its text is left out.`;
      }
      return `${at(message)}: ${sentence(lowerFirst(message.text))}`;
    });
  const unique = [...new Set(said)];
  if (unique.length <= MAX_SCAD_WARNINGS) return unique;
  const more = unique.length - MAX_SCAD_WARNINGS;
  return [
    ...unique.slice(0, MAX_SCAD_WARNINGS),
    `… and ${more} more message${more === 1 ? '' : 's'} from OpenSCAD.`,
  ];
}

/** The customizer list OpenSCAD wrote, or `undefined` when it wrote none it could read. */
function readParameters(json: string | undefined): ScadParameter[] | undefined {
  if (json === undefined) return undefined;
  try {
    const parsed = JSON.parse(json) as { parameters?: unknown };
    if (!Array.isArray(parsed.parameters)) return undefined;
    return parsed.parameters.filter(
      (p): p is ScadParameter =>
        typeof p === 'object' && p !== null && typeof (p as ScadParameter).name === 'string',
    );
  } catch {
    return undefined;
  }
}

function baseOf(fileName: string): string {
  return fileName.split(/[\\/]/).pop() ?? fileName;
}

function lowerFirst(text: string): string {
  // "Assertion 'x' failed" → "assertion 'x' failed"; an identifier stays as it is.
  return /^[A-Z][a-z]/.test(text) ? text[0]?.toLowerCase() + text.slice(1) : text;
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function size(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${Number(gb.toFixed(1))} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}
