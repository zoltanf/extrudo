/**
 * The docs pages in main (P6-06 S9, ADR-0080 §5): the renderer sends a
 * `docsPath` result over `docs:open` and main builds the URL itself — never a
 * URL from the renderer — and opens it with `shell.openExternal`, injected so
 * `docs.test.ts` can drive it. A path outside the whitelist is ignored.
 */
/** The landing site's docs, the same address the web app opens (`docsLinks.ts`). */
export const DOCS_URL = 'https://extrudo.org/docs';

/**
 * Every `docsPath` result (`apps/web/src/shell/docsLinks.ts`): the guide's
 * `/`, `/tutorials/`, `/examples/`, the tool index `/tools/` and a tool's
 * `/tools/<id>/`. Anything else — `..`, a full URL, a query or a name with a
 * space — is refused.
 */
const DOCS_PATH = /^\/(tools\/([A-Za-z0-9]+\/)?|tutorials\/|examples\/)?$/;

export interface Docs {
  /** Opens `DOCS_URL + path` for a whitelisted path; ignores anything else. */
  open(path: unknown): void;
}

/** Builds the docs opener over an injected `openExternal`-like dependency. */
export function createDocs(openExternal: (url: string) => void): Docs {
  return {
    open(path) {
      if (typeof path !== 'string' || !DOCS_PATH.test(path)) return;
      openExternal(DOCS_URL + path);
    },
  };
}
