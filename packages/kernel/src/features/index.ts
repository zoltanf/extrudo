import { FeatureRegistry } from '@extrudo/core';
import type { KernelFeatureDefinition } from '../recompute/types';
import { kernelRemove } from './bodies';
import { kernelChamfer } from './chamfer';
import { kernelCombine } from './combine';
import { KERNEL_CONSTRUCTION } from './construction';
import { kernelExtrude } from './extrude';
import { kernelFillet } from './fillet';
import { kernelCircularPattern, kernelPathPattern, kernelRectangularPattern } from './pattern';
import { kernelPlaceOnBed } from './place-on-bed';
import { KERNEL_PRIMITIVES } from './primitives';
import { kernelRevolve } from './revolve';
import { kernelShell } from './shell';
import { kernelSketch } from './sketch';
import { kernelMirror, kernelMove } from './transform';

/** Every feature type the kernel can compute (architecture §4.2). */
export function kernelFeatures(): FeatureRegistry<KernelFeatureDefinition> {
  const registry = new FeatureRegistry<KernelFeatureDefinition>()
    .register(kernelSketch as unknown as KernelFeatureDefinition)
    .register(kernelExtrude as unknown as KernelFeatureDefinition)
    .register(kernelRevolve as unknown as KernelFeatureDefinition)
    .register(kernelRemove as unknown as KernelFeatureDefinition)
    .register(kernelFillet as unknown as KernelFeatureDefinition)
    .register(kernelChamfer as unknown as KernelFeatureDefinition)
    .register(kernelShell as unknown as KernelFeatureDefinition);
  // Box, cylinder, sphere and torus (P2-10, ADR-0032).
  for (const primitive of KERNEL_PRIMITIVES) {
    registry.register(primitive as unknown as KernelFeatureDefinition);
  }
  // Construction planes, axes and points (P3-05, ADR-0040).
  for (const construction of KERNEL_CONSTRUCTION) {
    registry.register(construction as unknown as KernelFeatureDefinition);
  }
  // Combine, Move/Copy and Mirror (P3-06, ADR-0044).
  registry
    .register(kernelCombine as unknown as KernelFeatureDefinition)
    .register(kernelMove as unknown as KernelFeatureDefinition)
    .register(kernelMirror as unknown as KernelFeatureDefinition);
  // Place on Bed (P3-10, ADR-0048).
  registry.register(kernelPlaceOnBed as unknown as KernelFeatureDefinition);
  // Rectangular, circular and path patterns (P3-07, ADR-0047).
  registry
    .register(kernelRectangularPattern as unknown as KernelFeatureDefinition)
    .register(kernelCircularPattern as unknown as KernelFeatureDefinition)
    .register(kernelPathPattern as unknown as KernelFeatureDefinition);
  return registry;
}
