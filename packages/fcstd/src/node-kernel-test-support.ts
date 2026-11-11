/**
 * Test support (no production code): an `ImportKernel` with the kernel in
 * this thread, started as an import kernel, as the CLI would make one.
 */
import { importRebuilder, KernelService, loadOcct } from '@extrudo/kernel/node';
import type { ImportKernel } from './import-kernel';

export function nodeImportKernel(): ImportKernel & {
  restarts: number;
  service: () => KernelService;
} {
  const start = () => new KernelService(() => loadOcct(), { importKernel: true });
  let service = start();
  let rebuilder = importRebuilder(service);
  const kernel = {
    restarts: 0,
    service: () => service,
    storedShapeToStep: (text: string, chain: Parameters<ImportKernel['storedShapeToStep']>[1]) =>
      service.storedShapeToStep(text, chain),
    measureStoredShape: (text: string, chain: Parameters<ImportKernel['measureStoredShape']>[1]) =>
      service.measureStoredShape(text, chain),
    rebuild: (...args: Parameters<ImportKernel['rebuild']>) => rebuilder.rebuild(...args),
    restart: async () => {
      kernel.restarts++;
      service = start();
      rebuilder = importRebuilder(service);
    },
  };
  return kernel;
}
