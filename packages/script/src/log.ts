/**
 * The lines a script printed (ADR-0070 §2): at most so many lines, and at most
 * so many characters over all of them. A script that floods the log is stopped
 * at the cap with a line saying so, not by an error: its output is a nicety, and
 * the features it added are the point.
 */
import { logCharacterMessage, logLineMessage } from './limits';
import type { ScriptLimits } from './types';

export class ScriptLog {
  readonly #lines: string[] = [];
  readonly #limits: ScriptLimits;
  #characters = 0;
  #note: string | undefined;

  constructor(limits: ScriptLimits) {
    this.#limits = limits;
  }

  /** Adds one line, at the caps. */
  line(text: string): void {
    if (this.#lines.length >= this.#limits.logLines) {
      this.#note ??= logLineMessage(this.#limits.logLines);
      return;
    }
    const room = this.#limits.logCharacters - this.#characters;
    if (text.length > room) {
      if (room > 0) {
        this.#lines.push(text.slice(0, room));
        this.#characters += room;
      }
      this.#note ??= logCharacterMessage(this.#limits.logCharacters);
      return;
    }
    this.#lines.push(text);
    this.#characters += text.length;
  }

  /** What the run printed, with the cap's note last when it came to that. */
  out(): string[] {
    return this.#note === undefined ? [...this.#lines] : [...this.#lines, this.#note];
  }
}
