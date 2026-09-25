import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyInitialTheme, TooltipProvider } from './design-system';
import { webPlatform, webPreferences } from './platform';
import { StartupError } from './StartupError';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// The theme first, so the first paint has the right colours.
applyInitialTheme(webPreferences());
const reactRoot = createRoot(root);

webPlatform().then(
  (platform) =>
    reactRoot.render(
      <StrictMode>
        <TooltipProvider>
          <App platform={platform} />
        </TooltipProvider>
      </StrictMode>,
    ),
  (error: unknown) => reactRoot.render(<StartupError error={error} />),
);
