/**
 * Test support (no production code): an `ImportKernel` with the kernel in
 * this thread, started as an import kernel, as the CLI would make one.
 */
import { KernelService, loadOcct } from '@extrudo/kernel/node';
import type { ImportKernel } from './import-kernel';

export function nodeImportKernel(): ImportKernel & { restarts: number } {
  const start = () => new KernelService(() => loadOcct(), { importKernel: true });
  let service = start();
  const kernel = {
    restarts: 0,
    storedShapeToStep: (text: string, chain: Parameters<ImportKernel['storedShapeToStep']>[1]) =>
      service.storedShapeToStep(text, chain),
    restart: async () => {
      kernel.restarts++;
      service = start();
    },
  };
  return kernel;
}
