/**
 * The markup every docs widget shares (ADR-0116 §1): the figure around it, the
 * stage, the side column and its switch rows. The build writes it with the
 * controls `disabled`, so without a script the widget is a still picture; the
 * widget's `enhance` turns them on.
 */
import { escapeText } from './svg';

/** One switch row: an icon, a label and a real checkbox (keyboard and screen readers work). */
export interface Switch {
  /** The `data-key` the widget's script reads. */
  key: string;
  label: string;
  /** The icon's inner markup, drawn in a 16 × 16 box. */
  icon: string;
  checked: boolean;
}

/** A switch row, as the app's sketch palette draws it (ADR-0074's amendment of 2026-10-31). */
export function switchRow(row: Switch): string {
  return `<label class="widget-switch"><svg viewBox="0 0 16 16" aria-hidden="true">${row.icon}</svg><span>${escapeText(row.label)}</span><input type="checkbox" data-key="${escapeText(row.key)}"${row.checked ? ' checked' : ''} disabled /><span class="widget-track" aria-hidden="true"></span></label>`;
}

/** What a widget's figure holds. */
export interface WidgetParts {
  name: string;
  /** The stage's `viewBox`, e.g. `0 0 420 240`. */
  viewBox: string;
  /** Describes the starting state, for a reader that doesn't see the picture. */
  label: string;
  /** The stage's inner markup in its starting state. */
  stage: string;
  /** The side column's controls (already `disabled`). */
  controls: string;
  /** The starting text of the `aria-live` result line, for a widget that has one. */
  result?: string;
  caption: string;
}

/** The whole figure: stage, side column, result line and caption. */
export function widgetFigure(parts: WidgetParts): string {
  const result =
    parts.result === undefined
      ? ''
      : `<p class="widget-result" aria-live="polite">${escapeText(parts.result)}</p>`;
  const caption = parts.caption.trim()
    ? `<figcaption>${escapeText(parts.caption.trim())}</figcaption>`
    : '';
  return `<figure class="widget" data-widget="${escapeText(parts.name)}"><div class="widget-row"><svg class="widget-stage" viewBox="${escapeText(parts.viewBox)}" role="img" aria-label="${escapeText(parts.label)}">${parts.stage}</svg><div class="widget-side">${parts.controls}${result}</div></div>${caption}</figure>\n`;
}
