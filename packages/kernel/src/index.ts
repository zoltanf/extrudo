/**
 * @extrudo/kernel: the OCCT geometry kernel (architecture §5, ADR-0001).
 *
 * This entry is safe to import on the UI thread: it doesn't load OCCT. The
 * kernel itself runs in a worker (spawnBrowserKernel) or, in Node, through
 * `@extrudo/kernel/node`.
 */
export { spawnBrowserKernel } from './browser';
export {
  KernelClient,
  type KernelClientOptions,
  type KernelConnection,
  type KernelStatus,
  type SpawnKernel,
} from './client';
export {
  decodeHistory,
  type HistoryRecord,
  type HistoryRelation,
  SUB_SHAPE_KINDS,
  type SubShapeKind,
  type SubShapeRef,
} from './history';
export {
  Kernel,
  KernelError,
  type KernelStats,
  type OperationResult,
  type ShapeHandle,
  ShapeScope,
  type Vec3,
} from './kernel';
export { type BodyMesh, type Measurements, type MeshOptions, meshBuffers } from './mesh';
export {
  isKernelCrash,
  type KernelApi,
  KernelCrashError,
  type KernelInfo,
} from './service';
export { TEST_PART, type TestPart } from './test-part';
