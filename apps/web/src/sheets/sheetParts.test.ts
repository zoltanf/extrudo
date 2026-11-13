import {
  type BodyId,
  createDocument,
  type DocumentId,
  type ParameterId,
  type Sheet,
  type SheetId,
  type SheetItemId,
  type SheetParts,
  type SheetViewId,
  sheetStandardFrom,
} from '@extrudo/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MATERIAL } from '../print/material';
import {
  EXPORT_UNLISTED,
  exportPartsOf,
  hasPartsLists,
  mergeParts,
  partsAskKey,
  sheetDensity,
  sheetFieldContext,
} from './sheetParts';

const V = 'v1' as SheetViewId;
const LIST = 'l1' as SheetItemId;
const LEG = 'Leg1:0' as BodyId;

function sheet(withList = true): Sheet {
  return {
    id: 's1' as SheetId,
    name: 'Frame',
    size: 'A3',
    orientation: 'landscape',
    scale: [1, 10],
    projection: 'first',
    decimals: 0,
    views: [{ id: V, name: 'Front', at: [100, 150], from: sheetStandardFrom('front') }],
    items: withList ? [{ kind: 'partsList', id: LIST, view: V, at: [300, 28] }] : [],
  };
}

const parts: SheetParts = {
  lists: { [LIST]: [LEG] },
  bodies: { [LEG]: { volume: 1750000, box: { min: [0, 0, 0], max: [50, 50, 700] } } },
};

describe('asking for the parts lists', () => {
  it('asks again only when a list, its view or the bodies change', () => {
    const s = sheet();
    const key = partsAskKey(s);
    // A text placed, the list moved or a row typed over: the same question.
    expect(
      partsAskKey({
        ...s,
        items: [
          { kind: 'partsList', id: LIST, view: V, at: [10, 10], rows: { [LEG]: { name: 'X' } } },
          { kind: 'text', id: 't1' as SheetItemId, at: [0, 0], text: 'Hi' },
        ],
      }),
    ).toBe(key);
    // Another view direction, chosen bodies: a new question.
    expect(partsAskKey({ ...s, views: [{ ...s.views[0]!, bodies: [LEG] }] })).not.toBe(key);
    expect(partsAskKey(sheet(false))).toBe('');
    expect(hasPartsLists(s)).toBe(true);
    expect(hasPartsLists(sheet(false))).toBe(false);
  });

  it("merges a list's answer over what is there", () => {
    const other = 'l2' as SheetItemId;
    expect(mergeParts(parts, { lists: { [other]: [] }, bodies: {} })).toEqual({
      lists: { [LIST]: [LEG], [other]: [] },
      bodies: parts.bodies,
    });
    expect(mergeParts(undefined, parts)).toEqual(parts);
  });

  it('the export asks the kernel again for the sheets with lists, and stops when it cannot say', async () => {
    const asked: string[] = [];
    const kernel = {
      sheetParts: async (s: Sheet) => {
        asked.push(s.id);
        return parts;
      },
    };
    const without = { ...sheet(false), id: 's2' as SheetId };
    await expect(exportPartsOf(kernel, [sheet(), without])).resolves.toEqual(parts);
    expect(asked).toEqual(['s1']);
    await expect(exportPartsOf({ sheetParts: async () => undefined }, [sheet()])).rejects.toThrow(
      EXPORT_UNLISTED,
    );
  });
});

describe('fields and mass', () => {
  const doc = {
    ...createDocument({ id: 'd' as DocumentId, name: 'Frame', now: '2026-11-11T10:00:00Z' }),
    parameters: [
      { id: 'p' as ParameterId, name: 'legs', expression: '700 mm', unit: 'length' as const },
    ],
  };

  it('fills {date} with today, {version} when known, {= expr} from the parameters', () => {
    const context = sheetFieldContext(doc, {
      today: new Date(2026, 10, 11, 23, 30),
      version: 'V3',
      density: 1.24,
    });
    expect(context.date).toBe('2026-11-11');
    expect(context.version).toBe('V3');
    expect(context.density).toBe(1.24);
    const legs = context.evaluate('legs - 50 mm');
    expect(legs.ok && legs.value).toBe(650);
    expect(sheetFieldContext(doc)).not.toHaveProperty('version');
  });

  it("takes Print Info's filament density, the preset's when its own expression fails", () => {
    expect(sheetDensity(doc, DEFAULT_MATERIAL)).toBe(1.24);
    expect(sheetDensity(doc, { ...DEFAULT_MATERIAL, material: 'custom', density: '2 * 0.5' })).toBe(
      1,
    );
    expect(
      sheetDensity(doc, { ...DEFAULT_MATERIAL, material: 'custom', density: 'gone' }),
    ).toBeUndefined();
    expect(sheetDensity(doc, { ...DEFAULT_MATERIAL, densities: { pla: 'gone' } })).toBe(1.24);
  });
});
