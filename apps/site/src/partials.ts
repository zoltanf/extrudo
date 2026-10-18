/**
 * The pieces every page of the landing site shares (ADR-0057's amendment of
 * 2026-10-11): the icon sprite, the header and the footer. vite.config.ts writes
 * them into `index.html` and `features/index.html` in place of the comments
 * `<!-- site:sprite -->`, `<!-- site:header -->` and `<!-- site:footer -->`, before
 * the addresses (`__APP_URL__`, …) are filled in. Plain strings, so the pages stay
 * static HTML with no runtime DOM building (ADR-0057's amendment of 2026-10-05).
 */

/** The pages that carry the shared header; the current one is marked in the nav. */
export type SitePage = 'home' | 'features' | 'download';

/** Which page a path is (`ctx.path` in Vite's HTML transform: `/features/index.html`). */
export function pageOf(path: string): SitePage {
  if (path.startsWith('/features/')) return 'features';
  if (path.startsWith('/download/')) return 'download';
  return 'home';
}

/** The app's own two-tone icons, used with `<use href="#i-…">`. */
export const SPRITE = `<svg class="sprite" aria-hidden="true" focusable="false">
      <symbol id="i-sketch" viewBox="0 0 24 24"><rect x="3" y="8" width="13" height="13" rx="2.5" stroke-dasharray="3 2.6" /><path class="f" d="M12.6 17.4 13.5 13.6 19.7 4.9A1.7 1.7 0 0 1 22.1 4.5 1.7 1.7 0 0 1 22.5 6.9L16.3 15.6Z" /></symbol>
      <symbol id="i-extrude" viewBox="0 0 24 24"><path class="f" d="M4 14.5 12 10.5 20 14.5 12 18.5Z" /><path d="M4 14.5V18.5L12 22.5 20 18.5V14.5M12 18.5V22.5" /><path d="M12 2.5V8.5M9 5.5 12 2.5 15 5.5" /></symbol>
      <symbol id="i-customizer" viewBox="0 0 24 24"><path d="M3.5 6.5H20.5M3.5 12H20.5M3.5 17.5H20.5" /><circle class="f" cx="8" cy="6.5" r="2.4" /><circle class="f" cx="15.5" cy="12" r="2.4" /><circle class="f" cx="11" cy="17.5" r="2.4" /></symbol>
      <symbol id="i-print" viewBox="0 0 24 24"><rect class="f" x="7" y="3" width="10" height="8" rx="1.5" /><path d="M12 13V17M10 15 12 17 14 15" /><path d="M3 20.5H21" /></symbol>
      <symbol id="i-home" viewBox="0 0 24 24"><path class="f" d="M4 11 12 4l8 7v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5Z" /><path d="M9.5 21v-6h5v6" /></symbol>
      <symbol id="i-open" viewBox="0 0 24 24"><path d="M8 7 3 12l5 5M16 7l5 5-5 5" /><circle class="f" cx="12" cy="12" r="2.6" /></symbol>
      <symbol id="i-file" viewBox="0 0 24 24"><path class="f" d="M6 3H14L19 8V21H6Z" /><path d="M14 3V8H19M9.5 13.5 12 11 14.5 13.5M12 11V17.5" /></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></symbol>
      <symbol id="i-sketch-plane" viewBox="0 0 24 24"><rect class="f" x="3.5" y="6" width="17" height="12" rx="1" /><path d="M12 12 20.5 6" stroke-dasharray="3 2.6" /><circle cx="12" cy="12" r="1.6" /></symbol>
      <symbol id="i-shell" viewBox="0 0 24 24"><path class="f" d="M3 8 12 4 21 8V17L12 21 3 17Z" /><path d="M7 9.5 12 7.3 17 9.5V15.3L12 17.5 7 15.3Z" /></symbol>
      <symbol id="i-pattern" viewBox="0 0 24 24"><rect class="f" x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" stroke-dasharray="2.4 2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" stroke-dasharray="2.4 2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" stroke-dasharray="2.4 2" /></symbol>
      <symbol id="i-fillet" viewBox="0 0 24 24"><path class="f" d="M4 4H20V12.5A7.5 7.5 0 0 1 12.5 20H4Z" /><path d="M20 16V20H16" stroke-dasharray="1.6 2.2" /></symbol>
    </svg>`;

/** The top bar: the logo (home) and the site's nav, with the current page marked. */
export function header(page: SitePage): string {
  const current = (p: SitePage) => (page === p ? ' aria-current="page"' : '');
  return `<header class="top">
      <a class="brand" href="/" aria-label="Extrudo home">
        <svg class="mark" width="32" height="32" viewBox="0 0 64 64" aria-hidden="true">
          <path class="mark-top" d="M10 24 24 10H52L38 24Z" />
          <path class="mark-side" d="M38 24 52 10V38L38 52Z" />
          <rect class="mark-sketch" x="10" y="24" width="28" height="28" rx="1" />
          <circle class="mark-dot" cx="10" cy="24" r="2.2" />
          <circle class="mark-dot" cx="38" cy="24" r="2.2" />
          <circle class="mark-dot" cx="10" cy="52" r="2.2" />
          <circle class="mark-dot" cx="38" cy="52" r="2.2" />
        </svg>
        <span class="wordmark">extrudo</span>
      </a>
      <nav aria-label="Site">
        <a href="/download/"${current('download')}>Apps</a>
        <a href="/features/"${current('features')}>Features</a>
        <a href="https://github.com/zoltanf/extrudo/blob/main/docs/CHANGELOG.md">Changelog</a>
        <a href="/docs/">Docs</a>
        <a href="https://github.com/zoltanf/extrudo">GitHub</a>
        <a class="button small" href="__APP_URL__/">Open Extrudo</a>
      </nav>
    </header>`;
}

/** The footer: contact, the project's links, the license and what the site counts. */
export const FOOTER = `<footer class="foot">
      <p data-contact>
        Questions or feedback? Write to
        <a href="mailto:__CONTACT_EMAIL__">__CONTACT_EMAIL__</a>.
      </p>
      <p>
        <a href="https://github.com/zoltanf/extrudo">Source code</a> ·
        <a href="https://github.com/zoltanf/extrudo/issues/new/choose">Report a problem</a> ·
        <a href="https://github.com/zoltanf/extrudo/blob/main/CODE_OF_CONDUCT.md">Code of conduct</a> ·
        <a href="https://github.com/zoltanf/extrudo/blob/main/docs/file-format.md">File format</a> ·
        <a href="/download/">Desktop app</a> ·
        <a href="/docs/api/" data-api-docs>API docs</a>
      </p>
      <p class="muted">Extrudo is free software under the GPL-3.0. It shares no code or artwork with any commercial CAD product.</p>
      <p class="muted" data-privacy>
        Privacy: this page counts visits with Cloudflare Web Analytics, which uses no cookies
        and builds no profile of you. The Extrudo app has no analytics, and your designs stay in
        your browser. Both are hosted on Cloudflare, which sees each visitor's IP address as any
        web host does
        (<a href="https://www.cloudflare.com/privacypolicy/">Cloudflare's privacy policy</a>).
      </p>
    </footer>`;

/** A page with its shared pieces written in; `page` marks the nav's current link. */
export function withPartials(html: string, page: SitePage): string {
  return html
    .replace('<!-- site:sprite -->', () => SPRITE)
    .replace('<!-- site:header -->', () => header(page))
    .replace('<!-- site:footer -->', () => FOOTER);
}
