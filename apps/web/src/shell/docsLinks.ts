/**
 * Where the docs live (ADR-0080 §5, S9): the Help menu, Ctrl+K's Help
 * commands and a tile's F1 open the landing site's `/docs/` pages. The app's
 * own address is `SITE_URL` (`pwa/site.ts`); the docs belong to the landing
 * site, and a fork that hosts both its own way sets `VITE_DOCS_URL` at build
 * time (like `SITE_URL`, no code change).
 */
export const DOCS_URL: string = import.meta.env.VITE_DOCS_URL || 'https://extrudo.org/docs';

/**
 * A docs page: one of the top sections, a tool's generated reference, or a
 * guide page and one of its sections (ADR-0116 §4).
 */
export type DocsPage =
  | 'guide'
  | 'tutorials'
  | 'examples'
  | 'tools'
  | { tool: string }
  | { guide: string; anchor?: string };

/** A tool ID is a command ID: letters and digits only (`shell/tools.ts`). */
const TOOL_ID = /^[A-Za-z0-9]+$/;

/** A guide's or a section's name, as the docs headings' ids are (ADR-0116 §3). */
const SLUG = /^[a-z0-9-]+$/;

/**
 * The path under `DOCS_URL` for a page. A tool ID that isn't a plain command
 * ID (a plugin feature's `plugin:<plugin>:<type>`) has no generated page, so
 * it falls back to the tool index. A guide or anchor that isn't a plain slug
 * falls back to the guide, so a bad name can't build an odd address.
 */
export function docsPath(page: DocsPage): string {
  if (typeof page === 'object') {
    if ('tool' in page) {
      return TOOL_ID.test(page.tool) ? `/tools/${page.tool}/` : '/tools/';
    }
    return SLUG.test(page.guide) && (page.anchor === undefined || SLUG.test(page.anchor))
      ? `/${page.guide}/${page.anchor ? `#${page.anchor}` : ''}`
      : '/';
  }
  return page === 'guide' ? '/' : `/${page}/`;
}

/** The full address of a docs page. */
export function docsUrl(page: DocsPage): string {
  return DOCS_URL + docsPath(page);
}

/** The source code the GitHub link opens; a fork sets its own at build time. */
export const REPO_URL: string =
  import.meta.env.VITE_REPO_URL || 'https://github.com/zoltanf/extrudo';
