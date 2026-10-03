import type { Plugin } from 'vite';

/**
 * Where the hosted app lives. One place for it (ADR-0054): the canonical link and the
 * Open Graph tags in `index.html` take it. Since ADR-0057 the stable app is at
 * app.extrudo.org (the latest build at edge.extrudo.org names it as canonical too) and
 * extrudo.org is the landing page (apps/site). A different address, say for a fork or a
 * staging site, is set with the `SITE_URL` environment variable at build time (the
 * deploy workflow passes the repository variable `APP_URL`), with no code change.
 */
export const DEFAULT_SITE_URL = 'https://app.extrudo.org';

/** The site's base URL without a trailing slash; throws for something that isn't http(s). */
export function siteUrl(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_SITE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SITE_URL must be a full URL like ${DEFAULT_SITE_URL}, got "${raw}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SITE_URL must be an http(s) URL, got "${raw}"`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/** Fills `__SITE_URL__` in index.html (dev and build). */
export function sitePlugin(value: string | undefined = process.env.SITE_URL): Plugin {
  const site = siteUrl(value);
  return {
    name: 'extrudo-site-url',
    transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', site),
  };
}
