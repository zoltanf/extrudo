import { FeatureRegistry } from '@extrudo/core';
import type { KernelFeatureDefinition } from '../recompute/types';
import { kernelRemove } from './bodies';
import { KERNEL_CONSTRUCTION } from './construction';
import { kernelExtrude } from './extrude';
import { kernelFillet } from './fillet';
import { KERNEL_PRIMITIVES } from './primitives';
import { kernelRevolve } from './revolve';
import { kernelSketch } from './sketch';

/** Every feature type the kernel can compute (architecture §4.2). */
export function kernelFeatures(): FeatureRegistry<KernelFeatureDefinition> {
  const registry = new FeatureRegistry<KernelFeatureDefinition>()
    .register(kernelSketch as unknown as KernelFeatureDefinition)
    .register(kernelExtrude as unknown as KernelFeatureDefinition)
    .register(kernelRevolve as unknown as KernelFeatureDefinition)
    .register(kernelRemove as unknown as KernelFeatureDefinition)
    .register(kernelFillet as unknown as KernelFeatureDefinition);
  // Box, cylinder, sphere and torus (P2-10, ADR-0032).
  for (const primitive of KERNEL_PRIMITIVES) {
    registry.register(primitive as unknown as KernelFeatureDefinition);
  }
  // Construction planes, axes and points (P3-05, ADR-0040).
  for (const construction of KERNEL_CONSTRUCTION) {
    registry.register(construction as unknown as KernelFeatureDefinition);
  }
  return registry;
}
