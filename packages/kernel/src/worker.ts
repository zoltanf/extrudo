// Kernel Web Worker entry. Spawned by spawnBrowserKernel() (browser.ts): the
// kernel without a script runner (the app's projects start their own entry,
// which adds one: `serveKernel` in worker-entry.ts).
import { serveKernel } from './worker-entry';

serveKernel();
