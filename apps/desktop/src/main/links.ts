/**
 * The About dialog's links in main (ADR-0085): the window denies new windows,
 * so the renderer sends a URL over `link:open` and main opens it with
 * `shell.openExternal` (injected, so `links.test.ts` can drive it) only when
 * it is on this list. Anything else is ignored: a renderer can't make main
 * open a page of its choosing.
 */
const ALLOWED: readonly { host: string; pathPrefix: string }[] = [
  { host: 'extrudo.org', pathPrefix: '/' },
  { host: 'github.com', pathPrefix: '/zoltanf/extrudo' },
  // The credits line (`apps/web/src/shell/aboutLinks.ts`).
  { host: 'github.com', pathPrefix: '/Open-Cascade-SAS/OCCT' },
  { host: 'github.com', pathPrefix: '/Salusoft89/planegcs' },
  { host: 'github.com', pathPrefix: '/elalish/manifold' },
  { host: 'github.com', pathPrefix: '/openscad/openscad' },
  { host: 'github.com', pathPrefix: '/justjake/quickjs-emscripten' },
  { host: 'github.com', pathPrefix: '/mrdoob/three.js' },
  { host: 'github.com', pathPrefix: '/electron/electron' },
  { host: 'github.com', pathPrefix: '/facebook/react' },
];

/** Whether `url` is an https address on the list: the prefix is the path itself or a parent of it. */
export function isAllowedLink(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    return false;
  }
  const path = parsed.pathname;
  return ALLOWED.some(
    (a) =>
      a.host === parsed.hostname &&
      (a.pathPrefix === '/' || path === a.pathPrefix || path.startsWith(`${a.pathPrefix}/`)),
  );
}

export interface Links {
  /** Opens an allowed URL; ignores anything else. */
  open(url: unknown): void;
}

/** Builds the link opener over an injected `openExternal`-like dependency. */
export function createLinks(openExternal: (url: string) => void): Links {
  return {
    open(url) {
      if (isAllowedLink(url)) openExternal(url as string);
    },
  };
}
