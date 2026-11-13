/**
 * The name a FreeCAD import's kernel worker is started with (ADR-0144
 * decision 5). `kernelWorker.ts` starts the kernel as an import kernel, the
 * only kind that reads a file's B-rep text, when and only when its worker has
 * this name; only `importKernel.ts` spawns one so. The project's kernel
 * (`spawnKernel.ts`) is named `extrudo-kernel`. A leaf module: the worker
 * entry imports it without the rest of the app.
 */
export const IMPORT_KERNEL_WORKER_NAME = 'extrudo-import-kernel';
