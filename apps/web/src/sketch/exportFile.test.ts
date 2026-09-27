import { SketchBuilder } from '@extrudo/sketch/fixtures';
import { describe, expect, it } from 'vitest';
import { sketchExport, sketchExportFile } from './exportFile';
import { sketchProfiles } from './profiles';

/** A 40 × 20 plate with a hole, a construction line across it, and a loose line. */
function sketch() {
  const b = new SketchBuilder();
  b.line(0, 0, 40, 0);
  b.line(40, 0, 40, 20);
  b.line(40, 20, 0, 20);
  b.line(0, 20, 0, 0);
  b.circle(10, 10, 4);
  b.line(0, 0, 40, 20, true);
  b.line(50, 0, 60, 0);
  return b.sketch;
}

describe('sketchExport', () => {
  it('exports the curves, with construction only when asked', () => {
    const data = sketch();
    const plain = sketchExport(data, 'Plate', { content: 'curves', construction: false });
    expect(plain.count).toBe(6);
    expect(plain.bounds).toEqual({ minX: 0, minY: 0, maxX: 60, maxY: 20 });
    expect(sketchExport(data, 'Plate', { content: 'curves', construction: true }).count).toBe(7);
  });

  it('exports every profile, or only the selected ones', () => {
    const data = sketch();
    const all = sketchExport(data, 'Plate', { content: 'profiles', construction: false });
    // The plate (with its hole) and the hole's disc; the loose line bounds nothing.
    expect(all.count).toBe(2);
    expect(all.bounds).toEqual({ minX: 0, minY: 0, maxX: 40, maxY: 20 });
    const disc = sketchProfiles(data).find((p) => p.holes.length === 0);
    const one = sketchExport(data, 'Plate', {
      content: 'selected',
      construction: false,
      selected: [disc?.id ?? ''],
    });
    expect(one.count).toBe(1);
    expect(one.bounds?.maxX).toBeCloseTo(14, 9);
  });

  it('has nothing to export in a sketch without curves or profiles', () => {
    const empty = new SketchBuilder().sketch;
    expect(sketchExport(empty, 'S', { content: 'curves', construction: true }).bounds).toBe(
      undefined,
    );
    const open = new SketchBuilder();
    open.line(0, 0, 10, 0);
    expect(sketchExport(open.sketch, 'S', { content: 'profiles', construction: false }).count).toBe(
      0,
    );
  });
});

describe('sketchExportFile', () => {
  it('writes SVG or DXF, named after the project and the sketch', async () => {
    const exported = sketchExport(sketch(), 'Plate', { content: 'curves', construction: false });
    const svg = sketchExportFile(exported, 'svg', { project: 'Bracket: v2', sketch: 'Plate' });
    expect(svg.name).toBe('Bracket v2 - Plate.svg');
    expect(svg.blob.type).toBe('image/svg+xml');
    const text = await svg.blob.text();
    expect(text).toContain('width="60mm" height="20mm"');
    expect(text).toContain('<title>Plate</title>');
    const dxf = sketchExportFile(exported, 'dxf', { project: 'Bracket', sketch: 'Plate' });
    expect(dxf.name).toBe('Bracket - Plate.dxf');
    expect(await dxf.blob.text()).toContain('AC1009');
  });
});
