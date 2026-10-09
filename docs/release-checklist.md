# Release checklist: v0.4.0, the first public release

Everything the code can do for the release is done (P3-15, ADR-0054). What is
left needs the owner: accounts, repository settings and the machines the agents
cannot reach. Tick them off in order; each box says who and where.

## Before going public

- [x] **Read the audit.** The public-readiness audit (ADR-0054, "The audit") found
  one thing for you: every commit's author address is a personal one
  (see below). Decide whether to rewrite history before the repository is public.
  Nothing else was found: no credentials, tokens, private addresses, home
  paths or machine names, in the tree or in history.
- [x] **Commit author address.** **Decided 2026-10-02: keep it, no rewrite.** The
  same address is already public in the owner's other repositories, so a
  rewrite here would hide nothing. For the record, the option that was not
  taken: all commits carry the owner's own email address as
  author and committer. If you do not want it public: rewrite history once,
  before making the repository public, for example with
  `git filter-repo --mailmap` mapping it to your GitHub noreply address
  (`<id>+<user>@users.noreply.github.com`), then force-push. Tags (`occt-*`) and
  the releases that carry the WASM must be kept or recreated (CI republishes a
  release for a hash that is missing). After this, set
  `git config user.email` to the noreply address for new commits.
- [x] **Code of Conduct contact.** Done 2026-10-02: `CODE_OF_CONDUCT.md` names the
  project address `conduct@extrudo.org` (Cloudflare Email Routing forwards it
  to the owner; `docs/deploy.md`) beside GitHub's "Report content". No
  personal address is in the repository.
- [x] **Slicer check of the exports** (ADR-0034), on the Arch workstation with
  the real GUIs: export the Wall bracket and the PCB enclosure from the app
  as 3MF, STL and STEP, and open each in OrcaSlicer and PrusaSlicer (and
  Bambu Studio if you have it). Look for: the model opens without a repair
  prompt, one object per body with its name, colours kept in the 3MF,
  dimensions right in mm, no "non-manifold" or "open edges" warning, it
  slices, and the STEP opens in FreeCAD with solids and names. Note
  anything odd as an issue.
  *Done 2026-10-08 by the owner on edge:* 3MF and STL in PrusaSlicer and
  OrcaSlicer (one multi-part object, bodies as named parts in place, colours
  kept, no repair prompt, "No errors detected", slices); STEP in FreeCAD
  (Wall bracket: one valid solid "Bracket", 12 faces, 40 × 80 × 60 mm; PCB
  enclosure: "Enclosure" 80 × 60 × 25 mm, 25,326 mm³ and "Lid" 80 × 60 × 3 mm,
  14,214 mm³, both valid, equal to the CLI's numbers; Check Geometry: no
  errors).
- [ ] **Look at the app once, fresh.** `pnpm dev` or the CI build in a clean
  browser profile: the tour, a template, a print export, offline after a
  reload.

## Make the repository public

- [x] GitHub > Settings > General > Danger Zone > **Change visibility** > Public.
  Done 2026-10-04 (after a history audit: nothing found). The settings below
  were done the same day: private vulnerability reporting, Discussions,
  description/topics/website, a ruleset on `main` (no deletion, no force
  pushes), the social preview; fork PR workflows need approval for all
  external contributors.
- [x] Settings > Code security: enable **Private vulnerability reporting**
  (SECURITY.md sends reporters there), and the dependency graph and Dependabot
  alerts if you want them.
- [x] Settings > General > Features: enable **Discussions** if you want a place
  for questions (CONTRIBUTING.md mentions it only "if enabled"). Issues stay on.
- [x] Settings > General: add a description ("Parametric CAD for 3D printing, in
  your browser") and topics (`cad`, `3d-printing`, `parametric`, `webassembly`,
  `opencascade`, `pwa`). Set the website to <https://extrudo.org> (the landing page).
- [x] Settings > Branches: protect `main` (require CI to pass, no force pushes)
  if you want; the deploy workflow only runs for commits whose CI passed.
- [x] Actions: nothing to enable. The first public push runs CI; the OCCT and
  planegcs WASM releases already exist and are published as releases of this
  repository, which becomes downloadable without `gh` once it is public.
- [x] Social preview: Settings > General > Social preview > upload
  `apps/web/public/og-image.png`.

## Desktop installers and updates (P6-01 slices 3 and 4)

- [ ] After you tag `v0.4.0`, the `desktop` workflow builds the Linux (AppImage,
  deb), Windows (NSIS) and macOS (dmg, zip) installers and attaches them to the
  **draft** GitHub release it creates. Check the Linux job's smoke test passed,
  then **publish the release**. The installers are unsigned (signing is
  deferred until the app has users; owner, 2026-10-07): macOS users must right-click > Open the app, and Windows shows a
  SmartScreen warning ("More info" > "Run anyway"). Say so in the release notes.
- [ ] **Publishing the release ships the update** (P6-01 slice 4): installed
  AppImage and Windows apps download it within six hours (or at once from Help ›
  Check for Updates…); deb and macOS users get "Extrudo <version> is available."
  with a link to the release page. Before publishing, check the draft holds
  `latest-linux.yml`, `latest.yml` and `latest-mac.yml` next to the installers
  (the updater reads them; without them nobody updates). Only tag a commit whose
  CI passed on main, and never publish a release you would not want every
  installed app to take: a published `v*` release is an update.

### Homebrew (P6-01's amendment)

