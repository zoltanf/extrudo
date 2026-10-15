# ADR-0085: The About dialog and the web build's version

- **Status:** Accepted, 2026-10-14 (the owner approved the prototype).
- **Builds on:** ADR-0054 (headers, CSP: no cross-origin loads), ADR-0075 (the
  desktop app and its window rules), ADR-0057 (the stable and edge
  deployments), ADR-0080 (docs links through the platform).
- **No schema change.**

## Context

The desktop app had a version (its installer's); the web app had none, and a
bug report said nothing about which build, browser or GPU it came from. The
desktop window denies new windows, so a plain `<a target="_blank">` does
nothing there.

## Decision

1. **Version scheme.** From the last release tag (`git describe --tags --match
   'v[0-9]*' --long`): stable `0.6.1`; edge `0.6.1+edge.17` (17 commits after
   v0.6.1); a local build `0.6.1+dev.17`; without git, the package version.
   The tag exactly at HEAD gives the plain version on every channel.
   `apps/web/pwa/build-info.ts` computes it at build time and vite injects it
   as `__EXTRUDO_BUILD__` (the desktop renderer build does the same).
2. **Build metadata, not a pre-release.** `0.7.0-dev.N` would sort and read as
   *older* than 0.7.0; an edge build is *newer* than the tag it follows, and
   `+edge.N` says so without claiming the next version number.
3. **Channel from `EXTRUDO_CHANNEL`** (`edge`, `stable`; anything else is
   `dev`), set by `deploy.yml`'s matrix and by `desktop.yml` for `v*` tags.
   Both workflows check out the full history (`fetch-depth: 0`), which `git
   describe` needs.
4. **The dialog** (Help › About Extrudo, the `about` command, the home bar's
   About button, the macOS app menu): version chip and channel, a
   "Build" section (commit linking to GitHub, build time), "Running on" (app
   mode, browser, system, processor, graphics, screen, kernel worker status
   and WASM memory, JS heap, storage, service worker, language, isolation) and
   "Engines" (OCCT, planegcs and OpenSCAD hashes/versions, three.js, React).
   Everything comes from the browser's own APIs and nothing is sent anywhere;
   Copy details puts it all on the clipboard. The logo replays being sketched
   and extruded when clicked.
5. **Links through the platform.** `Platform.openLink(url)`: a new tab on the
   web; on the desktop `link:open` to main, which opens only an https URL
   without credentials or port whose host and path match its fixed allow-list
   (`apps/desktop/src/main/links.ts`; a prefix matches the path or the path
   plus `/`). Every URL the dialog links to is in
   `apps/web/src/shell/aboutLinks.ts`, and a desktop test checks each is
   allowed. The credits line links each project's upstream repository, muted
   and underlined.
6. **macOS.** The app menu's About Extrudo runs the `about` command in the
   renderer instead of Electron's native panel; the home screen answers it
   with its own `menu:run` listener (it does not mark the menu as listening).

## Amendment, 2026-10-14 (the owner's decisions after main moved on)

The branch was written before ADR-0079 round 5 (the app menu and the home
bar). Merged, it keeps three decisions:

1. **The home bar's About opens the dialog**, not the landing site: in
   `HomeScreen.tsx` it is a button with a `TopLink`'s look (`TopLinkButton`,
   one shared class), opening `AboutDialog`. Docs and GitHub stay links.
   `openSite('about')` is gone.
2. **No Help menu on the home screen.** The home bar keeps Docs/GitHub and the
   app menu; its `menu:run` listener stays for the macOS app menu's About
   Extrudo, which opens the same dialog. In the app bar the Help menu is the
   `HelpMenu` component (main's inline menu), ending Check for Updates…
   (desktop) · Source on GitHub · About Extrudo (last).
3. **Two link mechanisms stay.** `openSite(name)` for the fixed named pages
   (only `repo` now; main holds the URL) and `openLink(url)` with main's
   allow-list for the dialog's URLs, which can carry a hash (a commit link).
   Folding them into one was rejected for now: a name-only mechanism cannot
   express the commit URL, and the allow-list URL mechanism in the top bar
   would take a URL from the renderer, which the docs/site openers avoid.

## Rejected

- **A CI run number** as the version: says nothing about the code's relation
  to a release, and a local build has none.
- **A version file bumped by CI**: a commit per deploy, or a file that is
  wrong between bumps. The tag already is the source of truth.
- **Electron's native About panel**: no build channel, no system info, no
  shared code with the web.
