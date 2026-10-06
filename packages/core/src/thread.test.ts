import { describe, expect, it } from 'vitest';
import {
  autoThread,
  THREAD_PRESETS,
  THREAD_PROFILE_NAMES,
  ThreadInputsSchema,
  threadInputs,
  threadPreset,
  threadPresetOf,
  threadProfile,
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
    const bolt = threadRadii('iso', 8, P, 0, false);
    expect(bolt.crest).toBeCloseTo(4, 9);
    expect(bolt.root).toBeCloseTo(4 - (5 * H) / 8, 9);
    // ISO 724: D1 = D − 1.0825 P.
    expect(2 * bolt.root).toBeCloseTo(8 - 1.082532 * P, 5);
    expect(bolt.crestHalf * 2).toBeCloseTo(P / 8, 9);
    expect(bolt.rootHalf * 2).toBeCloseTo(P / 4, 9);
    const nut = threadRadii('iso', 8, P, 0, true);
    expect(nut.root).toBeCloseTo(bolt.crest, 9);
    expect(nut.crest).toBeCloseTo(bolt.root, 9);

    const t = 0.15;
    const bolt2 = threadRadii('iso', 8, P, t, false);
    const nut2 = threadRadii('iso', 8, P, t, true);
    expect(2 * bolt2.crest).toBeCloseTo(8 - 2 * t, 9);
    expect(nut2.root - bolt2.crest).toBeCloseTo(2 * t, 9);
    expect(nut2.crest - bolt2.root).toBeCloseTo(2 * t, 9);
  });

  it('keeps the flanks 60° apart: a flat plus the flanks make up one pitch', () => {
    for (const internal of [false, true]) {
      const r = threadRadii('iso', 10, 1.5, 0.1, internal);
      const depth = Math.abs(r.root - r.crest);
      const flank = depth * Math.tan(Math.PI / 6);
      expect(2 * (r.crestHalf + r.rootHalf + flank)).toBeCloseTo(1.5, 9);
    }
  });
});

