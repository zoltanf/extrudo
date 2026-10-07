import { describe, expect, it } from 'vitest';
import { renderingPlan } from './rendering';

describe('renderingPlan', () => {
  it('always allows SwiftShader and keeps the GPU by default', () => {
    expect(renderingPlan(['electron', '.'], {})).toEqual({
      switches: [{ name: 'enable-unsafe-swiftshader' }],
      disableHardwareAcceleration: false,
    });
  });

  it('turns the GPU off for --software-rendering', () => {
    expect(renderingPlan(['app', '--software-rendering'], {}).disableHardwareAcceleration).toBe(
      true,
    );
  });

  it('turns the GPU off for EXTRUDO_SOFTWARE_RENDERING=1, not 0 or empty', () => {
    expect(renderingPlan([], { EXTRUDO_SOFTWARE_RENDERING: '1' }).disableHardwareAcceleration).toBe(
      true,
    );
    expect(renderingPlan([], { EXTRUDO_SOFTWARE_RENDERING: '0' }).disableHardwareAcceleration).toBe(
      false,
    );
    expect(renderingPlan([], { EXTRUDO_SOFTWARE_RENDERING: '' }).disableHardwareAcceleration).toBe(
      false,
    );
  });
});
