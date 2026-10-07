/**
 * The styles every entry needs (P6-01, ADR-0075 §1): the bundled font faces
 * and the app stylesheet. `entry/web.tsx` and `entry/desktop.tsx` import it, so
 * the Electron renderer gets the same look as the web build.
 */
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../app.css';
