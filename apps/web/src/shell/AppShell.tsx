import type { DocumentStore } from '@extrudo/core';
import { useMemo, useState } from 'react';
import { useShortcuts } from '../commands/shortcuts';
import { useTheme } from '../design-system';
import { ParametersDialog } from '../parameters/ParametersDialog';
import type { Platform } from '../platform';
import { AppBar } from './AppBar';
import { BROWSER_ID, BrowserPanel } from './BrowserPanel';
import { Splitter, usePanel } from './panels';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import type { ToolId } from './tools';
import { ViewportPlaceholder } from './Viewport';

export interface AppShellProps {
  store: DocumentStore;
  platform: Platform;
}

/** The app shell (P0-04, UI spec §2): app bar, toolbar, browser, viewport, timeline. */
export function AppShell({ store, platform }: AppShellProps) {
  const { choice, setChoice } = useTheme(platform.preferences);
  const browser = usePanel(platform.preferences, { key: 'browser', size: 248, min: 180, max: 480 });
  const timeline = usePanel(platform.preferences, { key: 'timeline', size: 0, min: 0, max: 0 });
  const [parametersOpen, setParametersOpen] = useState(false);

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
        <ViewportPlaceholder />
      </main>
      <Timeline store={store} collapsed={timeline.collapsed} onToggle={timeline.toggle} />
      <ParametersDialog store={store} open={parametersOpen} onOpenChange={setParametersOpen} />
    </div>
  );
}
