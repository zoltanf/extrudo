/**
 * SVG markup as strings, for the docs widgets (ADR-0116 §1). The same strings are
 * written into the page by the build and set as a stage's `innerHTML` by a
 * widget's script, so a model has one way to draw, in Node and in the browser.
 * No style attribute ever: colours come from the `sk-*` classes in `docs.css`.
 */

/** Text for markup: `&`, `<`, `>` and a quote. */
export function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** An attribute value: a number is rounded to two places, so the markup stays short. */
export type Value = string | number;

function value(v: Value): string {
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : v;
}

/**
 * One element: `el('circle', { cx: 4, cy: 4, r: 2, class: 'sk-point' })`. `body` is
 * markup already (child elements); `text` is escaped. An element with neither is
 * self-closing, which inline SVG in HTML reads as an empty element.
 */
export function el(
  tag: string,
  attributes: Readonly<Record<string, Value>>,
  inner: { body?: string; text?: string } = {},
): string {
  const parts = Object.entries(attributes).map(([name, v]) => ` ${name}="${escapeText(value(v))}"`);
  const content = inner.body ?? (inner.text === undefined ? undefined : escapeText(inner.text));
  return content === undefined
    ? `<${tag}${parts.join('')}/>`
    : `<${tag}${parts.join('')}>${content}</${tag}>`;
}
