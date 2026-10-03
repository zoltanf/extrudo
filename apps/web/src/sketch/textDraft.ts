/**
 * The Text tool's draft (P4-03, ADR-0058 §6): the string, font, alignment and
 * height of the text being placed, in a store the panel writes and the tool
 * reads. It lives apart from the tool so the panel (in the main chunk) can
 * reach it without pulling the drawing tools' chunk in with it.
 */
import type { FontId, TextAlign } from '@extrudo/core';
import { DEFAULT_FONT } from '@extrudo/fonts';
import { createStore } from 'zustand/vanilla';

/** The height a new text gets, as the Height field's expression. */
export const DEFAULT_TEXT_HEIGHT = '10 mm';
/** The string a new text starts with. */
export const DEFAULT_TEXT_STRING = 'Text';

export interface TextDraft {
  /** The click placed the anchor and the panel is open. */
  open: boolean;
  text: string;
  font: FontId;
  align: TextAlign;
  /** The Height field's expression, as typed. */
  expr: string;
  /** Its last good value in mm: what the preview draws and the top point is. */
  mm: number;
}

/** The draft a new text starts from; the panel writes over it. */
export const DEFAULT_TEXT_DRAFT: TextDraft = {
  open: false,
  text: DEFAULT_TEXT_STRING,
  font: DEFAULT_FONT,
  align: 'left',
  expr: DEFAULT_TEXT_HEIGHT,
  mm: 10,
};

export const textDraftStore = createStore<TextDraft>()(() => ({ ...DEFAULT_TEXT_DRAFT }));

/** The panel's edits (or the tool opening and closing it). */
export function setTextDraft(patch: Partial<TextDraft>): void {
  textDraftStore.setState(patch);
}

/** The panel closed: the next text starts from the defaults again. */
export function resetTextDraft(): void {
  textDraftStore.setState({ ...DEFAULT_TEXT_DRAFT });
}

interface TextFocus {
  /** The text entity whose Text field the panel should put the cursor in. */
  id: string | undefined;
  /** Bumped per request, so the panel hears of a repeat on the same text. */
  request: number;
}

export const textFocusStore = createStore<TextFocus>()(() => ({ id: undefined, request: 0 }));

/** Asks the panel to focus its Text field for `id` (a double-click on the text, P4-03). */
export function focusTextField(id: string): void {
  textFocusStore.setState((s) => ({ id, request: s.request + 1 }));
}

/** The entity the panel should focus right now, read once. */
export function takeTextFocus(): string | undefined {
  return textFocusStore.getState().id;
}
