/**
 * Numbers in text formats: fixed decimals (4 by default: 0.1 µm in mm),
 * trailing zeros dropped, and no "-0". The same input always writes the
 * same text, so exported files diff cleanly and golden tests are stable.
 */
export function num(value: number, decimals = 4): string {
  const text = value.toFixed(decimals);
  const trimmed = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  return trimmed === '-0' ? '0' : trimmed;
}

/** Escapes text for XML content and attribute values. */
export function xmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
