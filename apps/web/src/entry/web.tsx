/**
 * The web entry (P6-01, ADR-0075 §1): what `main.tsx` used to be. It boots
 * `webPlatform()` and registers the service worker (a web build only; the
 * Electron build's `entry/desktop.tsx` never does).
 */
import './styles';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App';
import { applyInitialTheme, ToastsOnly, TooltipProvider } from '../design-system';
import { registerServiceWorker, webPlatform, webPreferences } from '../platform';
import { RootBoundary } from '../RootBoundary';
import { StartupError } from '../StartupError';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// The theme first, so the first paint has the right colours.
applyInitialTheme(webPreferences());
const reactRoot = createRoot(root);

// Until the app opens there is no app to draw a toast, and an IndexedDB upgrade
// waiting for another tab has to say so somewhere (the platform pushes to the
// page's notification store).
reactRoot.render(
  <StrictMode>
    <TooltipProvider>
      <ToastsOnly />
    </TooltipProvider>
  </StrictMode>,
);

webPlatform().then(
  (platform) =>
    reactRoot.render(
      <StrictMode>
        <RootBoundary>
          <TooltipProvider>
            <App platform={platform} />
          </TooltipProvider>
        </RootBoundary>
      </StrictMode>,
    ),
  (error: unknown) => reactRoot.render(<StartupError error={error} />),
);

registerServiceWorker();
