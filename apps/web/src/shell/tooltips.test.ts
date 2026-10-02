import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYMAP, keysFor } from '../commands/keymap';
import { shortcutLabel } from '../commands/shortcuts';
import { TABS, TOOLS } from './tools';

// FR-UX-04 (P3-12): every tool's tooltip says its name, its key and one sentence.
describe('tool tooltips', () => {
  const tools = Object.values(TOOLS);

  it.each(tools.map((t) => [t.id, t] as const))('%s has a name and one sentence', (_, tool) => {
    expect(tool.label.trim().length).toBeGreaterThan(1);
    expect(tool.hint.trim()).toMatch(/^[A-Z0-9].{8,}[.!]$/);
    // Tooltips are one sentence for the tile, not a paragraph.
    expect(tool.hint.length).toBeLessThan(160);
  });

  it('shows a key for every tool the keymap gives one', () => {
    for (const tool of tools) {
      const keys = keysFor(tool.id)[0];
      if (!keys) continue;
      expect(shortcutLabel(keys).length, tool.id).toBeGreaterThan(0);
    }
    const keyed = tools.filter((t) => t.id in DEFAULT_KEYMAP);
    expect(keyed.length).toBeGreaterThan(15);
  });

  it('has every tool on the toolbar a catalogue entry', () => {
    const ids = TABS.flatMap((t) => t.groups.flatMap((g) => [...g.tools, ...(g.more ?? [])]));
    for (const id of ids) expect(TOOLS[id], id).toBeDefined();
  });
});
