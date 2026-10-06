/**
 * TypeScript to JavaScript (ADR-0070 §2).
 *
 * sucrase only strips the types, and it does it in place: the JavaScript it
 * writes has the same lines as the TypeScript the user typed, so a runtime
 * error's line is the line in the editor. A syntax error comes back with its own
 * line and column, which is the one position in the pipeline QuickJS does not
 * have to find.
 */
import { transform } from 'sucrase';
import { codeLengthMessage, ScriptError } from './limits';
import type { ScriptLanguage } from './types';

/**
 * The script's source as QuickJS will run it. `language: 'js'` is the source
 * itself; `ts` is sucrase's output, which keeps every line.
 */
export function compileScript(code: string, language: ScriptLanguage): string {
  if (language === 'js') return code;
  try {
    return transform(code, { transforms: ['typescript'] }).code;
  } catch (error) {
    throw syntaxError(error);
  }
}

/** The source, once its length has been checked (ADR-0070 §1's `code` input). */
export function checkCodeLength(code: string, limit: number): void {
  if (code.length > limit) throw new ScriptError(codeLengthMessage(limit));
}

/**
 * A sucrase error as a `ScriptError` with the line and column its message ends
 * with (`Unexpected token, expected ',' (3:1)`), which is the position of the
 * token it stopped on.
 */
function syntaxError(error: unknown): ScriptError {
  const message = error instanceof Error ? error.message : String(error);
  const located = error as { loc?: { line?: number; column?: number } };
  const line = located.loc?.line;
  const column = located.loc?.column;
  return new ScriptError(message.replace(/\s*\(\d+:\d+\)\s*$/, ''), {
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
  });
}
