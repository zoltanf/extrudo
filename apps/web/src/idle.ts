/**
 * Work that can wait for a quiet moment (ADR-0102): the autosave's thumbnail,
 * the picking index after a recompute, the WebGL probe.
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

/** Runs `run` in a task of its own right after the next paint; returns a cancel. */
export function afterPaint(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(run, 0);
  });
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}
