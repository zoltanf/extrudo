import { FeatureRegistry } from '@extrudo/core';
import type { KernelFeatureDefinition } from '../recompute/types';
import { kernelRemove } from './bodies';
import { kernelCanvas } from './canvas';
import { kernelChamfer } from './chamfer';
import { kernelCoil } from './coil';
import { kernelCombine } from './combine';
import { KERNEL_CONSTRUCTION } from './construction';
import { kernelDraft } from './draft';
import { kernelEmboss } from './emboss';
import { kernelExtrude } from './extrude';
import { kernelFillet } from './fillet';
import { kernelHole } from './hole';
import { kernelImport } from './import';
import { kernelLoft } from './loft';
import { kernelOffsetFace } from './offset-face';
import { kernelCircularPattern, kernelPathPattern, kernelRectangularPattern } from './pattern';
import { kernelPlaceOnBed } from './place-on-bed';
import { kernelPlugin } from './plugin';
import { KERNEL_PRIMITIVES } from './primitives';
import { kernelRevolve } from './revolve';
import { kernelRib } from './rib';
import { kernelScale } from './scale';
import { kernelScript } from './script';
import { kernelShell } from './shell';
import { kernelSketch } from './sketch';
import { kernelSplitBody } from './split-body';
import { kernelSweep } from './sweep';
import { kernelThread } from './thread';
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
  // Hole (P3-04, ADR-0049).
  registry.register(kernelHole as unknown as KernelFeatureDefinition);
  // Offset Face (P3-08, ADR-0051).
  registry.register(kernelOffsetFace as unknown as KernelFeatureDefinition);
  // Split Body, Scale and Draft (P3-08, second half).
  registry
    .register(kernelSplitBody as unknown as KernelFeatureDefinition)
    .register(kernelScale as unknown as KernelFeatureDefinition)
    .register(kernelDraft as unknown as KernelFeatureDefinition);
  // Sweep, loft and coil (P4-01, ADR-0055).
  registry
    .register(kernelSweep as unknown as KernelFeatureDefinition)
    .register(kernelLoft as unknown as KernelFeatureDefinition)
    .register(kernelCoil as unknown as KernelFeatureDefinition);
  // Thread (P4-02, ADR-0056).
  registry.register(kernelThread as unknown as KernelFeatureDefinition);
  // Emboss and deboss (P4-04, ADR-0060; flat faces for now).
  registry.register(kernelEmboss as unknown as KernelFeatureDefinition);
  // Rib (P4-10, ADR-0064 §1).
  registry.register(kernelRib as unknown as KernelFeatureDefinition);
  // Import: a STEP file as bodies (P4-06, ADR-0066 §2).
  registry.register(kernelImport as unknown as KernelFeatureDefinition);
  // Canvas: a reference image on a plane, drawn by the view (P4-06, ADR-0066 §5).
  registry.register(kernelCanvas as unknown as KernelFeatureDefinition);
  // Script: code that makes features, run by an injected runner (P5-02, ADR-0070).
  registry.register(kernelScript as unknown as KernelFeatureDefinition);
  // A plugin's custom feature (P6-03, ADR-0077 §3), expanded like a Script.
  registry.register(kernelPlugin as unknown as KernelFeatureDefinition);
  return registry;
}
