# Release checklist: v0.3.0 and going public

Everything the code can do for the release is done (P3-15, ADR-0054). What is
left needs the owner: accounts, repository settings and the machines the agents
cannot reach. Tick them off in order; each box says who and where.

## Before going public

- [ ] **Read the audit.** The public-readiness audit (ADR-0054, "The audit") found
  one thing for you: every commit's author address is a personal one
  (see below). Decide whether to rewrite history before the repository is public.
  Nothing else was found: no credentials, tokens, private addresses, home
  paths or machine names, in the tree or in history.
- [ ] **Commit author address.** All commits carry the owner's own email address as
  author and committer. If you do not want it public: rewrite history once,
  before making the repository public, for example with
  `git filter-repo --mailmap` mapping it to your GitHub noreply address
  (`<id>+<user>@users.noreply.github.com`), then force-push. Tags (`occt-*`) and
  the releases that carry the WASM must be kept or recreated (CI republishes a
  release for a hash that is missing). After this, set
  `git config user.email` to the noreply address for new commits.
- [ ] **Code of Conduct contact.** `CODE_OF_CONDUCT.md` points reporters to GitHub's
  "Report content" and to an issue asking for a private channel; there is no
  email address on purpose. If you want a project address (not a personal
  one), put it in the "Enforcement" section; the spot is marked with an HTML
  comment.
- [ ] **Slicer check of the exports** (ADR-0034), on the Arch workstation with
  the real GUIs: export the Wall bracket and the PCB enclosure from the app
  as 3MF, STL and STEP, and open each in OrcaSlicer and PrusaSlicer (and
  Bambu Studio if you have it). Look for: the model opens without a repair
  prompt, one object per body with its name, colours kept in the 3MF,
  dimensions right in mm, no "non-manifold" or "open edges" warning, it
  slices, and the STEP opens in FreeCAD with solids and names. Note
  anything odd as an issue.
- [ ] **Look at the app once, fresh.** `pnpm dev` or the CI build in a clean
  browser profile: the tour, a template, a print export, offline after a
  reload.

## Make the repository public

- [ ] GitHub > Settings > General > Danger Zone > **Change visibility** > Public.
- [ ] Settings > Code security: enable **Private vulnerability reporting**
  (SECURITY.md sends reporters there), and the dependency graph and Dependabot
  alerts if you want them.
- [ ] Settings > General > Features: enable **Discussions** if you want a place
  for questions (CONTRIBUTING.md mentions it only "if enabled"). Issues stay on.
- [ ] Settings > General: add a description ("Parametric CAD for 3D printing, in
  your browser") and topics (`cad`, `3d-printing`, `parametric`, `webassembly`,
  `opencascade`, `pwa`). Set the website to <https://extrudo.org> once it is up.
- [ ] Settings > Branches: protect `main` (require CI to pass, no force pushes)
  if you want; the deploy workflow only runs for commits whose CI passed.
- [ ] Actions: nothing to enable. The first public push runs CI; the OCCT and
  planegcs WASM releases already exist and are published as releases of this
  repository, which becomes downloadable without `gh` once it is public.
- [ ] Social preview: Settings > General > Social preview > upload
  `apps/web/public/og-image.png`.

## Hosting (docs/deploy.md has the steps)

- [ ] Cloudflare: create the Pages project `extrudo` (Direct Upload).
- [ ] Create the API token (Cloudflare Pages: Edit) and add the secrets
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- [ ] Run the Deploy workflow; open <https://extrudo.pages.dev> and check the
  site (isolated, `sw.js` not cached, no red console lines, offline works
  after the first load, installable).
- [ ] **Attach `extrudo.org`** (registered 2026-10-02) to the Pages project:
  Custom domains > Set up a custom domain, and a `www` redirect if you want one
  (`docs/deploy.md`). The build already uses `https://extrudo.org` for the
  canonical link and the link previews; no variable is needed. Then check
  <https://extrudo.org> the same way.

## Release

- [ ] Merge the P3-15 branch to `main` and let CI and the first deploy go green.
- [ ] Tag it: `git tag -a v0.3.0 -m "v0.3.0" && git push origin v0.3.0`. (All
  package versions are already 0.3.0.)
- [ ] GitHub > Releases > **Draft a new release** for `v0.3.0`. Use the
  `## v0.3.0` section of `docs/CHANGELOG.md` for the notes (grouped by task;
  trim it to a readable summary of what is new: sketching, solids, patterns,
  print aids, onboarding), link the hosted demo and `docs/file-format.md`, and
  say that it is the first public release and rough in places.
- [ ] Announce it where you like (a print-community forum, a short demo video).
  Have the demo ready: the tutorial's box, the Wall bracket with a parameter
  change, an export into a slicer.

## After

- [ ] Watch the first issues; the templates ask for a `.extrudo` file and
  console errors.
- [ ] Next up is Phase 4 of `docs/03-roadmap.md`.
