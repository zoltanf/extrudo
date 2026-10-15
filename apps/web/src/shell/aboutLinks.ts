/**
 * Every address the About dialog links to (ADR-0085). The desktop's main
 * process opens a link only when it is on its own allow-list
 * (`apps/desktop/src/main/links.ts`), and a test there checks that each URL
 * below is allowed: a new link goes here, and into that list if it is a new
 * address.
 */
export const REPO = 'https://github.com/zoltanf/extrudo';
export const SITE = 'https://extrudo.org';
export const COMMIT_URL = (commit: string) => `${REPO}/commit/${commit}`;
export const ISSUES_URL = `${REPO}/issues/new`;
export const CHANGELOG_URL = `${REPO}/blob/main/docs/CHANGELOG.md`;
export const LICENSE_URL = `${REPO}/blob/main/LICENSE`;
export const NOTICE_URL = `${REPO}/blob/main/NOTICE`;

/** The "Made with" line: each project's upstream repository. */
export const CREDITS: readonly { name: string; url: string; desktopOnly?: true }[] = [
  { name: 'OCCT', url: 'https://github.com/Open-Cascade-SAS/OCCT' },
  { name: 'planegcs', url: 'https://github.com/Salusoft89/planegcs' },
  { name: 'Manifold', url: 'https://github.com/elalish/manifold' },
  { name: 'OpenSCAD', url: 'https://github.com/openscad/openscad' },
  { name: 'QuickJS', url: 'https://github.com/justjake/quickjs-emscripten' },
  { name: 'three.js', url: 'https://github.com/mrdoob/three.js' },
  { name: 'Electron', url: 'https://github.com/electron/electron', desktopOnly: true },
  { name: 'React', url: 'https://github.com/facebook/react' },
];

/** All of them, for the desktop's allow-list test. */
export const ABOUT_LINKS: readonly string[] = [
  SITE,
  REPO,
  COMMIT_URL('0123abc'),
  ISSUES_URL,
  CHANGELOG_URL,
  LICENSE_URL,
  NOTICE_URL,
  ...CREDITS.map((c) => c.url),
];
