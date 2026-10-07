// The Plugins dialog's list (P6-03 slice 2), rendered without stores.
import { readPluginFile } from '@extrudo/storage';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../design-system';
import { PluginsList, type PluginsListProps } from './PluginsDialog';
import type { DesignPlugin, PluginEntry } from './plugins';
import { pluginBytes } from './testing';

const entry = (enabled = true): PluginEntry => ({
  plugin: {
    id: 'tiny',
    name: 'Tiny',
    version: '1.0.0',
    enabled,
    installedAt: '2026-10-07T00:00:00.000Z',
    sha256: '0'.repeat(64),
  },
  file: readPluginFile(pluginBytes()),
});

const markup = (over: Partial<PluginsListProps> = {}) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <PluginsList
        installed={[entry()]}
        inDesign={[]}
        status=""
        refused={false}
        busy={false}
        onInstall={vi.fn()}
        onInstallFromDesign={vi.fn()}
        onEnabled={vi.fn()}
        onRemove={vi.fn()}
        {...over}
      />
    </TooltipProvider>,
  );

describe('the Plugins dialog', () => {
  it('lists a plugin with its version, description, Enabled and Remove', () => {
    const html = markup();
    expect(html).toContain('aria-label="Installed plugins"');
    expect(html).toContain('data-plugin="tiny"');
    expect(html).toContain('Makes small things.');
    const box = /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? '';
    expect(box).toContain('aria-label="Enabled: Tiny"');
    expect(box).toContain('checked=""');
    expect(html).toContain('aria-label="Remove Tiny"');
    expect(html).toContain(' Install…</button>');
  });

  it('shows the README as plain text, the commands, the features and the license', () => {
    const html = markup();
    expect(html).toContain('aria-label="README of Tiny"');
    // Escaped, never rendered: a plugin brings no HTML.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; stays text.');
    expect(html).not.toContain('<script>');
    expect(html).toContain('data-plugin-command="box"');
    expect(html).toContain('Small box<span class="text-muted"> — A 1 mm cube</span>');
    expect(html).toContain('data-plugin-feature="peg"');
    expect(html).toContain('aria-label="License of Tiny"');
  });

  it('shows a disabled plugin unchecked, and an empty list in words', () => {
    expect(markup({ installed: [entry(false)] })).not.toMatch(/checked=""/);
    expect(markup({ installed: [] })).toContain('No plugins yet.');
    expect(markup({ installed: undefined })).toContain('Loading…');
  });

  it('says a refusal in the status line', () => {
    const html = markup({ status: 'Tiny 1.0.0 is already installed…', refused: true });
    expect(html).toMatch(/role="status" aria-label="Plugins status" data-refused=""/);
    expect(html).toContain('Tiny 1.0.0 is already installed…');
  });

  it("offers a design's plugin that isn't installed", () => {
    const file = readPluginFile(pluginBytes('2.0.0', { id: 'other', name: 'Other' }));
    const plugin: DesignPlugin = {
      attachment: 'x' as DesignPlugin['attachment'],
      manifest: file.manifest,
      bytes: new Uint8Array(),
    };
    const html = markup({ inDesign: [plugin] });
    expect(html).toContain('data-design-plugin="other"');
    expect(html).toContain('In this design, not installed');
    expect(html).toContain('aria-label="Install Other"');
    expect(markup()).not.toContain('In this design');
  });
});
