import type { DocumentStore, ModelStore } from '@extrudo/core';
import type { BodyMesh } from '@extrudo/kernel';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { useShortcuts } from '../commands/shortcuts';
import { useTheme } from '../design-system';
import { ParametersDialog } from '../parameters/ParametersDialog';
import type { Platform } from '../platform';
import { createViewportStore } from '../viewport/store';

// three.js loads in its own chunk, so the shell paints before it arrives.
const Viewport = lazy(() => import('../viewport/Viewport').then((m) => ({ default: m.Viewport })));

import { AppBar } from './AppBar';
import { BROWSER_ID, BrowserPanel } from './BrowserPanel';
import { Splitter, usePanel } from './panels';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import type { ToolId } from './tools';

export interface AppShellProps {
  store: DocumentStore;
  model: ModelStore<BodyMesh>;
  platform: Platform;
}

/** The app shell (P0-04, UI spec §2): app bar, toolbar, browser, viewport, timeline. */
export function AppShell({ store, model, platform }: AppShellProps) {
  const { choice, setChoice } = useTheme(platform.preferences);
  const browser = usePanel(platform.preferences, { key: 'browser', size: 248, min: 180, max: 480 });
  const timeline = usePanel(platform.preferences, { key: 'timeline', size: 0, min: 0, max: 0 });
  const [parametersOpen, setParametersOpen] = useState(false);
  const viewport = useMemo(
    () => createViewportStore({ preferences: platform.preferences }),
    [platform],
  );
  const bodies = useStore(model, (s) => s.bodies);
  const meta = useStore(store, (s) => s.doc.bodies);

  const shortcuts = useMemo(
    () => [
      { keys: 'Mod+Z', run: () => store.getState().undo() },
      { keys: 'Mod+Y', run: () => store.getState().redo() },
      { keys: 'Mod+Shift+Z', run: () => store.getState().redo() },
    ],
    [store],
  );
  useShortcuts(shortcuts);

  const run = (tool: ToolId) => {
    if (tool === 'parameters') setParametersOpen(true);
  };

  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-bg text-ink">
      <AppBar store={store} theme={choice} onThemeChange={setChoice} />
      <Toolbar onRun={run} />
      <main className="flex min-h-0">
        <BrowserPanel
          store={store}
          viewport={viewport}
          width={browser.size}
          collapsed={browser.collapsed}
          onToggle={browser.toggle}
        />
        {!browser.collapsed && (
          <Splitter
            label="Resize browser"
            controls={BROWSER_ID}
            size={browser.size}
            min={browser.min}
            max={browser.max}
            collapsed={browser.collapsed}
            onResize={browser.resize}
            onToggle={browser.toggle}
          />
        )}
        <Suspense
          fallback={
            <section
              aria-label="Viewport"
              aria-busy="true"
              className="min-w-0 flex-1"
              style={{ background: 'var(--x-viewport-glow)' }}
            />
          }
        >
          <Viewport viewport={viewport} bodies={bodies} meta={meta} />
        </Suspense>
      </main>
      <Timeline store={store} collapsed={timeline.collapsed} onToggle={timeline.toggle} />
      <ParametersDialog store={store} open={parametersOpen} onOpenChange={setParametersOpen} />
    </div>
  );
}