describe('thread profiles', () => {
  const P = 2;
  const stated: Record<string, number> = {
    iso: (5 * Math.sqrt(3) * P) / 16,
    trapezoidal: 0.5 * P,
    buttress: 0.75 * P,
    bottle: 0.45 * P,
  };
  const flanks: Record<string, [number, number]> = {
    iso: [30, 30],
    trapezoidal: [15, 15],
    buttress: [30, 3],
    bottle: [20, 20],
  };

  /** The outline's vertices, in order, from each segment's `to` (the loop is closed). */
  const vertices = (profile: (typeof THREAD_PROFILE_NAMES)[number], internal = false) => {
    const shape = threadProfile(profile, P, { internal });
    const last = shape.segments[shape.segments.length - 1];
    const points = [last?.to as [number, number]];
    for (const segment of shape.segments) points.push(segment.to as [number, number]);
    return { shape, points: points.slice(0, shape.segments.length) };
  };

  it('draws every profile closed, within one pitch and at its stated depth', () => {
    for (const profile of THREAD_PROFILE_NAMES) {
      for (const internal of [false, true]) {
        const { shape, points } = vertices(profile, internal);
        expect(shape.depth, profile).toBeCloseTo(stated[profile] as number, 9);
        // Every segment is finite and the outline closes on itself.
        for (const [a, r] of points) {
          expect(Number.isFinite(a) && Number.isFinite(r), profile).toBe(true);
        }
        // The crest is at radial 0 and the tooth never reaches past its foot.
        const radial = points.map((p) => p[1]);
        const axial = points.map((p) => p[0]);
        expect(Math.min(...radial), profile).toBeCloseTo(0, 9);
        expect(Math.max(...radial), profile).toBeLessThanOrEqual(shape.depth + 0.31 * P);
        // The whole tooth lies within one pitch, so neighbouring turns clear.
        expect(Math.max(...axial) - Math.min(...axial), profile).toBeLessThan(P);
      }
    }
  });

  it('keeps the flanks at the profile’s angles to the radial', () => {
    for (const profile of THREAD_PROFILE_NAMES) {
      const { shape } = vertices(profile);
      const [want0, want1] = flanks[profile] as [number, number];
      const segments = shape.segments;
      const start = (i: number) =>
        (i === 0 ? segments[segments.length - 1] : segments[i - 1])!.to as [number, number];
      const at = (source: string) => {
        const i = segments.findIndex((s) => s.source === source && s.kind === 'line');
        if (i < 0) throw new Error(`${profile} has no ${source}`);
        const to = segments[i]!.to as [number, number];
        const from = start(i);
        return (Math.atan2(Math.abs(to[0] - from[0]), Math.abs(from[1] - to[1])) * 180) / Math.PI;
      };
      expect(at('flank0'), `${profile} flank0`).toBeCloseTo(want0, 6);
      expect(at('flank1'), `${profile} flank1`).toBeCloseTo(want1, 6);
    }
  });

  it('has arcs only where a rounded profile asks for them', () => {
    for (const profile of THREAD_PROFILE_NAMES) {
      const arcs = threadProfile(profile, P).segments.filter((s) => s.kind === 'arc');
      expect(arcs.length, profile).toBe(profile === 'bottle' ? 4 : 0);
    }
  });

  it('reproduces the ISO 68-1 tooth bit for bit', () => {
    for (const [diameter, pitch] of [
      [6, 1],
      [20, 2.5],
      [64, 6],
    ] as const) {
      for (const internal of [false, true]) {
        const r = threadRadii('iso', diameter, pitch, 0, internal);
        const shape = threadProfile('iso', pitch, { internal });
        expect(shape.depth).toBeCloseTo(Math.abs(r.root - r.crest), 12);
        expect(shape.crestHalf).toBeCloseTo(r.crestHalf, 12);
        expect(shape.rootHalf).toBeCloseTo(r.rootHalf, 12);
        const seg = (source: string) => {
          const s = shape.segments.find((x) => x.source === source);
          if (!s) throw new Error(`no ${source}`);
          return s;
        };
        // The crest flat and the flank's 30° hold at the old numbers.
        expect((seg('flank0').to as [number, number])[1]).toBeCloseTo(0, 12);
        expect((seg('crest').to as [number, number])[0]).toBeCloseTo(r.crestHalf, 12);
      }
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

  it('has Trapezoidal and Bottle presets (P4-12)', () => {
    const tr = THREAD_PRESETS.filter((p) => p.group === 'trapezoidal');
    expect(tr.map((p) => p.id)).toEqual(['tr8x1.5', 'tr10x2', 'tr12x3', 'tr16x4', 'tr20x4']);
    expect(tr.every((p) => p.profile === 'trapezoidal')).toBe(true);
    expect(threadPreset('tr20x4')).toMatchObject({ diameter: 20, pitch: 4, label: 'Tr 20 × 4' });
    const bottle = THREAD_PRESETS.find((p) => p.group === 'bottle');
    expect(bottle).toMatchObject({
      id: 'pco-1881',
      profile: 'bottle',
      diameter: 27.43,
      pitch: 2.7,
    });
  });

  it('finds the preset of a size', () => {
    expect(threadPresetOf(6, 1)?.id).toBe('m6');
    expect(threadPresetOf(25.4 / 4, 25.4 / 28)?.label).toBe('1/4-28 UNF');
    expect(threadPresetOf(6, 0.9)).toBeUndefined();
    // The profile matters: 20 × 4 is the trapezoidal size, not an ISO one.
    expect(threadPresetOf(20, 4, 'trapezoidal')?.id).toBe('tr20x4');
    expect(threadPresetOf(20, 4, 'iso')).toBeUndefined();
    expect(threadPresetOf(27.43, 2.7, 'bottle')?.id).toBe('pco-1881');
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
    expect(autoThread(100, true)).toBeUndefined();
  });

  it('fits the coarse series past M30 (P4-11)', () => {
    // A bore takes the thread just above it: Ø36 takes M39, Ø40 M42, Ø50 M56
    // (its minor diameter is 50.05 mm, just inside the 0.1 mm of slack).
    expect(autoThread(18, true)?.id).toBe('m39');
    expect(autoThread(20, true)?.id).toBe('m42');
    expect(autoThread(25, true)?.id).toBe('m56');
    // A shaft takes the largest thread inside it, so Ø36 takes M36 and Ø40 M39
    // (nearly a fit; a much thicker shaft is turned down, and warned about).
    expect(autoThread(18, false)?.id).toBe('m36');
    expect(autoThread(20, false)?.id).toBe('m39');
    // The sizes and their pitches, and every preset's radii.
    expect(threadRadii('iso', 36, 4, 0, false).crest).toBeCloseTo(18, 9);
    expect(threadRadii('iso', 64, 6, 0, false).root).toBeCloseTo(
      32 - (5 / 8) * (Math.sqrt(3) / 2) * 6,
      9,
    );
    for (const size of [33, 36, 39, 42, 45, 48, 52, 56, 60, 64]) {
      const preset = threadPreset(`m${size}`);
      expect(preset, `M${size}`).toBeDefined();
      expect(preset?.group).toBe('metric');
    }
  });

  it('keeps the presets ordered by size', () => {
    const coarse = THREAD_PRESETS.filter((p) => p.group === 'metric');
    expect(coarse.map((p) => p.diameter)).toEqual(
      [...coarse.map((p) => p.diameter)].sort((a, b) => a - b),
    );
    // ISO 261's coarse pitches, smallest to largest.
    expect(coarse.map((p) => [p.diameter, p.pitch])).toEqual([
      [2, 0.4],
      [2.5, 0.45],
      [3, 0.5],
      [4, 0.7],
      [5, 0.8],
      [6, 1],
      [8, 1.25],
      [10, 1.5],
      [12, 1.75],
      [14, 2],
      [16, 2],
      [20, 2.5],
      [24, 3],
      [30, 3.5],
      [33, 3.5],
      [36, 4],
      [39, 4],
      [42, 4.5],
      [45, 4.5],
      [48, 5],
      [52, 5],
      [56, 5.5],
      [60, 5.5],
      [64, 6],
    ]);
    // And the fine sizes and inch threads follow without overlapping names.
    const fine = THREAD_PRESETS.filter((p) => p.group === 'metric-fine');
    expect(fine.every((p) => p.diameter <= 30)).toBe(true);
  });
});
