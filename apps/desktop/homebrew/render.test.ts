import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDER = join(import.meta.dirname, 'render.mjs');
const DUMMY_SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** The cask render.mjs must print for the known pair below, byte-exact. */
const EXPECTED = `# Extrudo's Homebrew cask, rendered by the \`desktop\` workflow's \`homebrew\` job
# from the template in the main repository (P6-01, ADR-0075's amendment); do
# not edit by hand. Install with \`brew install --cask zoltanf/extrudo/extrudo\`.

cask "extrudo" do
  version "0.4.0"
  sha256 "${DUMMY_SHA}"

  url "https://github.com/zoltanf/extrudo/releases/download/v#{version}/extrudo-#{version}-mac-arm64.zip"
  name "Extrudo"
  desc "Parametric CAD for 3D printing"
  homepage "https://extrudo.org"

  livecheck do
    url "https://github.com/zoltanf/extrudo/releases/latest"
    strategy :github_latest
  end

  # The zip's top-level entry is \`Extrudo.app\` (electron-builder's zip target
  # archives the bundle from its parent directory; the runner is Apple silicon
  # — if an Intel zip ever exists, add an \`on_intel\` block).
  app "Extrudo.app"

  caveats do
    <<~EOS
      Extrudo is signed ad hoc, not with an Apple certificate (ADR-0075:
      signing is deferred until the app has users), so macOS asks before the
      first open: open the app, then go to System Settings > Privacy &
      Security and choose "Open Anyway" next to Extrudo. The app's own updater
      only notifies on macOS, so \`brew upgrade\` is the update path.
    EOS
  end

  # Electron's paths on macOS: userData is "Application Support/Extrudo" (the
  # productName in electron-builder.yml), the rest the bundle id
  # "org.extrudo.desktop" (the appId).
  zap trash: [
    "~/Library/Application Support/Extrudo",
    "~/Library/Caches/org.extrudo.desktop",
    "~/Library/HTTPStorages/org.extrudo.desktop",
    "~/Library/Logs/Extrudo",
    "~/Library/Preferences/org.extrudo.desktop.plist",
    "~/Library/Saved Application State/org.extrudo.desktop.savedState",
    "~/Library/WebKit/org.extrudo.desktop",
  ]
end
`;

describe('render.mjs', () => {
  it('renders the cask for a known version and sha, byte-exact', () => {
    const run = spawnSync(process.execPath, [RENDER, '0.4.0', DUMMY_SHA], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe(EXPECTED);
  });

  it('refuses a version that is not plain semver', () => {
    for (const version of ['v0.4.0', '0.4', '0.4.0-rc.1', '']) {
      const run = spawnSync(process.execPath, [RENDER, version, DUMMY_SHA], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('not plain semver');
      expect(run.stdout).toBe('');
    }
  });

  it('refuses a sha256 that is not 64 hex characters', () => {
    for (const sha of ['deadbeef', `${DUMMY_SHA}a`, `zz${DUMMY_SHA.slice(2)}`, '']) {
      const run = spawnSync(process.execPath, [RENDER, '0.4.0', sha], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('64 hex characters');
      expect(run.stdout).toBe('');
    }
  });

  it('takes exactly two arguments', () => {
    const run = spawnSync(process.execPath, [RENDER, '0.4.0'], { encoding: 'utf8' });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('usage:');
  });
});
