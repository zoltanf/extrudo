import { Plane, ShaderChunk, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createDotMaterial } from './dots';

describe('createDotMaterial', () => {
  it('takes section clipping planes (P3-17): vertex dots hide on the removed side', () => {
    const { material } = createDotMaterial();
    expect(material.clipping).toBe(true);
    for (const chunk of ['clipping_planes_pars_vertex', 'clipping_planes_vertex']) {
      expect(material.vertexShader).toContain(`#include <${chunk}>`);
      expect(ShaderChunk).toHaveProperty(chunk);
    }
    for (const chunk of ['clipping_planes_pars_fragment', 'clipping_planes_fragment']) {
      expect(material.fragmentShader).toContain(`#include <${chunk}>`);
    }
    // The chunk reads the view-space position the vertex shader names `mvPosition`.
    expect(ShaderChunk.clipping_planes_vertex).toContain('mvPosition');
    expect(material.vertexShader).toContain('vec4 mvPosition');
    material.clippingPlanes = [new Plane(new Vector3(0, 0, -1), 30)];
    expect(material.clippingPlanes).toHaveLength(1);
  });
});
