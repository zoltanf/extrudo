# Release checklist

Two parts: **Every release**, the steps for each version (no boxes: they
repeat), and **History**, the one-time list for v0.4.0, the first public
release, kept as a record.

## Every release

The agent prepares, **the owner tags** (or tells the agent to, for that
release only), and the owner approves the notes before the release is
published. Versions come from `git describe` of the last `v*` tag: stable shows
`X.Y.Z`, edge `X.Y.Z+edge.N`.

1. **Test on edge.** Every green CI run on main deploys
   <https://edge.extrudo.org> (`docs/deploy.md`). Release only a main commit
   you have tried there.
2. **Release commit** (the agent), one commit "Version X.Y.Z": first
   `pnpm changelog` (folds every `docs/changelog.d/` fragment into the
   CHANGELOG's `## Unreleased` section and deletes the files), then the rest:
   every `package.json` version (not the spikes, which stay at 0.0.0), the
   CHANGELOG's `## Unreleased` heading to `## vX.Y.Z (YYYY-MM-DD)`, and the
   release line in `CLAUDE.md`. In the same commit, take the "Latest build"
   tags (`<span class="tag">`) off `apps/site/features/index.html` for the
   features the release ships: the site deploys from main, so they mark what
   app.extrudo.org doesn't have yet (ADR-0057's amendment of 2026-10-11).
3. **Wait for CI on main** for that commit (`gh run list -c <full sha>`; a
   short SHA finds nothing). Only tag a commit whose CI passed.
4. **Tag:** `git tag -a vX.Y.Z -m "vX.Y.Z" <commit> && git push origin vX.Y.Z`.
   The tag deploys the stable app at <https://app.extrudo.org> (ADR-0057), and
   the `desktop` workflow builds the Linux (AppImage, deb), Windows (NSIS and
   the portable exe) and macOS (dmg, zip) installers into a **draft** GitHub
   release, then pushes the Homebrew cask.
5. **Check the draft.** The Linux job's smoke test passed (its step prints
   `smoke: OK`; GPU errors under xvfb in the same log are expected), and so did the Windows job's two (it installs the NSIS installer and smoke-tests the installed app, then the portable exe). The draft
   holds the installers and `latest.yml`, `latest-mac.yml` and
   `latest-linux.yml`: the updater reads them, and without them nobody updates.
6. **Release notes** on the draft: a short highlights list, then the
   CHANGELOG's section for the version. Say the installers are unsigned
   (signing is deferred until the app has users; owner, 2026-10-07): macOS
   asks before the first open (`docs/desktop.md` has the steps), Windows shows
   SmartScreen ("More info" > "Run anyway").
7. **Publish = update.** Publishing ships the version to every installed app:
   AppImage and Windows download it within six hours (or at once from the Menu
   strip's Check now); deb, the portable Windows exe and macOS get "Extrudo <version> is available."
   with a link to the release page. Never publish a release you would not
   want every installed app to take.
8. **After publishing**, check:
   - <https://app.extrudo.org> shows the new version;
   - `curl -sL https://github.com/zoltanf/extrudo/releases/latest/download/latest-linux.yml`
     says `version: X.Y.Z`;
   - the tap `zoltanf/homebrew-extrudo` has the commit "Extrudo X.Y.Z"
     (`Casks/extrudo.rb`). If it is missing (the `homebrew` job failed),
     `gh workflow run desktop.yml --ref main -f cask_tag=vX.Y.Z` runs only that
     job, with the zip from the tag's release;
   - optionally, on a Mac: `brew upgrade` (or
     `brew install --cask zoltanf/extrudo/extrudo`), open the app, sketch a box.

## History: v0.4.0, the first public release

Everything the code could do for the release was done (P3-15, ADR-0054). This
list was what needed the owner: accounts, repository settings and the machines
the agents cannot reach. Open boxes were not confirmed done.

### Before going public

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

### Make the repository public

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

### Homebrew setup (P6-01's amendment)

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
### Hosting (docs/deploy.md has the steps)

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

### Three addresses (ADR-0057; docs/deploy.md, "Three addresses")

- [ ] Export any design made at `https://extrudo.org` (File > Export `.extrudo`).
- [x] Cloudflare: move `extrudo.org` and `www` from the `extrudo` project to
  `extrudo-site`; add `app.extrudo.org` to `extrudo`; add `edge.extrudo.org` and
  point its CNAME at `edge.extrudo.pages.dev`. Checked 2026-10-15: `extrudo.org`
  and `www` serve the landing page, `app.` and `edge.` the app.
- [x] Web Analytics **on** for `extrudo-site` (the landing page), **off** for
  `extrudo` (app. and edge.): Workers & Pages › project › Metrics › Web
  Analytics (ADR-0057 amendment). Done 2026-10-04.
- [ ] Check the landing page, its video and button, edge, and that an old
  `extrudo.org` visitor gets the landing page after a reload or two.

### Release

- [x] Merge the P3-15 branch to `main` and let CI and the first deploy go green.
  Done 2026-10-02 (`8810502`; first deploy after `ffe159a` replaced
  wrangler-action with `npx wrangler`). Paste secrets through the GitHub web
  page: `gh secret set`'s hidden prompt saved empty values once.
- [x] **Decided 2026-10-04: no v0.3.0 tag; the first public release is v0.4.0**
  (Phase 4: sweeps, threads, text, emboss, splines, customizer, tolerance,
  timeline groups, linked folders, import, canvas; the hardening of ADR-0067).
  Before the tag: the slicer check and the fresh look above, on
  <https://edge.extrudo.org> (the latest main). Then the agent bumps every
  package version to 0.4.0, renames the CHANGELOG's "v0.4 (Phase 4, in
  progress)" heading to "v0.4.0" and turns the README's status note and its
  _0.4_ marks into plain text for the release, in one commit, and **the owner tags that
  commit**: `git tag -a v0.4.0 -m "v0.4.0" <commit> && git push origin v0.4.0`.
  The tag deploys itself as the stable app (`app.extrudo.org`, ADR-0057) once
  that commit's CI on main passed. Tagged (`v0.4.0`, then `v0.4.1`).
- [ ] GitHub > Releases > **Draft a new release** for `v0.4.0`. Use the
  `## v0.4.0` and `## v0.3.0` sections of `docs/CHANGELOG.md` for the notes
  (grouped by task; trim them to a readable summary of what is new: sketching,
  solids, patterns, print aids, threads, text and emboss, import, the customizer,
  onboarding), link <https://extrudo.org> and `docs/file-format.md`, and say that
  it is the first public release and rough in places. As of 2026-10-15 there
  is no GitHub release for `v0.4.0` or `v0.4.1`; the first is Extrudo 0.5.0.
- [ ] Announce it where you like (a print-community forum, a short demo video).
  Have the demo ready: the tutorial's box, the Wall bracket with a parameter
  change, an export into a slicer.

### After

- [ ] Watch the first issues; the templates ask for a `.extrudo` file and
  console errors.
- [x] Next up is Phase 4 of `docs/03-roadmap.md`. Done apart from P4-12's backlog.
