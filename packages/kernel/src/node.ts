/**
 * @extrudo/kernel/node: runs the kernel in the current thread (Node tests,
 * the future CLI). Loads OCCT, so don't import it on the UI thread.
 */

export { kernelFeatures } from './features';
export { type LoadOptions, loadOcct } from './occt/load';
export { type OcctObject, OcctScope } from './occt/scope';
export type { FacadeBinding, OcctModule } from './occt/types';
export { DEFAULT_TESSELLATION, type EngineOptions, RecomputeEngine } from './recompute/engine';
export { KernelService, type KernelServiceOptions } from './service';
export { buildTestPart, makeTestPart, TEST_PART_MESH } from './test-part';
