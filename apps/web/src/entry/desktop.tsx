/**
 * The Electron renderer entry (P6-01, ADR-0075 §1): the same UI as the web
 * entry, booted with `desktopPlatform()` instead of `webPlatform()` and with
 * no service worker. `apps/desktop/src/renderer/main.tsx` calls it, passing the
 * platform factory and the synchronous desktop preferences (the theme is
 * applied before the platform resolves).
 */
import './styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App';
import { applyInitialTheme, ToastsOnly, TooltipProvider } from '../design-system';
import type { Platform, Preferences } from '../platform';
import { StartupError } from '../StartupError';

export function bootDesktop(
  createPlatform: () => Promise<Platform>,
  preferences: Preferences,
  onPlatform?: (platform: Platform) => void,
): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');

  applyInitialTheme(preferences);
  const reactRoot = createRoot(root);

  reactRoot.render(
    <StrictMode>
      <TooltipProvider>
        <ToastsOnly />
      </TooltipProvider>
    </StrictMode>,
  );

  createPlatform().then(
    (platform) => {
      // The desktop entry registers the native menu's open-file handler here,
      // before the app mounts, and then tells main the renderer is listening
      // (a file the association opened before this is queued in main).
      onPlatform?.(platform);
      reactRoot.render(
        <StrictMode>
          <TooltipProvider>
            <App platform={platform} />
          </TooltipProvider>
        </StrictMode>,
      );
    },
    (error: unknown) => reactRoot.render(<StartupError error={error} />),
  );
}

export * from './kit';
