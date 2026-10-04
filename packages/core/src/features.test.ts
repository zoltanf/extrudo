import { describe, expect, it } from 'vitest';
import { type FeatureDefinition, FeatureRegistry, nextFeatureName } from './features';
import { BoolInputSchema, ExprInputSchema, RefInputSchema } from './schema';
import { feature, sampleDocument } from './testing';
import { z } from './zod';

const extrude = {
  type: 'extrude',
  label: 'Extrude',
  category: 'create',
  icon: 'extrude',
  inputsSchema: z.strictObject({
    distance: ExprInputSchema,
    profile: RefInputSchema.optional(),
    flip: BoolInputSchema.optional(),
  }),
} satisfies FeatureDefinition;

describe('FeatureRegistry', () => {
  it('registers, finds and lists definitions', () => {
    const registry = new FeatureRegistry().register(extrude);
    expect(registry.get('extrude')).toBe(extrude);
    expect(registry.get('loft')).toBeUndefined();
    expect(registry.list()).toEqual([extrude]);
    expect(() => registry.register(extrude)).toThrow(
      'Feature type "extrude" is already registered.',
    );
  });

  it('can hold extended definitions (kernel evaluators, UI dialogs)', () => {
    interface KernelDefinition extends FeatureDefinition {
      evaluate(): string;
    }
    const registry = new FeatureRegistry<KernelDefinition>().register({
      ...extrude,
      evaluate: () => 'solid',
    });
    expect(registry.get('extrude')?.evaluate()).toBe('solid');
  });

  it('reports unknown feature types and invalid inputs', () => {
    const registry = new FeatureRegistry().register(extrude);
    const [sketch, base, fillet] = sampleDocument().features;
    const noDistance = { ...feature('f9'), inputs: {} };
    const features = [sketch, base, noDistance, fillet].filter((f) => f !== undefined);
    expect(registry.check({ ...sampleDocument(), features, timelineMarker: 4 })).toEqual([
      { featureId: 'f1', message: 'Unknown feature type "sketch".' },
      { featureId: 'f9', message: expect.stringMatching(/^distance: /) },
      { featureId: 'f3', message: 'Unknown feature type "fillet".' },
    ]);
  });
});

describe('nextFeatureName', () => {
  it('numbers default names after the highest existing one', () => {
    const doc = sampleDocument();
    expect(nextFeatureName(doc, 'Extrude')).toBe('Extrude2');
    expect(nextFeatureName(doc, 'Revolve')).toBe('Revolve1');
    const renamed = {
      ...doc,
      features: [feature('a', 'extrude', 'Extrude7'), feature('b', 'extrude', 'Extrude 3')],
    };
    expect(nextFeatureName(renamed, 'Extrude')).toBe('Extrude8');
  });

  it('treats the label literally', () => {
    const doc = { ...sampleDocument(), features: [feature('a', 'x', 'C++4')] };
    expect(nextFeatureName(doc, 'C++')).toBe('C++5');
  });
});
