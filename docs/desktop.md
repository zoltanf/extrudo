# The desktop app

The Electron app lives in `apps/desktop` (ADR-0075): the web app's own UI over a
Node-fs project store. There is no README in that package; this is its guide.

```sh
pnpm --filter @extrudo/desktop dev       # run it, renderer with HMR
pnpm --filter @extrudo/desktop build     # main + preload + renderer into apps/desktop/out
pnpm --filter @extrudo/desktop package   # build, then electron-builder for this OS
pnpm --filter @extrudo/desktop package:linux   # also :win and :mac
```

## Packaging

`package` writes installers (macOS ad-hoc signed, nothing notarised) to `apps/desktop/release/` (gitignored):
AppImage and deb on Linux, an NSIS installer on Windows, a dmg and a zip on
macOS, named `extrudo-<version>-<os>-<arch>.<ext>`. The configuration is
`apps/desktop/electron-builder.yml`. On Arch-based systems (Arch, Omarchy,
Manjaro) an AppImage needs `fuse2` (`sudo pacman -S fuse2`), or run it with
`--appimage-extract-and-run`; with the latter, the in-app update may not replace
the file. Building for another OS than the one you
are on is not supported; the `desktop` workflow builds all three (`docs/deploy.md`).

The workspace keeps `electron: false` in `pnpm-workspace.yaml`, so `pnpm install`
does not download Electron's binary. `dev` needs it once:
`node apps/desktop/node_modules/electron/install.js`. `package` does not (electron-builder
downloads the Electron it packs itself), but running the result does.

## Slicers

"Open in slicer" (the Export dialog and the Send to Slicer tile, ADR-0062's
amendment) writes the file to `<temp>/extrudo-slicer/<name>` (`app.getPath('temp')`;
directory mode 0700, emptied when the app quits) and starts the slicer on it.
It finds PrusaSlicer, OrcaSlicer, Bambu Studio and Cura on `PATH` or as a flatpak
(Linux), in `Program Files` or `%LOCALAPPDATA%\Programs` (Windows) and in
`/Applications` (macOS). For a slicer installed elsewhere add its path to
`preferences.json` in the app's user data directory:

```json
{ "slicers.paths": { "orcaslicer": "/opt/orca/orca-slicer", "cura": "D:\\Cura\\UltiMaker-Cura.exe" } }
```

(slicer IDs: `prusaslicer`, `orcaslicer`, `bambustudio`, `cura`; there is no UI
for it yet). Flatpak slicers get the file through the document portal.

## Smoke test

`apps/desktop/scripts/smoke.mjs` launches the app and waits for the kernel to
compute a new design. `--app <path>` launches a packaged AppImage instead; main
reads the environment variable `EXTRUDO_USER_DATA` as its data directory, which
the script points at a temporary directory. Both need a display (`xvfb-run -a`).

## Updates

The packaged app checks the **published** GitHub releases of `zoltanf/extrudo`
with `electron-updater` (ADR-0075's slice 4 amendment): 10 s after it starts,
every six hours, when the window gets focus more than an hour after the last
check, and from Help › Check for Updates…. A draft release is invisible to it,
so publishing the release is what ships an update. Prereleases are ignored.

| Install | What happens |
|---|---|
| Linux AppImage | downloads in the background; "Extrudo 0.5.0 is ready." with **Restart** (saves every open design, then installs and relaunches), or installs on the next quit |
| Windows (NSIS) | the same |
| Linux deb | "Extrudo 0.5.0 is available." with **Open the release page**: the package manager owns a deb, so nothing is downloaded |
| macOS | the same as a deb: Squirrel.Mac refuses an ad-hoc signed app, and a certificate is deferred until the app has users (owner, 2026-10-07) |

`electron-builder` writes `app-update.yml` into the package from
`electron-builder.yml`'s `publish` block, and the manifests the updater reads
(`latest-linux.yml`, `latest.yml` for Windows, `latest-mac.yml`) beside the
installers; a `v*` tag attaches them to the release with the installers. A dev
run (`app.isPackaged` false) never checks, and **`EXTRUDO_DISABLE_UPDATES=1`**
turns the updater off in a packaged app (the smoke test sets it, so CI never
asks GitHub). A failed check is logged and kept in the notification history
without a toast.

## Install on macOS with Homebrew

The macOS build is also a Homebrew cask. The `desktop` workflow's `homebrew`
job renders `apps/desktop/homebrew/extrudo.rb.template` from the
`extrudo-<version>-mac-arm64.zip` it just built (the sha256 included; the
renderer is `apps/desktop/homebrew/render.mjs` and its test pins the output)
and pushes `Casks/extrudo.rb` to the tap
[`zoltanf/homebrew-extrudo`](https://github.com/zoltanf/homebrew-extrudo) as
one commit per release ("Extrudo <version>"). Install:

```sh
brew install --cask zoltanf/extrudo/extrudo
```

The app is signed ad hoc, with no Apple certificate (ADR-0075's amendments), so
macOS asks before the first open: open the app, and when it says it can't
verify it, go to **System Settings › Privacy & Security** and choose **Open
Anyway**. For the v0.4.1 build, which says "damaged", run once in Terminal:
`xattr -dr com.apple.quarantine /Applications/Extrudo.app`. Since the app's own updater only notifies on macOS (the
table above), **`brew upgrade` is the update path there**. One-time setup and
the per-release check are in `docs/release-checklist.md`.
If a tag's cask was not pushed, `gh workflow run desktop.yml --ref main -f
cask_tag=v0.4.1` runs only the cask job again, with the zip from that release.
