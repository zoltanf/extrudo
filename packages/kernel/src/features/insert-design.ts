/**
 * Insert Design in the kernel (P6-26, ADR-0140 §3): the copied design's
 * features, expanded like a Script's (`KernelFeatureDefinition.expand`) but
 * from stored JSON instead of code, and **isolated**: they see only the bodies
 * the insert itself made, so a join or cut of the copy never reaches the
 * host's bodies, and a change before the insert recomputes none of them.
 */
import { type InsertDesignInputs, insertDesignFeature, insertedFeatures } from '@extrudo/core';
import { KernelError } from '../kernel';
import type { ExpandContext, Expansion, KernelFeatureDefinition } from '../recompute/types';

export const kernelInsertDesign: KernelFeatureDefinition<InsertDesignInputs> = {
  ...insertDesignFeature,
  // It adds bodies through the features it expands to.
  bodyAccess: () => 'write',
  expand(ctx: ExpandContext<InsertDesignInputs>): Expansion {
    const features = insertedFeatures(ctx.feature, ctx.inputs.design.design);
    if (typeof features === 'string') throw new KernelError(features);
    return { features, log: [], isolated: true };
  },
  evaluate() {
    // The engine expands an insert instead (see the module comment).
    throw new Error('An inserted design is expanded, not evaluated.');
  },
};
