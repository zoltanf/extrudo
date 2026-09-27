import { describe, expect, it } from 'vitest';
import { fuzzyMatch, searchCommands } from './search';

const labels = (results: { item: { label: string } }[]) => results.map((r) => r.item.label);

const COMMANDS = [
  { id: 'line', label: 'Line', keywords: 'Sketch Create Lines from point to point.' },
  { id: 'rectangle', label: '2-Point Rectangle', keywords: 'Sketch Create' },
  { id: 'rectangle3', label: '3-Point Rectangle', keywords: 'Sketch Create' },
  { id: 'polygon', label: 'Inscribed Polygon', keywords: 'Sketch Create' },
  { id: 'circle', label: 'Center Diameter Circle', keywords: 'Sketch Create' },
  { id: 'concentric', label: 'Concentric', keywords: 'Sketch Constraints' },
  { id: 'coincident', label: 'Coincident', keywords: 'Sketch Constraints' },
  {
    id: 'sketchFillet',
    label: 'Sketch Fillet',
    keywords: 'Sketch Modify Round the corner between two lines.',
  },
  { id: 'extrude', label: 'Extrude', keywords: 'Solid Create', unavailable: 'P2-06' },
  { id: 'exportSketch', label: 'Export Sketch', keywords: 'Sketch Export' },
  { id: 'fit', label: 'Fit', keywords: 'View' },
];

describe('fuzzyMatch', () => {
  it('matches letters in order, anywhere', () => {
    expect(fuzzyMatch('ln', 'Line')?.positions).toEqual([0, 2]);
    expect(fuzzyMatch('nl', 'Line')).toBeUndefined();
    expect(fuzzyMatch('lines', 'Line')).toBeUndefined();
  });

  it('prefers word starts over letters inside words', () => {
    // "pr" could be "P…r" inside "Point" or the P of Point and R of Rectangle.
    expect(fuzzyMatch('pr', '3-Point Rectangle')?.positions).toEqual([2, 8]);
    expect(fuzzyMatch('cdc', 'Center Diameter Circle')?.positions).toEqual([0, 7, 16]);
  });

  it('prefers a run of letters', () => {
    expect(fuzzyMatch('rect', '3-Point Rectangle')?.positions).toEqual([8, 9, 10, 11]);
  });

  it('ignores case and separators in the query', () => {
    expect(fuzzyMatch('3 POINT-rect', '3-Point Rectangle')).toBeDefined();
    expect(fuzzyMatch('', 'Line')).toEqual({ score: 0, positions: [] });
  });

  it('counts camel-case and digit steps as word starts', () => {
    expect(fuzzyMatch('sf', 'sketchFillet')?.positions).toEqual([0, 6]);
    expect(fuzzyMatch('3p', 'Shift3Point')?.positions).toEqual([5, 6]);
  });
});

describe('searchCommands', () => {
  it('lists everything, in order, for an empty query', () => {
    expect(searchCommands(COMMANDS, '  ')).toHaveLength(COMMANDS.length);
    expect(searchCommands(COMMANDS, '')[0]?.item.id).toBe('line');
  });

  it('ranks prefixes and word starts first', () => {
    expect(labels(searchCommands(COMMANDS, 'rect'))).toEqual([
      '2-Point Rectangle',
      '3-Point Rectangle',
    ]);
    expect(labels(searchCommands(COMMANDS, '3pr'))[0]).toBe('3-Point Rectangle');
    expect(labels(searchCommands(COMMANDS, 'con'))[0]).toBe('Concentric');
    expect(labels(searchCommands(COMMANDS, 'circ'))[0]).toBe('Center Diameter Circle');
  });

  it('finds commands by the words of their group and hint', () => {
    expect(labels(searchCommands(COMMANDS, 'constraints'))).toEqual(['Concentric', 'Coincident']);
    expect(labels(searchCommands(COMMANDS, 'round'))).toEqual(['Sketch Fillet']);
    // Short words don't search the hints: "to" would find half the catalogue.
    expect(labels(searchCommands(COMMANDS, 'to'))).toEqual([]);
  });

  it('puts label matches before word matches', () => {
    const results = labels(searchCommands(COMMANDS, 'sketch'));
    expect(results.slice(0, 2)).toEqual(['Sketch Fillet', 'Export Sketch']);
    expect(results).toContain('Line');
  });

  it('ranks unavailable commands after available ones that match as well', () => {
    expect(labels(searchCommands(COMMANDS, 'ex'))).toEqual(['Export Sketch', 'Extrude']);
  });

  it('nudges recent commands up among equals', () => {
    expect(labels(searchCommands(COMMANDS, 'rect', ['rectangle3']))[0]).toBe('3-Point Rectangle');
  });

  it('returns the matched positions for highlighting', () => {
    expect(searchCommands(COMMANDS, 'fit')[0]).toMatchObject({
      item: { id: 'fit' },
      positions: [0, 1, 2],
    });
  });
});
