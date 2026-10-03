import { describe, expect, it } from 'vitest';
import {
  autoThread,
  THREAD_PRESETS,
  ThreadInputsSchema,
  threadInputs,
  threadPreset,
  threadPresetOf,
  threadRadii,
  threadSettings,
} from './thread';

const face = { kind: 'face' as const, id: 'extrude:a:side:c1' };

describe('thread inputs', () => {
  it('takes the minimal thread: one face, sized to fit', () => {
    const inputs = ThreadInputsSchema.parse(threadInputs({ faces: [face] }));
    const settings = threadSettings(inputs);
    expect(settings).toMatchObject({
      extent: 'full',
      hand: 'right',
      flip: false,
      chamfer: true,
      auto: true,
    });
  });

  it('reads every option', () => {
    const inputs = threadInputs({
      faces: [face],
      numbers: { diameter: '8 mm', pitch: '1.25 mm', length: '6 mm', tolerance: 'tolerance' },
      extent: 'length',
      hand: 'left',
      flip: true,
      chamfer: false,
    });
    expect(ThreadInputsSchema.safeParse(inputs).success).toBe(true);
    const settings = threadSettings(inputs);
    expect(settings.auto).toBe(false);
    expect([...settings.exprs].sort()).toEqual(['diameter', 'length', 'pitch', 'tolerance']);
    expect(settings).toMatchObject({ extent: 'length', hand: 'left', flip: true, chamfer: false });
  });

  it('refuses what a thread is not', () => {
    expect(() => threadInputs({ faces: [face], numbers: { depth: '1 mm' } })).toThrow(/no number/);
    expect(ThreadInputsSchema.safeParse({}).success).toBe(false);
    const edge = { kind: 'edge' as const, id: 'e[a|b]' };
    expect(ThreadInputsSchema.safeParse(threadInputs({ faces: [edge] })).success).toBe(false);
    const angle = {
      faces: { kind: 'ref', refs: [face] },
      pitch: { kind: 'expr', expr: '1 deg', unit: 'angle' },
    };
    expect(ThreadInputsSchema.safeParse(angle).success).toBe(false);
  });
});

describe('thread profile', () => {
  it('is the ISO 68-1 basic profile, moved by the tolerance into the material', () => {
    const P = 1.25;
    const H = (Math.sqrt(3) / 2) * P;
    const bolt = threadRadii(8, P, 0, false);
    expect(bolt.crest).toBeCloseTo(4, 9);
    expect(bolt.root).toBeCloseTo(4 - (5 * H) / 8, 9);
    // ISO 724: D1 = D − 1.0825 P.
    expect(2 * bolt.root).toBeCloseTo(8 - 1.082532 * P, 5);
    expect(bolt.crestHalf * 2).toBeCloseTo(P / 8, 9);
    expect(bolt.rootHalf * 2).toBeCloseTo(P / 4, 9);
    const nut = threadRadii(8, P, 0, true);
    expect(nut.root).toBeCloseTo(bolt.crest, 9);
    expect(nut.crest).toBeCloseTo(bolt.root, 9);

    const t = 0.15;
    const bolt2 = threadRadii(8, P, t, false);
    const nut2 = threadRadii(8, P, t, true);
    expect(2 * bolt2.crest).toBeCloseTo(8 - 2 * t, 9);
    expect(nut2.root - bolt2.crest).toBeCloseTo(2 * t, 9);
    expect(nut2.crest - bolt2.root).toBeCloseTo(2 * t, 9);
  });

  it('keeps the flanks 60° apart: a flat plus the flanks make up one pitch', () => {
    for (const internal of [false, true]) {
      const r = threadRadii(10, 1.5, 0.1, internal);
      const depth = Math.abs(r.root - r.crest);
      const flank = depth * Math.tan(Math.PI / 6);
      expect(2 * (r.crestHalf + r.rootHalf + flank)).toBeCloseTo(1.5, 9);
    }
  });
});

describe('thread presets', () => {
  it('has ISO coarse and fine, UNC and UNF', () => {
    expect(threadPreset('m8')).toMatchObject({ diameter: 8, pitch: 1.25, label: 'M8' });
    expect(threadPreset('m8x1')).toMatchObject({ diameter: 8, pitch: 1, label: 'M8 × 1' });
    const quarter = THREAD_PRESETS.find((p) => p.label === '1/4-20 UNC');
    expect(quarter?.diameter).toBeCloseTo(6.35, 9);
    expect(quarter?.pitch).toBeCloseTo(1.27, 9);
    expect(quarter?.exprs).toEqual({ diameter: '0.25 in', pitch: '1 in / 20' });
    expect(new Set(THREAD_PRESETS.map((p) => p.id)).size).toBe(THREAD_PRESETS.length);
    expect(THREAD_PRESETS.find((p) => p.label === 'M30')).toBeDefined();
  });

  it('finds the preset of a size', () => {
    expect(threadPresetOf(6, 1)?.id).toBe('m6');
    expect(threadPresetOf(25.4 / 4, 25.4 / 28)?.label).toBe('1/4-28 UNF');
    expect(threadPresetOf(6, 0.9)).toBeUndefined();
  });

  it('fits a coarse thread to a shaft or a tap-drill hole', () => {
    expect(autoThread(4, false)?.id).toBe('m8');
    expect(autoThread(3.5, false)?.id).toBe('m6');
    expect(autoThread(1.5, false)?.id).toBe('m3');
    expect(autoThread(0.5, false)).toBeUndefined();
    expect(autoThread(100, false)).toBeUndefined();
    // Tap drills: M8 6.8 mm, M3 2.5 mm, M6 5 mm.
    expect(autoThread(3.4, true)?.id).toBe('m8');
    expect(autoThread(1.25, true)?.id).toBe('m3');
    expect(autoThread(2.5, true)?.id).toBe('m6');
    expect(autoThread(40, true)).toBeUndefined();
  });
});
