/**
 * How long a render has left, from how fast its bar has moved since the
 * rendering phase began (either engine: both report `fraction` 0–1). The
 * average over the whole phase, not the last step: the path tracer's first
 * frames are slow while it sizes its tiles, and a last-step rate jumps.
 */

/** Where the rendering phase started: the time (ms) and the bar's fraction then. */
export interface EtaStart {
  at: number;
  fraction: number;
}

/** No estimate before this many ms of rendering, or before the bar moved this much. */
const MIN_MS = 3000;
const MIN_PROGRESS = 0.02;

/** Seconds left, or undefined while there is too little to go on (pure). */
export function remainingSeconds(
  start: EtaStart,
  now: number,
  fraction: number,
): number | undefined {
  const elapsed = now - start.at;
  const moved = fraction - start.fraction;
  if (elapsed < MIN_MS || moved < MIN_PROGRESS) return undefined;
  return ((elapsed / moved) * Math.max(0, 1 - fraction)) / 1000;
}

/** "about 40 s left", "about 3 min left", "about 1 h 10 min left" (pure). */
export function etaText(seconds: number): string {
  if (seconds < 10) return 'a few seconds left';
  if (seconds < 55) return `about ${Math.round(seconds / 5) * 5} s left`;
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `about ${hours} h left` : `about ${hours} h ${rest} min left`;
}
