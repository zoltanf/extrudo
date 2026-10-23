/**
 * Work that can wait for a quiet moment (ADR-0102): the autosave's thumbnail,
 * the picking index after a recompute.
 */

/** Runs `run` when the browser is idle (at most 2 s later); returns a cancel. */
export function whenIdle(run: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(run, { timeout: 2000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(run, 200);
  return () => clearTimeout(handle);
}
