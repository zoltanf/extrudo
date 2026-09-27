import { FeatureRegistry } from '@extrudo/core';
import type { KernelFeatureDefinition } from '../recompute/types';
import { kernelSketch } from './sketch';

/** Every feature type the kernel can compute (architecture §4.2). */
export function kernelFeatures(): FeatureRegistry<KernelFeatureDefinition> {
  return new FeatureRegistry<KernelFeatureDefinition>().register(
    kernelSketch as unknown as KernelFeatureDefinition,
  );
}
