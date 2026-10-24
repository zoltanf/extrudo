/** The in-app renderer's finishes (ADR-0101 §6.3): the material parameters of each finish. */
import { RENDER_FINISHES } from '@extrudo/core';
import { Color, SRGBColorSpace, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { bodyColor, finishMaterial } from './finishes';

const wood = () => new Texture();

describe('finishMaterial', () => {
  it("keeps the body's colour as the base colour, grey without one", () => {
    for (const finish of RENDER_FINISHES) {
      const m = finishMaterial(finish, '#3366ff', 100, { wood });
      expect(m.color.getHexString(SRGBColorSpace)).toBe('3366ff');
    }
    expect(finishMaterial('matte', undefined, 100, { wood }).color.getHex()).toBe(
      new Color().setStyle('#cccccc', SRGBColorSpace).getHex(),
    );
    expect(bodyColor('nonsense').getHexString(SRGBColorSpace)).toBe('cccccc');
  });

  it('sets each finish like the brief', () => {
    const m = (f: (typeof RENDER_FINISHES)[number]) => finishMaterial(f, '#ffffff', 120, { wood });
    expect(m('matte')).toMatchObject({ roughness: 0.6, metalness: 0 });
    expect(m('glossy')).toMatchObject({ roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 });
    expect(m('translucent')).toMatchObject({
      transmission: 0.9,
      thickness: 12,
      ior: 1.5,
      roughness: 0.1,
    });
    expect(m('resin')).toMatchObject({ roughness: 0.3, sheen: 0.3 });
    expect(m('metal')).toMatchObject({ metalness: 1, roughness: 0.35 });
    const w = m('wood');
    expect(w.roughness).toBe(0.5);
    expect(w.map).toBeInstanceOf(Texture);
    expect(m('matte').map).toBeNull();
  });
});
