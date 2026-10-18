---
title: The desktop app
section: Guide
order: 8
---

# The desktop app

The desktop app is the same Extrudo as in the browser, in its own window: the same screens, tools
and file format, from the same code. Use it if you prefer a program of your own to a browser tab,
if you want to open `.extrudo` files from your file manager, or if you want to send a model
straight to your slicer.

## Installing it

Installers are attached to each release on the project's
[releases page](https://github.com/zoltanf/extrudo/releases):

| System | What you download |
|---|---|
| Linux | An AppImage (make it executable and run it) or a `.deb` |
| Windows | An installer (`.exe`), or the portable `…-portable.exe`: nothing to install, keep it in a folder or on a USB stick, and your designs stay in an `Extrudo-data` folder next to it. It takes a few seconds to start, since it unpacks itself each time |
| macOS | A `.dmg`, or a `.zip` |

On Arch-based systems (Arch, Omarchy, Manjaro) an AppImage needs `fuse2`
(`sudo pacman -S fuse2`), or run it with `--appimage-extract-and-run`; with the
latter, the in-app update may not be able to replace the file.

On macOS you can also use Homebrew:

```sh
brew install --cask zoltanf/extrudo/extrudo
```

The installers are not signed yet, so your system may warn you the first time. On Windows,
choose **More info**, then **Run anyway**. On macOS, the Homebrew cask removes macOS's
quarantine flag for you, so the app opens straight away; install it only if you trust the tap. If
you downloaded the app yourself and macOS says it can't be opened, open **System Settings ›
Privacy & Security** and choose **Open Anyway** next to Extrudo's line. You do this once for each
install. If you still have the 0.4.1 build and macOS says Extrudo "is damaged and can't be
opened", run `xattr -dr com.apple.quarantine /Applications/Extrudo.app` once in Terminal; newer
builds show the normal prompt.

## What is different from the browser

Everything on the other pages of this guide applies. These things are added.

**Files and the menu.** On a Mac the window has the system menu bar, built from the same
commands as the toolbar and `Ctrl+K`: the **Home** tab's actions are in its **File** menu, which
also has **Open…**, **Open Recent** (the last ten files) and **Save As…**. On Windows and Linux
there is no menu bar: everything is in the top bar. The **Home** tab's **Design** group has
**Open File** (`Ctrl+O`) and **Save As** (`Ctrl+Shift+S`), its ▾ menu lists **Open Recent** and
**Clear Recent**, **Help** has **Check for Updates…** and `Ctrl+Q` quits (after saving your
open designs). On a Mac these keys are `⌘`.

**Opening `.extrudo` files.** Double-click an `.extrudo` file in your file manager and it opens in Extrudo. A design opened this way, or saved with **Save As…**,
stays linked to that file: every autosave writes the file as well. If the file changed on disk
in the meantime, nothing is overwritten and you choose between loading the disk's version and
overwriting it, just as with a [linked folder](./files.md).

**Send to Slicer.** In the 3D Print tab's Output group, **Send to Slicer** (and the **Open in
slicer** button in the Export dialog) hands the model to PrusaSlicer, OrcaSlicer, Bambu Studio
or Cura without a download step. Extrudo finds the slicers installed on your machine, and the
dialog greys out the ones it cannot find. The file goes in a temporary folder that is emptied when
you quit. See [getting it printed](./printing.md).

**Updates.** The app looks for a new release a few seconds after it starts, then every six
hours. What happens next depends on how you installed it:

| Install | When a new version is out |
|---|---|
| AppImage, Windows installer | It downloads in the background, then tells you it is ready. Press **Restart**, or let it install the next time you quit. It saves open designs first. |
| `.deb`, macOS | It tells you a new version is available, with a button for the release page. Your package manager or Homebrew (`brew upgrade`) does the update. |
| Windows portable | It tells you a new version is available, with a button for the release page. Download the new exe and keep your `Extrudo-data` folder next to it. |

**Check now** in the Menu's bottom strip (or Ctrl+K "Check for Updates…") checks right away.

## Connecting an agent

While the desktop app runs, it can serve the open design to AI agents such as Claude Code over
MCP. This happens on your computer only: an agent can read the design, set parameters, add
sketches and features, undo and export — and each change lands as one undo step named
"Agent: …", so Ctrl+Z takes the last one back. While an agent is connected, the top bar says
**Agent connected**.

Turn the server on or off in Settings › Desktop › Agents: there you find the switch, a line
saying whether the server listens, and **Copy client config**, which copies what you paste into
the agent to connect it. The server is on to begin with. The web app has none of this. A skill
for Claude Code comes with every release (`extrudo-skill-<version>.zip` on the releases page)
and teaches the agent how to model in Extrudo.

## Where your designs are kept

Designs are stored as files in a `projects` folder inside the app's user-data directory, which
your system decides (under your profile, not next to the program). The portable Windows exe is
the exception: its user data is the `Extrudo-data` folder next to the exe. They do not share storage
with the web app, so a design you made at the website is not in the desktop app until you
export it from one and import it into the other.

[Linked folders](./files.md) work here too, on a real folder of your disk.

Rescue copies of unsaved changes are written to disk as well, so a crash costs you a moment of
work, not a session.

The desktop app has no account or sign-in and does not send your designs anywhere. It uses the
internet to look for updates.
