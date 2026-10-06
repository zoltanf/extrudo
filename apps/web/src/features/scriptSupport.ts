import type { FeatureStatus } from '@extrudo/core';
import { ALLOWED_SCRIPT_METHODS, SCRIPT_METHOD_DESCRIPTIONS } from '@extrudo/script/methods';

export interface ScriptCompletion {
  label: string;
  type: string;
  detail?: string;
}

/** Pure completion matching; never offers document mutations or nested scripts. */
export function scriptCompletions(before: string, params: Readonly<Record<string, number>>) {
  const match = /\b(design|params|console)\.([\w$]*)$/.exec(before);
  if (!match) return undefined;
  const prefix = match[2] ?? '';
  const options: ScriptCompletion[] =
    match[1] === 'design'
      ? ALLOWED_SCRIPT_METHODS.map((label) => ({
          label,
          type: label === 'origin' ? 'property' : 'method',
          ...(SCRIPT_METHOD_DESCRIPTIONS[label] && { detail: SCRIPT_METHOD_DESCRIPTIONS[label] }),
        }))
      : match[1] === 'params'
        ? Object.entries(params).map(([label, value]) => ({
            label,
            type: 'property',
            detail: String(value),
          }))
        : [{ label: 'log', type: 'method', detail: 'Write to Script output' }];
  return {
    from: before.length - prefix.length,
    options: options.filter((o) => o.label.startsWith(prefix)),
  };
}

export function scriptMessage(message: string): string {
  return message.replace(/^(Line \d+: )?Error: /, '$1');
}

/** Clamp positions to the source: a compiler's end-of-file position may be past its last line. */
export function scriptDiagnostics(code: string, status?: FeatureStatus) {
  if (status?.status !== 'error' || !status.script?.line) return [];
  const lines = code.split('\n');
  const line = Math.max(1, Math.min(status.script.line, lines.length));
  const text = lines[line - 1] ?? '';
  const start = lines.slice(0, line - 1).reduce((sum, s) => sum + s.length + 1, 0);
  const column = Math.max(
    0,
    Math.min((status.script.column ?? 1) - 1, Math.max(0, text.length - 1)),
  );
  return [
    {
      from: start + column,
      to: start + text.length,
      severity: 'error' as const,
      message: scriptMessage(status.message ?? 'The script failed.'),
    },
  ];
}
