/** Renders a message from core, showing `backticked` names as code. */
export function Message({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]*`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of a fixed string.
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          part
        ),
      )}
    </>
  );
}
