/**
 * @extrudo/kernel/node: runs the kernel in the current thread (Node tests,
 * the future CLI). Loads OCCT, so don't import it on the UI thread.
 */
export { type LoadOptions, loadOcct } from './occt/load';
export { type OcctObject, OcctScope } from './occt/scope';
export type { FacadeBinding, OcctModule } from './occt/types';
export { KernelService } from './service';
export { buildTestPart, makeTestPart, TEST_PART_MESH } from './test-part';
