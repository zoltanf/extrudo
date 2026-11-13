// @vitest-environment jsdom
// The strip's Restart runs the update toast's path: save every design, then apply.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { TooltipProvider } from '../design-system';
import type { PlatformUpdates, UpdateState } from '../platform/updates';
import { DEFAULT_SETTINGS } from '../viewport/store';
import { MenuPanel } from './AppMenu';
import { applyUpdate } from './useUpdateNotice';

afterEach(cleanup);

function renderStrip(updates: PlatformUpdates, push = vi.fn()) {
  const choose = vi.fn((run: () => void) => run);
  render(
    <TooltipProvider>
      <MenuPanel
        display={{ get: () => DEFAULT_SETTINGS, set: vi.fn(), subscribe: () => () => {} }}
        theme="dark"
        onThemeChange={vi.fn()}
        markingRadial
        onMarkingRadial={vi.fn()}
        autoProject
        autoProjectSketches={false}
        autoProjectFace={false}
        preset="spindle"
        help={undefined}
        choose={choose}
        onSettings={vi.fn()}
        onAbout={vi.fn()}
        onTutorial={vi.fn()}
        onDocs={vi.fn()}
        version="0.9.0"
        updates={updates}
        onApplyUpdate={() => void applyUpdate(updates, push)}
        onSource={vi.fn()}
      />
    </TooltipProvider>,
  );
  return { choose, push };
}

describe("the app menu strip's Restart", () => {
  it('saves, then applies the downloaded update; the panel closes first', async () => {
    const store = createStore<UpdateState>(() => ({ waiting: true, version: '0.10.0' }));
    const apply = vi.fn(async () => true);
    const { choose, push } = renderStrip({ store, apply, action: 'Restart' });

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    await vi.waitFor(() => expect(apply).toHaveBeenCalledOnce());
    expect(push).not.toHaveBeenCalled();
    // Wrapped in `choose`, like the strip's GitHub: the panel closes before the restart.
    expect(choose).toHaveBeenCalled();
  });

  it('appears when the update arrives while the panel is open', () => {
    const store = createStore<UpdateState>(() => ({ waiting: false }));
    renderStrip({ store, apply: async () => true, action: 'Restart' });
    expect(screen.queryByRole('button', { name: 'Restart' })).toBeNull();
    act(() => store.setState({ waiting: true, version: '0.10.0' }, true));
    expect(screen.getByRole('button', { name: 'Restart' })).toBeTruthy();
  });
});
