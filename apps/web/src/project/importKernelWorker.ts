// The FreeCAD import's own kernel worker (P6-25 S3, ADR-0144 decision 5): the
// kernel started as an import kernel, the only kind that reads a file's B-rep
// text. The FreeCAD import's worker (`fcstdWorker.ts`) starts it, throws it
// away after a failure, and goes with it when the import ends. No script
// runner: nothing here computes a design.
import { serveKernel } from '@extrudo/kernel/worker';

serveKernel({ importKernel: true });
