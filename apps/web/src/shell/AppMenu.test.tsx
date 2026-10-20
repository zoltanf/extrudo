// The app menu's panel (ADR-0090): its structure as static markup, without the popover.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { TooltipProvider } from '../design-system';
import type { UpdateState } from '../platform/updates';
import { DEFAULT_SETTINGS } from '../viewport/store';
import { MenuPanel, type MenuPanelProps, updateWord } from './AppMenu';

const markup = (over: Partial<MenuPanelProps> = {}) =>
  renderToStaticMarkup(
    <TooltipProvider>
      <MenuPanel
        display={{ get: () => DEFAULT_SETTINGS, set: vi.fn(), subscribe: () => () => {} }}
        theme="dark"
        onThemeChange={vi.fn()}
        markingRadial
        onMarkingRadial={vi.fn()}
        autoProject
        autoProjectFace={false}
        preset="spindle"
        help={undefined}
        choose={(run) => run}
        onSettings={vi.fn()}
        onSearch={vi.fn()}
        onAbout={vi.fn()}
        onReportBug={vi.fn()}
        onTutorial={vi.fn()}
        onDocs={vi.fn()}
        version="0.7.0"
        onSource={vi.fn()}
        {...over}
      />
    </TooltipProvider>,
  );

/** The accessible names of one role's elements inside the element named `group`, in order. */
function names(html: string, group: string, attr = 'aria-label'): string[] {
  const start = html.indexOf(`aria-label="${group}"`);
  const end = html.indexOf('</div>', start);
  const part = html.slice(start, end);
  return [...part.matchAll(new RegExp(`${attr}="([^"]*)"`, 'g'))]
    .map((m) => m[1] as string)
    .slice(1);
}

const itemTexts = (html: string, menu: string) => {
  const start = html.indexOf(`role="menu" aria-label="${menu}"`);
  const end = html.indexOf('</div>', start);
  return [...html.slice(start, end).matchAll(/<span class="min-w-0 flex-1 truncate">([^<]*)/g)].map(
    (m) => m[1],
  );
};

describe('the app menu panel', () => {
  it('has the rail: six presets in order, Slicer disabled, three toggles, three themes', () => {
    const html = markup();
    expect(names(html, 'Mouse controls')).toEqual([
      'Crank',
      'Spindle',
      'Glide',
      'Blender',
      'Slicer',
      'Trackpad',
    ]);
    expect(html).toMatch(/aria-label="Slicer" aria-checked="false" aria-disabled="true"/);
    expect(html).toMatch(/aria-label="Spindle" aria-checked="true"/);
    expect(html).toMatch(/aria-label="Auto-project body edges" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="Auto-project face outline" aria-pressed="false"/);
    expect(html).toMatch(/aria-label="Radial right-click menu" aria-pressed="true"/);
    expect(names(html, 'Theme')).toEqual(['System', 'Light', 'Dark']);
    expect(html).toMatch(/aria-label="Dark" aria-checked="true"/);
  });

  it('has the App and Learn columns in order; Help for <tool> only with a tool', () => {
    let html = markup();
    expect(itemTexts(html, 'App')).toEqual([
      'Search…',
      'Settings…',
      'Report a bug',
      'About Extrudo',
    ]);
    expect(itemTexts(html, 'Learn')).toEqual([
      'User Guide',
      'Tutorial',
      'Online Tutorials',
      'Examples',
      'Tool Reference',
    ]);
    html = markup({
      help: { label: 'Extrude', onHelp: vi.fn() },
      onCloseDesign: vi.fn(),
      onSearch: undefined,
    });
    expect(itemTexts(html, 'Learn')[0]).toBe('Help for Extrude');
    expect(itemTexts(html, 'App')).toEqual([
      'Settings…',
      'Report a bug',
      'About Extrudo',
      'Close design',
    ]);
    expect(markup({ onQuit: vi.fn() })).toContain('>Quit<');
  });

  it('says the update state in words in the strip, with Check now on the desktop only', () => {
    const strip = (state: UpdateState, over: Partial<MenuPanelProps> = {}) => {
      // Static markup reads a store's initial state.
      const store = createStore<UpdateState>(() => state);
      return markup({ updates: { store, apply: async () => false }, ...over });
    };
    expect(strip({ waiting: false })).toContain('data-update-word=""');
    expect(strip({ waiting: true, version: '0.8.0' })).toContain(
      'data-update-word="Update ready: 0.8.0"',
    );
    expect(strip({ waiting: false, check: 'checking' })).toContain('data-update-word="Checking…"');
    expect(strip({ waiting: false, check: 'current' })).toContain('data-update-word="Up to date"');
    expect(markup()).toContain('0.7.0');
    expect(markup()).not.toContain('Check now');
    expect(markup({ onCheckUpdates: vi.fn() })).toContain('Check now');
    expect(markup()).toContain('GitHub');
  });

  it('gives each state a dot colour as well as the word', () => {
    expect(updateWord(undefined)).toEqual({ dot: 'bg-muted' });
    expect(updateWord({ waiting: true }).dot).toBe('bg-warning');
    expect(updateWord({ waiting: false, check: 'current' }).dot).toBe('bg-success');
  });
});
