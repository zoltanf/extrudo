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

`package` writes unsigned installers to `apps/desktop/release/` (gitignored):
AppImage and deb on Linux, an NSIS installer on Windows, a dmg and a zip on
macOS, named `extrudo-<version>-<os>-<arch>.<ext>`. The configuration is
`apps/desktop/electron-builder.yml`. Building for another OS than the one you
are on is not supported; the `desktop` workflow builds all three (`docs/deploy.md`).

The workspace keeps `electron: false` in `pnpm-workspace.yaml`, so `pnpm install`
does not download Electron's binary. `dev` needs it once:
`node apps/desktop/node_modules/electron/install.js`. `package` does not (electron-builder
downloads the Electron it packs itself), but running the result does.

## Smoke test

`apps/desktop/scripts/smoke.mjs` launches the app and waits for the kernel to
compute a new design. `--app <path>` launches a packaged AppImage instead; main
reads the environment variable `EXTRUDO_USER_DATA` as its data directory, which
the script points at a temporary directory. Both need a display (`xvfb-run -a`).
