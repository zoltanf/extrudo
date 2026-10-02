import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../shell/tools';
import { DEMO_TOOLS, demoUrl } from './demos';
import { ToolDemo } from './ToolDemo';

/** The clips on disk, by file name (their loaders are never called except for sizes). */
const files = import.meta.glob<string>('../../public/demos/*.webm', {
  query: '?url&inline',
  import: 'default',
});
const names = Object.keys(files)
  .map((path) => path.replace(/^.*\//, '').replace(/\.webm$/, ''))
  .sort();

/** The tools the plan names (P3-12): the most used ones each get a clip. */
const WANTED = [
  'sketch',
  'line',
  'rectangle',
  'circle',
  'dimension',
  'extrude',
  'revolve',
  'fillet',
  'shell',
  'hole',
  'pressPull',
  'rectangularPattern',
];

describe('tool demos', () => {
  it('lists exactly the clips on disk, each for a real tool', () => {
    expect([...DEMO_TOOLS].sort()).toEqual(names);
    for (const id of DEMO_TOOLS) expect(Object.keys(TOOLS)).toContain(id);
  });

  it('has a clip for the most used tools', () => {
    expect(WANTED.filter((id) => !DEMO_TOOLS.includes(id))).toEqual([]);
  });

  it('keeps every clip small enough for a tooltip', async () => {
    const sizes = await Promise.all(
      Object.entries(files).map(async ([path, load]) => ({
        path,
        // A `data:` URL is base64: three bytes for four characters.
        bytes: ((await load()).length * 3) / 4,
      })),
    );
    for (const { path, bytes } of sizes)
      expect({ path, ok: bytes <= 150_000 }).toEqual({ path, ok: true });
    expect(sizes.reduce((sum, s) => sum + s.bytes, 0)).toBeLessThan(2_000_000);
  });

  it('gives a URL only to tools that have a clip', () => {
    expect(demoUrl('line')).toMatch(/demos\/line\.webm$/);
    expect(demoUrl('parameters')).toBeUndefined();
  });

  it('renders a muted, looping, hidden video for a tool with a clip, and nothing otherwise', () => {
    const html = renderToStaticMarkup(createElement(ToolDemo, { tool: 'line' }));
    expect(html).toContain('<video');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/\bautoPlay\b|\bautoplay\b/i);
    expect(html).toContain('loop');
    expect(html).toContain('demos/line.webm');
    expect(renderToStaticMarkup(createElement(ToolDemo, { tool: 'parameters' }))).toBe('');
  });
});