The macOS build is installed and updated through Homebrew (`docs/desktop.md`);
the cask itself is rendered and pushed by the `desktop` workflow's `homebrew`
job, never by hand.

- [x] **One time: create the tap repository.** GitHub > New repository >
  `zoltanf/homebrew-extrudo` (public), with a README saying it is Extrudo's
  cask tap (the job `mkdir -p`s `Casks/` itself and writes `Casks/extrudo.rb`
  into it). The main repository keeps only the template and the job; nothing
  there is a cask Homebrew reads. Done 2026-10-07 (README on `main`).
- [x] **One time: add the secret.** GitHub > Settings > Developer settings >
  Fine-grained tokens: a PAT with **Contents: read/write** on
  `zoltanf/homebrew-extrudo` only (expiring whenever you like), then
  `zoltanf/extrudo` > Settings > Secrets and variables > Actions > add
  **`HOMEBREW_TAP_TOKEN`**. Without the secret the `homebrew` job skips itself
  cleanly and everything else builds. Done 2026-10-07.
- [ ] **Each release:** the `desktop` workflow's `homebrew` job pushed
  `Casks/extrudo.rb` to the tap (one commit "Extrudo <version>"; it runs only
  on the tag). On a Mac, install it fresh or upgrade from the last one:
  `brew install --cask zoltanf/extrudo/extrudo` (or `brew upgrade`), open the
  app (right-click › Open the first time), and sketch a box.
  If a tag's cask is missing (the job failed), publish it by hand with
  `gh workflow run desktop.yml --ref main -f cask_tag=v0.4.1`: only the
  `homebrew` job runs, taking the zip from that tag's release.

## Hosting (docs/deploy.md has the steps)

- [x] Cloudflare: create the Pages project `extrudo` (Direct Upload). Done
  2026-10-02 (`wrangler pages project create extrudo --production-branch main`).
- [x] Create the API token (Cloudflare Pages: Edit) and add the secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- [x] Run the Deploy workflow; open <https://extrudo.pages.dev> and check the
  site (isolated, `sw.js` not cached, no red console lines, offline works
  after the first load, installable).
- [x] **Attach `extrudo.org`** (registered 2026-10-02) to the Pages project:
  Custom domains > Set up a custom domain, and a `www` redirect if you want one
  (`docs/deploy.md`). The build already uses `https://extrudo.org` for the
  canonical link and the link previews; no variable is needed. Then check
  <https://extrudo.org> the same way. Done 2026-10-02 (apex and `www`), with the
  zone's Browser Cache TTL set to "Respect Existing Headers" so `sw.js` stays
  `no-cache`; the first deploy is live and the kernel starts there.

## Three addresses (ADR-0057; docs/deploy.md, "Three addresses")

- [ ] Export any design made at `https://extrudo.org` (File > Export `.extrudo`).
- [ ] Cloudflare: move `extrudo.org` and `www` from the `extrudo` project to
  `extrudo-site`; add `app.extrudo.org` to `extrudo`; add `edge.extrudo.org` and
  point its CNAME at `edge.extrudo.pages.dev`.
- [x] Web Analytics **on** for `extrudo-site` (the landing page), **off** for
  `extrudo` (app. and edge.): Workers & Pages › project › Metrics › Web
  Analytics (ADR-0057 amendment). Done 2026-10-04.
- [ ] Check the landing page, its video and button, edge, and that an old
  `extrudo.org` visitor gets the landing page after a reload or two.

## Release

- [x] Merge the P3-15 branch to `main` and let CI and the first deploy go green.
  Done 2026-10-02 (`8810502`; first deploy after `ffe159a` replaced
  wrangler-action with `npx wrangler`). Paste secrets through the GitHub web
  page: `gh secret set`'s hidden prompt saved empty values once.
- [ ] **Decided 2026-10-04: no v0.3.0 tag; the first public release is v0.4.0**
  (Phase 4: sweeps, threads, text, emboss, splines, customizer, tolerance,
  timeline groups, linked folders, import, canvas; the hardening of ADR-0067).
  Before the tag: the slicer check and the fresh look above, on
  <https://edge.extrudo.org> (the latest main). Then the agent bumps every
  package version to 0.4.0, renames the CHANGELOG's "v0.4 (Phase 4, in
  progress)" heading to "v0.4.0" and turns the README's status note and its
  _0.4_ marks into plain text for the release, in one commit, and **the owner tags that
  commit**: `git tag -a v0.4.0 -m "v0.4.0" <commit> && git push origin v0.4.0`.
  The tag deploys itself as the stable app (`app.extrudo.org`, ADR-0057) once
  that commit's CI on main passed.
- [ ] GitHub > Releases > **Draft a new release** for `v0.4.0`. Use the
  `## v0.4.0` and `## v0.3.0` sections of `docs/CHANGELOG.md` for the notes
  (grouped by task; trim them to a readable summary of what is new: sketching,
  solids, patterns, print aids, threads, text and emboss, import, the customizer,
  onboarding), link <https://extrudo.org> and `docs/file-format.md`, and say that
  it is the first public release and rough in places.
- [ ] Announce it where you like (a print-community forum, a short demo video).
  Have the demo ready: the tutorial's box, the Wall bracket with a parameter
  change, an export into a slicer.

## After

- [ ] Watch the first issues; the templates ask for a `.extrudo` file and
  console errors.
- [ ] Next up is Phase 4 of `docs/03-roadmap.md`.
