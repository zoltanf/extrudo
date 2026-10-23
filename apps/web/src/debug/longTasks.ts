/**
 * Development-only long-task observer (P6-13, ADR-0100 §2): every main-thread
 * task over 50 ms is logged with the current route and counted in the viewport
 * store, whose count the status bar's render meter shows next to the frame
 * time. Started only in dev builds (`import.meta.env.DEV`), so nothing of it
 * lands in the production bundle.
 */
import type { ViewportStore } from '../viewport/store';

/** The line a task has to cross to count (NFR-01's interactive budget). */
const THRESHOLD_MS = 50;

export function startLongTaskObserver(viewport: ViewportStore): () => void {
  if (typeof PerformanceObserver === 'undefined') return () => {};
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return () => {};
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.duration <= THRESHOLD_MS) continue;
      console.warn('[perf] long task', Math.round(entry.duration), 'ms at', location.hash);
      viewport.getState().noteLongTask();
    }
  });
  observer.observe({ type: 'longtask', buffered: true });
  return () => observer.disconnect();
}
